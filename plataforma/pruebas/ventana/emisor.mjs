// Emisor de la ventana de 72 horas (RNF-18 y RNF-17; docs/16 §104; LEEME.md de esta carpeta). Hace de N equipos reales: lee el archivo
// de credenciales que descarga el alta masiva (id_fisico,id,credencial,destino; panel, lib/lote.ts → csvCredenciales) y abre UN cliente
// MQTT por equipo, con su usuario como identificador (el broker lo impone igual: use_username_as_clientid), por TLS a través del proxy y
// verificando el certificado. Cada VENTANA_PERIODO_S publica en el formato nativo (SenML, RFC 8428) dos magnitudes con la marca de tiempo
// del equipo, con QoS 1. Sin relojes rotos ni pérdidas emuladas: mide la plataforma, no la estresa (eso es el emulador del banco).
// Escribe una línea CSV por minuto con lo de ESE minuto (no acumulado: así sobrevive a un reinicio del contenedor y las líneas se suman):
//   hora_utc,enviados,confirmados,reconexiones,conectados,en_vuelo,equipos,periodo_s
// hora_utc es el INICIO del minuto UTC al que pertenecen los contadores (el resumen lo cruza con el mismo minuto de la sonda); equipos y
// periodo_s dejan al resumen calcular cuántos envíos esperar por minuto.
// Además, UNA línea por mensaje confirmado en VENTANA_CONFIRMADOS (/ventana/datos/confirmados.csv): equipo,bt_ms,llegada_ms (la marca de
// tiempo del mensaje en milisegundos, la misma que guarda la base, y el instante en que llegó su PUBACK: el resumen exige que llegue a tiempo). Se escribe en el instante del PUBACK, sin esperar al fin del minuto: así un
// mensaje encolado al final y confirmado después del cierre cuenta en el minuto de SU marca de tiempo, y un proceso que muere sin aviso
// no pierde lo que ya confirmó. El resumen compara ese conjunto con lo guardado (por equipo y marca de tiempo).
// enviados = publicaciones entregadas a la biblioteca; confirmados = PUBACK recibidos; en_vuelo = enviados aún sin PUBACK (al momento).
// Nunca imprime una clave: ni en el registro ni en el CSV ni en un error.
//
// Variables (las rutas son las de DENTRO del contenedor con compose.ventana.yml):
//   VENTANA_CREDENCIALES  archivo de credenciales (/ventana/credenciales.csv)          VENTANA_SALIDA  CSV de salida (/ventana/datos/emisor.csv)
//   VENTANA_MQTT_HOST     servidor MQTT (proxy: el servicio del proxy en la red de la pila)  VENTANA_MQTT_PUERTO (8883)
//   VENTANA_MQTT_NOMBRE   nombre que se exige en el certificado (proxy: está en el SAN del certificado de ca-desarrollo.sh)
//   VENTANA_CA            CA con que se verifica (/ventana/ca.crt; vacía = las CA del sistema)
//   VENTANA_PERIODO_S     período de publicación (60)       VENTANA_TOPICO_FINAL  último segmento del tópico en lugar de <magnitud> (temperatura)
import { createRequire } from 'node:module';
import { existsSync, readFileSync, appendFileSync, statSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

// El paquete `mqtt` es el del backend: en su imagen vive en /app; fuera del contenedor, en plataforma/backend (pnpm install).
const AQUI = dirname(fileURLToPath(import.meta.url));
const paquete = [process.env.VENTANA_PAQUETE, '/app/package.json', resolve(AQUI, '../../backend/package.json')].find((p) => p && existsSync(p));
if (!paquete) { console.error('FALLA no encuentro el paquete mqtt (ni /app/package.json ni plataforma/backend)'); process.exit(2); }
const mqtt = createRequire(paquete)('mqtt');

const E = process.env;
const ARCHIVO = E.VENTANA_CREDENCIALES || '/ventana/credenciales.csv';
const SALIDA = E.VENTANA_SALIDA || '/ventana/datos/emisor.csv';
const CONFIRMADOS = E.VENTANA_CONFIRMADOS || resolve(dirname(SALIDA), 'confirmados.csv');
const HOST = E.VENTANA_MQTT_HOST || 'proxy';
const PUERTO = Number(E.VENTANA_MQTT_PUERTO || 8883);
const NOMBRE = E.VENTANA_MQTT_NOMBRE || HOST;
const CA = E.VENTANA_CA ?? '/ventana/ca.crt';
const PERIODO_S = Number(E.VENTANA_PERIODO_S || 60);
const FINAL = E.VENTANA_TOPICO_FINAL || 'temperatura';
if (!Number.isInteger(PUERTO) || PUERTO < 1 || PUERTO > 65535) { console.error('FALLA VENTANA_MQTT_PUERTO no es un puerto'); process.exit(2); }
if (!(PERIODO_S >= 5 && PERIODO_S <= 3600)) { console.error('FALLA VENTANA_PERIODO_S debe estar entre 5 y 3600'); process.exit(2); }
if (!/^[a-z0-9_]{1,40}$/.test(FINAL)) { console.error('FALLA VENTANA_TOPICO_FINAL: solo minúsculas, dígitos y «_»'); process.exit(2); }

// ── El archivo de credenciales: CSV RFC 4180 con coma, CRLF y sin BOM (csvCredenciales); se admite también LF y un BOM ──────────
function leerCsv(texto) {
  const filas = []; let fila = []; let celda = ''; let comillas = false;
  for (let i = 0; i < texto.length; i++) {
    const c = texto[i];
    if (comillas) {
      if (c === '"' && texto[i + 1] === '"') { celda += '"'; i++; } else if (c === '"') comillas = false; else celda += c;
    } else if (c === '"') comillas = true;
    else if (c === ',') { fila.push(celda); celda = ''; }
    else if (c === '\n' || c === '\r') { if (c === '\r' && texto[i + 1] === '\n') i++; fila.push(celda); filas.push(fila); fila = []; celda = ''; }
    else celda += c;
  }
  if (celda !== '' || fila.length) { fila.push(celda); filas.push(fila); }
  return filas.filter((f) => f.some((x) => x !== ''));
}
let texto;
try { texto = readFileSync(ARCHIVO, 'utf8').replace(/^﻿/, ''); } catch (e) { console.error(`FALLA no puedo leer el archivo de credenciales (${e.code ?? 'error'})`); process.exit(2); }
const [cabecera, ...resto] = leerCsv(texto);
const col = (n) => (cabecera ?? []).indexOf(n);
if (col('id_fisico') < 0 || col('credencial') < 0 || col('destino') < 0) { console.error('FALLA el archivo no tiene las columnas id_fisico, credencial y destino del alta masiva'); process.exit(2); }
const equipos = [];
for (const f of resto) {
  const id = f[col('id_fisico')] ?? ''; const clave = f[col('credencial')] ?? ''; const destino = f[col('destino')] ?? '';
  // Solo los de la vía MQTT: su destino es el tópico; los HTTP y LoRaWAN no se conectan al broker.
  if (!/^sitio\/[^/]+\/dispositivo\/[^/]+\/<magnitud>$/.test(destino)) { console.log(`aviso ${id || '(sin id)'} no es de la vía MQTT: se omite`); continue; }
  if (!/^[A-Za-z0-9][A-Za-z0-9._-]{0,62}$/.test(id) || clave.length < 16) { console.log(`aviso fila de ${id || '(sin id)'} incompleta: se omite`); continue; }
  equipos.push({ id, clave, topico: destino.replace('<magnitud>', FINAL) });
}
const repetidos = equipos.map((e) => e.id).filter((x, i, a) => a.indexOf(x) !== i);
if (repetidos.length) { console.error(`FALLA identificadores repetidos en el archivo (${[...new Set(repetidos)].join(', ')}): un cliente por credencial`); process.exit(2); }
if (!equipos.length) { console.error('FALLA el archivo no trae ningún equipo de la vía MQTT'); process.exit(2); }
// La carpeta de salida tiene que ser escribible desde el arranque (un bind mount que Docker creó como root no lo es): sin CSV no hay
// medición, así que se sale con 2 en vez de seguir sin escribir.
try { appendFileSync(SALIDA, ''); appendFileSync(CONFIRMADOS, ''); } catch (e) { console.error(`FALLA no puedo escribir ${SALIDA} ni ${CONFIRMADOS} (${e.code ?? 'error'}): la carpeta datos/ debe existir y ser del usuario del contenedor`); process.exit(2); }
let ca;
if (CA) { try { ca = readFileSync(CA); } catch (e) { console.error(`FALLA no puedo leer la CA ${CA} (${e.code ?? 'error'})`); process.exit(2); } }

// ── Contadores del minuto y la línea CSV ────────────────────────────────────────────────────────────────────────────────────────
const m = { enviados: 0, confirmados: 0, reconexiones: 0 };
let enVuelo = 0;
const clientes = [];
const CABECERA = 'hora_utc,enviados,confirmados,reconexiones,conectados,en_vuelo,equipos,periodo_s\n';
function escribirLinea(hora) {
  const conectados = clientes.filter((c) => c.connected).length;
  let nuevo = true;
  try { nuevo = statSync(SALIDA).size === 0; } catch { nuevo = true; }
  try {
    appendFileSync(SALIDA, (nuevo ? CABECERA : '') + `${hora},${m.enviados},${m.confirmados},${m.reconexiones},${conectados},${enVuelo},${equipos.length},${PERIODO_S}\n`);
  } catch (e) { console.error(`error no puedo escribir ${SALIDA} (${e.code ?? 'error'})`); }
  m.enviados = 0; m.confirmados = 0; m.reconexiones = 0;
}
const horaUtc = (ms) => new Date(ms).toISOString().slice(0, 19) + 'Z';
// En el borde de cada minuto UTC se escribe la línea del minuto que termina, rotulada con su INICIO (la sonda escribe una línea por
// minuto: las dos se cruzan por el mismo minuto).
function programarMinuto() {
  const ahora = Date.now();
  const siguiente = Math.floor(ahora / 60000) * 60000 + 60000;
  setTimeout(() => { escribirLinea(horaUtc(siguiente - 60000)); programarMinuto(); }, siguiente - ahora);
}

// ── Un cliente por equipo ───────────────────────────────────────────────────────────────────────────────────────────────────────
// Reconexión con espera creciente: 1, 2, 4… hasta 60 s, con ±20 % de azar (diez equipos que caen juntos no vuelven todos en el mismo
// milisegundo), y de vuelta a 1 s tras una conexión que duró. La biblioteca guarda lo publicado sin conexión y lo reenvía al volver.
function arrancar(eq, i) {
  let espera = 1000;
  const c = mqtt.connect({
    protocol: 'mqtts', host: HOST, port: PUERTO, servername: NOMBRE, ca, rejectUnauthorized: true,
    username: eq.id, password: eq.clave, clientId: eq.id, clean: true, protocolVersion: 4, keepalive: 60,
    connectTimeout: 15_000, reconnectPeriod: 1000, queueQoSZero: false,
  });
  let conectadoEn = 0; let primera = true;
  c.on('connect', () => {
    conectadoEn = Date.now();
    if (primera) { primera = false; console.log(`conectado ${eq.id}`); } else { m.reconexiones++; console.log(`reconectado ${eq.id}`); }
  });
  // prependListener: la biblioteca registra en su constructor su propio oyente de `close`, que programa la reconexión con el
  // reconnectPeriod vigente; este tiene que correr ANTES para que la espera nueva valga para ESTA reconexión (con `on` iba un ciclo atrás:
  // medido contra un puerto cerrado, 1,00 · 1,12 · 2,11 · 4,00 s en vez de ≈ 1 · 2 · 4 · 8).
  c.prependListener('close', () => {
    if (conectadoEn && Date.now() - conectadoEn > 120_000) espera = 1000;
    conectadoEn = 0;
    c.options.reconnectPeriod = Math.round(espera * (0.8 + Math.random() * 0.4));
    espera = Math.min(espera * 2, 60_000);
  });
  // El mensaje de error de la biblioteca no trae la clave; igual se muestra solo su código o su primera frase, acotada.
  c.on('error', (e) => console.log(`error ${eq.id}: ${String(e.code ?? e.message ?? 'error').slice(0, 120)}`));
  clientes.push(c);
  // Fase propia dentro del período, ALINEADA AL RELOJ: el equipo i publica en el instante período·k + fase (con 60 s, en el segundo 6·i de
  // cada minuto). Cada envío se programa contra el reloj (no con setInterval, que acumula su atraso vuelta a vuelta: medido en docs/16
  // §104), así la marca de cada equipo cae siempre en su minuto, y un reinicio del emisor no cambia las fases.
  const fase = Math.round((i / equipos.length) * PERIODO_S * 1000);
  const publicar = () => {
    const t = Date.now() / 1000;
    const temperatura = Math.round((22 + 3 * Math.sin((2 * Math.PI * t) / 3600) + i * 0.1) * 10) / 10;
    const humedad = Math.round((55 + 10 * Math.sin((2 * Math.PI * t) / 7200) - i * 0.2) * 10) / 10;
    const btMs = Math.round(t * 1000);
    const carga = JSON.stringify([{ bt: btMs / 1000, n: 'temperatura', u: 'Cel', v: temperatura }, { n: 'humedad', u: '%RH', v: humedad }]);
    m.enviados++; enVuelo++;
    c.publish(eq.topico, carga, { qos: 1 }, (err) => {
      enVuelo--;
      if (err) return;
      // Si no se puede anotar, se dice en voz alta y ese confirmado NO cuenta en emisor.csv: el resumen verá la marca faltante (minuto no
      // disponible) y la diferencia entre los dos archivos, en vez de un confirmados.csv corto en silencio.
      try { appendFileSync(CONFIRMADOS, `${eq.id},${btMs},${Date.now()}\n`); } catch (e) { console.error(`FALLA no puedo anotar en ${CONFIRMADOS} el confirmado de ${eq.id} (${e.code ?? 'error'}): no cuenta como confirmado`); return; }
      m.confirmados++;
    });
  };
  const P = PERIODO_S * 1000;
  // `ultima` es la ranura ya usada: el temporizador corre con el reloj monótono y puede disparar un milisegundo ANTES de la ranura según el
  // reloj de pared; sin esto, la cuenta volvía a dar la misma ranura y el equipo publicaba dos veces en ese minuto (visto en el ensayo
  // local del 25/11/2026, con el broker caído).
  let ultima = 0;
  const programar = () => {
    const ahora = Date.now();
    let siguiente = Math.floor(ahora / P) * P + fase;
    if (siguiente <= ahora || siguiente <= ultima) siguiente += P;
    ultima = siguiente;
    setTimeout(() => { publicar(); programar(); }, siguiente - ahora);
  };
  programar();
}

console.log(`emisor: ${equipos.length} equipos, cada ${PERIODO_S} s, mqtts://${HOST}:${PUERTO} (certificado verificado para «${NOMBRE}»${CA ? ', CA propia' : ''}), salida ${SALIDA}`);
equipos.forEach(arrancar);
programarMinuto();
// Al detenerlo (docker stop: SIGTERM), una última línea con lo del minuto en curso, y se cierran las conexiones.
let cerrando = false;
for (const s of ['SIGTERM', 'SIGINT']) {
  process.on(s, () => {
    if (cerrando) return; cerrando = true;
    escribirLinea(horaUtc(Math.floor(Date.now() / 60000) * 60000));   // el minuto en curso, parcial
    console.log(`emisor detenido (${enVuelo} sin confirmar al cerrar)`);
    for (const c of clientes) c.end(true);
    setTimeout(() => process.exit(0), 500).unref();
  });
}
