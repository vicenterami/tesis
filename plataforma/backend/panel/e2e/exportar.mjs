// P8, «Exportar datos» de un sitio (HU-08, RF-34; docs/19 §4, R, puntos 6 y 8; docs/16 §89), en navegadores reales con Playwright, contra la
// pila de desarrollo. Lo lanza `plataforma/pruebas/panel-exportar-e2e.sh`, que crea el sitio, sus equipos, mediciones, tramas y eventos y las
// personas de descarte (perfil de investigación), pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes ni se
// imprimen) y lo borra todo al final. Por cada caso (navegador × ancho): la persona entra (clave temporal → propia → términos, por la API desde
// la página); desde la ficha de un equipo, «Exportar todo el sitio» lleva a la pantalla; la estimación dice lo que el guion sembró; se
// descargan los tres formatos y cada archivo llega con su nombre, el zip y el xlsx con la firma `PK\x03\x04` y el JSON se interpreta con los
// conteos sembrados; «Entre fechas» pide los días en la zona del sitio; sin desplazamiento horizontal ni errores de JavaScript.
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, sitio, zona, dispositivo, esperado, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
let fallos = 0;
const ok = (m) => console.log(`OK    [${NAV}] ${m}`);
const falla = (m) => { fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
let paginaActual = null;
const paso = async (nombre, f) => {
  try { await f(); } catch (e) {
    const visto = paginaActual ? ((await paginaActual.textContent('main').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
  }
};
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
// El nombre que manda el servidor: `sitio_<código>_<desde>_<hasta>.<extensión>` (sitios.controller.ts, nombreDeArchivoSitio).
const NOMBRE = (ext) => new RegExp(`^sitio_${sitio.replace(/[.-]/g, '\\$&')}_\\d{4}-\\d{2}-\\d{2}_\\d{4}-\\d{2}-\\d{2}\\.${ext}$`);
const FIRMA_ZIP = [0x50, 0x4b, 0x03, 0x04];
const numero = (n) => n.toLocaleString('es-CL');
// Un instante como «AAAA-MM-DD hh:mm» en la zona del sitio, y el día siguiente a «AAAA-MM-DD» (calendario, sin zonas).
const enSitio = (iso) => {
  const x = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: zona, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' })
    .formatToParts(new Date(iso)).map((y) => [y.type, y.value]));
  return `${x.year}-${x.month}-${x.day} ${x.hour}:${x.minute}`;
};
const diaSiguiente = (f) => { const [a, m, d] = f.split('-').map(Number); return new Date(Date.UTC(a, m - 1, d + 1)).toISOString().slice(0, 10); };

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
// Como en e2e/publico.mjs: la persona entra por la API desde la página (la pantalla «Entrar» la prueba panel-sesion-e2e.sh).
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
    const c = await fetch('/terminos/aceptar', { method: 'POST', headers: h, body: JSON.stringify({ version: t.version }) });
    return c.ok ? 'ok' : `POST /terminos/aceptar ${c.status}`;
  }, c);
  if (r !== 'ok') throw new Error(`no se pudo entrar: ${r}`);
};
// Elige el formato, pulsa «Descargar» y devuelve el archivo bajado (nombre y bytes) y el aviso de éxito.
const bajar = async (p, formato) => {
  await p.check(`[data-formato-exportar="${formato}"]`);
  await p.waitForFunction(() => document.querySelector('[data-descargar-exportar]')?.disabled === false, null, { timeout: 15000 });
  const espera = p.waitForEvent('download', { timeout: 30000 }).then((x) => ({ x }), (e) => ({ e }));
  await p.click('[data-descargar-exportar]', { timeout: 10000 }).catch((e) => { throw new Error(`no se pudo pulsar «Descargar»: ${e.message.split('\n').slice(0, 12).join(' | ')}`); });
  // Si no llega la descarga, lo que dice la pantalla (el aviso de error o de éxito, el botón) es el diagnóstico.
  const d = await espera.then(({ x, e }) => (e === undefined ? x : Promise.reject(e))).catch(async (e) => {
    const avisos = await p.$$eval('[data-aviso]', (xs) => xs.map((x) => `${x.getAttribute('data-aviso')}: ${(x.textContent ?? '').trim()}`)).catch(() => []);
    const boton = await p.textContent('[data-descargar-exportar]').catch(() => '');
    throw new Error(`${e.message.split('\n')[0]}; avisos: ${JSON.stringify(avisos)}; botón: «${(boton ?? '').trim()}»`);
  });
  const ruta = await d.path();
  const bytes = ruta ? readFileSync(ruta) : Buffer.alloc(0);
  await p.locator('[data-aviso="exito"]').waitFor({ timeout: 15000 });
  return { nombre: d.suggestedFilename(), bytes, aviso: limpio(await p.textContent('[data-aviso="exito"] .aviso-texto')), fallo: await d.failure() };
};

for (const caso of casos) {
  const ancho = caso.ancho;
  const etiqueta = `${ancho} px`;
  const contexto = await motor.newContext({ viewport: { width: ancho, height: ancho < 500 ? 844 : 900 }, timezoneId: 'Asia/Tokyo', acceptDownloads: true });
  const p = await contexto.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e)));
  const estimaciones = [];
  p.on('request', (r) => { if (new URL(r.url()).pathname.endsWith('/exportar/estimacion')) estimaciones.push(new URL(r.url()).searchParams); });

  await paso(`${etiqueta}: de la ficha a la pantalla, con la estimación de lo sembrado`, async () => {
    await iniciar(p, caso);
    await p.goto(`${base}/panel/#/dispositivos/${dispositivo}`);
    await p.reload();
    await p.locator('[data-exportar-sitio]').waitFor({ timeout: 15000 });
    comprobar((await p.getAttribute('[data-exportar-sitio]', 'href')) === `#/exportar?sitio=${sitio}`, `${etiqueta}: la ficha ofrece «Exportar todo el sitio» con el código de su sitio`);
    await p.click('[data-exportar-sitio]');
    await p.locator('[data-formulario-exportar]').waitFor({ timeout: 15000 });
    comprobar((await p.locator('[data-ir-exportar]').count()) === 1, `${etiqueta}: «Exportar datos» está en el menú de quien investiga en el sitio`);
    await p.locator('[data-estimacion-texto]').waitFor({ timeout: 15000 });
    const t = limpio(await p.textContent('[data-estimacion-texto]'));
    const cuenta = `≈ ${numero(esperado.mediciones)} mediciones, ${numero(esperado.tramas)} tramas y ${numero(esperado.eventos)} eventos; unos `;
    comprobar(t.startsWith(cuenta) && t.endsWith(' en CSV.'), `${etiqueta}: la estimación de los últimos 30 días dice lo sembrado y el tamaño en CSV`, t);
    const retencion = limpio(await p.textContent('[data-retencion]'));
    comprobar(retencion === 'Las tramas originales se guardan 30 días: este rango las trae todas.', `${etiqueta}: con la línea de la retención de las tramas`, retencion);
    await sinDesborde(p, `${etiqueta}, la pantalla con su estimación`);
    await foto(p, '1-exportar');
  });

  await paso(`${etiqueta}: los tres formatos`, async () => {
    for (const [formato, ext] of [['csv', 'zip'], ['xlsx', 'xlsx'], ['json', 'json']]) {
      const d = await bajar(p, formato);
      comprobar(d.fallo === null && NOMBRE(ext).test(d.nombre), `${etiqueta}: ${formato.toUpperCase()} bajó como ${d.nombre}`, `${d.nombre} ${d.fallo ?? ''}`);
      comprobar(d.aviso.startsWith(`Descargado ${d.nombre} (`), `${etiqueta}: el aviso de ${formato.toUpperCase()} dice el nombre y el tamaño`, d.aviso);
      if (ext === 'json') {
        let x = null;
        try { x = JSON.parse(d.bytes.toString('utf8')); } catch { /* se informa abajo */ }
        comprobar(x !== null && x.sitio?.codigo === sitio && x.conteos?.mediciones === esperado.mediciones && x.conteos?.tramas === esperado.tramas && x.conteos?.eventos === esperado.eventos,
          `${etiqueta}: el JSON se interpreta y trae el sitio y los conteos sembrados`, x === null ? `no se interpreta (${d.bytes.length} bytes)` : JSON.stringify(x.conteos));
      } else {
        comprobar(d.bytes.length > 4 && FIRMA_ZIP.every((b, i) => d.bytes[i] === b), `${etiqueta}: el ${ext} empieza con la firma PK\\x03\\x04 (${d.bytes.length} bytes)`, [...d.bytes.subarray(0, 4)].join(','));
      }
    }
    await sinDesborde(p, `${etiqueta}, tras las tres descargas`);
  });

  await paso(`${etiqueta}: «Entre fechas» en la zona del sitio`, async () => {
    const antes = estimaciones.length;
    // La estimación se pide tras una pausa desde el último cambio: se espera su respuesta, no el texto viejo que aún pudiera verse.
    const respuesta = p.waitForResponse((r) => new URL(r.url()).pathname.endsWith('/exportar/estimacion'), { timeout: 15000 });
    await p.check('[data-rango-exportar="fechas"]');
    await p.locator('[data-dia-desde]').waitFor({ timeout: 5000 });
    await respuesta;
    await p.waitForFunction(() => document.querySelector('[data-estimacion-texto]') !== null, null, { timeout: 15000 });
    const q = estimaciones.at(-1);
    const desde = q?.get('desde') ?? '';
    const hasta = q?.get('hasta') ?? '';
    // El sitio de prueba está en Isla de Pascua y el navegador, en Tokio: los días se cuentan en la hora del SITIO.
    const [diaDesde, diaHasta] = [await p.inputValue('[data-dia-desde]'), await p.inputValue('[data-dia-hasta]')];
    comprobar(estimaciones.length > antes && desde !== '' && enSitio(desde) === `${diaDesde} 00:00` && enSitio(hasta) === `${diaSiguiente(diaHasta)} 00:00` && diaSiguiente(diaDesde) <= diaHasta,
      `${etiqueta}: «Entre fechas» abre con la última semana y la pide de 00:00 a 00:00 en la hora del sitio (${zona}), no en la del navegador`,
      `${desde} → ${hasta}; días ${diaDesde} a ${diaHasta}`);
    // Un día después de hoy no se pide: el motivo junto a los campos y «Descargar» desactivado.
    const n = estimaciones.length;
    await p.fill('[data-dia-hasta]', diaSiguiente(diaHasta));
    await p.waitForFunction(() => (document.querySelector('[data-error-dias]')?.textContent ?? '').trim() !== '', null, { timeout: 5000 });
    await p.waitForTimeout(600); // más que la pausa de la estimación (300 ms)
    comprobar(limpio(await p.textContent('[data-error-dias]')) === 'El último día puede ser, como mucho, hoy.' && estimaciones.length === n && await p.locator('[data-descargar-exportar]').isDisabled(),
      `${etiqueta}: un último día después de hoy en el sitio se dice junto a los campos, sin pedir nada y con «Descargar» desactivado`);
    await sinDesborde(p, `${etiqueta}, con «Entre fechas» abierto`);
    await foto(p, '2-entre-fechas');
  });

  if (errores.length === 0) ok(`${etiqueta}: sin errores de JavaScript`);
  else falla(`${etiqueta}: errores en la página: ${errores.join(' | ').slice(0, 300)}`);
  await contexto.close();
}
await motor.close();
process.exit(fallos === 0 ? 0 : 1);
