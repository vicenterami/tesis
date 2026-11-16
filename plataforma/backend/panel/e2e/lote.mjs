// P7, alta masiva en tres pasos (docs/19 §4, bloque N, puntos 7, 9 y 11), en un navegador real con Playwright, contra el banco. Lo lanza
// `banco.sh lote-navegador`, que pasa la zona; no se corre suelto contra la pila de desarrollo (crea dos dispositivos de descarte).
//   node e2e/lote.mjs <url_base> <zona> <captura.png>
// Variable: NAVEGADOR=firefox (por defecto) o chromium. Sesión (docs/20 §5): la clave de administrador del banco llega por la ENTRADA
// ESTÁNDAR (una línea; nunca en la línea de órdenes ni se imprime) y va como cabecera X-Clave-Admin en toda petición del navegador.
// Recorrido, a 1 280 px: pegar un lote con una fila vacía en medio y una fila mala (los números de fila son los de la planilla y abre en
// «No entran»); descargar «las que no entran» y volver a subirla sin tocar (el mismo plan); quitar la mala y crear (resultado con
// credenciales, que se descargan una vez). A 390 px: lo mismo hasta la revisión, con tarjetas y sin desplazamiento horizontal (RF-52).
import { chromium, firefox } from 'playwright';
import { mkdtempSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const [BASE, ZONA, captura] = process.argv.slice(2);
if (!captura) {
  console.log('FALLA faltan argumentos (ver la cabecera de e2e/lote.mjs)');
  process.exit(2);
}
const NAVEGADOR = process.env.NAVEGADOR || 'firefox';
const motores = { firefox, chromium };
if (!motores[NAVEGADOR]) {
  console.log(`FALLA NAVEGADOR=${NAVEGADOR}: se admite firefox o chromium`);
  process.exit(2);
}
let fallos = 0;
let comprobaciones = 0;
const ok = (m) => { comprobaciones++; console.log(`OK    ${m}`); };
const falla = (m) => { comprobaciones++; console.log(`FALLA ${m}`); fallos++; };
const comprobar = (cond, bien, mal) => (cond ? ok(bien) : falla(mal));
// Cada paso corre aislado: si uno se corta (un elemento que no existe), se cuenta como falla y los demás siguen.
const paso = async (nombre, f) => {
  try { await f(); } catch (e) { falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})`); }
};
const CLAVE_ADMIN = readFileSync(0, 'utf8').split('\n')[0].trim();
if (!CLAVE_ADMIN) {
  console.log('FALLA falta la clave de administrador del banco por la entrada estándar');
  process.exit(2);
}
const CABECERAS = { 'X-Clave-Admin': CLAVE_ADMIN };
const api = async (ruta) => (await fetch(`${BASE}${ruta}`, { headers: CABECERAS })).json();

// Identificadores de descarte, únicos por corrida (minúsculas, dígitos y guion).
const SUFIJO = Date.now().toString(36);
const id = (s) => `lote-${SUFIJO}-${s}`;
const fila = (idf, zona = ZONA) => [idf, `Nodo ${idf}`, zona, '', '', '60', 'temperatura:Cel'].join('\t');
const CABECERA = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales'].join('\t');
// La fila vacía en medio cuenta: cabecera = 1, buena = 2, vacía = 3, buena = 4, mala = 5.
const pegado = (a, b, mala) => [CABECERA, fila(a), '', fila(b), ...(mala === null ? [] : [fila(mala, 'Zona que no existe en ningún sitio')])].join('\n');

const navegador = await motores[NAVEGADOR].launch();
console.log(`navegador: ${NAVEGADOR} ${navegador.version()}`);
const errores = [];
const abrir = async (ancho) => {
  const p = await navegador.newPage({ viewport: { width: ancho, height: 900 }, extraHTTPHeaders: CABECERAS, acceptDownloads: true });
  p.on('pageerror', (e) => errores.push(String(e)));
  await p.goto(`${BASE}/panel/#/alta?modo=lote`);
  await p.waitForSelector('[data-pegado]', { timeout: 15000 });
  return p;
};
const texto = async (p, sel) => ((await p.textContent(sel)) ?? '').replace(/\s+/g, ' ').trim();
const numerosDeFila = (p) => p.$$eval('[data-fila-lote]', (es) => es.map((e) => e.getAttribute('data-fila-lote')));
const conteo = (p, f) => p.textContent(`[data-filtro-lote="${f}"] [data-cifra]`);
async function pegarYRevisar(p, a, b, mala) {
  await p.fill('[data-pegado]', pegado(a, b, mala));
  await p.click('[data-leer-pegado]');
  await p.waitForSelector('[data-revisar]', { timeout: 5000 });
  await p.click('[data-revisar]');
  // El lote tiene un límite de validaciones por persona y minuto (docs/11 §4): si esta corrida lo alcanza (varias seguidas contra el
  // mismo banco), se hace lo que haría una persona: esperar lo que dice el aviso y pulsar su botón «Reintentar».
  for (let intento = 0; intento < 4; intento++) {
    const cual = await Promise.race([
      p.waitForSelector('[data-paso-lote="2"]', { timeout: 15000 }).then(() => 'revision'),
      p.waitForSelector('[data-error-lote="demasiadas_peticiones"]', { timeout: 15000 }).then(() => 'limite'),
    ]);
    if (cual === 'revision') return;
    const aviso = await texto(p, '[data-error-lote="demasiadas_peticiones"] .aviso-texto');
    const espera = Number(/Espera (\d+) s/.exec(aviso)?.[1] ?? 15);
    console.log(`      (límite de validaciones por minuto: «${aviso}»; se espera ${espera + 1} s y se reintenta)`);
    await p.waitForTimeout((espera + 1) * 1000);
    await p.click('[data-error-lote="demasiadas_peticiones"] [data-remedio]');
  }
  await p.waitForSelector('[data-paso-lote="2"]', { timeout: 15000 });
}
const sobraAncho = async (p) => {
  let sobra = 0;
  for (let i = 0; i < 8; i++) { // el peor de 8 muestras en 2 s (la lección de RF-52 del 24/10)
    sobra = Math.max(sobra, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
    await p.waitForTimeout(250);
  }
  return sobra;
};

try {
  // ── 1 280 px ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const a = id('a'), b = id('b'), mala = id('mala');
  let planPrimero = '';
  const p = await abrir(1280);
  await paso('pegar y revisar', async () => {
    await pegarYRevisar(p, a, b, mala);
    comprobar((await texto(p, '[data-titulo-paso-lote]')) === 'Paso 2 de 3: Revisión', 'el segundo paso se llama «Paso 2 de 3: Revisión»', 'el encabezado del paso 2 no es el esperado');
    comprobar(await p.evaluate(() => document.activeElement?.hasAttribute('data-titulo-paso-lote')), 'el foco pasó al encabezado del paso', 'el foco no está en el encabezado del paso 2');
    comprobar((await p.getAttribute('[data-filtro-lote="rechazada"]', 'aria-pressed')) === 'true', 'la revisión abre en «No entran»', 'la revisión no abrió en «No entran»');
    comprobar(JSON.stringify(await numerosDeFila(p)) === '["5"]', 'la fila que no entra es la 5 de la planilla (la vacía cuenta)', `filas a la vista: ${JSON.stringify(await numerosDeFila(p))}`);
    await p.click('[data-filtro-lote="leidas"]');
    comprobar(JSON.stringify(await numerosDeFila(p)) === '["2","4","5"]', 'los números de fila son 2, 4 y 5: los de la planilla', `filas leídas: ${JSON.stringify(await numerosDeFila(p))}`);
    comprobar((await conteo(p, 'valida')) === '2' && (await conteo(p, 'rechazada')) === '1', 'las tarjetas cuentan 2 que se crean y 1 que no entra', 'los conteos de las tarjetas no son 2 y 1');
    planPrimero = await texto(p, '[data-fila-lote="5"] [data-que-pasa]');
    comprobar(planPrimero.startsWith('No entra: '), `la frase de la fila 5 dice por qué: «${planPrimero}»`, `la frase de la fila 5 es «${planPrimero}»`);
    await p.click('[data-detalle-fila="2"]');
    comprobar((await p.$$('[data-detalle-lote="2"] [data-por-omision]')).length >= 2, 'el detalle de la fila 2 marca «por omisión» la vía y el formato', 'el detalle no marca «por omisión»');
    comprobar((await p.$$('[data-tabla-lote]')).length === 1, 'a 1 280 px las filas van en una tabla', 'no hay tabla a 1 280 px');
    await p.screenshot({ path: captura.replace(/\.png$/, '-revision-1280.png'), fullPage: true });
  });
  await paso('descargar las que no entran y volver a subirlas', async () => {
    await p.click('[data-filtro-lote="rechazada"]');
    const frases = (pg) => pg.$$eval('[data-que-pasa]', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    const frasesPrimero = await frases(p);
    const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-no-entran]')]);
    const ruta = join(mkdtempSync(join(tmpdir(), 'lote-')), 'no-entran-lote.csv');
    await descarga.saveAs(ruta);
    const bytes = readFileSync(ruta);
    comprobar(bytes[0] === 0xef && bytes[1] === 0xbb && bytes[2] === 0xbf && bytes.toString('utf8').includes(';fila;motivo'), 'lo descargado lleva BOM, «;» y las columnas «fila» y «motivo»', 'la descarga no trae BOM, «;» o las columnas fila y motivo');
    await p.click('[data-volver]');
    await p.waitForSelector('[data-paso-lote="1"]', { timeout: 5000 });
    comprobar((await p.inputValue('[data-pegado]')).includes(mala), '«Volver» conserva lo pegado', '«Volver» perdió lo pegado');
    await p.setInputFiles('[data-archivo]', ruta);
    await p.waitForFunction(() => /no-entran-lote\.csv: 1 filas leídas\./.test(document.querySelector('[data-filas-leidas]')?.textContent ?? ''), null, { timeout: 5000 });
    await p.click('[data-revisar]');
    await p.waitForSelector('[data-paso-lote="2"]', { timeout: 15000 });
    await p.click('[data-filtro-lote="leidas"]');
    const frasesOtra = await frases(p);
    comprobar(JSON.stringify(frasesOtra) === JSON.stringify(frasesPrimero) && frasesOtra.length >= 1 && (await conteo(p, 'rechazada')) === '1',
      `subido sin tocar, el archivo da el mismo plan: las mismas ${frasesOtra.length} frases y 1 que no entra`, `el plan cambió al volver a subirlo: ${JSON.stringify(frasesOtra)} (antes ${JSON.stringify(frasesPrimero)})`);
  });
  await paso('quitar la mala, crear y descargar las credenciales una vez', async () => {
    await p.click('[data-volver]');
    await p.waitForSelector('[data-pegado]', { timeout: 5000 });
    await pegarYRevisar(p, a, b, null);
    comprobar((await p.getAttribute('[data-filtro-lote="leidas"]', 'aria-pressed')) === 'true' && (await conteo(p, 'rechazada')) === '0', 'sin la mala, la revisión abre en «Leídas» y no hay filas que no entren', 'sin la mala, la revisión no abre en «Leídas»');
    comprobar((await texto(p, '[data-crear-lote]')) === 'Crear 2 dispositivos', 'el botón dice «Crear 2 dispositivos»', `el botón dice «${await texto(p, '[data-crear-lote]')}»`);
    await p.click('[data-crear-lote]');
    await p.waitForSelector('[data-paso-lote="3"]', { timeout: 20000 });
    comprobar((await texto(p, '[data-resultado-lote]')) === 'Se crearon 2 dispositivos.', 'el resultado dice «Se crearon 2 dispositivos.»', `el resultado dice «${await texto(p, '[data-resultado-lote]')}»`);
    comprobar((await texto(p, '[data-credenciales-lote]')).includes('2 credenciales'), 'hay 2 credenciales para descargar', 'no aparecen las 2 credenciales');
    await p.screenshot({ path: captura.replace(/\.png$/, '-resultado-1280.png'), fullPage: true });
    const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-credenciales]')]);
    const ruta = join(mkdtempSync(join(tmpdir(), 'lote-')), 'credenciales.csv');
    await descarga.saveAs(ruta);
    const lineas = readFileSync(ruta, 'utf8').split('\r\n').filter((l) => l !== '');
    comprobar(lineas.length === 3 && lineas[0] === 'id_fisico,id,credencial,topico', 'el archivo de credenciales trae la cabecera y 2 filas, con coma y sin cambios', `el archivo de credenciales trae ${lineas.length} líneas`);
    comprobar(!(await p.content()).includes(lineas[1].split(',')[2]), 'la credencial nunca se dibujó en la página', 'una credencial quedó escrita en la página');
    await p.click('[data-olvidar-credenciales]');
    comprobar((await p.$$('[data-credenciales-lote], [data-descargar-credenciales]')).length === 0, 'tras «Ya las guardé», las credenciales ya no están: se descargan una sola vez', 'las credenciales siguen en la página');
    const lista = await api(`/dispositivos?q=${encodeURIComponent(`lote-${SUFIJO}`)}`);
    const creados = Array.isArray(lista) ? lista.map((d) => d.id_fisico).sort() : [];
    comprobar(JSON.stringify(creados) === JSON.stringify([a, b].sort()), 'el inventario tiene los 2 dispositivos creados', `el inventario trae ${JSON.stringify(creados)}`);
  });
  await p.screenshot({ path: captura, fullPage: true });
  await p.close();

  // ── 390 px ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  await paso('390 px', async () => {
    const t = await abrir(390);
    await pegarYRevisar(t, id('c'), id('d'), id('mala2'));
    comprobar((await t.getAttribute('[data-filtro-lote="rechazada"]', 'aria-pressed')) === 'true' && JSON.stringify(await numerosDeFila(t)) === '["5"]', 'a 390 px también abre en «No entran» con la fila 5', 'a 390 px la revisión no abre en «No entran» con la fila 5');
    await t.click('[data-filtro-lote="leidas"]');
    comprobar((await t.$$('[data-tarjetas-lote] .tarjeta-lote')).length === 3 && (await t.$$('[data-tabla-lote]')).length === 0, 'a 390 px cada fila es una tarjeta y no hay tabla', 'a 390 px no hay 3 tarjetas, o hay tabla');
    await t.click('[data-detalle-fila="5"]');
    const sobra = await sobraAncho(t);
    await t.screenshot({ path: captura.replace(/\.png$/, '-revision-390.png'), fullPage: true });
    comprobar(sobra <= 0, 'a 390 px la página no se desplaza a lo ancho (con el detalle abierto)', `a 390 px la página se desplaza ${sobra} px a lo ancho`);
    await t.close();
  });

  if (errores.length === 0) ok('sin errores de JavaScript en la página'); else falla(`errores en la página: ${errores.join(' | ')}`);
} catch (e) {
  falla(`la prueba se cortó: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  await navegador.close();
}
console.log(fallos === 0 ? `\nLOTE NAVEGADOR OK (${comprobaciones} de ${comprobaciones} comprobaciones, ${NAVEGADOR})` : `\n${fallos} de ${comprobaciones} comprobación(es) con falla (${NAVEGADOR})`);
process.exit(fallos === 0 ? 0 : 1);
