// Emulador de nodos (TT-28): hace de N dispositivos MQTT a la vez contra un broker, con el tráfico irregular de
// docs/10 §9.6, y deja un CSV con cada lectura enviada (cuándo salió, cuándo la confirmó el broker) para que
// pruebas/banco/evaluar.sql lo cruce con lo que quedó en la base: pérdidas, latencia p95, origen de la marca,
// falsos positivos de silencio. No usa NestJS ni la base: es un dispositivo, y un dispositivo no ve la base.
//
//   pnpm -s emulador semilla --dispositivos 100 [--periodo 2] [--semilla 1] [--sitio banco] [--intervalo-factor 2]  → SQL
//   pnpm -s emulador correr --url mqtt://127.0.0.1:1884 --duracion 60 --salida /ruta/envios.csv [opciones]
//   pnpm -s emulador carrera --url … --dispositivo emu-0003          → las dos pruebas de carrera de docs/04 (×20 y ×5)
//
// Opciones del tráfico (valores por defecto entre paréntesis): --dispositivos (100) --periodo s (2) --jitter s (0.3)
// --perdida (0.01) --deriva ms/periodo (20) --caidas fracción (0.1) --semilla (1) --sitio (banco) --sin-sys.
process.env.TZ = 'UTC';
import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import mqtt, { MqttClient } from 'mqtt';
import { esperaS, lectura, marcaDelNodo, mulberry32, Opciones, pack, Perfil, perfiles, semillaSQL, topico } from './modelo';

type Estado = 'publicada' | 'rafaga' | 'perdida_emulada';
interface Envio { id: string; magnitud: string; tiempoMs: number; enviadoEnMs: number; confirmadoEnMs: number | null; estado: Estado }

function arg(nombre: string, porDefecto: string): string {
  const i = process.argv.indexOf(`--${nombre}`);
  return i >= 0 && process.argv[i + 1] !== undefined ? process.argv[i + 1] : porDefecto;
}
function num(nombre: string, porDefecto: number): number {
  const v = Number(arg(nombre, String(porDefecto)));
  if (!Number.isFinite(v)) throw new Error(`--${nombre} debe ser un número`);
  return v;
}

const opciones: Opciones = {
  dispositivos: num('dispositivos', 100),
  periodoS: num('periodo', 2),
  jitterS: num('jitter', 0.3),
  pPerdida: num('perdida', 0.01),
  derivaMs: num('deriva', 20),
  fraccionCaidas: num('caidas', 0.1),
  semilla: num('semilla', 1),
  sitio: arg('sitio', 'banco'),
};
const url = arg('url', 'mqtt://127.0.0.1:1884');

function conectar(id: string): Promise<MqttClient> {
  return new Promise((resolver, rechazar) => {
    // Sin usuario: el broker del banco admite anónimos y, con el plugin de seguridad activo, un usuario sin clave se rechaza
    // (medido el 12/10, docs/16 §20). El pipeline identifica al emulado por el tópico, no por el usuario.
    const c = mqtt.connect(url, { clientId: id, clean: true, reconnectPeriod: 1000, connectTimeout: 10_000 });
    c.once('connect', () => resolver(c));
    c.once('error', rechazar);
  });
}

function publicar(c: MqttClient, t: string, carga: string): Promise<number> {
  return new Promise((resolver, rechazar) => {
    c.publish(t, carga, { qos: 1 }, (err) => (err ? rechazar(err) : resolver(Date.now())));
  });
}

function percentil(valores: number[], p: number): number {
  if (!valores.length) return NaN;
  const v = [...valores].sort((a, b) => a - b);
  return v[Math.min(v.length - 1, Math.floor((p / 100) * v.length))];
}

// ── correr: N nodos durante D segundos ──────────────────────────────────────────────────────────────────────────
async function correr(): Promise<void> {
  const duracionS = num('duracion', 60);
  const salida = arg('salida', `${tmpdir()}/plataforma-banco-envios.csv`);
  const ps = perfiles(opciones);
  const envios: Envio[] = [];
  const pendientes: Promise<unknown>[] = [];
  const inicio = Date.now();
  const fin = inicio + duracionS * 1000;
  let activos = true;

  // Un nodo: bucle propio con su periodo, su jitter, su deriva, sus pérdidas y sus caídas.
  async function nodo(p: Perfil): Promise<void> {
    const rnd = mulberry32(opciones.semilla * 1000 + Number(p.id.slice(4)));
    const c = await conectar(p.id);
    await new Promise((r) => setTimeout(r, p.faseS * 1000));
    let tick = 0;
    let derivaAcum = 0;
    let cola: { bt: number; carga: string; magnitudes: string[] }[] = [];
    let enCaida = 0;
    while (activos && Date.now() < fin) {
      tick++;
      derivaAcum += p.derivaMsPorPeriodo;
      const ahora = Date.now();
      const bt = marcaDelNodo(p, ahora, derivaAcum);
      const l = lectura(p, (ahora - inicio) / 1000, rnd);
      const carga = pack(p, bt, l);
      const tiempoMs = Math.round(bt * 1000);
      const registrar = (estado: Estado, enviadoEnMs: number, confirmadoEnMs: number | null) => {
        envios.push({ id: p.id, magnitud: 'temperatura', tiempoMs, enviadoEnMs, confirmadoEnMs, estado });
        envios.push({ id: p.id, magnitud: 'humedad', tiempoMs, enviadoEnMs, confirmadoEnMs, estado });
      };
      if (p.caida && enCaida === 0 && tick % p.caida.cadaN === 0) enCaida = p.caida.duraPeriodos;
      if (enCaida > 0) {
        // Sin cobertura: la lectura se guarda en el nodo con SU marca de tiempo y saldrá después, en ráfaga.
        cola.push({ bt, carga, magnitudes: ['temperatura', 'humedad'] });
        enCaida--;
        if (enCaida === 0) {
          for (const item of cola) {
            const enviadoEn = Date.now();
            const tMs = Math.round(item.bt * 1000);
            const pr = publicar(c, topico(opciones.sitio, p), item.carga).then(
              (conf) => item.magnitudes.forEach((m) => envios.push({ id: p.id, magnitud: m, tiempoMs: tMs, enviadoEnMs: enviadoEn, confirmadoEnMs: conf, estado: 'rafaga' })),
              () => item.magnitudes.forEach((m) => envios.push({ id: p.id, magnitud: m, tiempoMs: tMs, enviadoEnMs: enviadoEn, confirmadoEnMs: null, estado: 'rafaga' })),
            );
            pendientes.push(pr);
          }
          cola = [];
        }
      } else if (rnd() < p.pPerdida) {
        registrar('perdida_emulada', ahora, null); // la trama no sale: pérdida en el aire
      } else {
        const enviadoEn = Date.now();
        const pr = publicar(c, topico(opciones.sitio, p), carga).then(
          (conf) => registrar('publicada', enviadoEn, conf),
          () => registrar('publicada', enviadoEn, null),
        );
        pendientes.push(pr);
      }
      await new Promise((r) => setTimeout(r, esperaS(p, rnd) * 1000));
    }
    c.end(true);
  }

  // Muestra de $SYS del broker: cola almacenada, descartes, clientes, memoria (el broker los publica cada 10 s).
  const sys: Record<string, number> = {};
  const sysMax: Record<string, number> = {};
  let sysCliente: MqttClient | undefined;
  if (arg('sin-sys', 'no') === 'no') {
    sysCliente = await conectar('emulador-sys');
    sysCliente.subscribe('$SYS/broker/#', { qos: 0 });
    sysCliente.on('message', (t, m) => {
      const v = Number(m.toString());
      if (!Number.isFinite(v)) return;
      sys[t] = v;
      sysMax[t] = Math.max(sysMax[t] ?? -Infinity, v);
    });
  }

  console.error(`emulador: ${ps.length} nodos · ${duracionS} s · ${url} · sitio ${opciones.sitio} · semilla ${opciones.semilla}`);
  const nodos = ps.map((p) => nodo(p).catch((e: Error) => console.error(`${p.id}: ${e.message}`)));
  await new Promise((r) => setTimeout(r, duracionS * 1000 + 500));
  activos = false;
  await Promise.all(nodos);
  await Promise.race([Promise.all(pendientes), new Promise((r) => setTimeout(r, 5000))]);
  sysCliente?.end(true);

  // CSV para evaluar.sql: una fila por lectura enviada
  const filas = ['id,magnitud,tiempo,enviado_en,confirmado_en,estado'];
  for (const e of envios) {
    filas.push([e.id, e.magnitud, new Date(e.tiempoMs).toISOString(), new Date(e.enviadoEnMs).toISOString(),
      e.confirmadoEnMs === null ? '' : new Date(e.confirmadoEnMs).toISOString(), e.estado].join(','));
  }
  writeFileSync(salida, filas.join('\n') + '\n');

  // Resumen: picos, no promedios (docs/10 §9.6)
  const tramas = envios.filter((e) => e.magnitud === 'temperatura');
  const publicadas = tramas.filter((e) => e.estado !== 'perdida_emulada');
  const porSegundo = new Map<number, number>();
  for (const e of publicadas) porSegundo.set(Math.floor(e.enviadoEnMs / 1000), (porSegundo.get(Math.floor(e.enviadoEnMs / 1000)) ?? 0) + 1);
  const latPuback = publicadas.filter((e) => e.confirmadoEnMs !== null).map((e) => e.confirmadoEnMs! - e.enviadoEnMs);
  const segundos = Math.max(1, (Date.now() - inicio) / 1000);
  const resumen = {
    nodos: ps.length,
    tramas_publicadas: publicadas.length,
    tramas_en_rafaga: tramas.filter((e) => e.estado === 'rafaga').length,
    tramas_perdidas_emuladas: tramas.filter((e) => e.estado === 'perdida_emulada').length,
    sin_puback: publicadas.filter((e) => e.confirmadoEnMs === null).length,
    tasa_media_por_s: Math.round((publicadas.length / segundos) * 10) / 10,
    pico_por_s: Math.max(0, ...porSegundo.values()),
    puback_ms: { p50: percentil(latPuback, 50), p95: percentil(latPuback, 95), max: Math.max(0, ...latPuback) },
    broker_sys_max: {
      almacenados: sysMax['$SYS/broker/store/messages/count'],
      descartados: sysMax['$SYS/broker/publish/messages/dropped'],
      clientes: sysMax['$SYS/broker/clients/connected'],
      heap_kib: sysMax['$SYS/broker/heap/maximum'] ? Math.round(sysMax['$SYS/broker/heap/maximum'] / 1024) : undefined,
    },
    csv: salida,
  };
  console.log(JSON.stringify(resumen));
}

// ── carrera: las dos pruebas de docs/04 (dos tramas del mismo instante; umbral cruzado dos veces) ───────────────
// Se publican 5 mensajes seguidos por la misma conexión: llegan al backend en el mismo milisegundo y el pipeline
// los procesa a la vez. La evaluación (cuántas filas quedaron) la hace pruebas/banco/banco.sh carrera con SQL.
async function carrera(): Promise<void> {
  const id = arg('dispositivo', 'emu-0003');
  const p: Perfil = { id, periodoS: 2, jitterS: 0, pPerdida: 0, derivaMsPorPeriodo: 0, faseS: 0, caliente: true };
  const c = await conectar(id);
  const t = topico(opciones.sitio, p);
  const btA = Math.round(Date.now() / 1000) - 120;
  // (a) la misma lectura VEINTE veces (reentrega QoS 1 extrema): debe quedar UNA fila por canal y UNA trama cruda.
  // Veinte y no cinco: con procesamiento concurrente (antes de la decisión 4), cinco copias a veces dejaban una sola
  // trama por azar; con veinte, dos copias distintas ganaban cada canal casi siempre y la prueba era determinista:
  // roja hasta el 07/10 y verde desde que el broker procesa un mensaje a la vez (docs/10 §8.4 punto 4).
  const mismo = pack(p, btA, { temperatura: 21, humedad: 50 });
  await Promise.all(Array.from({ length: 20 }, () => publicar(c, t, mismo)));
  // (b) cinco lecturas distintas, todas sobre el umbral alto (30), a la vez: debe quedar UNA condición abierta
  await Promise.all(Array.from({ length: 5 }, (_, i) => publicar(c, t, pack(p, btA + 10 + i, { temperatura: 35 + i, humedad: 50 }))));
  c.end(true);
  console.log(JSON.stringify({ dispositivo: id, bt_a: btA, bt_b_desde: btA + 10, bt_b_hasta: btA + 14 }));
}

const orden = process.argv[2];
if (orden === 'semilla') process.stdout.write(semillaSQL(perfiles(opciones), opciones.sitio, num('intervalo-factor', 2)));
else if (orden === 'correr') void correr().then(() => process.exit(0), (e: Error) => { console.error(e.message); process.exit(1); });
else if (orden === 'carrera') void carrera().then(() => process.exit(0), (e: Error) => { console.error(e.message); process.exit(1); });
else { console.error('uso: emulador.ts semilla|correr|carrera [opciones]  (ver cabecera del archivo)'); process.exit(2); }
