// P7, alta masiva sin fricción (docs/19 §4, bloques N y S; docs/16), en navegadores reales con Playwright, contra la pila de desarrollo. Lo
// lanza `plataforma/pruebas/panel-lote-e2e.sh`, que crea dos sitios de descarte (el de la persona, con las zonas «Norte» y «Galpón Sur» y un
// equipo que ya existe; otro con un equipo ajeno) y las personas de descarte (administración del sitio), pasa los datos por la ENTRADA
// ESTÁNDAR (las claves nunca van en la línea de órdenes ni se imprimen) y lo borra todo al final, también lo que esta prueba crea.
// Por cada caso (navegador × ancho), con el catálogo fijo de escenarios (e2e/datos/lote-escenarios.*):
//   N6  el lector de libros .xlsx no entra en la primera carga ni al abrir el alta masiva: se descarga al elegir un libro y pesa menos de
//       10 kB comprimido; un libro dañado se dice con su remedio, y el catálogo guardado como .xlsx por LibreOffice llega a la MISMA
//       revisión que su CSV (cada fila con su resultado y su frase; solo cambia la de la celda de más, que en un libro es una columna sin nombre);
//   S1  el archivo de 60 casos abre la revisión (las 2 mal formadas «No entran» con su motivo);
//   S3  la zona por nombre se dice una vez y la línea de avisos y «Con aviso» cuentan lo mismo; S4 ningún texto a la vista trae jerga;
//   S5  «Ya existe» en ámbar con «Abrir su ficha»; S6 «Volver» y «Crear» se pulsan como persona (nada los tapa) y la ayuda emergente no
//   recibe toques bajo 700 px; S7 «atrás» y «adelante» con credenciales sin descargar las conservan; S8 el foco tras «Mostrar 100 más» y
//   «Ya las guardé»; S11 la revisión de 500 filas bajo 1 s y cada «Mostrar 100 más» bajo 0,3 s. Crea por HTTP (sin clientes del broker).
import { existsSync, mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { crc32, deflateRawSync, gzipSync, inflateRawSync } from 'node:zlib';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, prefijo: P, sitio_nombre: SITIO, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
const DATOS = new URL('./datos/', import.meta.url);
const ESCENARIOS = JSON.parse(readFileSync(new URL('lote-escenarios.json', DATOS), 'utf8'));
// El catálogo con el prefijo de esta corrida (minúsculas y, en la fila de las mayúsculas, mayúsculas).
const CATALOGO = readFileSync(new URL('lote-escenarios.csv', DATOS), 'utf8').replaceAll(ESCENARIOS.prefijo, P).replaceAll(ESCENARIOS.prefijo.toUpperCase(), P.toUpperCase());
// El mismo catálogo guardado como .xlsx por LibreOffice 26.8 (importado sin evaluar fórmulas; docs/16 §91), con el prefijo de esta corrida.
const LIBRO = libroConPrefijo(readFileSync(new URL('lote-escenarios.xlsx', DATOS)), ESCENARIOS.prefijo, P);
// El lector de libros, comprimido, no pasa de 10 kB (docs/19 §4, bloque N, punto 11).
const UMBRAL_LECTOR_BYTES = 10_000;
const ES_LECTOR = /\/assets\/xlsx-lector-[^/]+\.js$/;
// Los umbrales del bloque S (punto 11), medidos el 19/11/2026 muy por debajo: la revisión de 500 filas y cada «Mostrar 100 más».
const UMBRAL_REVISION_MS = 1000;
const UMBRAL_MOSTRAR_MS = 300;
// Lo que no debe verse (S4): un nombre de columna o de variable, un índice, el código de una vía o de un formato, una unidad como código.
const JERGA = /\b[a-z]+_[a-z_]+\b|\[\d+\]|\b(mqtt|http|lorawan|senml|milesight|chirpstack)\b|%RH|%EL/;

let fallos = 0;
let total = 0;
const ok = (m) => { total++; console.log(`OK    [${NAV}] ${m}`); };
const falla = (m) => { total++; fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();
const medidas = [];

// Un libro con el texto de sus partes XML cambiado (el prefijo del catálogo por el de la corrida): se abre cada parte con node:zlib y se vuelve a
// armar el zip (cabecera local, datos con deflate, directorio central y su fin; APPNOTE §4.3.7, §4.3.12 y §4.3.16). Lo que LibreOffice escribió
// en cada parte (tipos de celda, estilos, cadenas compartidas) no cambia.
function libroConPrefijo(b, de, a) {
  const fin = b.length - 22;
  if (b.readUInt32LE(fin) !== 0x06054b50) throw new Error('el libro del catálogo no termina en su fin de directorio');
  const partes = [];
  let p = b.readUInt32LE(fin + 16);
  for (let k = 0; k < b.readUInt16LE(fin + 10); k++) {
    const nl = b.readUInt16LE(p + 28);
    const nombre = b.subarray(p + 46, p + 46 + nl);
    const local = b.readUInt32LE(p + 42);
    const desde = local + 30 + b.readUInt16LE(local + 26) + b.readUInt16LE(local + 28);
    const datos = b.subarray(desde, desde + b.readUInt32LE(p + 20));
    let crudo = b.readUInt16LE(p + 10) === 8 ? inflateRawSync(datos) : datos;
    if (nombre.toString('utf8').endsWith('.xml')) crudo = Buffer.from(crudo.toString('utf8').replaceAll(de, a).replaceAll(de.toUpperCase(), a.toUpperCase()));
    partes.push({ nombre, crudo });
    p += 46 + nl + b.readUInt16LE(p + 30) + b.readUInt16LE(p + 32);
  }
  const salida = [];
  const central = [];
  let pos = 0;
  for (const x of partes) {
    const comprimido = deflateRawSync(x.crudo);
    const crc = crc32(x.crudo);
    const h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(8, 8);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(comprimido.length, 18); h.writeUInt32LE(x.crudo.length, 22); h.writeUInt16LE(x.nombre.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(8, 10);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(comprimido.length, 20); c.writeUInt32LE(x.crudo.length, 24); c.writeUInt16LE(x.nombre.length, 28); c.writeUInt32LE(pos, 42);
    salida.push(h, x.nombre, comprimido);
    central.push(c, x.nombre);
    pos += 30 + x.nombre.length + comprimido.length;
  }
  const directorio = Buffer.concat(central);
  const e = Buffer.alloc(22);
  e.writeUInt32LE(0x06054b50, 0); e.writeUInt16LE(partes.length, 8); e.writeUInt16LE(partes.length, 10); e.writeUInt32LE(directorio.length, 12); e.writeUInt32LE(pos, 16);
  return Buffer.concat([...salida, directorio, e]);
}

const motor = await motores[NAV].launch();
console.log(`navegador: ${NAV} ${motor.version()}`);

for (const c of casos) {
  const A = c.ancho;
  // A 390 px, un teléfono táctil (bloque S, punto 6): `hasTouch` e `isMobile` hacen que `(hover: none)` se cumpla en los dos navegadores
  // (medido el 19/11/2026 y comprobado abajo en cada corrida); a 1 280 px, escritorio con ratón.
  const tactil = A === 390 ? { hasTouch: true, isMobile: true } : {};
  const ctx = await motor.newContext({ viewport: { width: A, height: A === 390 ? 844 : 800 }, acceptDownloads: true, locale: 'es-CL', ...tactil });
  const p = await ctx.newPage();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  const dialogos = [];
  p.on('dialog', (d) => { dialogos.push(d.message()); void d.dismiss(); });
  // Cuándo se pide el lector de libros (N6): nunca en la primera carga ni al abrir el alta masiva; sí al elegir un libro.
  const lector = [];
  p.on('request', (r) => { if (ES_LECTOR.test(new URL(r.url()).pathname)) lector.push(r.url()); });
  const paso = async (nombre, f) => {
    try { await f(); } catch (e) {
      const visto = limpio(await p.textContent('main').catch(() => '')).slice(0, 240);
      falla(`${A} px, ${nombre}: se cortó (${e instanceof Error ? e.message.split('\n').filter((l) => l.trim() !== '').slice(0, 1).concat(e.message.split('\n').filter((l) => /intercepts|visible|enabled|stable/.test(l)).slice(-2)).join(' | ') : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
    }
  };
  const foto = async (nombre) => {
    if (!capturas) return;
    await p.mouse.move(0, 0);
    await p.screenshot({ path: `${capturas}/lote-${nombre}-${NAV}-${A}.png`, fullPage: true });
  };
  const texto = async (sel) => limpio(await p.textContent(sel));
  const cifra = (f) => p.textContent(`[data-filtro-lote="${f}"] [data-cifra]`).then((x) => (x ?? '').trim());
  const sinDesborde = async (donde) => {
    let sobra = 0;
    for (let i = 0; i < 4; i++) {
      sobra = Math.max(sobra, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth));
      await p.waitForTimeout(150);
    }
    comprobar(sobra <= 0, `${A} px, ${donde}: sin desplazamiento horizontal`, `${sobra} px de más`);
  };
  // Un archivo para el campo, desde la memoria (no queda en disco).
  const elegir = (nombre, contenido) => p.setInputFiles('[data-archivo]', { name: nombre, mimeType: 'text/csv', buffer: Buffer.from(contenido) });
  // «Revisar las filas», midiendo en la página: del clic al paso 2 dibujado (dos cuadros pintados). Tras un 429 (10 por minuto por persona,
  // docs/11 §4), se hace lo que haría una persona: esperar lo que dice el aviso y pulsar su «Reintentar».
  const revisar = async () => {
    for (let intento = 0; intento < 4; intento++) {
      const r = await p.evaluate(async () => {
        const t0 = performance.now();
        document.querySelector('[data-revisar]').click();
        const listo = () => document.querySelector('[data-paso-lote="2"] [data-informe-lote]') || document.querySelector('[data-error-lote]');
        await new Promise((fin) => { const f = () => (listo() ? fin() : requestAnimationFrame(f)); requestAnimationFrame(f); });
        await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
        const e = document.querySelector('[data-error-lote]');
        return { ms: Math.round(performance.now() - t0), error: e?.getAttribute('data-error-lote') ?? null, aviso: e?.textContent ?? '' };
      });
      if (r.error !== 'demasiadas_peticiones') return r;
      const s = Number(/Espera (\d+) s/.exec(r.aviso)?.[1] ?? 20);
      console.log(`      (límite de validaciones por minuto: se esperan ${s + 1} s y se reintenta)`);
      await p.waitForTimeout((s + 1) * 1000);
      await p.click('[data-error-lote] [data-remedio]');
      await p.waitForSelector('[data-paso-lote="2"] [data-informe-lote], [data-error-lote]', { timeout: 15000 });
      if (await p.$('[data-paso-lote="2"]')) return { ms: null, error: null };
    }
    throw new Error('el límite de validaciones no cedió');
  };
  const leido = async (patron) => p.waitForFunction((x) => new RegExp(x).test(document.querySelector('[data-filas-leidas]:not([data-leyendo])')?.textContent ?? ''), patron, { timeout: 10000 });

  // ── Entrar (la persona de descarte: clave temporal → propia → términos, por la API desde la página) ─────────────────────────────
  await paso('entrar', async () => {
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
    await p.goto(`${base}/panel/#/`);
    await p.reload();
    await p.waitForLoadState('networkidle');
    await p.evaluate(() => { location.hash = '#/alta?modo=lote'; });
    await p.waitForSelector('[data-archivo]', { timeout: 15000 });
  });

  // ── N6: el lector de libros se descarga al elegir uno; un libro dañado se dice con su remedio; su peso ──────────────────────────
  await paso('N6 lector a pedido y libro dañado', async () => {
    comprobar(lector.length === 0, `${A} px, N6: el lector de libros no se pidió en la primera carga ni al abrir el alta masiva`, lector.join(' '));
    await p.setInputFiles('[data-archivo]', { name: 'planilla.xlsx', mimeType: 'application/octet-stream', buffer: Buffer.from('PK\u0003\u0004\u0014\u0000\u0006\u0000\u0008\u0000[Content_Types].xml') });
    await p.waitForSelector('[data-error-archivo="libro_ilegible"]', { timeout: 10000 });
    const t = await texto('[data-error-archivo]');
    comprobar(t.includes('El libro no se puede leer: está incompleto o dañado. Guárdalo de nuevo desde tu planilla (como .xlsx o como CSV) o copia las celdas y pégalas aquí.') && !t.includes('PK')
      && (await texto('[data-error-archivo] [data-remedio]')) === 'Elegir otro archivo', `${A} px, N6: un libro dañado se dice, con su remedio`, `«${t}»`);
    comprobar(lector.length === 1, `${A} px, N6: al elegir el libro se pidió el lector, una vez`, lector.join(' '));
    const r = await p.request.get(lector[0]);
    const cuerpo = await r.body();
    const gz = gzipSync(cuerpo, { level: 9 }).length;
    comprobar(r.ok() && gz < UMBRAL_LECTOR_BYTES, `${A} px, N6: el lector pesa ${cuerpo.length} bytes y ${gz} comprimido con gzip (umbral ${UMBRAL_LECTOR_BYTES})`, `HTTP ${r.status()}`);
    medidas.push({ ancho: A, lector_bytes: cuerpo.length, lector_gzip: gz, lector_codificacion: r.headers()['content-encoding'] ?? 'ninguna' });
  });

  // ── S1, S3, S4: el catálogo de 60 escenarios ─────────────────────────────────────────────────────────────────────────────────
  let frasesPrimera = null;
  // Cada fila de la revisión: su número, su resultado y su frase de «Qué pasa» (con el filtro «Leídas», todas a la vista: son 60).
  let planCsv = null;
  const planVisto = () => p.$$eval('[data-fila-lote]', (es) => es.map((e) => [Number(e.getAttribute('data-fila-lote')), e.getAttribute('data-resultado'), e.querySelector('[data-que-pasa]')?.textContent.replace(/\s+/g, ' ').trim() ?? '']));
  await paso('S1 catálogo de 60', async () => {
    await elegir('escenarios.csv', CATALOGO);
    await leido('escenarios\\.csv: 60 filas leídas');
    comprobar((await p.$('[data-error-archivo]')) === null && (await texto('[data-filas-leidas]')).includes('2 están mal escritas y no entran'),
      `${A} px, S1: el archivo de 60 casos no se rechaza entero: 60 leídas y 2 mal escritas que no entran`, await texto('[data-filas-leidas]'));
    const r = await revisar();
    comprobar(r.error === null, `${A} px, S1: la revisión de los 60 abre`, r.error ?? '');
    comprobar(await p.evaluate(() => document.activeElement?.hasAttribute('data-titulo-paso-lote')), `${A} px: el foco pasó al encabezado del paso 2`);
    const t = ESCENARIOS.totales;
    const vistas = { leidas: await cifra('leidas'), valida: await cifra('valida'), existe: await cifra('existe'), rechazada: await cifra('rechazada'), aviso: await cifra('aviso') };
    comprobar(JSON.stringify(vistas) === JSON.stringify({ leidas: String(t.leidas), valida: String(t.valida), existe: String(t.existe), rechazada: String(t.rechazada), aviso: String(t.aviso) }),
      `${A} px: las tarjetas cuentan ${t.leidas} leídas, ${t.valida} se crean, ${t.existe} ya existe, ${t.rechazada} no entran y ${t.aviso} con aviso`, JSON.stringify(vistas));
    // S3: la línea de avisos y la tarjeta «Con aviso» cuentan lo mismo; la zona por su nombre, una vez por zona, con el sitio por su nombre.
    const linea = await texto('[data-avisos-lote]');
    comprobar(linea.startsWith(`${t.aviso} filas que se crean traen avisos`), `${A} px, S3: «${t.aviso} filas que se crean traen avisos» = la tarjeta «Con aviso»`, linea);
    const zonas = await p.$$eval('[data-zonas-lote] li', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    const esperadas = ESCENARIOS.zonas_por_nombre.map((z) => `Zona «${z.zona}» → sitio «${SITIO}»: ${z.filas} filas`);
    comprobar(JSON.stringify(zonas) === JSON.stringify(esperadas), `${A} px, S3: «${esperadas.join('» y «')}»`, JSON.stringify(zonas));
    comprobar((await texto('[data-resumen-lote]')) === `${t.leidas} leídas: ${t.valida} se crean, ${t.existe} ya existe y ${t.rechazada} no entran.`, `${A} px, S6: el resumen va sobre la lista`, await texto('[data-resumen-lote]'));
    comprobar(await p.evaluate(() => document.querySelector('[data-remedio-no-entran]')?.textContent.includes('corrígelas y vuelve a subirlas') === true), `${A} px, S6: «corrígelas y vuelve a subirlas», a la vista`);
    // Cada escenario: su resultado y su texto (en «Qué pasa» o en el detalle). La fila vacía cuenta: no hay fila 22 y sí 23.
    await p.click('[data-filtro-lote="leidas"]');
    planCsv = await planVisto();
    comprobar((await p.$('[data-fila-lote="22"]')) === null && (await p.$('[data-fila-lote="23"]')) !== null, `${A} px: los números de fila son los de la planilla (la vacía cuenta)`);
    const malos = [];
    for (const e of ESCENARIOS.casos) {
      const fila = await p.$(`[data-fila-lote="${e.n}"]`);
      const resultado = await fila?.getAttribute('data-resultado');
      if (e.contiene !== '') {
        await p.click(`[data-detalle-fila="${e.n}"]`);
        await p.waitForSelector(`[data-detalle-lote="${e.n}"]`, { timeout: 3000 });
      }
      const dicho = limpio(await p.evaluate((n) => [...document.querySelectorAll(`[data-fila-lote="${n}"], [data-detalle-de="${n}"]`)].map((x) => x.textContent).join(' '), e.n));
      if (resultado !== e.resultado || !dicho.includes(e.contiene)) malos.push(`${e.caso} (fila ${e.n}): ${resultado}, «${dicho.slice(0, 160)}»`);
    }
    comprobar(malos.length === 0, `${A} px: los ${ESCENARIOS.casos.length} escenarios del catálogo dan su resultado y su texto`, malos.join(' · '));
    // S4: lo que se ve de cada fila (la frase, el resumen y los detalles abiertos: rótulos y valores salvo el tópico y el identificador escrito).
    const vistos = await p.evaluate(() => [
      ...[...document.querySelectorAll('[data-que-pasa], [data-con-aviso], [data-resumen-fila], [data-zonas-lote], [data-resumen-lote], [data-avisos-lote], [data-motivo-fila], [data-aviso-campo], [data-motivo-campo]')].map((x) => x.textContent),
      ...[...document.querySelectorAll('[data-detalle-lote] dt')].map((x) => x.textContent),
      // Los valores del detalle de lo que se crea (en una fila que no entra, el detalle muestra lo que la persona escribió, tal cual).
      ...[...document.querySelectorAll('[data-detalle-lote]')].filter((d) => document.querySelector(`[data-fila-lote="${d.getAttribute('data-detalle-lote')}"]`)?.getAttribute('data-resultado') === 'valida')
        .flatMap((d) => [...d.querySelectorAll('dd:not([data-campo-lote="topico"]):not([data-campo-lote="id_fisico"]) code')].map((x) => x.textContent)),
    ]);
    // La única excepción por diseño: «… se leyó como Cel» (S2), que nombra la unidad del catálogo.
    const jerga = [...new Set(vistos.map(limpio).filter((x) => x !== '' && JERGA.test(x) && !/ se leyó como /.test(x)))];
    comprobar(vistos.length > 100 && jerga.length === 0, `${A} px, S4: ${vistos.length} textos a la vista, ninguno con un nombre de columna, de variable o un código`, jerga.slice(0, 5).join(' · '));
    // S5: «Ya existe» en ámbar, con «Abrir su ficha».
    const existe = ESCENARIOS.casos.find((e) => e.caso === 'existe_en_sitio').n;
    const clase = await p.getAttribute(`[data-fila-lote="${existe}"] [data-que-pasa]`, 'class');
    comprobar(clase.includes('alerta') && (await p.$(`[data-fila-lote="${existe}"] [data-abrir-ficha]`)) !== null, `${A} px, S5: «Ya existe» en ámbar, con «Abrir su ficha»`, clase);
    comprobar((await p.$$(`[data-detalle-de="${existe}"] [data-motivo-campo].sin_senal, [data-detalle-lote="${existe}"] [data-motivo-campo].sin_senal`)).length === 0, `${A} px, S5: sin la cruz roja en su detalle`);
    if (A === 390) {
      comprobar((await p.$$('[data-tarjetas-lote] .tarjeta-lote')).length === t.leidas && (await p.$('[data-tabla-lote]')) === null, `${A} px: cada fila es una tarjeta, sin tabla`);
      await sinDesborde('revisión con 60 tarjetas y detalles abiertos');
    } else comprobar((await p.$('[data-tabla-lote]')) !== null, `${A} px: las filas van en una tabla`);
    await p.click('[data-filtro-lote="rechazada"]');
    frasesPrimera = await p.$$eval('[data-que-pasa]', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    await foto('revision-60');
  });

  // ── Descargar las que no entran y volver a subirlas sin tocar ───────────────────────────────────────────────────────────────
  await paso('las que no entran, ida y vuelta', async () => {
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-no-entran]')]);
    const ruta = join(mkdtempSync(join(tmpdir(), 'lote-')), 'no-entran.csv');
    await d.saveAs(ruta);
    const b = readFileSync(ruta);
    const lineas = b.toString('utf8').split('\r\n').filter((l) => l !== '');
    comprobar(b[0] === 0xef && lineas[0].endsWith(';fila;motivo') && lineas.length === ESCENARIOS.totales.rechazada + 1 && lineas.some((l) => l.startsWith("'@SUM(1+1);")),
      `${A} px: «las que no entran» trae BOM, «;», «fila» y «motivo», las ${ESCENARIOS.totales.rechazada} filas (también las mal formadas) y la fórmula neutralizada`, `${lineas.length} líneas`);
    // S6: el «Volver» de ABAJO, tras la lista larga con los detalles abiertos, se pulsa como persona (Playwright comprueba que nada lo tapa;
    // sin `force`). El 19/11/2026, a 390 px, su ayuda emergente fija al pie lo tapaba y el clic iba a ella.
    await p.click('[data-volver="abajo"]', { timeout: 5000 });
    await p.waitForSelector('[data-paso-lote="1"]', { timeout: 5000 });
    ok(`${A} px, S6: el «Volver» de abajo, tras la lista, se pulsó como persona`);
    await p.setInputFiles('[data-archivo]', ruta);
    await leido(`no-entran\\.csv: ${ESCENARIOS.totales.rechazada} filas leídas`);
    await revisar();
    await p.click('[data-filtro-lote="leidas"]');
    const frases = await p.$$eval('[data-que-pasa]', (es) => es.map((e) => e.textContent.replace(/\s+/g, ' ').trim()));
    // Las mismas frases salvo las dos que ya no fallan por lo mismo: la repetida (su original no viene) y la de la celda de más (ya alineada).
    const iguales = frasesPrimera.filter((f) => frases.includes(f));
    comprobar((await p.$('[data-error-archivo]')) === null && iguales.length === frasesPrimera.length - 2, `${A} px: vuelto a subir sin tocar, ${iguales.length} de ${frasesPrimera.length} filas dicen lo mismo (la repetida y la de la celda de más ya no fallan por eso)`,
      JSON.stringify(frasesPrimera.filter((f) => !frases.includes(f))));
    await p.click('[data-volver]');
    await p.waitForSelector('[data-paso-lote="1"]', { timeout: 5000 });
  });

  // ── N6: el catálogo guardado como .xlsx por LibreOffice llega a la misma revisión que su CSV ─────────────────────────────────
  await paso('N6 libro real', async () => {
    await p.setInputFiles('[data-archivo]', { name: 'escenarios.xlsx', mimeType: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet', buffer: LIBRO });
    await leido('escenarios\\.xlsx: 60 filas leídas');
    comprobar((await p.$('[data-error-archivo]')) === null && (await texto('[data-filas-leidas]')) === 'escenarios.xlsx: 60 filas leídas. 2 están mal escritas y no entran: la revisión dice por qué.',
      `${A} px, N6: el libro se lee en el navegador: 60 filas y las mismas 2 mal escritas que en su CSV`, await texto('[data-filas-leidas]'));
    const r = await revisar();
    comprobar(r.error === null, `${A} px, N6: la revisión del libro abre`, r.error ?? '');
    const t = ESCENARIOS.totales;
    const vistas = [await cifra('leidas'), await cifra('valida'), await cifra('existe'), await cifra('rechazada'), await cifra('aviso')];
    comprobar(vistas.join(' ') === [t.leidas, t.valida, t.existe, t.rechazada, t.aviso].join(' '), `${A} px, N6: las tarjetas del libro cuentan lo mismo que las del CSV (${vistas.join(', ')})`, vistas.join(' '));
    await p.click('[data-filtro-lote="leidas"]');
    const planLibro = await planVisto();
    const CELDA_DE_MAS = ESCENARIOS.casos.find((e) => e.caso.includes('celda') && e.donde === 'panel')?.n ?? 60;
    const distintas = planLibro.filter((f, i) => JSON.stringify(f) !== JSON.stringify(planCsv?.[i]));
    comprobar(planCsv !== null && planLibro.length === planCsv.length && planLibro.every((f, i) => f[0] === planCsv[i][0] && f[1] === planCsv[i][1])
      && distintas.length === 1 && distintas[0][0] === CELDA_DE_MAS && distintas[0][2] === 'No entra: la fila trae «sobra» en la columna H, que no tiene cabecera',
      `${A} px, N6: las 60 filas del libro con el mismo número y resultado que las del CSV, y la misma frase salvo la de la celda de más («en la columna H, que no tiene cabecera»)`,
      JSON.stringify(distintas).slice(0, 400));
    await foto('revision-xlsx');
    await p.click('[data-volver]');
    await p.waitForSelector('[data-paso-lote="1"]', { timeout: 5000 });
  });

  // ── S11: 500 filas: la revisión bajo 1 s y cada «Mostrar 100 más» bajo 0,3 s; S8: el foco tras el último ──────────────────────
  await paso('S11 500 filas', async () => {
    // Como el recorrido del 19/11/2026: dos de cada tres con la unidad del catálogo; una de cada tres sin unidad (con aviso: 167).
    const filas = Array.from({ length: 500 }, (_, i) => `${P}-v${String(i + 1).padStart(3, '0')},Sensor ${i + 1},${i % 5 ? 'Norte' : 'Galpón Sur'},,,300,${i % 3 ? 'temperatura:Cel | humedad:%RH' : 'temperatura | humedad | bateria:%EL'}`);
    await elegir('quinientas.csv', ['id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales', ...filas].join('\n'));
    await leido('quinientas\\.csv: 500 filas leídas');
    const r = await revisar();
    comprobar(r.error === null && r.ms !== null && r.ms < UMBRAL_REVISION_MS, `${A} px, S11: la revisión de 500 filas se dibuja en ${r.ms} ms (umbral ${UMBRAL_REVISION_MS} ms)`, r.error ?? '');
    comprobar((await cifra('valida')) === '500' && (await cifra('aviso')) === '167', `${A} px, S3: 500 se crean y solo las 167 sin unidad traen aviso (la zona por su nombre ya no lo es)`, `con aviso: ${await cifra('aviso')}`);
    const veces = [];
    for (let i = 0; i < 4; i++) {
      await p.focus('[data-mostrar-mas]');
      veces.push(await p.evaluate(async () => {
        const antes = document.querySelectorAll('[data-fila-lote]').length;
        const t0 = performance.now();
        document.querySelector('[data-mostrar-mas]').click();
        await new Promise((fin) => { const f = () => (document.querySelectorAll('[data-fila-lote]').length > antes ? fin() : requestAnimationFrame(f)); f(); });
        await new Promise((fin) => requestAnimationFrame(() => requestAnimationFrame(fin)));
        return Math.round(performance.now() - t0);
      }));
    }
    comprobar(veces.length === 4 && veces.every((x) => x < UMBRAL_MOSTRAR_MS), `${A} px, S11: cada «Mostrar 100 más» en ${veces.join(', ')} ms (umbral ${UMBRAL_MOSTRAR_MS} ms)`);
    await p.waitForFunction(() => document.activeElement?.hasAttribute('data-mostrando'), null, { timeout: 3000 });
    comprobar((await p.evaluate(() => document.activeElement?.textContent ?? '')).includes('Se ven 500 de 500'), `${A} px, S8: tras el último «Mostrar 100 más», el foco está en «Se ven 500 de 500»`);
    medidas.push({ ancho: A, revision_500_ms: r.ms, mostrar_mas_ms: veces });
    await p.click('[data-volver]');
    await p.waitForSelector('[data-paso-lote="1"]', { timeout: 5000 });
  });

  // ── Crear por HTTP; S7 «atrás» y «adelante» con credenciales sin descargar; S8 el foco tras «Ya las guardé» ───────────────────
  await paso('crear, atrás y adelante', async () => {
    // Una entrada previa en el historial: «atrás» va a otra pantalla y desmonta el alta masiva.
    await p.evaluate(() => { location.hash = '#/'; });
    await p.waitForTimeout(300);
    await p.evaluate(() => { location.hash = '#/alta?modo=lote'; });
    await p.waitForSelector('[data-pegado]', { timeout: 10000 });
    const tag = `${NAV === 'chromium' ? 'c' : 'f'}${A}`;
    const ids = [1, 2].map((k) => `${P}-${tag}-${k}`);
    await p.fill('[data-pegado]', ['id_fisico\tnombre\tzona\tvia\tformato\tintervalo_esperado_s\tcanales', ...ids.map((x) => `${x}\tNodo de prueba ${x}\tNorte\thttp\t\t300\ttemperatura:°C | humedad:%`)].join('\n'));
    await p.click('[data-leer-pegado]');
    await leido('Lo pegado: 2 filas leídas');
    await revisar();
    comprobar((await texto('[data-crear-lote]')) === 'Crear 2 dispositivos', `${A} px: el botón de arriba dice «Crear 2 dispositivos»`);
    await p.click('[data-crear-lote]', { timeout: 5000 }); // S6: como persona, sin `force`
    await p.waitForSelector('[data-paso-lote="3"]', { timeout: 20000 });
    ok(`${A} px, S6: «Crear 2 dispositivos» se pulsó como persona`);
    comprobar((await texto('[data-resultado-lote]')) === 'Se crearon 2 dispositivos.', `${A} px: «Se crearon 2 dispositivos.»`);
    await p.goBack();
    await p.waitForFunction(() => location.hash !== '#/alta?modo=lote', null, { timeout: 5000 });
    const sinPantalla = (await p.$('[data-lote]')) === null;
    await p.goForward();
    await p.waitForSelector('[data-paso-lote="3"]', { timeout: 10000 }).catch(() => {});
    comprobar(sinPantalla && (await p.$('[data-paso-lote="3"] [data-descargar-credenciales]')) !== null,
      `${A} px, S7: «atrás» sale de la pantalla y «adelante» vuelve al paso 3 con las credenciales sin descargar`);
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-credenciales]')]);
    // Las credenciales de descarte no quedan en disco: el directorio temporal se borra entero, también si algo falla al leerlo.
    const dir = mkdtempSync(join(tmpdir(), 'lote-'));
    let lineas = [];
    try {
      await d.saveAs(join(dir, 'cred.csv'));
      lineas = existsSync(join(dir, 'cred.csv')) ? readFileSync(join(dir, 'cred.csv'), 'utf8').split('\r\n').filter((l) => l !== '') : [];
    } finally {
      rmSync(dir, { recursive: true, force: true });
    }
    // La cuarta columna dice a dónde envía cada equipo según su vía (bloque S): por HTTP, «POST /recepcion/<id_fisico>».
    comprobar(lineas.length === 3 && lineas[0] === 'id_fisico,id,credencial,destino' && ids.every((x) => lineas.some((l) => l.startsWith(`${x},`) && l.endsWith(`,POST /recepcion/${x}`))),
      `${A} px: el archivo de credenciales trae las 2 creadas por HTTP, cada una con su destino «POST /recepcion/<id>»`, `${lineas.length} líneas: ${lineas.map((l) => l.split(',').filter((_, i) => i !== 2).join(',')).join(' | ')}`);
    const credencial = lineas[1]?.split(',')[2] ?? '';
    comprobar(credencial.length >= 16, `${A} px: hay una credencial que buscar en la página`, `${credencial.length} caracteres`);
    comprobar(credencial !== '' && !(await p.content()).includes(credencial), `${A} px, S7: la credencial nunca se dibujó en la página`);
    comprobar(credencial !== '' && !(await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href)).includes(credencial), `${A} px, S7: ni en el almacenamiento del navegador ni en la dirección`);
    await p.click('[data-olvidar-credenciales]');
    await p.waitForFunction(() => document.activeElement?.hasAttribute('data-sin-credenciales'), null, { timeout: 3000 });
    ok(`${A} px, S8: tras «Ya las guardé», el foco está en el párrafo que lo confirma`);
    comprobar(dialogos.length === 0, `${A} px: «atrás» no abrió diálogos`, dialogos.join(' | '));
  });

  // ── S5: «Abrir su ficha» lleva a la ficha del equipo que ya existe ──────────────────────────────────────────────────────────
  await paso('S5 abrir su ficha', async () => {
    await p.click('[data-otro-lote]');
    await elegir('escenarios.csv', CATALOGO);
    await leido('escenarios\\.csv: 60 filas leídas');
    await revisar();
    await p.click('[data-filtro-lote="existe"]');
    await p.click('[data-abrir-ficha]');
    await p.waitForFunction(() => location.hash.startsWith('#/dispositivos/'), null, { timeout: 5000 });
    await p.waitForFunction((x) => document.querySelector('main')?.textContent?.includes(x), `${P}-existe`, { timeout: 10000 });
    ok(`${A} px, S5: «Abrir su ficha» abre la ficha de ${P}-existe`);
  });

  // ── S6 en todo el panel: la ayuda emergente bajo 700 px no recibe toques; en escritorio sigue admitiendo el puntero (WCAG 1.4.13) ──
  // La ayuda emergente de un botón del inventario, abierta con el foco: su estilo y si recibe lo que se pulsa encima de ella.
  const ayudaAbierta = async (pg) => {
    await pg.evaluate(() => { location.hash = '#/inventario'; });
    await pg.waitForSelector('main .con-tooltip button', { timeout: 10000 });
    await pg.focus('main .con-tooltip button');
    await pg.waitForSelector('[data-tooltip]:not([hidden])', { timeout: 3000 });
    return pg.evaluate(() => {
      const t = document.querySelector('[data-tooltip]:not([hidden])');
      const c = t.getBoundingClientRect();
      const encima = document.elementFromPoint(c.left + c.width / 2, c.top + c.height / 2);
      const s = getComputedStyle(t);
      return {
        sinHover: matchMedia('(hover: none)').matches, eventos: s.pointerEvents, posicion: s.position, recibe: t.contains(encima),
        dentro: c.left >= 0 && c.right <= innerWidth && c.bottom <= innerHeight, letra: parseFloat(s.fontSize), ancho: Math.round(c.width),
      };
    });
  };
  await paso('S6 ayuda emergente', async () => {
    const r = await ayudaAbierta(p);
    if (A === 390) {
      comprobar(r.sinHover, `${A} px, S6: el teléfono emulado es táctil: (hover: none) se cumple en ${NAV}`, JSON.stringify(r));
      comprobar(r.posicion === 'fixed' && r.eventos === 'none' && !r.recibe, `${A} px, S6: en el teléfono, la ayuda emergente, fija al pie, deja pasar toques y clics a lo que tapa`, JSON.stringify(r));
      comprobar(r.dentro && r.letra >= 12 && r.ancho >= 300, `${A} px, S6: y se sigue leyendo entera (dentro de la pantalla, ${r.letra} px de letra, ${r.ancho} px de ancho)`, JSON.stringify(r));
      await sinDesborde('inventario con la ayuda abierta');
      // La misma sesión en una ventana de 390 px con ratón: la ayuda, fija al pie, sigue admitiendo el puntero encima (WCAG 2.2, 1.4.13).
      const conRaton = await motor.newContext({ viewport: { width: 390, height: 844 }, locale: 'es-CL', storageState: await ctx.storageState() });
      try {
        const q = await conRaton.newPage();
        await q.goto(`${base}/panel/#/`);
        await q.waitForLoadState('networkidle');
        const m = await ayudaAbierta(q);
        comprobar(!m.sinHover && m.posicion === 'fixed' && m.eventos !== 'none' && m.recibe, `390 px con ratón, S6: la ayuda fija al pie admite el puntero encima (WCAG 2.2, 1.4.13)`, JSON.stringify(m));
      } finally {
        await conRaton.close();
      }
    } else comprobar(!r.sinHover && r.eventos !== 'none' && r.recibe, `${A} px, S6: en escritorio la ayuda admite el puntero encima (WCAG 2.2, 1.4.13)`, JSON.stringify(r));
  });

  comprobar(errores.length === 0, `${A} px: sin errores de JavaScript en la página`, errores.join(' | '));
  await ctx.close();
}
await motor.close();
console.log(`medidas: ${JSON.stringify(medidas)}`);
console.log(fallos === 0 ? `\nLOTE NAVEGADOR OK (${total} de ${total} comprobaciones, ${NAV})` : `\n${fallos} de ${total} comprobación(es) con falla (${NAV})`);
process.exit(fallos === 0 ? 0 : 1);
