// «Ahora»: lo que se mide en este momento (docs/19 §4, bloque L, punto 3). `GET /sitios/{id}/ahora?tendencia=si` se lee UNA vez al cargar;
// después las tarjetas se mantienen con los avisos del canal en vivo: `medicion` y `visto` se aplican aquí, en memoria, sin pedir nada al
// servidor; solo `condicion` vuelve a pedir «Ahora» (sin tendencia: la línea de las 24 horas no se repide en vivo, se conserva la leída).
import type { AhoraSitio, EventoVivo } from './modelo';

// Qué aviso es del sitio (punto 6): lo dice su `sitio_id`. Con `null` (quien alcanza todos los sitios, si el servidor aún no conoce el
// dispositivo) o sin el campo (un backend anterior), solo si el dispositivo es uno de los que la pantalla ya muestra.
export function esDelSitio(e: { dispositivo_id: string; sitio_id?: string | null }, sitioId: string, visibles: ReadonlySet<string>): boolean {
  if (typeof e.sitio_id === 'string') return e.sitio_id === sitioId;
  return visibles.has(e.dispositivo_id);
}

const masNuevo = (a: string | null, b: string): boolean => a === null || Date.parse(b) > Date.parse(a);

// Aplica un lote de avisos `medicion` y `visto` a las tarjetas: el valor, su hora y «hace cuánto». Un aviso más viejo que lo que ya se
// muestra (llegó desordenado) no pisa nada. Devuelve los ids de las tarjetas que cambiaron (para el resalte breve).
export function aplicarAvisos(datos: AhoraSitio, avisos: readonly EventoVivo[]): { datos: AhoraSitio; cambiados: string[] } {
  const cambiados = new Set<string>();
  let dispositivos = datos.dispositivos;
  for (const e of avisos) {
    if (e.tipo !== 'medicion' && e.tipo !== 'visto') continue;
    const i = dispositivos.findIndex((d) => d.id === e.dispositivo_id);
    if (i < 0) continue;
    const d = dispositivos[i]!;
    let nuevo = d;
    if (e.tipo === 'visto') {
      if (masNuevo(d.visto_por_ultima_vez, e.tiempo)) nuevo = { ...d, visto_por_ultima_vez: e.tiempo };
    } else {
      const k = d.canales.findIndex((c) => c.id === e.canal_id);
      if (k >= 0 && masNuevo(d.canales[k]!.ultima?.tiempo ?? null, e.tiempo)) {
        const canales = d.canales.slice();
        canales[k] = { ...canales[k]!, ultima: { valor: e.valor, tiempo: e.tiempo, porcentaje: e.porcentaje ?? null } };
        nuevo = { ...d, canales, visto_por_ultima_vez: masNuevo(d.visto_por_ultima_vez, e.tiempo) ? e.tiempo : d.visto_por_ultima_vez };
      }
    }
    if (nuevo !== d) {
      dispositivos = dispositivos.slice();
      dispositivos[i] = nuevo;
      cambiados.add(d.id);
    }
  }
  return { datos: cambiados.size === 0 ? datos : { ...datos, dispositivos }, cambiados: [...cambiados] };
}

// Una lectura de «Ahora» sin tendencia (repedida por un aviso `condicion`) conserva la línea de tendencia ya leída de cada canal.
export function conservarTendencia(nuevo: AhoraSitio, anterior: AhoraSitio | null): AhoraSitio {
  if (nuevo.tendencia || anterior === null || !anterior.tendencia) return nuevo;
  const chispas = new Map<string, (number | null)[]>();
  for (const d of anterior.dispositivos) for (const c of d.canales) if (c.chispa !== undefined) chispas.set(c.id, c.chispa);
  return {
    ...nuevo,
    tendencia: true,
    ...(anterior.chispa !== undefined ? { chispa: anterior.chispa } : {}),
    dispositivos: nuevo.dispositivos.map((d) => ({ ...d, canales: d.canales.map((c) => (chispas.has(c.id) ? { ...c, chispa: chispas.get(c.id)! } : c)) })),
  };
}

// Una lectura con más de dos intervalos esperados ya no es «de ahora»: la tarjeta la atenúa y dice su antigüedad.
export function lecturaVieja(tiempo: string, intervaloEsperadoS: number, ahora: Date): boolean {
  return ahora.getTime() - Date.parse(tiempo) > 2 * intervaloEsperadoS * 1000;
}

// La cifra grande de una tarjeta: tantos decimales como se leen de un vistazo (1 010 hPa, 17,2 °C, 3,71 V), con coma decimal (es-CL).
const FORMATOS = [0, 1, 2].map((d) => new Intl.NumberFormat('es-CL', { maximumFractionDigits: d, minimumFractionDigits: 0 }));
export function cifraAhora(v: number): string {
  const a = Math.abs(v);
  return FORMATOS[a >= 1000 ? 0 : a >= 10 ? 1 : 2]!.format(v);
}

// La línea de tendencia (24 promedios por hora; null donde no hubo lecturas) como trazos SVG en un lienzo de `ancho` × `alto`: un tramo
// por cada racha sin huecos (un hueco no se une con una recta inventada). Decorativa: el dato es el número.
export function trazosChispa(valores: readonly (number | null)[], ancho: number, alto: number): string[] {
  const n = valores.length;
  const v = valores.filter((x): x is number => x !== null && Number.isFinite(x));
  if (n < 2 || v.length === 0) return [];
  const min = Math.min(...v);
  const max = Math.max(...v);
  const y = (x: number): number => (max === min ? alto / 2 : alto - 1 - ((x - min) / (max - min)) * (alto - 2));
  const trazos: string[] = [];
  let actual: string[] = [];
  valores.forEach((x, i) => {
    if (x === null || !Number.isFinite(x)) {
      if (actual.length > 0) trazos.push(actual.join(' '));
      actual = [];
      return;
    }
    actual.push(`${actual.length === 0 ? 'M' : 'L'}${((i / (n - 1)) * ancho).toFixed(1)} ${y(x).toFixed(1)}`);
  });
  if (actual.length > 0) trazos.push(actual.join(' '));
  // Un punto suelto (una sola hora con lecturas entre huecos) se dibuja como un trazo mínimo, para que se vea.
  return trazos.map((t) => (t.includes('L') ? t : `${t} l0.1 0`));
}
