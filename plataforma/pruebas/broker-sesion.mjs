// Ataques a la sesión persistente del receptor (docs/11 §7; docs/16 §102). Lo corre pruebas/broker-sesion.sh contra un broker
// desechable con la configuración del servidor y los roles reales; no se corre solo. Entrada estándar: un JSON con la URL y las
// claves de descarte (nunca se imprimen). Salida: una línea «OK …» o «FALLA …» por comprobación; sale 1 si alguna falla.
// La víctima hace lo mismo que el backend (broker.service.ts): MQTT 3.1.1, sesión persistente (clean: false), identificador igual
// a su usuario, suscrita a sitio/# con QoS 1. El atacante tiene la credencial de UN dispositivo (rol `dispositivo`) y elige el
// identificador de la víctima.
import { createRequire } from 'node:module';
import { readFileSync } from 'node:fs';

const require = createRequire(new URL('../backend/package.json', import.meta.url));
const mqtt = require('mqtt');
const E = JSON.parse(readFileSync(0, 'utf8'));
// Tope propio: si el broker dejara de confirmar (PUBACK), la prueba falla en vez de colgar al verificador (broker-sesion.sh pone otro).
setTimeout(() => { console.log('FALLA la prueba no terminó en 90 s (¿el broker dejó de confirmar?)'); process.exit(1); }, 90000).unref();
const U = { victima: 'dev-prueba-backend', emisor: 'dev-prueba-emisor', atacante: 'dev-prueba-atacante', pasarela: 'dev-prueba-pasarela', ordenador: 'dev-prueba-ordenador' };
const ID_VICTIMA = U.victima; // el identificador que el backend usa en el servidor: su usuario
const TOPICO = `sitio/s1/dispositivo/${U.emisor}/t`;
const esperar = (ms) => new Promise((r) => setTimeout(r, ms));
let fallos = 0;
const comprobar = (ok, texto) => { console.log(`${ok ? 'OK   ' : 'FALLA'} ${texto}`); if (!ok) fallos++; };

function conectar(quien, clientId, clean, extra = {}) {
  return new Promise((resolve) => {
    const c = mqtt.connect(E.url, { username: U[quien], password: E.claves[quien], clientId, clean, protocolVersion: 4, reconnectPeriod: 0, connectTimeout: 4000, ...extra });
    c.recibidos = []; c.sp = []; c.cierres = 0; c.conexiones = 0;
    c.on('connect', (p) => { c.conexiones++; c.sp.push(p.sessionPresent ? 1 : 0); });
    c.on('message', (_t, m) => c.recibidos.push(m.toString()));
    c.on('close', () => { c.cierres++; });
    c.on('error', () => {});
    let listo = false;
    const fin = (ok) => { if (!listo) { listo = true; resolve({ c, ok }); } };
    c.once('connect', () => fin(true));
    c.once('close', () => fin(false));
    setTimeout(() => fin(false), 5000);
  });
}
const cerrar = (c) => new Promise((r) => (c.connected ? c.end(false, {}, r) : (c.end(true), r())));
const suscribir = (c, t) => new Promise((r) => c.subscribe(t, { qos: 1 }, (e, g) => r(e ? -1 : g[0].qos)));
async function publicar(emisor, prefijo, n) {
  for (let i = 1; i <= n; i++) await new Promise((r) => emisor.publish(TOPICO, `${prefijo}${i}`, { qos: 1 }, r));
}
const cuantos = (c, prefijo) => new Set(c.recibidos.filter((x) => x.startsWith(prefijo))).size;

const { c: emisor, ok: okEmisor } = await conectar('emisor', U.emisor, true);
if (!okEmisor) { console.log('FALLA el emisor de descarte no pudo conectarse al broker'); process.exit(1); }

// Sesión base de la víctima: limpia, después persistente y suscrita (lo que hace el backend al arrancar).
{ const { c } = await conectar('victima', ID_VICTIMA, true); await cerrar(c); }
const { c: v1, ok: okV1 } = await conectar('victima', ID_VICTIMA, false);
const suback = okV1 ? await suscribir(v1, 'sitio/#') : -1;
comprobar(okV1 && suback === 1, `la víctima (rol recepcion) abre su sesión persistente y se suscribe a sitio/# con QoS 1 (SUBACK ${suback})`);
await cerrar(v1);

// ── Ataque A: con la víctima caída, el atacante se conecta con SU identificador y sesión persistente ──
await publicar(emisor, 'colaA-', 5); await esperar(300);
const { c: a1, ok: okA1 } = await conectar('atacante', ID_VICTIMA, false);
await esperar(1200);
await publicar(emisor, 'vivoA-', 3); await esperar(800);
comprobar(okA1, 'A: el broker acepta la conexión del atacante (su credencial es válida)');
comprobar(a1.recibidos.length === 0, `A: el atacante no recibe la cola ni lo publicado en vivo (recibió ${a1.recibidos.length} de 8)`);
await cerrar(a1);
const { c: v2, ok: okV2 } = await conectar('victima', ID_VICTIMA, false);
await esperar(1200);
comprobar(okV2 && v2.sp[0] === 1, `A: la víctima vuelve y su sesión sigue ahí (CONNACK session present = ${v2.sp[0]})`);
comprobar(cuantos(v2, 'colaA-') === 5 && cuantos(v2, 'vivoA-') === 3, `A: la víctima recibe su cola completa: ${cuantos(v2, 'colaA-')} de 5 encolados y ${cuantos(v2, 'vivoA-')} de 3 publicados con el atacante conectado`);

// ── Ataque B: con la víctima conectada, el atacante entra con su identificador y sesión LIMPIA (expulsar y borrar) ──
const cierresV2 = v2.cierres;
const { c: b1, ok: okB1 } = await conectar('atacante', ID_VICTIMA, true);
await esperar(800);
comprobar(okB1, 'B: el broker acepta la conexión del atacante con sesión limpia (sin ella, B no atacó)');
comprobar(v2.cierres === cierresV2 && v2.connected, 'B: la víctima conectada no es expulsada');
await publicar(emisor, 'vivoB-', 3); await esperar(800);
comprobar(cuantos(v2, 'vivoB-') === 3, `B: la víctima sigue recibiendo en vivo (${cuantos(v2, 'vivoB-')} de 3)`);
await cerrar(b1); await cerrar(v2);
await publicar(emisor, 'colaB-', 5); await esperar(300);
{ const { c, ok } = await conectar('atacante', ID_VICTIMA, true); await esperar(300); await cerrar(c);
  comprobar(ok, 'B: el atacante vuelve a entrar con sesión limpia con la víctima caída'); }
const { c: v3, ok: okV3 } = await conectar('victima', ID_VICTIMA, false); // sin volver a suscribirse
await esperar(1200);
comprobar(okV3 && v3.sp[0] === 1 && cuantos(v3, 'colaB-') === 5, `B: tras la sesión limpia del atacante, la cola de la víctima sigue entera (session present ${v3.sp[0]}, ${cuantos(v3, 'colaB-')} de 5)`);
await publicar(emisor, 'vivoB2-', 3); await esperar(800);
comprobar(cuantos(v3, 'vivoB2-') === 3, `B: su suscripción sobrevivió sin volver a pedirla (${cuantos(v3, 'vivoB2-')} de 3 en vivo)`);
await cerrar(v3);

// ── Ataque C: pelea por el identificador, los dos con reconexión automática (la víctima se suscribe en cada conexión) ──
const pelea = (quien, clean, sub) => {
  const c = mqtt.connect(E.url, { username: U[quien], password: E.claves[quien], clientId: ID_VICTIMA, clean, protocolVersion: 4, reconnectPeriod: 300 });
  c.rec = new Set(); c.conexiones = 0;
  c.on('connect', () => { c.conexiones++; if (sub) c.subscribe('sitio/#', { qos: 1 }); });
  c.on('message', (_t, m) => c.rec.add(m.toString()));
  c.on('error', () => {});
  return c;
};
const vc = pelea('victima', false, true); await esperar(600);
const ac = pelea('atacante', false, false);
const N = 50;
for (let i = 1; i <= N; i++) { emisor.publish(TOPICO, `pelea-${i}`, { qos: 1 }); await esperar(100); }
await esperar(1500); ac.end(true); await esperar(2500);
const recV = [...vc.rec].filter((x) => x.startsWith('pelea-')).length;
const recA = [...ac.rec].filter((x) => x.startsWith('pelea-')).length;
comprobar(ac.conexiones >= 1, `C: el atacante llegó a conectarse en la pelea (${ac.conexiones} conexiones; sin ellas, C no atacó)`);
comprobar(recV === N && vc.conexiones === 1, `C: en la pelea la víctima recibe ${recV} de ${N} sin reconectarse nunca (conexiones: ${vc.conexiones}); el atacante, ${recA}`);
vc.end(true);
await esperar(500);

// ── Ataque C, segunda variante: el atacante reconecta con sesión LIMPIA (cada conexión suya borraría la sesión de la víctima) ──
const vc2 = pelea('victima', false, true); await esperar(600);
const ac2 = pelea('atacante', true, false);
for (let i = 1; i <= N; i++) { emisor.publish(TOPICO, `peleaL-${i}`, { qos: 1 }); await esperar(100); }
await esperar(1500); ac2.end(true); await esperar(2500);
const recV2 = [...vc2.rec].filter((x) => x.startsWith('peleaL-')).length;
comprobar(ac2.conexiones >= 1 && recV2 === N && vc2.conexiones === 1,
  `C (sesión limpia): el atacante se conecta (${ac2.conexiones} conexiones) y la víctima recibe ${recV2} de ${N} sin reconectarse nunca (conexiones: ${vc2.conexiones})`);
vc2.end(true);

// ── La negación de recibir no le quita a la pasarela su subárbol de comandos (permiso de prioridad mayor) ──
const { c: pas, ok: okPas } = await conectar('pasarela', U.pasarela, false);
const subPas = okPas ? await suscribir(pas, `sitio/s1/pasarela/${U.pasarela}/+/command/#`) : -1;
const { c: ord } = await conectar('ordenador', U.ordenador, true);
await new Promise((r) => ord.publish(`sitio/s1/pasarela/${U.pasarela}/0102030405060708/command/down`, 'orden-1', { qos: 1 }, r));
await esperar(800);
comprobar(subPas === 1 && pas.recibidos.includes('orden-1'), `la pasarela (rol real) se suscribe a su subárbol de comandos (SUBACK ${subPas}) y recibe lo que llega ahí (${pas.recibidos.length} de 1)`);
await cerrar(ord); await cerrar(pas); await cerrar(emisor);
console.log(fallos === 0 ? 'ATAQUES CONTENIDOS' : `${fallos} comprobación(es) con falla`);
process.exit(fallos === 0 ? 0 : 1);
