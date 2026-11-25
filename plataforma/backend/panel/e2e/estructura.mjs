// P15 «Zonas», P17 «Sitios» y las zonas nuevas del alta (docs/19 §4, U y U2), en navegadores reales con Playwright, contra la pila de desarrollo. Lo
// lanza `plataforma/pruebas/panel-estructura-e2e.sh`, que crea un sitio de descarte (con la zona «Norte») y las personas de descarte
// (administrador del sistema, con ese sitio como predeterminado); pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de
// órdenes) y lo borra todo al final, también los sitios, zonas, equipos y eventos que esta prueba crea (la aplicación no borra sitios ni zonas).
// Por caso (navegador × ancho): (1) crear un sitio desde «Sitios» con su código sugerido, su primera zona y su descripción, y editarlo en su fila;
// (2) en sus Ajustes, agregar, renombrar, repetir con otras mayúsculas (se ve el mensaje), retirar y volver a ofrecer una zona; (3) «+ Nueva zona…»
// del alta de a uno; (4) el alta masiva con una zona que no existe: sin la casilla, 3 «No entran»; con ella, se anuncia y quedan los 3 equipos
// en la zona (por HTTP, sin clientes del broker); (5) «Actividad» cuenta todo eso. Sin desplazamiento horizontal ni errores de JavaScript.
// Antes de CADA escritura sobre zonas o equipos, una guarda dura comprueba que la pantalla nombra el sitio de la corrida; si no, el paso se corta
// sin escribir, y un paso que falla corta el caso (los siguientes dependen de él).
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, prefijo: P, sitio_base: SITIO_BASE, nombre_base: NOMBRE_BASE, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
let fallos = 0;
const ok = (m) => console.log(`OK    [${NAV}] ${m}`);
const falla = (m) => { fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
// ¿El nombre que muestra la pantalla es el del sitio de la corrida (o el mismo tras el renombre a «… B»)?
const esElSitio = (t, nombre) => t === nombre || t === `${nombre} B`;
// Lo mismo que lib/estructura.ts (codigoSugerido): el código que el panel sugiere desde el nombre.
const codigoDe = (nombre) => nombre.normalize('NFD').replace(/\p{M}/gu, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '');
let paginaActual = null;
const paso = async (nombre, f) => {
  try { await f(); return true; } catch (e) {
    const visto = paginaActual ? limpio(await paginaActual.textContent('main').catch(() => '')).slice(0, 240) : '';
    falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
    return false;
  }
};
// Una guarda dura: si no se cumple, el paso se corta ANTES de escribir (a diferencia de `comprobar`, que cuenta y sigue).
const exigir = (cond, m) => { if (!cond) throw new Error(`guarda: ${m}`); };

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
  const ctx = await motor.newContext({ viewport: { width: A, height: 900 }, locale: 'es-CL' });
  const p = await ctx.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  // El panel pide confirmar al salir con credenciales sin descargar: aquí se descartan igual que lo haría un «Quedarme».
  p.on('dialog', (d) => { void d.dismiss(); });
  const tag = `${NAV === 'chromium' ? 'c' : 'f'}${A}`;
  const nombreSitio = `Sede e2e ${P}${tag}`; // el código sugerido empieza con «sede-e2e-<corrida>», que la limpieza reconoce
  const codigoSitio = codigoDe(nombreSitio);
  const zonaA = 'Galería';
  const zonaB = 'Galería norte';
  const zonaAlta = `Invernadero e2e ${tag}`;
  const zonaLote = `Zona lote ${tag}`;
  const ids = [1, 2, 3].map((k) => `${P}-${tag}-${k}`);
  const zonasDe = (codigo) => p.evaluate(async (cod) => {
    const s = (await (await fetch('/sitios', { headers: { accept: 'application/json' } })).json()).find((x) => x.codigo === cod);
    return s ? s.zonas : null;
  }, codigo);

  // Cada paso parte de lo que dejó el anterior (el sitio creado, sus zonas): si uno falla, el caso se corta. Seguir podría escribir en un
  // sitio que no es de la prueba, que es justo lo que las guardas de abajo evitan.
  let sigue = true;
  const correr = async (nombre, f) => {
    if (!sigue) return;
    sigue = await paso(nombre, f);
    if (!sigue) console.log(`AVISO [${NAV}] ${A} px: falló «${nombre}»; se corta el caso (los pasos siguientes dependen de él)`);
  };
  // Qué sitio nombra la pantalla de Ajustes: su nombre fijo o, con varios sitios, el elegido en el selector.
  const sitioDeAjustes = async () => ((await p.locator('[data-sitio-ajustes-nombre]').count()) > 0
    ? limpio(await p.textContent('[data-sitio-ajustes-nombre] strong'))
    : limpio(await p.locator('[data-sitio-ajustes] option:checked').textContent()));
  // Por igualdad, no por «contiene»: otro sitio cuyo nombre empiece igual («… Bodega») no pasa. Tras el renombre de (1) se llama «… B».
  const guardaAjustes = async () => {
    const t = await sitioDeAjustes();
    exigir(esElSitio(t, nombreSitio), `Ajustes del sitio nombra «${t}» y no «${nombreSitio}»: no se escribe`);
  };
  // Qué sitio nombra el alta masiva para las zonas nuevas: el selector (con varios sitios) o el rótulo de la casilla.
  const guardaLote = async () => {
    const sel = p.locator('[data-sitio-zonas-lote]');
    const t = (await sel.count()) > 0 ? limpio(await sel.locator('option:checked').textContent()) : limpio(await p.textContent('[data-crear-zonas-lote]'));
    exigir(t.includes(NOMBRE_BASE), `el alta masiva crearía zonas en «${t}» y no en «${NOMBRE_BASE}»: no se escribe`);
  };

  await correr(`${A} px: entrar como administrador del sistema`, () => iniciar(p, c));

  // ── (1) «Sitios»: crear con código sugerido y primera zona; editar nombre y descripción en la misma fila ─────────────────────────
  await correr(`${A} px: Sitios`, async () => {
    await p.goto(`${base}/panel/#/sitios`);
    await p.reload(); // la sesión se lee al cargar (como e2e/catalogo.mjs)
    await p.waitForSelector('[data-pantalla-sitios]');
    comprobar((await p.locator(`[data-sitio="${SITIO_BASE}"]`).count()) === 1, `${A} px: la tabla trae el sitio de prueba`);
    await sinDesborde(p, `${A} px, tabla de sitios`);
    await foto(p, 'sitios-tabla');
    await p.click('[data-abrir-crear-sitio]');
    await p.fill('[data-campo-nombre-sitio]', nombreSitio);
    await p.waitForFunction((x) => document.querySelector('[data-campo-codigo-sitio]')?.value === x, codigoSitio, { timeout: 5000 });
    ok(`${A} px: el código sugerido desde el nombre es «${codigoSitio}»`);
    await p.fill('[data-campo-primera-zona]', 'Principal');
    await p.fill('[data-campo-descripcion-sitio]', 'Sitio de prueba');
    await sinDesborde(p, `${A} px, formulario de sitio`);
    await foto(p, 'sitios-crear');
    await p.click('[data-crear-sitio]');
    await p.waitForSelector('[data-sitio-creado]');
    exigir(limpio(await p.textContent('[data-sitio-creado]')).includes(nombreSitio), `el aviso de sitio creado no nombra «${nombreSitio}»: no se sigue`);
    const fila = `[data-sitio="${codigoSitio}"]`;
    await p.waitForSelector(fila);
    const t = limpio(await p.textContent(fila));
    comprobar(t.includes(nombreSitio) && t.includes('Sitio de prueba') && t.includes(codigoSitio), `${A} px: el sitio nuevo aparece en la tabla con su descripción`, t);
    exigir((await p.locator(fila).count()) === 1 && limpio(await p.textContent(`${fila} code`)) === codigoSitio, `la fila a editar no es la del sitio de la corrida (${codigoSitio})`);
    await p.click(`${fila} [data-editar-sitio]`);
    await p.fill(`${fila} [data-campo-editar-nombre]`, `${nombreSitio} B`);
    await p.fill(`${fila} [data-campo-editar-descripcion]`, 'Anexo de prueba');
    await sinDesborde(p, `${A} px, edición en la fila`);
    await p.click(`${fila} [data-guardar-sitio]`);
    await p.waitForSelector('[data-sitio-guardado]');
    await p.waitForFunction(([f, x]) => document.querySelector(f)?.textContent?.includes(x), [fila, `${nombreSitio} B`], { timeout: 5000 });
    const t2 = limpio(await p.textContent(fila));
    comprobar(t2.includes('Anexo de prueba') && t2.includes(codigoSitio), `${A} px: editado en la misma fila: nuevo nombre y descripción, mismo código`, t2);
  });

  // ── (2) Ajustes del sitio → «Zonas» ─────────────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: Zonas en Ajustes del sitio`, async () => {
    await p.goto(`${base}/panel/#/sitio/ajustes?sitio=${codigoSitio}`);
    await p.waitForSelector('[data-seccion-zonas] [data-lista-zonas]');
    exigir(await p.locator('[data-zona="Principal"]').count() === 1, 'la lista de zonas no trae la zona creada con el sitio de la corrida: no se escribe');
    ok(`${A} px: la zona creada con el sitio está en la lista`);
    await guardaAjustes();
    await p.fill('[data-campo-zona-nueva]', zonaA);
    await p.click('[data-boton-agregar-zona]');
    await p.waitForSelector(`[data-zona="${zonaA}"]`);
    await p.waitForSelector('[data-zonas-hecho]');
    ok(`${A} px: agregar «${zonaA}»`);
    await p.click(`[data-zona="${zonaA}"] [data-renombrar-zona]`);
    await p.fill('[data-campo-renombrar]', zonaB);
    await sinDesborde(p, `${A} px, zona en edición`);
    await guardaAjustes();
    await p.click('[data-guardar-zona]');
    await p.waitForSelector(`[data-zona="${zonaB}"]`);
    comprobar((await p.locator(`[data-zona="${zonaA}"]`).count()) === 0, `${A} px: renombrar «${zonaA}» a «${zonaB}»`);
    await p.fill('[data-campo-zona-nueva]', zonaB.toUpperCase());
    await guardaAjustes();
    await p.click('[data-boton-agregar-zona]');
    await p.waitForSelector('[data-seccion-zonas] [data-aviso="error"]');
    const m = limpio(await p.textContent('[data-seccion-zonas] [data-aviso="error"]'));
    comprobar(/ya hay una zona/i.test(m) && !/_|zona_id|codigo/.test(m), `${A} px: un nombre repetido con otras mayúsculas dice por qué, en palabras llanas`, m);
    await guardaAjustes();
    await p.click(`[data-zona="${zonaB}"] [data-retirar-zona]`);
    await p.waitForSelector(`[data-zona="${zonaB}"] [data-reactivar-zona]`);
    comprobar(limpio(await p.textContent(`[data-zona="${zonaB}"]`)).includes('retirada'), `${A} px: la zona retirada lo dice con letras`);
    await sinDesborde(p, `${A} px, zonas con una retirada`);
    await foto(p, 'zonas');
    await guardaAjustes();
    await p.click(`[data-zona="${zonaB}"] [data-reactivar-zona]`);
    await p.waitForSelector(`[data-zona="${zonaB}"] [data-retirar-zona]`);
    ok(`${A} px: volver a ofrecer la zona retirada`);
  });

  // ── (3) Alta de a uno: «+ Nueva zona…» ──────────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: «+ Nueva zona…» en el alta`, async () => {
    await p.goto(`${base}/panel/#/alta`);
    await p.waitForSelector('[data-asistente] [data-campo="sitio"]');
    await p.selectOption('[data-campo="sitio"]', SITIO_BASE);
    await p.click('[data-nueva-zona]');
    await p.fill('[data-campo-nueva-zona] input', zonaAlta);
    await sinDesborde(p, `${A} px, campo de la zona nueva`);
    const elegidoAlta = limpio(await p.locator('[data-campo="sitio"] option:checked').textContent());
    exigir(elegidoAlta.includes(NOMBRE_BASE) && (await p.$eval('[data-campo="sitio"]', (e) => e.value)) === SITIO_BASE, `el alta tiene elegido «${elegidoAlta}» y no «${NOMBRE_BASE}»: no se crea la zona`);
    await p.click('[data-crear-zona]');
    await p.waitForSelector('[data-campo-nueva-zona]', { state: 'detached' });
    const elegida = limpio(await p.locator('[data-campo="zona"] option:checked').textContent());
    comprobar(elegida === zonaAlta, `${A} px: «+ Nueva zona…» crea «${zonaAlta}» y la deja elegida`, elegida);
    await foto(p, 'alta-nueva-zona');
  });

  // ── (4) Alta masiva con una zona que no existe: la casilla, desmarcada por omisión ──────────────────────────────────────────────
  await correr(`${A} px: alta masiva con una zona nueva`, async () => {
    await p.goto(`${base}/panel/#/alta?modo=lote`);
    await p.waitForSelector('[data-archivo]');
    const filas = ['id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales', ...ids.map((x) => `${x},Nodo ${x},${zonaLote},http,,300,temperatura`)].join('\n');
    await p.setInputFiles('[data-archivo]', { name: 'zona-nueva.csv', mimeType: 'text/csv', buffer: Buffer.from(filas) });
    await p.waitForFunction(() => /3 filas leídas/.test(document.querySelector('[data-filas-leidas]:not([data-leyendo])')?.textContent ?? ''), null, { timeout: 10000 });
    await p.click('[data-revisar]');
    await p.waitForSelector('[data-paso-lote="2"] [data-informe-lote], [data-error-lote]', { timeout: 15000 });
    const cifra = (f) => p.textContent(`[data-filtro-lote="${f}"] [data-cifra]`).then((x) => (x ?? '').trim());
    const casilla = p.locator('[data-casilla-crear-zonas]');
    comprobar((await casilla.count()) === 1 && !(await casilla.isChecked()), `${A} px: la casilla «Crear las zonas que no existan en…» aparece desmarcada`);
    // Con ajustes en más de un sitio (el administrador del sistema los tiene todos) hay selector: se elige el de la corrida y se exige.
    if ((await p.locator('[data-sitio-zonas-lote]').count()) > 0) await p.selectOption('[data-sitio-zonas-lote]', { label: NOMBRE_BASE });
    await guardaLote();
    ok(`${A} px: la casilla y su sitio son los de la prueba («${NOMBRE_BASE}»)`);
    comprobar((await cifra('rechazada')) === '3' && (await p.locator('[data-zonas-nuevas-lote]').count()) === 0, `${A} px: sin la casilla, las 3 filas «No entran»`, `no entran: ${await cifra('rechazada')}`);
    await guardaLote();
    await casilla.click();
    await p.waitForSelector('[data-zonas-nuevas-lote], [data-error-lote]', { timeout: 15000 });
    const aviso = limpio(await p.textContent('[data-zonas-nuevas-lote]'));
    exigir(aviso.includes(`«${NOMBRE_BASE}»`), `el aviso de zonas nuevas nombra otro sitio que «${NOMBRE_BASE}»: no se crea nada (${aviso})`);
    comprobar(aviso.includes('Se crearán 1 zona nueva') && aviso.includes(`${zonaLote} (3 filas)`), `${A} px: con la casilla, se anuncia la zona nueva y cuántas filas la usan`, aviso);
    comprobar((await cifra('valida')) === '3' && (await cifra('rechazada')) === '0', `${A} px: con la casilla, las 3 filas se crean`, `se crean: ${await cifra('valida')}`);
    await sinDesborde(p, `${A} px, revisión con la zona nueva`);
    await foto(p, 'lote-zona-nueva');
    await guardaLote();
    await p.click('[data-crear-lote]');
    await p.waitForSelector('[data-paso-lote="3"]', { timeout: 20000 });
    comprobar(limpio(await p.textContent('[data-resultado-lote]')) === 'Se crearon 3 dispositivos.', `${A} px: «Se crearon 3 dispositivos.»`);
    const zonas = await zonasDe(SITIO_BASE);
    const z = (zonas ?? []).find((x) => x.nombre === zonaLote);
    comprobar(z !== undefined && z.dispositivos === 3, `${A} px: la zona «${zonaLote}» quedó creada con los 3 equipos`, JSON.stringify(z));
    // Las credenciales de descarte no quedan: se descargan (y el archivo se borra) y se olvidan, como haría una persona.
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-credenciales]')]);
    await d.delete();
    await p.click('[data-olvidar-credenciales]');
    await p.waitForSelector('[data-sin-credenciales]');
  });

  // ── (5) Actividad ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await correr(`${A} px: Actividad`, async () => {
    await p.goto(`${base}/panel/#/actividad?sitio=${codigoSitio}`);
    await p.waitForSelector('[data-fila-actividad]');
    const t = limpio(await p.textContent('[data-actividad]'));
    comprobar(t.includes(`creó la zona «${zonaA}»`) && t.includes(`creó el sitio «${nombreSitio}»`), `${A} px: la actividad del sitio nuevo dice que se creó el sitio y la zona «${zonaA}»`, t.slice(0, 300));
    comprobar(t.includes(`«${zonaA}» a «${zonaB}»`) && t.includes(`retiró la zona «${zonaB}»`) && t.includes(`volvió a ofrecer la zona «${zonaB}»`), `${A} px: y que se renombró, se retiró y se volvió a ofrecer`, t.slice(0, 300));
    const tipos = limpio(await p.textContent('[data-filtro-tipo]'));
    comprobar(tipos.includes('Zonas creadas') && tipos.includes('Sitios creados'), `${A} px: el filtro por tipo ofrece «Sitios creados» y «Zonas creadas»`, tipos);
    await sinDesborde(p, `${A} px, actividad`);
    await p.goto(`${base}/panel/#/actividad?sitio=${SITIO_BASE}`);
    await p.waitForFunction((z) => document.querySelector('[data-actividad]')?.textContent?.includes(z), zonaLote, { timeout: 10000 });
    const b = limpio(await p.textContent('[data-actividad]'));
    comprobar(b.includes(`creó la zona «${zonaAlta}»`) && b.includes(`creó la zona «${zonaLote}» al dar de alta por lote`), `${A} px: la actividad del sitio de prueba cuenta la zona del alta y la del lote («al dar de alta por lote»)`, b.slice(0, 300));
  });

  comprobar(errores.length === 0, `${A} px: sin errores de JavaScript`, errores.join(' | '));
  await ctx.close();
}
await motor.close();
process.exit(fallos === 0 ? 0 : 1);
