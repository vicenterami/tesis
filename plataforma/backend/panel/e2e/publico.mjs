// P9, la vista pública por enlace (HU-32, RF-62; docs/19 §4, O; docs/16 §80), en navegadores reales con Playwright, contra la pila de
// desarrollo. Lo lanza `plataforma/pruebas/panel-publico-e2e.sh` (paso 4c del guardián), que crea el sitio, los equipos, las lecturas y las
// personas de descarte, pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes ni se imprimen) y lo borra todo
// al final. Por cada caso (navegador × ancho): la persona entra (clave temporal → propia → términos, por la API desde la página) y abre
// «Vista pública»; publica con vista previa y avisos visibles antes de «Publicar»; abre la dirección como visitante en un contexto sin
// sesión y comprueba que lo dibujado es lo que responde GET /publico, que el token no va en la dirección de ninguna petición (solo en la
// cabecera), ni en el almacenamiento del navegador, ni en cookies, ni en la consola; que la primera petición cuenta la carga y los
// refrescos no; renueva con un plazo que acorta (409 `acorta` y confirmación); baja el k del sitio a 1 con su aviso (el visitante ve la zona
// que antes salía oculta) y lo devuelve a 3; y revoca: el visitante ve «enlace no disponible». Al final escribe «CARGAS n» (los accesos
// que el backend contó: el guion espera a que se vuelquen antes de borrar los enlaces).
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const { base, api, navegador: NAV, sitio, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
let fallos = 0;
let cargas = 0;
// Sin token (no se leyó de la dirección), toda comprobación «el token no aparece en…» FALLA: no pasa en falso buscando «null».
// Los tokens de la corrida nunca se imprimen: un mensaje de Playwright puede traer la dirección entera (revisión del 17/11/2026).
const secretos = new Set();
const sinSecretos = (m) => [...secretos].reduce((s, x) => s.replaceAll(x, '…'), String(m));
const ok = (m) => console.log(`OK    [${NAV}] ${sinSecretos(m)}`);
const falla = (m) => { fallos++; console.log(`FALLA [${NAV}] ${sinSecretos(m)}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
let paginaActual = null;
const paso = async (nombre, f) => {
  try { await f(); } catch (e) {
    const visto = paginaActual ? ((await paginaActual.textContent('main').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
  }
};
// Los textos del diseño (docs/19 §4, O, puntos 9 a 11), escritos aquí a propósito: si el panel los cambia, la prueba lo dice.
const NO_DISPONIBLE = 'Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.';
const PROTEGIDO = 'Algunos tramos se ocultan para proteger a equipos individuales.';
const TODOS_LOS_ENLACES = 'Este mínimo afecta a todos los enlaces públicos de este sitio.';
const PIE = 'Vista pública de solo lectura · promedios del sitio';
const NUMERO = new Intl.NumberFormat('es-CL', { maximumFractionDigits: 1 });
// La unidad con su símbolo para personas (la de la tabla de lib/unidades.ts que usa este sitio de prueba: solo temperatura).
const SIMBOLO = { Cel: '°C' };
const valor = (v, unidad) => (v === null ? 'Sin dato' : `${NUMERO.format(v)} ${SIMBOLO[unidad] ?? unidad}`);
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

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
const foto = async (p, nombre, tapar = []) => {
  if (!capturas) return;
  await p.mouse.move(0, 0);
  await p.screenshot({ path: `${capturas}/${nombre}-${NAV}-${p.viewportSize().width}.png`, fullPage: true, mask: tapar.map((s) => p.locator(s)) });
};
// La persona entra por la API desde la página (la pantalla «Entrar» ya la prueba panel-sesion-e2e.sh): sesión con la temporal, clave
// propia y términos aceptados. La cookie queda en el contexto del navegador, como si hubiera entrado por la pantalla.
const iniciar = async (p, c) => {
  await p.goto(`${base}/panel/#/legal`);
  // Con `pnpm dev`, Vite puede recargar la página una vez al terminar de preparar sus módulos: se espera a que la red quede quieta.
  await p.waitForLoadState('networkidle');
  const r = await p.evaluate(async ({ email, temporal, nueva }) => {
    const h = { 'content-type': 'application/json', accept: 'application/json', 'X-Pedido': 'panel' };
    const a = await fetch('/sesion', { method: 'POST', headers: h, body: JSON.stringify({ email, clave: temporal }) });
    if (!a.ok) return `POST /sesion ${a.status}`;
    const b = await fetch('/sesion/clave', { method: 'POST', headers: h, body: JSON.stringify({ actual: temporal, nueva }) });
    if (!b.ok) return `POST /sesion/clave ${b.status}`;
    const t = await (await fetch('/terminos')).json();
    const c = await fetch('/terminos/aceptar', { method: 'POST', headers: h, body: JSON.stringify({ version: t.version }) });
    return c.ok ? 'ok' : `POST /terminos/aceptar ${c.status}`;
  }, c);
  if (r !== 'ok') throw new Error(`no se pudo entrar: ${r}`);
};
// Lo que responde GET /publico para un token (desde Node: sin navegador, sin cookies, sin `carga`).
const vistaDeLaApi = async (token, ventana = '24h') => {
  const r = await fetch(`${api}/publico?ventana=${ventana}`, { headers: { 'X-Enlace-Publico': token } });
  return { status: r.status, cuerpo: r.status === 200 ? await r.json() : null };
};
// Lo que dibujó la pantalla del visitante, en la misma forma que se compara.
// `raiz`: la vista que se lee (la del visitante es la página entera; la vista previa, la de «Publicar»).
const dibujado = (p, raiz = 'body') => p.evaluate((r) => {
  const base = document.querySelector(r) ?? document;
  const t = (el, sel) => (el.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
  return {
    titulo: t(base, '[data-vp-titulo]'),
    sitio: t(base, '[data-vp-sitio]'),
    magnitudes: [...base.querySelectorAll('[data-vp-magnitud]')].map((m) => ({
      codigo: m.getAttribute('data-vp-magnitud'), ahora: t(m, '[data-vp-ahora]'), protegido: m.querySelector('[data-vp-protegido]') !== null,
      zonas: [...m.querySelectorAll('[data-vp-zona]')].map((z) => ({ nombre: z.getAttribute('data-vp-zona'), ahora: t(z, '[data-vp-zona-ahora]') })),
    })),
    ventanas: [...base.querySelectorAll('[data-vp-ventana]')].map((b) => b.getAttribute('data-vp-ventana')),
  };
}, raiz);
const esperado = (v) => ({
  titulo: v.titulo, sitio: v.sitio,
  magnitudes: v.magnitudes.map((m) => ({ codigo: m.codigo, ahora: valor(m.ahora, m.unidad), protegido: m.protegido, zonas: m.zonas.map((z) => ({ nombre: z.nombre, ahora: valor(z.ahora, m.unidad) })) })),
  ventanas: v.ventanas.length > 1 ? v.ventanas : [],
});

for (const caso of casos) {
  const ancho = caso.ancho;
  const etiqueta = `${ancho} px`;
  const titulo = `Clima e2e ${NAV} ${ancho}`;
  const alto = ancho < 500 ? 844 : 900;
  const admin = await motor.newContext({ viewport: { width: ancho, height: alto }, timezoneId: 'America/Santiago' });
  const p = await admin.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e)));
  let token = null;
  let direccion = null;
  let idEnlace = null;
  let enPrevia = null; // lo que dibujó la vista previa justo antes de publicar
  // El visitante: otro contexto, sin la sesión de quien publica; se anota cada petición, cada respuesta y la consola.
  const visita = await motor.newContext({ viewport: { width: ancho, height: alto }, timezoneId: 'America/Santiago' });
  const v = await visita.newPage();
  const pedidas = [];
  const consola = [];
  const erroresVisita = [];
  v.on('request', (r) => pedidas.push({ url: r.url(), cabecera: r.headers()['x-enlace-publico'] ?? null }));
  const esPublico = (url) => new URL(url).pathname === '/publico'; // la ruta de la API, no un módulo del panel (en `pnpm dev`, /panel/src/lib/publico.ts)
  v.on('response', (r) => { if (esPublico(r.url()) && r.url().includes('carga=si') && r.status() === 200) cargas++; });
  v.on('console', (m) => consola.push(m.text()));
  v.on('pageerror', (e) => erroresVisita.push(String(e)));

  await paso(`${etiqueta}: publicar con vista previa y avisos`, async () => {
    await iniciar(p, caso);
    await p.goto(`${base}/panel/#/publicar?sitio=${sitio}`);
    await p.reload();
    await p.locator('[data-formulario-publicar]').waitFor({ timeout: 15000 });
    comprobar((await p.locator('[data-ir-publicar]').count()) === 1, `${etiqueta}: «Vista pública» está en el menú de quien administra el sitio`);
    await p.waitForFunction(() => document.querySelector('[data-minimo-actual]')?.textContent?.trim() === 'k = 3' && document.querySelector('[data-tope-actual]') !== null, null, { timeout: 10000 })
      .then(() => ok(`${etiqueta}: al abrir, la pantalla dice el k que rige en el sitio (3, el de omisión) y su tope de enlaces`))
      .catch(() => falla(`${etiqueta}: al abrir, no aparecen el k ni el tope del sitio`));
    comprobar(limpio(await p.textContent('[data-aviso-todos]').catch(() => '')) === TODOS_LOS_ENLACES, `${etiqueta}: junto al k, «${TODOS_LOS_ENLACES}»`);
    comprobar(limpio(await p.textContent('[data-aviso-texto-publico]')) === 'Este texto lo verá cualquiera con el enlace: sin nombres de personas ni datos personales.',
      `${etiqueta}: junto al título y la descripción, el aviso de que los verá cualquiera`);
    comprobar(limpio(await p.textContent('[data-aviso-nombres-publicos]')).startsWith('El nombre del sitio y el de cada zona publicada también los verá cualquiera con el enlace'),
      `${etiqueta}: junto a las zonas, el aviso de los nombres del sitio y de las zonas`);
    comprobar(await p.locator('[data-publicar-crear]').isDisabled(), `${etiqueta}: sin título ni magnitudes, «Publicar» está desactivado con su motivo`);
    await p.fill('[data-titulo-enlace]', titulo);
    await p.fill('[data-descripcion-enlace]', 'Promedios para el curso, sin datos crudos.');
    await p.check('[data-magnitud-enlace="temperatura"]');
    await p.check('[data-zona-enlace="Norte"]');
    await p.check('[data-zona-enlace="Sur"]');
    await p.locator('[data-vista-previa] [data-vista-publica]').waitFor({ timeout: 15000 });
    await p.locator('[data-aviso-publicar]').first().waitFor({ timeout: 15000 });
    // Esperar a que la vista previa sea la de las dos zonas (la de una sola zona pudo llegar antes).
    await p.waitForFunction(() => document.querySelectorAll('[data-vista-previa] [data-vp-magnitud="temperatura"] [data-vp-zona]').length === 2, null, { timeout: 15000 });
    await p.waitForFunction(() => !document.querySelector('[data-publicar-crear]')?.disabled, null, { timeout: 15000 });
    // Cambiar la selección y pulsar «Publicar» de inmediato: el botón espera la vista previa de la selección nueva, con su motivo.
    await p.uncheck('[data-zona-enlace="Sur"]');
    const ahoraMismo = await p.evaluate(() => ({
      desactivado: document.querySelector('[data-publicar-crear]')?.disabled === true,
      motivo: (document.querySelector('[data-formulario-publicar] [data-motivo-desactivado]')?.textContent ?? '').trim(),
      avisos: document.querySelector('[data-avisos-publicar]') !== null,
    }));
    await p.click('[data-publicar-crear]', { force: true });
    comprobar(ahoraMismo.desactivado && ahoraMismo.motivo === 'Espera la vista previa: lo que verá quien visite y sus avisos se muestran antes de publicar.' && !ahoraMismo.avisos,
      `${etiqueta}: al cambiar la selección, «Publicar» queda desactivado con su motivo hasta que llega la vista previa nueva (sin los avisos viejos)`, JSON.stringify(ahoraMismo));
    comprobar((await p.locator('[data-direccion-enlace]').count()) === 0, `${etiqueta}: … y pulsarlo entonces no publica nada`);
    await p.check('[data-zona-enlace="Sur"]');
    await p.waitForFunction(() => !document.querySelector('[data-publicar-crear]')?.disabled && document.querySelectorAll('[data-vista-previa] [data-vp-magnitud="temperatura"] [data-vp-zona]').length === 2, null, { timeout: 15000 });
    const avisos = await p.$$eval('[data-aviso-publicar]', (es) => es.map((e) => e.textContent.trim()));
    comprobar(avisos.some((a) => a === 'La zona «Sur» tiene hoy 2 equipos, menos que k = 3: saldrá sin valor mientras sea así.'), `${etiqueta}: la vista previa avisa que la zona Sur (2 equipos) saldrá sin valor con k = 3`, JSON.stringify(avisos));
    comprobar(avisos.some((a) => a.startsWith('Combinando el total del sitio con las zonas publicadas se puede deducir el promedio de las no publicadas') && a.includes('«Este»')),
      `${etiqueta}: … y que con el total y las zonas publicadas se deduce la no publicada (Este)`, JSON.stringify(avisos));
    const antes = await p.evaluate(() => {
      const a = document.querySelector('[data-avisos-publicar]');
      const b = document.querySelector('[data-publicar-crear]');
      return a !== null && b !== null && (a.compareDocumentPosition(b) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0;
    });
    comprobar(antes, `${etiqueta}: los avisos se ven ANTES del botón «Publicar»`);
    const previa = await p.evaluate(() => [...document.querySelectorAll('[data-vista-previa] [data-vp-magnitud="temperatura"] [data-vp-zona-ahora]')].map((e) => e.textContent.trim()));
    comprobar(previa.length === 2 && previa[1] === 'Sin dato' && previa[0] !== 'Sin dato', `${etiqueta}: en la vista previa, Norte con valor y Sur oculta («Sin dato»), como lo verá el visitante`, JSON.stringify(previa));
    enPrevia = await dibujado(p, '[data-vista-previa]');
    if (ancho < 500) await sinDesborde(p, `${etiqueta}, publicar con vista previa`);
    await foto(p, '1-publicar-previa');
    await p.click('[data-publicar-crear]');
    await p.locator('[data-direccion-enlace]').waitFor({ timeout: 15000 });
    direccion = limpio(await p.textContent('[data-direccion-enlace]'));
    token = /#\/v\/([A-Za-z0-9_-]{43})$/.exec(direccion)?.[1] ?? null;
    if (token !== null) secretos.add(token);
    comprobar(token !== null && direccion.startsWith(`${base}/panel/#/v/`), `${etiqueta}: al publicar, la dirección se muestra una vez, con el token en el fragmento`);
    comprobar((await p.locator('[data-copiar-direccion]').count()) === 1, `${etiqueta}: … con «Copiar»`);
    comprobar((await p.locator('[data-aviso-origen]').count()) === (/^(localhost|127\.)/.test(new URL(base).hostname) ? 1 : 0),
      `${etiqueta}: si se entró por un nombre local, junto a la dirección se avisa que no sirve para compartir`);
    await foto(p, '2-enlace-creado', ['[data-direccion-enlace]']);
    await p.click('[data-ocultar-direccion]');
    await p.locator('[data-enlace-una-vez]').waitFor({ state: 'detached', timeout: 5000 });
    comprobar(token !== null && !(await p.content()).includes(token), `${etiqueta}: «Ya la guardé: ocultar» la borra de la página: no se vuelve a ver`);
    const fila = p.locator('[data-enlace]', { has: p.locator('[data-titulo-de-enlace]', { hasText: titulo }) });
    await fila.waitFor({ timeout: 10000 });
    idEnlace = await fila.getAttribute('data-enlace');
    comprobar(limpio(await fila.locator('[data-estado-enlace]').textContent()) === 'vigente' && limpio(await fila.locator('[data-que-publica]').textContent()) === 'Temperatura; hasta 7 días; zonas Norte y Sur',
      `${etiqueta}: la lista muestra el enlace vigente y qué publica`);
    const guardado = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    comprobar(token !== null && !guardado.includes(token), `${etiqueta}: el token no queda en el almacenamiento del navegador de quien publica`);
  });

  await paso(`${etiqueta}: el visitante sin sesión ve lo que responde GET /publico`, async () => {
    if (token === null) throw new Error('no hay enlace');
    await v.goto(direccion);
    await v.locator('[data-vp-titulo]').waitFor({ timeout: 15000 });
    await v.locator('[data-vp-grafica="temperatura"] canvas').first().waitFor({ timeout: 15000 });
    const a = await vistaDeLaApi(token);
    comprobar(a.status === 200, `${etiqueta}: GET /publico con el token en la cabecera responde 200`);
    const d = await dibujado(v);
    comprobar(JSON.stringify(d) === JSON.stringify(esperado(a.cuerpo)), `${etiqueta}: lo dibujado (título, sitio, «ahora» por magnitud y zona, aviso de lo oculto, ventanas) es lo que responde GET /publico`,
      `dibujado ${JSON.stringify(d)} · API ${JSON.stringify(esperado(a.cuerpo))}`);
    comprobar(JSON.stringify(d) === JSON.stringify(enPrevia), `${etiqueta}: el visitante ve lo mismo que mostró la vista previa antes de publicar (los mismos números)`,
      `previa ${JSON.stringify(enPrevia)} · visitante ${JSON.stringify(d)}`);
    comprobar(d.magnitudes[0]?.zonas[1]?.ahora === 'Sin dato' && d.magnitudes[0]?.protegido === true, `${etiqueta}: la zona oculta se ve «Sin dato», con el aviso «${PROTEGIDO}»`);
    comprobar(limpio(await v.textContent('[data-vp-pie]')) === PIE, `${etiqueta}: al pie, «${PIE}»`);
    const publicas = pedidas.filter((x) => esPublico(x.url));
    comprobar(token !== null && pedidas.every((x) => !x.url.includes(token)), `${etiqueta}: el token no aparece en la dirección de ninguna de las ${pedidas.length} peticiones`);
    comprobar(publicas.length >= 1 && publicas.every((x) => x.cabecera === token), `${etiqueta}: viaja solo en la cabecera X-Enlace-Publico`);
    comprobar(publicas[0]?.url.endsWith('/publico?ventana=24h&carga=si'), `${etiqueta}: la primera petición lleva carga=si`, publicas[0]?.url.replaceAll(token, '…'));
    comprobar(!pedidas.some((x) => /\/(sesion|salud|preferencias|sitios)(\?|$)/.test(new URL(x.url).pathname)), `${etiqueta}: el visitante no pide la sesión, la salud, las preferencias ni los sitios`);
    const guardado = await v.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
    comprobar(token !== null && !guardado.includes(token), `${etiqueta}: el token no está en localStorage ni en sessionStorage`);
    comprobar((await visita.cookies()).length === 0 && (await v.evaluate(() => document.cookie)) === '', `${etiqueta}: ninguna cookie en el navegador del visitante`);
    await sinDesborde(v, `${etiqueta}, visitante`);
    await foto(v, '3-visitante');
    if (await v.locator('[data-vp-ventana="7d"]').count()) {
      await v.click('[data-vp-ventana="7d"]');
      await v.waitForFunction(() => document.querySelector('[data-vp-ventana="7d"]')?.getAttribute('aria-pressed') === 'true', null, { timeout: 15000 });
      const ultima = pedidas.filter((x) => esPublico(x.url)).at(-1);
      comprobar(ultima.url.endsWith('/publico?ventana=7d'), `${etiqueta}: cambiar la ventana pide «7d» sin volver a contar la carga`, ultima.url.replaceAll(token, '…'));
    } else falla(`${etiqueta}: no aparece la ventana de 7 días (el enlace la permite)`);
  });

  await paso(`${etiqueta}: renovar con un plazo que acorta`, async () => {
    if (idEnlace === null) throw new Error('no hay enlace');
    await p.click(`[data-renovar="${idEnlace}"]`);
    await p.selectOption('[data-plazo-renovar]', '7');
    await p.click('[data-confirmar-renovar]');
    await p.locator('[data-acorta]').waitFor({ timeout: 15000 });
    comprobar(/^Vencía el .+; con este plazo vencerá antes, el .+\.$/.test(limpio(await p.textContent('[data-acorta] p'))), `${etiqueta}: el 409 «acorta» muestra las dos fechas y pide confirmar`);
    await p.click('[data-renovar-igual]');
    await p.locator('[data-acorta]').waitFor({ state: 'detached', timeout: 15000 });
    const fila = p.locator(`[data-enlace="${idEnlace}"]`);
    await fila.locator('[data-aviso="exito"]').waitFor({ timeout: 10000 });
    comprobar(limpio(await fila.locator('[data-estado-enlace]').textContent()) === 'vence pronto', `${etiqueta}: renovado a 7 días, el enlace queda «vence pronto»`);
    const a = await vistaDeLaApi(token);
    comprobar(a.status === 200, `${etiqueta}: renovar no cambia el token: el enlace sigue sirviendo`);
  });

  await paso(`${etiqueta}: el k del sitio, con su aviso`, async () => {
    await p.fill('[data-minimo-campo]', '1');
    await p.click('[data-guardar-minimo]');
    await p.locator('[data-confirmar-minimo-aviso]').waitFor({ timeout: 10000 });
    const aviso = limpio(await p.textContent('[data-confirmar-minimo-aviso] p'));
    comprobar(aviso.includes(TODOS_LOS_ENLACES), `${etiqueta}: bajar k pide confirmar y dice «${TODOS_LOS_ENLACES}»`);
    await p.click('[data-confirmar-minimo]');
    await p.locator('[data-avisos-minimo]').waitFor({ timeout: 15000 });
    const avisos = await p.$$eval('[data-aviso-minimo]', (es) => es.map((e) => e.textContent.trim()));
    comprobar(avisos.includes(TODOS_LOS_ENLACES) && avisos.some((x) => x.includes('«Este» tiene 1 equipo: con k = 1 su lectura sale tal cual')),
      `${etiqueta}: la respuesta trae los avisos: afecta a todos los enlaces y lo que un visitante podría deducir`, JSON.stringify(avisos));
    await foto(p, '4-k-del-sitio');
    await v.reload();
    await v.locator('[data-vp-titulo]').waitFor({ timeout: 15000 });
    const a = await vistaDeLaApi(token);
    const d = await dibujado(v);
    comprobar(a.cuerpo?.minimo_dispositivos === 1 && d.magnitudes[0]?.zonas[1]?.ahora !== 'Sin dato' && JSON.stringify(d) === JSON.stringify(esperado(a.cuerpo)),
      `${etiqueta}: con k = 1, en la visita siguiente la zona Sur sale con valor, igual que en GET /publico`, JSON.stringify(d.magnitudes[0]));
    comprobar(d.magnitudes[0]?.protegido === false, `${etiqueta}: con k = 1, sin el aviso de lo oculto`);
    await p.fill('[data-minimo-campo]', '3');
    await p.click('[data-guardar-minimo]');
    await p.waitForFunction(() => document.querySelector('[data-minimo-actual]')?.textContent?.trim() === 'k = 3', null, { timeout: 15000 });
    ok(`${etiqueta}: subir k a 3 no pide confirmar y vuelve a regir`);
  });

  await paso(`${etiqueta}: revocar`, async () => {
    if (idEnlace === null) throw new Error('no hay enlace');
    await p.click(`[data-revocar="${idEnlace}"]`);
    await p.locator('[data-confirmar-revocacion]').waitFor({ timeout: 10000 });
    await p.click('[data-confirmar-revocar]');
    await p.locator(`[data-enlace="${idEnlace}"]`).waitFor({ state: 'detached', timeout: 15000 });
    ok(`${etiqueta}: revocado, el enlace sale de la lista de vivos`);
    await v.reload();
    await v.locator('[data-vp-no-disponible]').waitFor({ timeout: 15000 });
    comprobar(limpio(await v.textContent('[data-vp-no-disponible]')) === NO_DISPONIBLE && (await v.locator('[data-vista-publica]').count()) === 0,
      `${etiqueta}: el visitante ve «${NO_DISPONIBLE}» y nada más`);
    comprobar((await vistaDeLaApi(token)).status === 404, `${etiqueta}: GET /publico responde 404`);
    await foto(v, '5-no-disponible');
    comprobar(token !== null && pedidas.every((x) => !x.url.includes(token)) && !consola.some((x) => x.includes(token)), `${etiqueta}: en toda la visita, el token no apareció en ninguna dirección pedida ni en la consola`);
  });

  if (errores.length + erroresVisita.length === 0) ok(`${etiqueta}: sin errores de JavaScript en las dos páginas`);
  else falla(`${etiqueta}: errores en la página: ${[...errores, ...erroresVisita].join(' | ').slice(0, 300)}`);
  await admin.close();
  await visita.close();
}
await motor.close();
console.log(`CARGAS ${cargas}`);
process.exit(fallos === 0 ? 0 : 1);
