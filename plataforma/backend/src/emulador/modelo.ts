// Modelo de tráfico del emulador de nodos (TT-28), según docs/10 §9.6: cada dispositivo tiene su periodo, las
// tramas llegan con latencia variable, se pierden, un nodo sin cobertura descarga su cola con marcas antiguas y los
// relojes derivan. Todo lo que aquí se decide es DETERMINISTA a partir de una semilla: la misma corrida se repite.
// Funciones puras, sin red ni reloj: se prueban solas (modelo.spec.ts). La parte que publica vive en emulador.ts.

export interface Opciones {
  dispositivos: number;   // cuántos nodos emulados
  periodoS: number;       // periodo nominal; cada nodo recibe entre 0,5× y 1,5× (no sincronizados)
  jitterS: number;        // latencia variable: ± este máximo sobre cada periodo
  pPerdida: number;       // probabilidad de que una trama no salga (0..1)
  derivaMs: number;       // deriva máxima del reloj del nodo, en ms por periodo (signo al azar)
  fraccionCaidas: number; // fracción de nodos que sufren caídas y luego descargan su cola en ráfaga
  semilla: number;
  sitio: string;
}

export interface Perfil {
  id: string;             // id_fisico (y usuario MQTT): emu-0001…
  periodoS: number;
  jitterS: number;
  pPerdida: number;
  derivaMsPorPeriodo: number;
  faseS: number;          // desfase inicial: no arrancan todos en el mismo segundo
  caliente: boolean;      // su temperatura cruza el umbral alto (30) de vez en cuando → ejercita alertas
  caida?: { cadaN: number; duraPeriodos: number };
  relojRoto?: 'epoch' | 'futuro'; // marca implausible: la regla 7 de docs/13 debe descartarla (origen 'recepcion')
}

// Generador pseudoaleatorio pequeño y reproducible (mulberry32). Math.random no admite semilla.
export function mulberry32(semilla: number): () => number {
  let a = semilla >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function perfiles(o: Opciones): Perfil[] {
  const rnd = mulberry32(o.semilla);
  return Array.from({ length: o.dispositivos }, (_, i) => {
    const periodoS = Math.round(o.periodoS * (0.5 + rnd()) * 10) / 10;
    const conCaida = rnd() < o.fraccionCaidas;
    const deriva = o.derivaMs * (rnd() * 2 - 1);
    const fase = rnd() * periodoS;
    const cadaN = 20 + Math.floor(rnd() * 20);
    const dura = 3 + Math.floor(rnd() * 5);
    return {
      id: `emu-${String(i + 1).padStart(4, '0')}`,
      periodoS,
      jitterS: o.jitterS,
      pPerdida: o.pPerdida,
      derivaMsPorPeriodo: deriva,
      faseS: fase,
      caliente: i % 10 === 5,
      caida: conCaida ? { cadaN, duraPeriodos: dura } : undefined,
      // Los dos primeros nodos (si existen) tienen el reloj roto: uno en 1970, otro una hora en el futuro.
      relojRoto: i === 0 ? 'epoch' : i === 1 ? 'futuro' : undefined,
    };
  });
}

// Siguiente espera entre envíos: periodo ± jitter, nunca menor que la mitad del periodo.
export function esperaS(p: Perfil, rnd: () => number): number {
  const jitter = (rnd() * 2 - 1) * p.jitterS;
  return Math.max(p.periodoS / 2, p.periodoS + jitter);
}

// Lectura sintética en el instante t (segundos desde el arranque): una senoidal lenta con ruido; los nodos
// «calientes» oscilan alrededor del umbral alto (30 Cel) para abrir y cerrar condiciones de umbral.
export function lectura(p: Perfil, tS: number, rnd: () => number): { temperatura: number; humedad: number } {
  const base = p.caliente ? 29 : 22;
  const temperatura = Math.round((base + 3 * Math.sin((2 * Math.PI * tS) / 300) + (rnd() - 0.5)) * 10) / 10;
  const humedad = Math.round((55 + 10 * Math.sin((2 * Math.PI * tS) / 900) + (rnd() - 0.5) * 2) * 10) / 10;
  return { temperatura, humedad };
}

// Marca de tiempo que el nodo pone en la trama (segundos Unix con milésimas), a partir de la hora real y su deriva.
export function marcaDelNodo(p: Perfil, ahoraMs: number, derivaAcumuladaMs: number): number {
  if (p.relojRoto === 'epoch') return Math.round(ahoraMs / 1000) % 86_400;           // «1970»: reloj sin inicializar
  if (p.relojRoto === 'futuro') return Math.round((ahoraMs + 3_600_000) / 1000);     // una hora adelantado
  return Math.round(ahoraMs + derivaAcumuladaMs) / 1000;
}

// Pack SenML (RFC 8428) con las dos lecturas: el adaptador nativo de la plataforma.
export function pack(p: Perfil, bt: number, l: { temperatura: number; humedad: number }): string {
  return JSON.stringify([
    { bn: p.id, bt, n: 'temperatura', u: 'Cel', v: l.temperatura },
    { n: 'humedad', u: '%RH', v: l.humedad },
  ]);
}

export function topico(sitio: string, p: Perfil): string {
  return `sitio/${sitio}/dispositivo/${p.id}/temperatura`;
}

// Semilla SQL para el banco: sitio, zona, los dispositivos con su intervalo esperado, dos canales cada uno y una
// regla de umbral alto (30 Cel, histéresis 2) en temperatura. Reejecutable: nada se duplica.
// factorIntervalo: cuántas veces el periodo del nodo se declara como `intervalo_esperado_s` (1 = el periodo redondeado
// hacia arriba, lo más estricto; 2 = el silencio normal admite una trama perdida). Es el experimento de la ficha D-02:
// el supervisor abre «sin comunicación» al superar 2 × intervalo, así que el factor decide cuántas alarmas son falsas.
export function semillaSQL(ps: Perfil[], sitio: string, factorIntervalo = 1): string {
  const SITIO = '00000000-0000-0000-0000-00000000ba7c';
  const ZONA = '00000000-0000-0000-0000-00000000ba7d';
  const valores = ps
    .map((p) => `('${ZONA}', '${p.id}', 'Emulado ${p.id.slice(4)}', ${Math.max(1, Math.ceil(p.periodoS * factorIntervalo))})`)
    .join(',\n    ');
  return `-- Semilla del banco de pruebas (generada por emulador.ts semilla): ${ps.length} dispositivos emulados, intervalo = periodo × ${factorIntervalo}
INSERT INTO sitio (id, nombre, descripcion) VALUES ('${SITIO}', '${sitio}', 'Banco de pruebas desechable (TT-28/TT-29)')
    ON CONFLICT (id) DO NOTHING;
INSERT INTO zona (id, sitio_id, nombre) VALUES ('${ZONA}', '${SITIO}', 'Emulados') ON CONFLICT (id) DO NOTHING;
INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) VALUES
    ${valores}
    ON CONFLICT (id_fisico) DO UPDATE SET intervalo_esperado_s = EXCLUDED.intervalo_esperado_s;
INSERT INTO canal (dispositivo_id, magnitud_codigo)
    SELECT d.id, m FROM dispositivo d, unnest(ARRAY['temperatura', 'humedad']) AS m
     WHERE d.id_fisico LIKE 'emu-%'
    ON CONFLICT (dispositivo_id, magnitud_codigo) DO NOTHING;
INSERT INTO regla_umbral (canal_id, umbral_alto, histeresis)
    SELECT c.id, 30, 2 FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
     WHERE d.id_fisico LIKE 'emu-%' AND c.magnitud_codigo = 'temperatura'
       AND NOT EXISTS (SELECT 1 FROM regla_umbral r WHERE r.canal_id = c.id);
`;
}
