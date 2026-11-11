// Pantallas P3 (ficha del dispositivo), P3b (comparación) y P2 (inventario) en un navegador real con Playwright, contra el banco
// (docs/19 §6 y §7, filas P3 e incremento 2; docs/16 §39 y §52). Lo lanza `banco.sh navegador`, que siembra el histórico y pasa los
// datos; no se corre suelto contra la pila de desarrollo (detiene y arranca el backend del banco).
//   node e2e/p3.mjs <url_base> <dispositivo_id> <canal_id> <id_fisico> <sitio> <red_docker> <imagen_broker> <contenedor_backend> <captura.png>
// Variables (las pone banco.sh): NAVEGADOR=firefox (por defecto) o chromium; E2E_DISP2 y E2E_ID2, el segundo emulado con temperatura
// (P3b); E2E_DISP_VACIO y E2E_CANAL_VACIO, un canal cuya única lectura tiene entre 1 y 24 h (la «última hora» queda vacía).
// Sesión (desde el 08/11/2026, docs/20 §5): la clave de administrador del banco llega por la ENTRADA ESTÁNDAR (una línea; nunca en la línea
// de órdenes ni se imprime) y va como cabecera X-Clave-Admin en toda petición del navegador (también la del canal en vivo) y en api():
// el panel entra como «usuario del sistema», sin la pantalla «Entrar».
import { chromium, firefox } from 'playwright';
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

const [BASE, dispId, canalId, idFisico, sitio, red, imagen, backend, captura] = process.argv.slice(2);
if (!captura) {
  console.log('FALLA faltan argumentos (ver la cabecera de e2e/p3.mjs)');
  process.exit(2);
}
const NAVEGADOR = process.env.NAVEGADOR || 'firefox';
const motores = { firefox, chromium };
if (!motores[NAVEGADOR]) {
  console.log(`FALLA NAVEGADOR=${NAVEGADOR}: se admite firefox o chromium`);
  process.exit(2);
}
const { E2E_DISP2: disp2, E2E_ID2: idFisico2, E2E_DISP_VACIO: dispVacio, E2E_CANAL_VACIO: canalVacio } = process.env;
let fallos = 0;
let comprobaciones = 0;
const ok = (m) => { comprobaciones++; console.log(`OK    ${m}`); };
const falla = (m) => { comprobaciones++; console.log(`FALLA ${m}`); fallos++; };
// Cada comprobación del incremento 2 corre aislada: si una se corta (un elemento que no existe en un build anterior), se cuenta como
// falla y las demás siguen; así la corrida contra el build anterior dice CUÁLES detectan la falta, no solo la primera.
const paso = async (nombre, f) => {
  try { await f(); } catch (e) { falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`); }
};
const docker = (...args) => execFileSync('docker', args, { stdio: 'ignore' });
// Una interrupción (Ctrl+C) mientras el backend del banco está detenido lo vuelve a arrancar antes de salir (revisión del 22/10).
let backendDetenido = false;
for (const señal of ['SIGINT', 'SIGTERM']) process.on(señal, () => { if (backendDetenido) { try { docker('start', backend); } catch { /* se verá al salir */ } } process.exit(130); });
// Publica como un emulado anónimo del banco (rol «emulado»: solo sitio/+/dispositivo/+/+), con la marca del emisor EN MILISEGUNDOS
// (SenML admite decimales en bt): dos lecturas en el mismo segundo serían, por la regla de idempotencia (docs/10 §4.1), la misma
// lectura, y la segunda se ignoraría como duplicada (pasó en la segunda corrida del 16/10).
const publicar = (valor, quien = idFisico) => docker('run', '--rm', '--network', red, imagen, 'mosquitto_pub', '-h', 'mosquitto', '-q', '1',
  '-t', `sitio/${sitio}/dispositivo/${quien}/temperatura`,
  '-m', JSON.stringify([{ bn: quien, bt: Date.now() / 1000, n: 'temperatura', u: 'Cel', v: valor }]));
const tarjeta = `[data-canal-id="${canalId}"]`;
const lecturaEs = (texto, ms) => pagina.waitForFunction(([sel, t]) => document.querySelector(`${sel} [data-ultima]`)?.textContent === t, [tarjeta, texto], { timeout: ms });
// El estado del canal en vivo se lee en su propio elemento (`p[data-canal]`, que también lleva el botón de pausa), no en toda la
// página: el atributo dice el estado y el texto, lo que ve la persona (revisión del 16/10).
const textoVisible = (texto, ms) => pagina.waitForFunction((t) => (document.querySelector('p[data-canal]')?.textContent ?? '').trim().startsWith(t), texto, { timeout: ms });
const CLAVE_ADMIN = readFileSync(0, 'utf8').split('\n')[0].trim();
if (!CLAVE_ADMIN) {
  console.log('FALLA falta la clave de administrador del banco por la entrada estándar');
  process.exit(2);
}
const CABECERAS = { 'X-Clave-Admin': CLAVE_ADMIN };
const api = async (ruta) => (await fetch(`${BASE}${ruta}`, { headers: CABECERAS })).json();

const navegador = await motores[NAVEGADOR].launch();
console.log(`navegador: ${NAVEGADOR} ${navegador.version()}`);
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 }, extraHTTPHeaders: CABECERAS, acceptDownloads: true });
const errores = [];
// Peticiones de histórico en vuelo y pedidas: al reconectar debe pedirlo de nuevo (docs/19 F4); tras cada clic se espera a que no
// quede ninguna en vuelo (sirve igual para un build sin indicador de «cargando…»).
let pedidosHistorico = 0;
let enVuelo = 0;
const esHistorico = (r) => r.url().includes('/historico?');
function vigilar(p) {
  p.on('pageerror', (e) => errores.push(String(e)));
  p.on('request', (r) => { if (esHistorico(r)) { enVuelo++; if (r.url().includes(`/canales/${canalId}/historico`)) pedidosHistorico++; } });
  p.on('requestfinished', (r) => { if (esHistorico(r)) enVuelo--; });
  p.on('requestfailed', (r) => { if (esHistorico(r)) enVuelo--; });
}
vigilar(pagina);
async function asentar(p = pagina) {
  const hasta = Date.now() + 15000;
  await p.waitForTimeout(150);
  while (enVuelo > 0 && Date.now() < hasta) await p.waitForTimeout(100);
  await p.waitForTimeout(300); // el redibujo tras la respuesta
}
// Tras un clic en la ficha o la comparación: sigue en la misma pantalla y el gráfico tiene puntos o el mensaje de rango vacío.
async function estadoGrafico(p = pagina) {
  return p.evaluate(() => {
    const g = document.querySelector('.grafico');
    return { hash: location.hash, puntos: g === null ? null : Number(g.getAttribute('data-puntos')), vacio: document.querySelector('[data-rango-vacio]') !== null, texto: document.querySelector('[data-historico]')?.textContent ?? '' };
  });
}
const conPuntosOVacio = (e) => (e.puntos ?? 0) > 0 || e.vacio;

try {
  await pagina.goto(`${BASE}/panel/#/dispositivos/${dispId}`);
  await pagina.waitForSelector('[data-historico]', { timeout: 15000 });
  // La ficha abre el primer canal en orden alfabético: se elige la temperatura con un clic, como lo haría una persona.
  await pagina.click(tarjeta);
  await pagina.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true', tarjeta, { timeout: 15000 });
  await asentar();
  await pagina.waitForFunction(() => !(document.querySelector('[data-historico]')?.textContent ?? '').startsWith('0 puntos'), null, { timeout: 15000 }).catch(() => {});
  // 1. Los puntos del gráfico son los de /historico (mismo rango por defecto: 24 h cada 15 minutos).
  const h = await api(`/canales/${canalId}/historico`);
  const texto = await pagina.textContent('[data-historico]');
  const puntosGrafico = Number(await pagina.getAttribute('.grafico', 'data-puntos'));
  if (h.puntos >= 3 && texto.startsWith(`${h.puntos} puntos`) && puntosGrafico === h.puntos) ok(`el gráfico tiene los ${h.puntos} puntos de /historico (en el texto y en el gráfico)`);
  else falla(`puntos: API ${h.puntos}, texto «${texto}», gráfico ${puntosGrafico}`);
  // 2. Formatos para personas (docs/19 §6): lo que es texto (la leyenda); el eje, en la captura.
  // El eje se dibuja en un lienzo (no se puede leer como texto: se revisa en la captura); aquí, el primer rótulo de la leyenda de uPlot
  // (`.u-legend .u-label`, el de la serie del tiempo) y que nada del gráfico traiga am/pm ni «Time».
  const rotuloTiempo = (await pagina.textContent('.grafico .u-legend .u-label'))?.trim();
  const textosGrafico = await pagina.textContent('.grafico');
  if (rotuloTiempo === 'Hora' && !/\d(am|pm)\b/i.test(textosGrafico) && !textosGrafico.includes('Time')) ok('la leyenda del tiempo dice «Hora» y el gráfico no trae am/pm ni «Time» (el eje, en la captura)');
  else falla(`formato del gráfico: rótulo «${rotuloTiempo}», texto «${textosGrafico.slice(0, 120)}»`);
  // 3. En vivo: una trama publicada por MQTT aparece sin recargar.
  await textoVisible('en vivo: conectado', 15000);
  ok('el canal en vivo dice «conectado»');
  publicar(27.5);
  await lecturaEs('27,5 °C', 15000).then(() => ok('una trama publicada por MQTT aparece en su tarjeta sin recargar (27,5 °C)'), () => falla('la lectura en vivo no apareció'));
  // 4. Caída del backend: «reconectando»; lo publicado mientras tanto aparece al volver, porque la ficha se repite (docs/19 F4).
  const historicosAntes = pedidosHistorico;
  try {
    docker('stop', backend);
    backendDetenido = true;
    await textoVisible('en vivo: reconectando', 20000).then(() => ok('con el backend detenido, la ficha dice «reconectando»'), () => falla('no mostró «reconectando»'));
    publicar(28.25);
  } finally {
    docker('start', backend); // pase lo que pase, el banco no queda con el backend detenido (revisión del 16/10)
    backendDetenido = false;
  }
  await lecturaEs('28,25 °C', 60000).then(() => ok('al volver el backend, la ficha muestra la lectura publicada durante la caída (28,25 °C)'), () => falla('la lectura de la caída no apareció'));
  await textoVisible('en vivo: conectado', 30000).then(() => ok('y el canal vuelve a «conectado»'), () => falla('el canal no volvió a «conectado»'));
  // Al reconectar también se repite el histórico con una ventana nueva: debe traer las lecturas recién guardadas (más puntos que
  // antes). Sin esperarlo, la captura salía antes de esa respuesta y parecía que faltaban (visto en la primera corrida, 16/10).
  // Se comprueba por la petición que hace la página (no por el número de puntos, que no sube si las lecturas nuevas caen en un bloque
  // de 15 minutos que ya existía) y después que el texto diga los puntos que la API tiene ahora.
  const hasta = Date.now() + 30000;
  while (pedidosHistorico === historicosAntes && Date.now() < hasta) await pagina.waitForTimeout(250);
  await asentar();
  const ahoraApi = await api(`/canales/${canalId}/historico`);
  const textoAhora = await pagina.textContent('[data-historico]');
  if (pedidosHistorico > historicosAntes && textoAhora.startsWith(`${ahoraApi.puntos} puntos`)) ok(`al volver, la página repitió el histórico y muestra lo que la API tiene ahora (${ahoraApi.puntos} puntos)`);
  else falla(`histórico tras la caída: ${pedidosHistorico - historicosAntes} pedido(s) nuevo(s), texto «${textoAhora}», API ${ahoraApi.puntos}`);
  await pagina.screenshot({ path: captura, fullPage: true });

  // ── Incremento 2 (docs/19 §4, puntos 1 a 6) ────────────────────────────────────────────────────────────────────────────────────
  // 5. La leyenda informa, no apaga (punto 1): clic en «promedio» y en «lectura actual» (con el ratón, donde está la fila, como una
  // persona; Playwright no puede forzar el clic sobre el elemento si este no recibe eventos) → mismos puntos y ninguna fila apagada.
  await paso('leyenda', async () => {
    const antes = await estadoGrafico();
    for (const nombre of ['promedio', 'lectura actual']) {
      const fila = pagina.locator('.grafico .u-legend .u-series', { hasText: nombre }).first();
      const caja = await fila.boundingBox();
      await pagina.mouse.click(caja.x + 12, caja.y + caja.height / 2);
      await pagina.waitForTimeout(300);
      const apagadas = await pagina.locator('.grafico .u-legend .u-off').count();
      const despues = await estadoGrafico();
      if (apagadas === 0 && despues.puntos === antes.puntos) ok(`clic en «${nombre}» de la leyenda: ninguna serie apagada y los mismos ${despues.puntos} puntos`);
      else falla(`clic en «${nombre}» de la leyenda: ${apagadas} fila(s) apagada(s) (u-off), puntos ${antes.puntos} → ${despues.puntos}`);
    }
    // Los valores de la leyenda siguen al cursor (los mueve el lienzo, no la leyenda).
    const lienzo = await pagina.locator('.grafico .u-over').boundingBox();
    let valor = '';
    for (const f of [0.995, 0.98, 0.96, 0.9, 0.8]) {
      await pagina.mouse.move(lienzo.x + lienzo.width * f, lienzo.y + lienzo.height / 2);
      valor = (await pagina.locator('.grafico .u-legend .u-series', { hasText: 'promedio' }).locator('.u-value').textContent()) ?? '';
      if (valor.includes('°C')) break; // la unidad para personas (docs/19 §4, tablero v2, D7)
    }
    if (valor.includes('°C')) ok(`con el cursor sobre el gráfico, la leyenda sigue dando el valor del promedio («${valor.trim()}»)`);
    else falla(`la leyenda no muestra el valor bajo el cursor («${valor}»)`);
    await pagina.mouse.move(0, 0);
  });

  // 6. Cada botón de rango (punto 2): misma pantalla, el rango en la URL, y puntos o el mensaje de vacío; nunca ninguno.
  const rotulos = { '1h': 'última hora', '24h': '24 horas', '7d': '7 días', '30d': '30 días' };
  await paso('rangos', async () => {
    for (const [clave, rotulo] of Object.entries(rotulos)) {
      await pagina.getByRole('button', { name: rotulo, exact: true }).click();
      await asentar();
      const e = await estadoGrafico();
      if (e.hash.startsWith(`#/dispositivos/${dispId}?`) && e.hash.includes(`rango=${clave}`) && conPuntosOVacio(e)) ok(`rango «${rotulo}»: la ficha sigue en su URL (rango=${clave}) con ${e.vacio ? 'el mensaje de rango vacío' : `${e.puntos} puntos`}`);
      else falla(`rango «${rotulo}»: hash «${e.hash}», puntos ${e.puntos}, vacío ${e.vacio}`);
    }
  });

  // 7. Cada resolución ofrecida en cada rango (punto 4): misma pantalla, «res» en la URL solo si no es «auto», y el texto dice los
  // puntos y el intervalo de lo que pidió; puntos o vacío.
  await paso('resoluciones', async () => {
    const intervalo = { auto: null, '1m': '1 minuto', '5m': '5 minutos', '15m': '15 minutos', '1h': '1 hora', '6h': '6 horas', '1d': '1 día' };
    for (const [clave, rotulo] of Object.entries(rotulos)) {
      await pagina.getByRole('button', { name: rotulo, exact: true }).click();
      await asentar();
      const opciones = await pagina.locator('[data-resolucion] option').evaluateAll((os) => os.map((o) => o.value));
      if (opciones.length < 2) { falla(`rango «${rotulo}»: no hay selector de resolución con opciones (${opciones.length})`); continue; }
      const malas = [];
      for (const r of opciones) {
        await pagina.selectOption('[data-resolucion]', r);
        await asentar();
        const e = await estadoGrafico();
        const urlBien = e.hash.startsWith(`#/dispositivos/${dispId}?`) && e.hash.includes(`rango=${clave}`) && (r === 'auto' ? !e.hash.includes('res=') : e.hash.includes(`res=${r}`));
        const textoBien = r === 'auto' || e.vacio || e.texto.includes(`promedio por ${intervalo[r]}`);
        if (!(urlBien && textoBien && conPuntosOVacio(e))) malas.push(`${r}: hash «${e.hash}», texto «${e.texto}», puntos ${e.puntos}, vacío ${e.vacio}`);
      }
      await pagina.selectOption('[data-resolucion]', 'auto');
      await asentar();
      if (malas.length === 0) ok(`rango «${rotulo}»: las ${opciones.length} resoluciones (${opciones.join(', ')}) dejan la ficha en su URL con puntos o vacío`);
      else falla(`rango «${rotulo}»: ${malas.join(' | ')}`);
    }
    await pagina.getByRole('button', { name: '24 horas', exact: true }).click();
    await asentar();
  });

  // 8. Cada tarjeta de canal (punto 2).
  await paso('canales', async () => {
    const ids = await pagina.locator('[data-canal-id]').evaluateAll((bs) => bs.map((b) => b.getAttribute('data-canal-id')));
    const malas = [];
    for (const c of [...ids, canalId]) {
      await pagina.click(`[data-canal-id="${c}"]`);
      await asentar();
      const e = await estadoGrafico();
      if (!(e.hash.startsWith(`#/dispositivos/${dispId}?`) && e.hash.includes(`canal=${c}`) && conPuntosOVacio(e))) malas.push(`${c}: hash «${e.hash}», puntos ${e.puntos}, vacío ${e.vacio}`);
    }
    if (malas.length === 0 && ids.length >= 2) ok(`las ${ids.length} tarjetas de canal dejan la ficha en su URL con puntos o vacío`);
    else falla(`tarjetas de canal (${ids.length}): ${malas.join(' | ')}`);
  });

  // 9. Lo que el rango ya sabe (punto 6): el resumen de los promedios y el CSV de la ventana visible (que la API sirve).
  await paso('resumen y CSV', async () => {
    const resumen = (await pagina.locator('[data-resumen-rango]').textContent({ timeout: 3000 })) ?? '';
    // Desde el 08/11/2026 «Descargar CSV» es un botón que descarga por fetch y Blob con la sesión (lib/api.ts, descargar): sin href.
    const [descarga] = await Promise.all([pagina.waitForEvent('download', { timeout: 15000 }), pagina.locator('[data-csv-rango]').click()]);
    const nombre = descarga.suggestedFilename();
    const cuerpo = readFileSync(await descarga.path(), 'utf8');
    const lineas = cuerpo.trim().split(/\r?\n/);
    if (/^en este rango: mín .+ · máx .+ · promedio de los \d+ promedios dibujados/.test(resumen.replace(/\s+/g, ' ').trim()) && nombre.endsWith('.csv') && nombre.includes(idFisico)
      && lineas.length > 2 && /^[a-z_]+(,[a-z_]+)+$/.test(lineas[0])) ok(`resumen del rango y CSV de la ventana visible (${nombre}, ${lineas.length - 1} filas)`);
    else falla(`resumen «${resumen}», CSV ${nombre} con ${lineas.length} líneas (cabecera «${lineas[0]}»)`);
  });

  // 10. Rango vacío con eje (punto 2) y «Ver la última medición»: un canal cuya única lectura tiene entre 1 y 24 h.
  await paso('rango vacío y «Ver la última medición»', async () => {
    if (!dispVacio || !canalVacio) throw new Error('faltan E2E_DISP_VACIO y E2E_CANAL_VACIO');
    await pagina.goto(`${BASE}/panel/#/dispositivos/${dispVacio}?canal=${canalVacio}&rango=1h`);
    await pagina.waitForSelector('[data-rango-vacio]', { timeout: 15000 });
    await asentar();
    const e = await estadoGrafico();
    if (e.vacio && e.puntos === 0) ok('«última hora» sin datos: el mensaje y un gráfico sin puntos (el eje de la ventana, en la captura)');
    else falla(`rango vacío: puntos ${e.puntos}, vacío ${e.vacio}`);
    await pagina.screenshot({ path: captura.replace(/\.png$/, '-vacio.png'), fullPage: true });
    await pagina.click('[data-ver-ultima]');
    await asentar();
    const d = await estadoGrafico();
    if (d.hash.startsWith(`#/dispositivos/${dispVacio}?`) && d.hash.includes('rango=24h') && d.puntos > 0) ok(`«Ver la última medición» lleva a «24 horas» en la misma ficha, con ${d.puntos} punto(s)`);
    else falla(`«Ver la última medición»: hash «${d.hash}», puntos ${d.puntos}, vacío ${d.vacio}`);
  });

  // 11. Hora del sitio y aviso de zona (punto 3): un contexto en Europe/Madrid ve el aviso; uno en la zona del sitio, no.
  await paso('zona horaria', async () => {
    const zonaSitio = (await api(`/dispositivos/${dispId}`)).zona_horaria;
    for (const [zona, debeAvisar] of [['Europe/Madrid', true], [zonaSitio, false]]) {
      const ctx = await navegador.newContext({ timezoneId: zona, viewport: { width: 1280, height: 900 }, extraHTTPHeaders: CABECERAS });
      const p = await ctx.newPage();
      p.on('pageerror', (e) => errores.push(String(e)));
      try {
        await p.goto(`${BASE}/panel/#/dispositivos/${dispId}`);
        await p.waitForSelector('[data-intervalo]', { timeout: 15000 });
        const hora = await p.locator('[data-hora-sitio]').textContent({ timeout: 3000 });
        const aviso = await p.locator('[data-aviso-zona]').count();
        const textoAviso = aviso ? await p.locator('[data-aviso-zona]').textContent() : '';
        const horaBien = new RegExp(`^Hora en el sitio: \\d{2}/\\d{2}/\\d{4} \\d{2}:\\d{2}:\\d{2} · ${zonaSitio} \\(UTC[+\u2212]\\d{2}:\\d{2}\\)$`).test(hora.trim());
        if (horaBien && (debeAvisar ? aviso === 1 && textoAviso.startsWith(`Tu navegador está en ${zona} (UTC+`) : aviso === 0)) ok(`navegador en ${zona}: «${hora.trim()}»${debeAvisar ? ` y el aviso «${textoAviso.trim()}»` : ', sin aviso'}`);
        else falla(`navegador en ${zona}: hora «${hora}», avisos ${aviso} «${textoAviso}»`);
      } finally {
        await ctx.close();
      }
    }
  });

  // 12. P3b desde P2 (punto 5): dos emulados con temperatura → dos series con puntos y la leyenda con sus nombres; el cambio de rango
  // conserva la pantalla; una trama MQTT de uno de ellos actualiza su fila sin recargar.
  await paso('comparar (P3b)', async () => {
    if (!disp2 || !idFisico2) throw new Error('faltan E2E_DISP2 y E2E_ID2');
    const nombres = [(await api(`/dispositivos/${dispId}`)).nombre, (await api(`/dispositivos/${disp2}`)).nombre];
    await pagina.goto(`${BASE}/panel/#/inventario`); // desde el tablero v2, «#/» es el tablero
    await pagina.waitForSelector(`tr[data-id="${dispId}"]`, { timeout: 15000 });
    await pagina.check(`[data-marcar="${dispId}"]`, { timeout: 3000 });
    await pagina.check(`[data-marcar="${disp2}"]`);
    await pagina.click('[data-comparar]');
    await pagina.waitForSelector('[data-magnitud]', { timeout: 15000 });
    // Los emulados miden temperatura y humedad (empate: rige la primera por nombre, humedad, que aquí no tiene lecturas): se elige la
    // temperatura en el selector, como lo haría una persona.
    await pagina.selectOption('[data-magnitud]', 'temperatura');
    await asentar();
    await pagina.waitForSelector('.grafico[data-series]', { timeout: 15000 });
    const e = await estadoGrafico();
    const series = Number(await pagina.getAttribute('.grafico', 'data-series'));
    const leyenda = await pagina.locator('.grafico .u-legend .u-series .u-label').allTextContents();
    if (e.hash.startsWith(`#/comparar?dispositivos=${dispId},${disp2}`) && e.hash.includes('magnitud=temperatura') && series === 2 && e.puntos > 0 && nombres.every((n) => leyenda.includes(n))) ok(`P3b: dos series (${leyenda.slice(1).join(' y ')}) con ${e.puntos} instantes, abierta desde «Comparar (2)» en el inventario`);
    else falla(`P3b: hash «${e.hash}», series ${series}, puntos ${e.puntos}, leyenda ${JSON.stringify(leyenda)}`);
    await pagina.getByRole('button', { name: '7 días', exact: true }).click();
    await asentar();
    const r = await estadoGrafico();
    if (r.hash.startsWith('#/comparar?') && r.hash.includes('rango=7d') && conPuntosOVacio(r)) ok('P3b: cambiar a «7 días» conserva la pantalla (rango=7d) con puntos');
    else falla(`P3b tras «7 días»: hash «${r.hash}», puntos ${r.puntos}`);
    await pagina.waitForFunction(() => (document.querySelector('p[data-canal]')?.textContent ?? '').includes('conectado'), null, { timeout: 15000 });
    publicar(31.5, idFisico2);
    await pagina.waitForFunction((d) => document.querySelector(`[data-fila-comparar="${d}"] [data-ultima]`)?.textContent === '31,5 Cel', disp2, { timeout: 15000 })
      .then(() => ok('P3b: una trama MQTT del segundo emulado actualiza su fila de la tabla en vivo sin recargar (31,5 Cel)'), () => falla('P3b: la fila en vivo no se actualizó'));
    await pagina.screenshot({ path: captura.replace(/\.png$/, '-p3b.png'), fullPage: true });
  });

  // RF-52 (docs/19 §1): en un teléfono la página no se desplaza a lo ancho; las tablas sí, dentro de su caja. banco.sh deja a un emulado
  // en una zona de nombre largo: el 24/10, el filtro de zona ensanchaba el inventario a 320 px de ancho (117 px en la pila de desarrollo, hasta 188 en el banco).
  await paso('RF-52', async () => {
    for (const ancho of [320, 375, 414]) {
      const p = await navegador.newPage({ viewport: { width: ancho, height: 800 }, extraHTTPHeaders: CABECERAS });
      vigilar(p);
      // Se mide con los datos ya dibujados: en P2, filas en la tabla y las zonas en su filtro (la primera versión de esta comprobación
      // medía con la tabla aún vacía y daba OK con el error presente).
      const listo = { P2: () => document.querySelectorAll('tbody tr, .tarjeta-inventario').length > 0 && document.querySelectorAll('.filtros select option').length > 2,
                      P3: (sel) => document.querySelector(sel) !== null };
      for (const [nombre, url, arg] of [['P2', `${BASE}/panel/#/inventario`, null], ['P3', `${BASE}/panel/#/dispositivos/${dispId}`, tarjeta]]) {
        await p.goto(url);
        await p.waitForFunction(listo[nombre], arg, { timeout: 15000 });
        await asentar(p);
        // El peor de 8 muestras en 2 s: el filtro de zona tomaba su ancho final un instante DESPUÉS de dibujar las filas (77 → 457 px),
        // y una sola medición temprana daba OK con el error presente (24/10).
        let sobra = 0;
        for (let i = 0; i < 8; i++) {
          sobra = Math.max(sobra, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
          await p.waitForTimeout(250);
        }
        if (sobra <= 0) ok(`${nombre} a ${ancho} px: la página no se desplaza a lo ancho`);
        else falla(`${nombre} a ${ancho} px: la página se desplaza ${sobra} px a lo ancho`);
      }
      await p.close();
    }
  });

  if (errores.length === 0) ok('sin errores de JavaScript en la página'); else falla(`errores en la página: ${errores.join(' | ')}`);
} catch (e) {
  falla(`la prueba se cortó: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  await navegador.close();
}
console.log(fallos === 0 ? `\nP3 NAVEGADOR OK (${comprobaciones} de ${comprobaciones} comprobaciones, ${NAVEGADOR})` : `\n${fallos} de ${comprobaciones} comprobación(es) con falla (${NAVEGADOR})`);
process.exit(fallos === 0 ? 0 : 1);
