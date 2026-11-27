// Generador de carga NEUTRO de la comparación medida (docs/23 §5). Corre en el anfitrión, fuera de la máquina medida, y es el mismo para
// todas las plataformas: lo único que cambia es el ADAPTADOR (formato, tópico y autenticación nativos de cada una, según su documentación).
// Por dispositivo y por período publica UN mensaje con dos magnitudes (temperatura y humedad) y SU marca de tiempo, con QoS 1. Los envíos
// van alineados al reloj: el dispositivo i (de N) publica en los instantes k·P + i·P/N (P = período), y la marca enviada es ese instante
// programado, así el número de mensajes y sus fases son los mismos en cada repetición y en cada plataforma. Los valores salen de la semilla
// (mulberry32 sobre semilla, dispositivo y k, con k = instante / P): deterministas para un instante dado, distintos de una corrida a otra. Sin relojes rotos, sin pérdidas emuladas, sin ráfagas: mide la plataforma, no la estresa con fallas.
//
// Mitades de red (docs/23 §3.3): el dispositivo i entra por la red A si i es par y por la B si es impar (dos direcciones de origen, la
// misma división para todas). La sonda entra siempre por la A.
//
// Uso:  node generador.mjs --plataforma propia|thingsboard --credenciales ARCHIVO --salida CARPETA --puerto-a N --puerto-b N
//            [--dispositivos 10] [--periodo-ms 60000] [--duracion-s 1200] [--semilla 1] [--ca ARCHIVO] [--servidor localhost]
//       node generador.mjs --modo sonda … (publica cada 5 s con el dispositivo «sonda» del archivo hasta recibir SIGTERM)
// ARCHIVO de credenciales (CSV con cabecera; lo escribe el guion de instalación de cada plataforma, modo 600):
//   id,usuario,clave,topico      (propia: usuario y clave del broker y su tópico; thingsboard: usuario = token de acceso, clave vacía)
// Salidas en CARPETA: confirmados.csv (id,ts_ms,enviado_ms,puback_ms: una línea por PUBACK) y resumen.json. Nunca imprime una clave.
import { createRequire } from 'node:module';
import { readFileSync, appendFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

const args = Object.fromEntries(process.argv.slice(2).reduce((acc, a, i, arr) => {
  if (a.startsWith('--')) acc.push([a.slice(2), arr[i + 1] && !arr[i + 1].startsWith('--') ? arr[i + 1] : 'si']);
  return acc;
}, []));
const E = process.env;
const NODE_MODULOS = E.BANCO_NODE || resolve(E.HOME, '.cache/tesis-comparacion/node');
if (!existsSync(resolve(NODE_MODULOS, 'node_modules/mqtt/package.json'))) {
  console.error(`FALLA no encuentro el paquete mqtt en ${NODE_MODULOS} (ver LEEME: npm install --prefix … mqtt@versión de versiones.env)`); process.exit(2);
}
const mqtt = createRequire(resolve(NODE_MODULOS, 'package.json'))('mqtt');

const MODO = args.modo || 'carga';
const PLATAFORMA = args.plataforma;
const ADAPTADORES = {
  // Plataforma propia: SenML (RFC 8428) por el proxy TLS (8883), usuario y clave del broker por dispositivo, tópico que da el alta.
  // `bt` en segundos con milisegundos; el tópico termina en una magnitud (el alta lo entrega con <magnitud>; la carga trae las dos).
  propia: {
    puerto: 'mqtts',
    topico: (e) => e.topico.replace('<magnitud>', 'temperatura'),
    carga: (ts, t, h) => JSON.stringify([{ bt: ts / 1000, n: 'temperatura', u: 'Cel', v: t }, { n: 'humedad', u: '%RH', v: h }]),
    auth: (e) => ({ username: e.usuario, password: e.clave, clientId: e.usuario }),
  },
  // ThingsBoard CE: JSON con marca de tiempo por MQTT plano (1883), el token de acceso como usuario y sin clave, tópico de telemetría
  // (https://thingsboard.io/docs/reference/mqtt-api/telemetry/: {"ts": …, "values": {…}}, «ts is a Unix timestamp in milliseconds»).
  thingsboard: {
    puerto: 'mqtt',
    topico: () => 'v1/devices/me/telemetry',
    carga: (ts, t, h) => JSON.stringify({ ts, values: { temperature: t, humidity: h } }),
    auth: (e, i) => ({ username: e.usuario, clientId: `tt40-${MODO}-${i}` }),
  },
};
const A = ADAPTADORES[PLATAFORMA];
if (!A) { console.error('FALLA --plataforma debe ser propia o thingsboard'); process.exit(2); }
const SALIDA = args.salida; if (!SALIDA) { console.error('FALLA falta --salida'); process.exit(2); }
mkdirSync(SALIDA, { recursive: true });
const PUERTO_A = Number(args['puerto-a']); const PUERTO_B = Number(args['puerto-b'] || args['puerto-a']);
const N = Number(args.dispositivos || 10);
const P = Number(MODO === 'sonda' ? 5000 : (args['periodo-ms'] || 60000));
const DURACION_MS = Number(args['duracion-s'] || 1200) * 1000;
const SEMILLA = Number(args.semilla || 1);
const SERVIDOR = args.servidor || 'localhost';
const ca = args.ca ? readFileSync(args.ca) : undefined;
if (A.puerto === 'mqtts' && !ca) { console.error('FALLA la plataforma propia va por TLS: falta --ca'); process.exit(2); }

// ── Credenciales ───────────────────────────────────────────────────────────────────────────────────────────────────────────
const filas = readFileSync(args.credenciales, 'utf8').trim().split(/\r?\n/);
const cab = filas.shift().split(',');
const col = (n) => cab.indexOf(n);
if (['id', 'usuario', 'clave', 'topico'].some((c) => col(c) < 0)) { console.error('FALLA el archivo de credenciales no trae id,usuario,clave,topico'); process.exit(2); }
const todos = filas.map((l) => { const f = l.split(','); return { id: f[col('id')], usuario: f[col('usuario')], clave: f[col('clave')], topico: f[col('topico')] }; });
let equipos;
if (MODO === 'sonda') equipos = todos.filter((e) => e.id === 'tt40-sonda');
else equipos = todos.filter((e) => e.id !== 'tt40-sonda').slice(0, N);
if (!equipos.length || (MODO !== 'sonda' && equipos.length < N)) { console.error(`FALLA el archivo trae ${equipos.length} dispositivos y se pidieron ${MODO === 'sonda' ? 'la sonda' : N}`); process.exit(2); }

// ── Valores deterministas ──────────────────────────────────────────────────────────────────────────────────────────────────
function mulberry32(a) { return () => { a |= 0; a = (a + 0x6d2b79f5) | 0; let t = Math.imul(a ^ (a >>> 15), 1 | a); t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t; return ((t ^ (t >>> 14)) >>> 0) / 4294967296; }; }
const valor = (i, k, base, amplitud) => Math.round((base + amplitud * (mulberry32((SEMILLA * 1_000_003) ^ (i * 7919) ^ (k * 104_729))() - 0.5)) * 10) / 10;

// ── Contadores ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
const CONF = resolve(SALIDA, MODO === 'sonda' ? 'sonda.csv' : 'confirmados.csv');
if (!existsSync(CONF)) writeFileSync(CONF, 'id,ts_ms,enviado_ms,puback_ms\n');
const r = { plataforma: PLATAFORMA, modo: MODO, dispositivos: equipos.length, periodo_ms: P, semilla: SEMILLA, enviados: 0, confirmados: 0,
  rechazados: 0, conexiones: 0, reconexiones: 0, errores: {}, atraso_max_ms: 0, inicio_ms: 0, fin_ms: 0, conectados_al_empezar: 0,
  primer_envio_ms: null, ultimo_envio_ms: null };
let enVuelo = 0;
const clientes = [];
const temporizadores = [];
let detener = false;

function conectar(e, i) {
  const red = MODO === 'sonda' || i % 2 === 0 ? PUERTO_A : PUERTO_B;
  const c = mqtt.connect({
    protocol: A.puerto, host: '127.0.0.1', port: red, servername: SERVIDOR, ca, rejectUnauthorized: true,
    ...A.auth(e, i), clean: true, protocolVersion: 4, keepalive: 60, connectTimeout: 15_000, reconnectPeriod: 1000, queueQoSZero: false,
  });
  let primera = true;
  c.on('connect', () => { r.conexiones++; if (!primera) r.reconexiones++; primera = false; });
  c.on('error', (err) => { const k = String(err.code ?? err.message ?? 'error').slice(0, 60); r.errores[k] = (r.errores[k] || 0) + 1; });
  clientes.push(c);
  return c;
}

function programar(e, i, c, finMs, desdeMs = 0) {
  const fase = Math.round((i / equipos.length) * P);
  const siguiente = (ahora) => { let s = Math.floor(ahora / P) * P + fase; if (s <= ahora) s += P; while (s < desdeMs) s += P; return s; };
  const tic = (programado) => {
    if (detener || programado >= finMs) return;
    const ahora = Date.now();
    r.atraso_max_ms = Math.max(r.atraso_max_ms, ahora - programado);
    const k = Math.round(programado / P);
    const carga = A.carga(programado, valor(i, k, 22, 10), valor(i, k + 1, 55, 30));
    r.enviados++; enVuelo++;
    r.primer_envio_ms ??= programado; r.ultimo_envio_ms = programado;
    c.publish(A.topico(e), carga, { qos: 1 }, (err) => {
      enVuelo--;
      if (err) { r.rechazados++; return; }
      r.confirmados++;
      appendFileSync(CONF, `${e.id},${programado},${ahora},${Date.now()}\n`);
    });
    // El siguiente es SIEMPRE programado + P (piloto del 25/11: recalcularlo desde Date.now() repetía el mismo instante cuando el
    // temporizador vencía un milisegundo antes, y se enviaban mensajes duplicados con la misma marca). Si el proceso se atrasó más de un
    // período, se salta al próximo instante futuro y el salto queda en atraso_max_ms.
    let s = programado + P; while (s <= Date.now()) s += P;
    temporizadores.push(setTimeout(() => tic(s), s - Date.now()));
  };
  const s = siguiente(Date.now());
  temporizadores.push(setTimeout(() => tic(s), s - Date.now()));
}

const esperarConexion = async (topeMs) => {
  const t0 = Date.now();
  while (Date.now() - t0 < topeMs) { if (clientes.every((c) => c.connected)) return true; await new Promise((ok) => setTimeout(ok, 200)); }
  return false;
};

async function terminar(codigo) {
  detener = true; temporizadores.forEach(clearTimeout);
  const t0 = Date.now();
  while (enVuelo > 0 && Date.now() - t0 < 30_000) await new Promise((ok) => setTimeout(ok, 200));
  r.fin_ms = Date.now(); r.en_vuelo_al_cerrar = enVuelo;
  writeFileSync(resolve(SALIDA, MODO === 'sonda' ? 'sonda.json' : 'resumen.json'), JSON.stringify(r, null, 1) + '\n');
  for (const c of clientes) c.end(true);
  console.log(`${MODO}: ${r.enviados} enviados, ${r.confirmados} confirmados, ${r.rechazados} rechazados, ${enVuelo} sin confirmar, ${r.reconexiones} reconexiones, atraso máx. ${r.atraso_max_ms} ms`);
  setTimeout(() => process.exit(codigo), 300).unref();
}
for (const s of ['SIGTERM', 'SIGINT']) process.on(s, () => terminar(0));

r.inicio_ms = Date.now();
equipos.forEach((e, i) => conectar(e, i));
if (MODO === 'sonda') {
  // La sonda publica desde ya (la biblioteca guarda lo publicado sin conexión y lo envía al conectar), hasta SIGTERM.
  programar(equipos[0], 0, clientes[0], Number.MAX_SAFE_INTEGER);
  console.log('sonda: publicando cada 5 s');
} else {
  const ok = await esperarConexion(120_000);
  r.conectados_al_empezar = clientes.filter((c) => c.connected).length;
  if (!ok) console.log(`aviso: ${r.conectados_al_empezar} de ${equipos.length} conectados tras 120 s; se publica igual (la biblioteca encola)`);
  // Empieza en el próximo borde de período: la serie no depende de cuándo terminó de conectar.
  const inicio = Math.ceil((Date.now() + 1000) / P) * P;
  const fin = inicio + DURACION_MS;
  r.ventana_desde_ms = inicio; r.ventana_hasta_ms = fin;
  console.log(`carga: ${equipos.length} dispositivos, cada ${P} ms (${(equipos.length * 1000 / P).toFixed(2)} mensajes/s), ${DURACION_MS / 1000} s`);
  equipos.forEach((e, i) => programar(e, i, clientes[i], fin, inicio));
  setTimeout(() => terminar(0), fin - Date.now() + 2000);
}
