// La calidad del enlace y lo configurable de la vista (docs/19 §4 AA, puntos 3 a 8), en navegadores reales con Playwright, contra la pila de
// desarrollo. Lo lanza `plataforma/pruebas/panel-enlace-e2e.sh`, que crea un sitio de descarte con un nodo LoRaWAN (canal temperatura y rssi,
// con mediciones y una trama cruda que trae además `co2` y la señal en `rxInfo`) y las personas de descarte (operador técnico, con ese sitio
// como predeterminado); pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes) y lo borra todo al final.
// Por caso (navegador × ancho, 390 y 1 280 px): (1) Resumen: «Elegir qué ver» abre la lista, ocultar una magnitud y guardar dice «1 magnitud
// oculta»; volver a mostrarla; (2) Red: «Calidad del enlace» con la línea del nodo y la gráfica de la intensidad; (3) Configurar: «Agregar una
// magnitud» (snr) y, tras «Revisar las tramas», co2 «sin magnitud en el catálogo»; (4) Preferencias: «Magnitudes que ves». En cada pantalla:
// sin desplazamiento horizontal, casillas y botones nuevos de al menos 24 × 24 px (WCAG 2.5.8) y ningún error de JavaScript.
// Antes de cada escritura, una guarda dura comprueba que la pantalla es la del sitio o el nodo de la corrida; si no, el paso se corta sin escribir.
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, sitio: SITIO, nombre_sitio: NOMBRE_SITIO, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
let fallos = 0;
const ok = (m) => console.log(`OK    [${NAV}] ${m}`);
const falla = (m) => { fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const exigir = (cond, m) => { if (!cond) throw new Error(`guarda: ${m}`); };
let paginaActual = null;
const paso = async (nombre, f) => {
  try { await f(); return true; } catch (e) {
    const visto = paginaActual ? limpio(await paginaActual.textContent('main').catch(() => '')).slice(0, 240) : '';
    falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
    return false;
  }
};

const motor = await motores[NAV].launch();
console.log(`navegador: ${NAV} ${motor.version()}`);
const sinDesborde = async (p, donde) => {
  let sobra = 0;
  for (let i = 0; i < 4; i++) {
    sobra = Math.max(sobra, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    await p.waitForTimeout(150);
  }
  comprobar(sobra <= 0, `${donde}: sin desplazamiento horizontal`, `${sobra} px de más`);
};
// Objetivos táctiles: lo nuevo (casillas y botones de estas pantallas) mide al menos 24 × 24 px (WCAG 2.5.8).
const objetivos = async (p, selector, donde) => {
  const chicos = await p.$$eval(selector, (xs) => xs.filter((x) => x.offsetParent !== null).map((x) => x.getBoundingClientRect())
    .filter((r) => r.width < 24 || r.height < 24).map((r) => `${Math.round(r.width)}×${Math.round(r.height)}`));
  comprobar(chicos.length === 0, `${donde}: objetivos táctiles de al menos 24 × 24 px`, chicos.join(', '));
};
const foto = async (p, nombre) => {
  if (!capturas) return;
  await p.mouse.move(0, 0);
  await p.screenshot({ path: `${capturas}/${nombre}-${NAV}-${p.viewportSize().width}.png`, fullPage: true });
};
const iniciar = async (p, c) => {
  await p.goto(`${base}/panel/#/legal`);
  await p.waitForLoadState('networkidle');
  const r = await p.evaluate(async ({ email, temporal, nueva }) => {
    const h = { 'content-type': 'application/json', accept: 'application/json', 'X-Pedido': 'panel' };
    const a = await fetch('/sesion', { method: 'POST', headers: h, body: JSON.stringify({ email, clave: temporal }) });
    if (!a.ok) return `POST /sesion ${a.status}`;
    const b = await fetch('/sesion/clave', { method: 'POST', headers: h, body: JSON.stringify({ actual: temporal, nueva }) });
    if (!b.ok) return `POST /sesion/clave ${b.status}`;
    const t = await (await fetch('/terminos')).json();
    const x = await fetch('/terminos/aceptar', { method: 'POST', headers: h, body: JSON.stringify({ version: t.version }) });
    return x.ok ? 'ok' : `POST /terminos/aceptar ${x.status}`;
  }, c);
  if (r !== 'ok') throw new Error(`no se pudo entrar: ${r}`);
};

for (const c of casos) {
  const A = c.ancho;
  const NODO = c.nodo; // uno por caso: «Agregar snr» cambia el equipo, y el caso siguiente debe encontrarlo como estaba
  const ctx = await motor.newContext({ viewport: { width: A, height: 900 }, locale: 'es-CL' });
  const p = await ctx.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  let sigue = true;
  const correr = async (nombre, f) => {
    if (!sigue) return;
    sigue = await paso(nombre, f);
    if (!sigue) console.log(`AVISO [${NAV}] ${A} px: falló «${nombre}»; se corta el caso`);
  };

  await correr(`${A} px: entrar como operador técnico`, () => iniciar(p, c));

  // ── (1) Resumen: «Elegir qué ver» ───────────────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: Elegir qué ver`, async () => {
    await p.goto(`${base}/panel/#/?sitio=${encodeURIComponent(SITIO)}`);
    await p.reload(); // la sesión y sus preferencias se leen al cargar
    await p.waitForSelector('[data-abrir-elegir]');
    exigir(limpio(await p.textContent('main')).includes(NOMBRE_SITIO), `el tablero no nombra «${NOMBRE_SITIO}»: no se escribe`);
    await p.click('[data-abrir-elegir]');
    await p.waitForSelector('[data-ver-magnitud="temperatura"]');
    await objetivos(p, '[data-elegir-que-ver] input[type=checkbox], [data-elegir-que-ver] button', `${A} px, Elegir qué ver`);
    await sinDesborde(p, `${A} px, Resumen con la lista abierta`);
    await foto(p, 'resumen-elegir');
    exigir((await p.locator('[data-ahora-magnitud="temperatura"]').count()) === 1, 'la temperatura no está en «Ahora» antes de ocultarla: no se prueba');
    await p.click('[data-ver-magnitud="temperatura"]');
    await p.click('[data-guardar-elegir]');
    await p.waitForSelector('[data-ocultas-cuenta]');
    comprobar(limpio(await p.textContent('[data-ocultas-cuenta]')) === '1 magnitud oculta.', `${A} px: tras guardar, «1 magnitud oculta»`);
    // «Ahora» se vuelve a pedir después de guardar: se espera su respuesta (hasta 10 s) antes de mirar.
    const sale = await p.waitForSelector('[data-ahora-magnitud="temperatura"]', { state: 'detached', timeout: 10_000 }).then(() => true, () => false);
    comprobar(sale, `${A} px: la temperatura ya no está en «Ahora»`);
    await p.click('[data-abrir-elegir]');
    await p.click('[data-ver-magnitud="temperatura"]');
    await p.click('[data-guardar-elegir]');
    await p.waitForSelector('[data-ocultas-cuenta]', { state: 'detached' });
    ok(`${A} px: volver a mostrarla deja la lista vacía`);
  });

  // ── (2) Red: «Calidad del enlace» ───────────────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: Calidad del enlace`, async () => {
    await p.goto(`${base}/panel/#/?sitio=${encodeURIComponent(SITIO)}&ver=red`);
    await p.waitForSelector(`[data-enlace-equipo="${NODO.id}"]`);
    // El nodo de la corrida guarda la intensidad (rssi) y aún no la relación señal/ruido: su línea es «−92 dBm · hace N min» (el caso con
    // las dos, en lib/senal.test.ts). Con la última lectura de hace segundos, «ahora».
    const linea = limpio(await p.textContent(`[data-enlace-equipo="${NODO.id}"] [data-enlace-linea]`));
    comprobar(/^−\d+ dBm · (ahora|hace )/.test(linea), `${A} px: la línea del nodo con su intensidad y hace cuánto`, linea);
    await p.waitForSelector('[data-enlace-grafica="rssi"] canvas');
    ok(`${A} px: la gráfica de la intensidad del sitio`);
    await objetivos(p, '[data-enlace-lista] a', `${A} px, Calidad del enlace`);
    await sinDesborde(p, `${A} px, Red`);
    await foto(p, 'red-enlace');
  });

  // ── (3) Configurar: «Agregar una magnitud» y «Lo que la trama trae y no se guarda» ─────────────────────────────────────────────
  await correr(`${A} px: Configurar`, async () => {
    await p.goto(`${base}/panel/#/dispositivos/${NODO.id}/configurar`);
    await p.waitForSelector('[data-magnitudes-equipo]');
    exigir(limpio(await p.textContent('[data-configurar] h2')) === `Configurar: ${NODO.nombre}`, 'la pantalla no es la del nodo de la corrida: no se escribe');
    await objetivos(p, '[data-magnitudes-equipo] select, [data-magnitudes-equipo] button, [data-sin-guardar] button', `${A} px, Configurar`);
    await p.click('[data-revisar-tramas]');
    await p.waitForSelector('[data-sin-guardar-clave="co2"]');
    comprobar(limpio(await p.textContent('[data-sin-guardar-clave="co2"] [data-sin-magnitud]')).startsWith('sin magnitud en el catálogo'), `${A} px: co2 «sin magnitud en el catálogo»`);
    comprobar((await p.locator('[data-agregar-clave="snr"]').count()) === 1, `${A} px: la relación señal/ruido de rxInfo se ofrece con «Agregar snr»`);
    await sinDesborde(p, `${A} px, Configurar con la lista`);
    await foto(p, 'configurar-sin-guardar');
    await p.click('[data-agregar-clave="snr"]');
    await p.waitForSelector('[data-sin-guardar-clave="snr"]', { state: 'detached' });
    // La lista del equipo se repinta con la respuesta: se espera (hasta 10 s) a que la nombre.
    await p.waitForFunction(() => (document.querySelector('[data-magnitudes-actuales]')?.textContent ?? '').includes('Relación señal/ruido'), null, { timeout: 10_000 }).catch(() => undefined);
    const actuales = limpio(await p.textContent('[data-magnitudes-actuales]'));
    comprobar(actuales.includes('Relación señal/ruido'), `${A} px: «Agregar snr» suma la magnitud al equipo`, actuales);
    await sinDesborde(p, `${A} px, Configurar tras agregar`);
  });

  // ── (4) Preferencias: «Magnitudes que ves» ──────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: Preferencias`, async () => {
    await p.goto(`${base}/panel/#/preferencias`);
    await p.waitForSelector('[data-lista-elegir] [data-ver-magnitud="snr"]');
    await objetivos(p, '[data-lista-elegir] input[type=checkbox]', `${A} px, Preferencias`);
    await sinDesborde(p, `${A} px, Preferencias`);
    await foto(p, 'preferencias-elegir');
  });

  comprobar(errores.length === 0, `${A} px: ningún error de JavaScript`, errores.slice(0, 3).join(' | '));
  await ctx.close();
}
await motor.close();
process.exit(fallos ? 1 : 0);
