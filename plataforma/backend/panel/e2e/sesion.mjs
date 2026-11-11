// P10 (sesión) en un navegador real con Playwright, contra la pila de desarrollo en http://127.0.0.1:3000 (docs/19 §4 y §6; docs/20;
// docs/16 §59). Lo lanza `plataforma/pruebas/panel-sesion-e2e.sh` (paso 4c del guardián), que crea las personas y el dispositivo de
// prueba, pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes ni se imprimen) y lo borra todo al final.
// Recorre, por cada caso (navegador × ancho): entrar con la clave temporal, cambiarla, ver el inventario y quién soy, abrir la ficha y
// exportar el CSV (descarga por Blob), la pantalla de usuarios (guía de perfiles, alta y «asignar clave temporal» con la temporal mostrada
// una vez y fuera de la lista), la sesión que
// vence (vuelve al inicio y, tras entrar, a la misma ficha) y salir. Un caso además entra como consulta y ve la exportación desactivada.
// Desde el 11/11/2026 (docs/19 §7, tablero v2): legal antes de entrar, la aceptación obligatoria de los términos (docs/20 §12), el tablero
// cuyos indicadores suman el inventario, P6 (validación en vivo, guardar y el 409 con otra escritura entretanto), P7 (asistente por HTTP y alta masiva
// por archivo), P13 (°F en la ficha sin cambiar la base) y P14 (el cambio de umbrales con la persona que lo hizo).
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const datos = JSON.parse(readFileSync(0, 'utf8'));
const { base, navegador: NAV, dispositivo, idFisico, sitio, capturas, casos } = datos;
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
let fallos = 0;
let comprobaciones = 0;
const ok = (m) => { comprobaciones++; console.log(`OK    [${NAV}] ${m}`); };
const falla = (m) => { comprobaciones++; fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
// Si un paso se corta, se dice también qué mostraba la pantalla (el texto de <main>, acotado): sin eso, un tiempo agotado no explica nada.
let paginaActual = null;
const paso = async (nombre, f) => {
  try { await f(); } catch (e) {
    const visto = paginaActual ? ((await paginaActual.textContent('main').catch(() => '')) ?? '').replace(/\s+/g, ' ').trim().slice(0, 240) : '';
    falla(`${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
  }
};
const TEXTO_CREDENCIALES = 'Correo o clave incorrectos. Revisa los dos y vuelve a intentarlo.';

const motor = await motores[NAV].launch();
console.log(`navegador: ${NAV} ${motor.version()}`);

// RF-52: nada se desplaza a lo ancho.
const sinDesborde = async (p, donde) => {
  const [ancho, vista] = await p.evaluate(() => [document.documentElement.scrollWidth, window.innerWidth]);
  comprobar(ancho <= vista, `${donde}: sin desplazamiento horizontal a ${vista} px`, `ancho del documento ${ancho}`);
};
// Las capturas van al repositorio público: se tapan la hora del sitio, el eje de tiempo del gráfico y los vencimientos, que dirían a qué
// hora del día se corrió la prueba (regla de privacidad del proyecto: ningún archivo versionado dice a qué hora se trabajó).
// Lo que las capturas tapan: la hora del sitio, el gráfico, el estado de usuarios, la última lectura y los campos de clave
// (revisión de privacidad del 08/11/2026: ni el largo de una clave de prueba se publica). Desde el 11/11/2026 también la cabecera
// «servicio: ok, base conectada, N tablas» (describe la instalación) y toda credencial ([data-credencial]).
const MASCARA = ['[data-salud]', '[data-hora-sitio]', '.grafico', '[data-estado-usuario]', '[data-ultima-lectura]', 'input[type=password]', '[data-credencial]', '[data-intervalo]', '[data-tabla-actividad] td:first-child', '[data-tarjetas-actividad] .vivo'];
const foto = async (p, nombre) => {
  // El puntero, fuera de la página: una ayuda abierta por el último clic taparía la pantalla en la captura.
  if (capturas) await p.mouse.move(0, 0);
  if (capturas) await p.screenshot({ path: `${capturas}/${nombre}-${NAV}-${p.viewportSize().width}.png`, fullPage: true, mask: MASCARA.map((s) => p.locator(s)) });
};
const entrar = async (p, email, clave) => {
  await p.getByLabel('Correo').fill(email);
  await p.getByLabel('Clave', { exact: true }).fill(clave);
  await p.getByRole('button', { name: 'Entrar', exact: true }).click();
};
const elegirClave = async (p, nueva) => {
  await p.getByRole('heading', { name: 'Elige tu clave' }).waitFor({ timeout: 15000 });
  await p.getByLabel('Clave nueva', { exact: true }).fill(nueva);
  await p.getByLabel('Repite la clave nueva').fill(nueva);
  await p.getByRole('button', { name: 'Guardar la clave nueva' }).click();
};
// Una persona nueva no aceptó los términos (docs/20 §12): la pantalla es obligatoria y, hasta aceptar, la API responde 403 con su código.
const aceptarTerminos = async (p, etiqueta) => {
  await p.getByRole('heading', { name: 'Términos de uso' }).waitFor({ timeout: 15000 });
  const r = await p.evaluate(async () => { const x = await fetch('/dispositivos'); return { status: x.status, codigo: (await x.json()).codigo }; });
  comprobar(r.status === 403 && r.codigo === 'terminos_pendientes', `${etiqueta}: sin aceptar los términos, la API responde 403 terminos_pendientes`, JSON.stringify(r));
  comprobar((await p.locator('[data-texto-terminos] h3').count()) > 0, `${etiqueta}: la pantalla muestra el texto completo de los términos`);
  const boton = p.getByRole('button', { name: /^Acepto los términos \(versión \d+\)$/ });
  await boton.waitFor({ timeout: 15000 });
  await boton.click();
  await p.getByRole('heading', { name: 'Términos de uso' }).waitFor({ state: 'detached', timeout: 15000 });
  ok(`${etiqueta}: «Acepto los términos (versión N)» los acepta y deja entrar`);
};
// La cuenta (nombre, Cambiar la clave, Salir…) vive en un <details> de la cabecera desde el armazón v2 (A1): se abre antes de pulsar.
const abrirCuenta = async (p) => {
  if (!(await p.locator('[data-quien]').evaluate((d) => d.open))) await p.locator('[data-quien] summary').click();
};

for (const caso of casos) {
  const ancho = caso.ancho;
  const contexto = await motor.newContext({ viewport: { width: ancho, height: ancho < 500 ? 844 : 900 }, acceptDownloads: true, timezoneId: 'America/Santiago' });
  const p = await contexto.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e)));
  const etiqueta = `${ancho} px`;

  await paso(`${etiqueta}: legal antes de entrar`, async () => {
    await p.goto(`${base}/panel/#/legal`);
    await p.locator('[data-inventario-privacidad]').waitFor({ timeout: 15000 });
    comprobar((await p.locator('[data-inventario-privacidad] li').count()) >= 5, `${etiqueta}: P11 sin sesión: la privacidad con el inventario de datos`);
    await p.locator('[data-legal-terminos] [data-version-legal]').waitFor({ timeout: 15000 });
    comprobar(/^Versión \d+/.test(await p.locator('[data-legal-terminos] [data-version-legal]').textContent()), `${etiqueta}: … los términos con su versión`);
    // Sin sesión (revisión del 11/11/2026): la licencia AGPL y el código fuente sí; la versión y el commit, no.
    await p.locator('[data-aviso-licencia]').waitFor({ timeout: 15000 });
    comprobar((await p.locator('[data-acerca-version]').count()) === 0 && (await p.locator('[data-codigo-fuente]').count()) === 1,
      `${etiqueta}: … y «Acerca de» con el aviso AGPL y el código fuente, sin la versión (solo con sesión)`);
    await sinDesborde(p, `${etiqueta}, legal`);
  });

  await paso(`${etiqueta}: inicio de sesión`, async () => {
    await p.goto(`${base}/panel/#/`);
    await p.getByRole('heading', { name: 'Entrar' }).waitFor({ timeout: 15000 });
    comprobar((await p.getByLabel('Correo').getAttribute('autocomplete')) === 'username' && (await p.getByLabel('Clave', { exact: true }).getAttribute('autocomplete')) === 'current-password',
      `${etiqueta}: «Entrar» con autocomplete username y current-password`);
    await sinDesborde(p, `${etiqueta}, Entrar`);
    if (caso.claveMala) {
      await entrar(p, caso.email, caso.claveMala);
      const alerta = p.getByRole('alert');
      await alerta.waitFor({ timeout: 15000 });
      comprobar((await alerta.textContent()).trim() === TEXTO_CREDENCIALES, `${etiqueta}: clave mala → «${TEXTO_CREDENCIALES}»`);
    }
    await foto(p, '1-entrar');
    await entrar(p, caso.email, caso.temporal);
    await p.getByRole('heading', { name: 'Elige tu clave' }).waitFor({ timeout: 15000 });
    ok(`${etiqueta}: con la clave temporal, el panel exige elegir una propia`);
    const reglas = await p.locator('[data-reglas-clave]').textContent();
    comprobar(reglas.includes('Entre 12 y 128 caracteres'), `${etiqueta}: las reglas de la clave se ven antes de escribir`);
    const galletas = await contexto.cookies();
    const g = galletas.find((c) => c.name === '__Host-sesion');
    comprobar(g && g.httpOnly && g.secure && g.sameSite === 'Lax' && g.path === '/', `${etiqueta}: cookie __Host-sesion HttpOnly, Secure, SameSite=Lax, Path=/`);
    comprobar((await p.evaluate(() => document.cookie)) === '', `${etiqueta}: document.cookie vacío (ningún script lee la sesión)`);
    comprobar((await p.evaluate(async () => (await fetch('/dispositivos')).status)) === 403, `${etiqueta}: con la temporal, la API responde 403 a todo lo demás`);
    await sinDesborde(p, `${etiqueta}, cambio de clave`);
    await foto(p, '2-cambiar-clave');
    await elegirClave(p, caso.nueva);
    await aceptarTerminos(p, etiqueta);
  });

  await paso(`${etiqueta}: inventario y quién soy`, async () => {
    // Desde el tablero v2 (docs/19 §4, A1) la llegada es el tablero; el inventario vive en #/inventario y bajo 700 px es una lista de
    // tarjetas: la fila se busca por su data-id, sea fila de tabla o tarjeta.
    await p.evaluate(() => { location.hash = '#/inventario'; });
    await p.locator(`[data-id="${dispositivo}"]`).waitFor({ timeout: 15000 });
    ok(`${etiqueta}: tras cambiar la clave, el inventario muestra el dispositivo de prueba`);
    comprobar((await p.locator('[data-quien-nombre]').textContent()) === caso.nombre, `${etiqueta}: la cabecera dice quién soy (${caso.nombre})`);
    comprobar((await p.locator('[data-quien-sitios]').textContent()).includes('(administrador)'), `${etiqueta}: … con su sitio y su rol`);
    await p.waitForFunction(() => document.querySelector('p[data-canal]')?.getAttribute('data-canal') === 'en_vivo', null, { timeout: 15000 });
    ok(`${etiqueta}: el canal en vivo se abre después de entrar`);
    await sinDesborde(p, `${etiqueta}, inventario`);
    await foto(p, '3-inventario');
  });

  await paso(`${etiqueta}: ficha y exportar`, async () => {
    await p.locator(`[data-id="${dispositivo}"] a`).click();
    const boton = p.getByRole('button', { name: 'Descargar CSV de este rango' });
    await boton.waitFor({ timeout: 15000 });
    const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), boton.click()]);
    const ruta = await descarga.path();
    const lineas = readFileSync(ruta, 'utf8').trim().split(/\r?\n/);
    comprobar(descarga.suggestedFilename().endsWith('.csv') && descarga.suggestedFilename().includes(idFisico), `${etiqueta}: exportar descarga ${descarga.suggestedFilename()} (por fetch y Blob, con la sesión)`);
    comprobar(lineas.length >= 4 && /^[a-z_]+(,[a-z_]+)+$/.test(lineas[0]), `${etiqueta}: el CSV trae la cabecera y ${lineas.length - 1} filas`, lineas[0]);
    comprobar(!p.url().includes('/exportar'), `${etiqueta}: la página no navegó a la API`);
    await sinDesborde(p, `${etiqueta}, ficha`);
    await foto(p, '7-ficha');
  });

  await paso(`${etiqueta}: tablero`, async () => {
    await p.evaluate(() => { location.hash = '#/'; });
    await p.locator('[data-indicadores]').waitFor({ timeout: 15000 });
    // Los cuatro estados suman el total y el total es el del inventario del sitio (X-Total), sin dos cálculos distintos (A4).
    const valores = await p.locator('[data-indicadores] [data-valor]').allTextContents();
    const inventario = await p.evaluate(async (codigo) => {
      const s = (await (await fetch('/sitios')).json()).find((x) => x.codigo === codigo);
      return Number((await fetch(`/dispositivos?sitio=${s.id}&limite=1`)).headers.get('x-total'));
    }, sitio);
    const n = valores.map((v) => Number(v.replace(/\D/g, '')));
    comprobar(n.length >= 5 && n[0] === inventario && n.slice(1, 5).reduce((a, b) => a + b, 0) === n[0], `${etiqueta}: P1: los indicadores suman el total y el total es el del inventario (${inventario})`, JSON.stringify(n));
    await sinDesborde(p, `${etiqueta}, tablero`);
    await foto(p, '6-tablero');
  });

  await paso(`${etiqueta}: configurar (P6)`, async () => {
    await p.evaluate((id) => { location.hash = `#/dispositivos/${id}/configurar`; }, dispositivo);
    const canal = p.locator('[data-config-canal]').first();
    await canal.waitFor({ timeout: 15000 });
    if ((await canal.locator('[data-regla]').count()) === 0) await canal.getByRole('button', { name: 'Agregar una regla' }).click();
    const regla = canal.locator('[data-regla]').first();
    await regla.locator('[data-campo="umbral_alto"]').fill('30');
    await regla.locator('[data-campo="umbral_bajo"]').fill('35');
    const guardar = canal.locator('[data-guardar-reglas]');
    comprobar((await regla.locator('[data-error-campo="reglas[0].umbral_bajo"]').textContent()) === 'debe ser menor que umbral_alto' && (await guardar.isDisabled()),
      `${etiqueta}: P6: bajo ≥ alto se dice junto al campo y frena «Guardar las reglas»`);
    await regla.locator('[data-campo="umbral_bajo"]').fill('10');
    await guardar.click();
    await p.getByText('Reglas guardadas: rigen desde la próxima trama.').waitFor({ timeout: 15000 });
    const reglas = await p.evaluate(async (id) => (await (await fetch(`/dispositivos/${id}`)).json()).canales[0].reglas, dispositivo);
    comprobar(reglas?.length === 1 && reglas[0].umbral_alto === 30 && reglas[0].umbral_bajo === 10, `${etiqueta}: … guardar deja la regla en el servidor`, JSON.stringify(reglas));
    await sinDesborde(p, `${etiqueta}, configurar`);
    if (ancho >= 1000) {
      // F2: la pantalla ya leyó el dispositivo (arriba); otra escritura (otra pestaña con la misma sesión) lo cambia entretanto y esta
      // pantalla guarda encima: 409. La otra escritura va por la API desde la misma página (una pestaña más no agrega nada al caso).
      const leido = await p.locator('[data-form-dispositivo] [data-campo="nombre"]').inputValue();
      const pedidas = []; // diagnóstico: qué pide la pantalla entre la otra escritura y el guardado
      const anotar = (r) => { if (r.url().includes('/dispositivos/') || r.url().endsWith('/sesion') || r.url().includes('/sitios')) pedidas.push(`${r.method()} ${new URL(r.url()).pathname}`); };
      p.on('request', anotar);
      // El nombre lleva el navegador: el dispositivo es el mismo en las dos corridas, y un PATCH que no cambia nada no mueve
      // `actualizado_en` (la segunda corrida no tenía conflicto que probar; lo encontró la corrida del 11/11/2026).
      const otra = await p.evaluate(async ([id, nombre]) => {
        const d = await (await fetch(`/dispositivos/${id}`, { cache: 'no-store' })).json();
        const r = await fetch(`/dispositivos/${id}`, { method: 'PATCH', headers: { 'content-type': 'application/json', 'X-Pedido': 'panel' }, body: JSON.stringify({ actualizado_en: d.actualizado_en, nombre }) });
        return r.status;
      }, [dispositivo, `nodo e2e (otra pestaña, ${NAV})`]);
      comprobar(otra === 200 && (await p.locator('[data-form-dispositivo] [data-campo="nombre"]').inputValue()) === leido, `${etiqueta}: P6: otra escritura cambia el dispositivo mientras la pantalla sigue con lo leído`, String(otra));
      await p.locator('[data-form-dispositivo] [data-campo="nombre"]').fill(`nodo e2e (esta pestaña, ${NAV})`);
      await p.locator('[data-guardar-dispositivo]').click();
      const alerta = p.locator('[data-aviso="conflicto"]');
      await alerta.waitFor({ timeout: 15000 }).catch((e) => { throw new Error(`${e.message.split('\n')[0]}; pedidas: ${pedidas.join(', ')}`); });
      p.off('request', anotar);
      comprobar(/Alguien lo cambió a las \d{2}:\d{2} entretanto: recarga/.test(await alerta.textContent()), `${etiqueta}: P6: 409 por la escritura de otra pestaña → «alguien lo cambió a las HH:MM: recarga»`);
      const nombre = await p.evaluate(async (id) => (await (await fetch(`/dispositivos/${id}`)).json()).nombre, dispositivo);
      comprobar(nombre === `nodo e2e (otra pestaña, ${NAV})`, `${etiqueta}: … y no pisó lo guardado por la otra pestaña`, nombre);
      await alerta.getByRole('button', { name: 'Recargar' }).click();
      await p.waitForFunction((n) => document.querySelector('[data-form-dispositivo] [data-campo="nombre"]')?.value === n, `nodo e2e (otra pestaña, ${NAV})`, { timeout: 15000 });
      ok(`${etiqueta}: … «Recargar» trae el valor nuevo`);
    }
    await foto(p, '8-configurar');
  });

  await paso(`${etiqueta}: preferencias (P13)`, async () => {
    await p.evaluate(() => { location.hash = '#/preferencias'; });
    const temp = p.locator('[data-pref="unidad_temperatura"]');
    await temp.waitFor({ timeout: 15000 });
    const [put] = await Promise.all([p.waitForResponse((r) => r.url().endsWith('/preferencias') && r.request().method() === 'PUT', { timeout: 15000 }), temp.selectOption('F')]);
    comprobar(put.status() === 200, `${etiqueta}: P13: elegir °F se guarda en la cuenta (PUT /preferencias 200)`, String(put.status()));
    await p.evaluate((id) => { location.hash = `#/dispositivos/${id}`; }, dispositivo);
    await p.locator('.canales').first().waitFor({ timeout: 15000 });
    await p.waitForFunction(() => document.querySelector('.canales')?.textContent?.includes('°F'), null, { timeout: 15000 });
    const valorBase = await p.evaluate(async (id) => (await (await fetch(`/dispositivos/${id}`)).json()).canales[0].ultima_medicion.valor, dispositivo);
    comprobar(valorBase >= 20 && valorBase <= 25, `${etiqueta}: … la ficha muestra °F y la base sigue en °C (${valorBase})`);
    await p.evaluate(() => { location.hash = '#/preferencias'; });
    await temp.waitFor({ timeout: 15000 });
    await Promise.all([p.waitForResponse((r) => r.url().endsWith('/preferencias') && r.request().method() === 'PUT', { timeout: 15000 }), temp.selectOption('C')]);
    await sinDesborde(p, `${etiqueta}, preferencias`);
    await foto(p, '9-preferencias');
  });

  await paso(`${etiqueta}: actividad (P14)`, async () => {
    await p.evaluate(() => { location.hash = '#/actividad'; });
    await p.locator('[data-fila-actividad]').first().waitFor({ timeout: 15000 });
    const filas = await p.locator('[data-fila-actividad]').allTextContents();
    comprobar(filas.some((f) => f.includes(caso.nombre) && /umbral/i.test(f)), `${etiqueta}: P14: el cambio de umbrales aparece con la persona que lo hizo`, filas.slice(0, 3).join(' | ').slice(0, 200));
    comprobar(!(await p.content()).includes(caso.email), `${etiqueta}: … sin correos en la actividad`);
    await sinDesborde(p, `${etiqueta}, actividad`);
  });

  if (ancho >= 1000) {
    await paso(`${etiqueta}: alta (P7)`, async () => {
      const nuevo = `${idFisico}-${NAV.slice(0, 2)}-a`;
      await p.evaluate(() => { location.hash = '#/alta'; });
      await p.locator('[data-campo="id_fisico"]').fill(nuevo);
      await p.locator('[data-campo="nombre"]').fill('alta e2e');
      await p.getByRole('button', { name: 'Siguiente' }).click();
      await p.locator('[data-campo="via"]').selectOption('http');
      await p.getByRole('button', { name: 'Siguiente' }).click();
      await p.locator('[data-campo="canal"]').fill('temperatura');
      await p.getByRole('button', { name: 'Crear el dispositivo' }).click();
      await p.locator('[data-credencial]').waitFor({ timeout: 15000 });
      comprobar((await p.locator('[data-credencial-una-vez]').textContent()).includes('no se vuelve a mostrar'), `${etiqueta}: P7: el asistente crea el dispositivo y muestra la credencial una sola vez`);
      await p.getByRole('button', { name: 'Ya la guardé: esperar la primera trama' }).click();
      await p.locator('[data-esperando]').waitFor({ timeout: 15000 });
      comprobar((await p.locator('[data-credencial]').count()) === 0, `${etiqueta}: … al pasar a «esperando la primera trama», la credencial deja la página`);
      // Alta masiva: dos válidas y una con una zona que no existe; se valida (no crea nada) y se crean solo las válidas.
      await p.evaluate(() => { location.hash = '#/alta?modo=lote'; });
      const csv = ['id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela',
        `${nuevo}-l1,lote e2e 1,zona e2e,http,senml,60,temperatura,`, `${nuevo}-l2,lote e2e 2,zona e2e,http,senml,60,temperatura,`,
        `${nuevo}-l3,lote e2e 3,zona que no existe,http,senml,60,temperatura,`].join('\n');
      await p.locator('[data-archivo]').setInputFiles({ name: 'lote-e2e.csv', mimeType: 'text/csv', buffer: Buffer.from(csv) });
      await p.getByRole('button', { name: 'Validar el archivo' }).click();
      await p.locator('[data-resumen-lote]').waitFor({ timeout: 15000 });
      comprobar((await p.locator('[data-resumen-lote]').textContent()).includes('Válidas 2 · creadas 0 · rechazadas 1'), `${etiqueta}: P7: validar informa 2 válidas y 1 rechazada sin crear nada`);
      const antes = await p.evaluate(async (s) => { const x = (await (await fetch('/sitios')).json()).find((y) => y.codigo === s); return Number((await fetch(`/dispositivos?sitio=${x.id}&limite=1`)).headers.get('x-total')); }, sitio);
      await p.getByRole('button', { name: 'Crear las válidas (2)' }).click();
      await p.waitForFunction(() => document.querySelector('[data-resumen-lote]')?.textContent?.includes('creadas 2'), null, { timeout: 30000 });
      const despues = await p.evaluate(async (s) => { const x = (await (await fetch('/sitios')).json()).find((y) => y.codigo === s); return Number((await fetch(`/dispositivos?sitio=${x.id}&limite=1`)).headers.get('x-total')); }, sitio);
      comprobar(despues === antes + 2, `${etiqueta}: … «Crear las válidas» crea solo las 2 válidas`, `${antes} → ${despues}`);
      const [descarga] = await Promise.all([p.waitForEvent('download', { timeout: 15000 }), p.getByRole('button', { name: 'Descargar credenciales (CSV)' }).click()]);
      const lineas = readFileSync(await descarga.path(), 'utf8').trim().split(/\r?\n/);
      comprobar(lineas[0] === 'id_fisico,id,credencial,topico' && lineas.length === 3, `${etiqueta}: … las credenciales se descargan una vez en CSV (${lineas.length - 1} filas)`);
      await sinDesborde(p, `${etiqueta}, alta masiva`);
      await foto(p, '10-alta-masiva');
    });
  }

  // WCAG 2.4.11 (revisión del 11/11/2026): en teléfono, los avisos fijos al pie no tapan el campo con el foco. Tres condiciones nuevas
  // llegan por el canal en vivo: un guion de inicio (solo mientras la marca `e2e-avisos` está en sessionStorage) envuelve EventSource y,
  // al abrirse /eventos, le entrega tres eventos `condicion` (abrir tres condiciones reales exigiría un nodo con reglas). Se ven 2 avisos
  // y el tercero queda plegado; con Tab hasta el último control del formulario de soporte, el foco queda a la vista.
  if (ancho < 1000) {
    await paso(`${etiqueta}: los avisos fijos no tapan el foco`, async () => {
      await p.addInitScript(() => {
        if (sessionStorage.getItem('e2e-avisos') !== '1') return;
        const Original = window.EventSource;
        window.EventSource = class extends Original {
          constructor(u, o) {
            super(u, o);
            if (!String(u).endsWith('/eventos')) return;
            this.addEventListener('open', () => {
              for (const d of ['00000000-0000-4000-8000-0000000000e1', '00000000-0000-4000-8000-0000000000e2', '00000000-0000-4000-8000-0000000000e3']) {
                this.dispatchEvent(new MessageEvent('condicion', { data: JSON.stringify({ dispositivo_id: d, condicion: 'umbral', estado: 'abierta' }) }));
              }
            }, { once: true });
          }
        };
      });
      await p.evaluate(() => { sessionStorage.setItem('e2e-avisos', '1'); location.hash = '#/legal?seccion=soporte'; });
      await p.reload();
      await p.locator('[data-avisos-plegados]').waitFor({ timeout: 15000 });
      const visibles = await p.locator('[data-notificaciones] > [data-aviso]').count();
      comprobar(visibles === 2 && (await p.locator('[data-avisos-plegados] summary').textContent()) === 'y 1 más', `${etiqueta}: tres avisos → 2 a la vista y «y 1 más» plegado`, `visibles ${visibles}`);
      await p.locator('[data-soporte-texto]').fill('prueba del foco (no se envía)');
      await p.locator('[data-soporte-texto]').focus();
      await p.keyboard.press('Tab'); // el último control del formulario: «Enviar a soporte»
      const r = await p.evaluate(() => {
        const a = document.activeElement.getBoundingClientRect();
        const n = document.querySelector('[data-notificaciones]').getBoundingClientRect();
        return { foco: document.activeElement.textContent?.trim().slice(0, 30), arriba: a.top, abajo: a.bottom, avisos: n.top, alto: innerHeight };
      });
      // Visible = el control entero queda por encima de los avisos y dentro de la ventana (más exigente que 2.4.11, que pide «no del todo tapado»).
      comprobar(r.foco === 'Enviar a soporte' && r.arriba >= 0 && r.abajo <= r.avisos && r.abajo <= r.alto, `${etiqueta}: Tab hasta «Enviar a soporte»: el foco queda por encima de los avisos`, JSON.stringify(r));
      await p.locator('[data-soporte-texto]').fill('');
      await p.evaluate(() => sessionStorage.removeItem('e2e-avisos'));
      await p.reload(); // sin la marca, el canal vuelve a ser el real
    });
  }

  await paso(`${etiqueta}: la sesión vence y se vuelve a la misma ficha`, async () => {
    await p.evaluate((id) => { location.hash = `#/dispositivos/${id}`; }, dispositivo);
    await p.getByRole('button', { name: 'Descargar CSV de este rango' }).waitFor({ timeout: 15000 });
    const hashAntes = await p.evaluate(() => location.hash);
    await contexto.clearCookies(); // como si venciera: la siguiente petición responde 401
    await p.getByRole('button', { name: '7 días', exact: true }).click();
    await p.getByRole('heading', { name: 'Entrar' }).waitFor({ timeout: 15000 });
    comprobar((await p.textContent('main')).includes('Tu sesión venció o se cerró'), `${etiqueta}: un 401 lleva a «Entrar» con el aviso`);
    await entrar(p, caso.email, caso.nueva);
    await p.getByRole('button', { name: 'Descargar CSV de este rango' }).waitFor({ timeout: 15000 });
    const hashDespues = await p.evaluate(() => location.hash);
    comprobar(hashDespues.split('?')[0] === hashAntes.split('?')[0], `${etiqueta}: tras entrar, vuelve a la ficha donde estaba`, `${hashAntes} → ${hashDespues}`);
  });

  if (caso.consulta) {
    await paso(`${etiqueta}: usuarios`, async () => {
      await p.getByRole('link', { name: 'Usuarios' }).click();
      await p.locator('[data-guia-rol="consulta"]').waitFor({ timeout: 15000 });
      comprobar((await p.locator('[data-guia-rol="consulta"]').textContent()).startsWith('Consulta: ve dispositivos'), `${etiqueta}: la guía de perfiles sale de la matriz del servidor`);
      // Dentro del formulario de alta: «Nombre» también es una columna de la lista (corrección del 11/11/2026: el selector era ambiguo).
      await p.locator('[data-alta-usuario]').getByLabel('Nombre').fill(caso.consulta.nombre);
      await p.locator('[data-alta-usuario]').getByLabel('Correo').fill(caso.consulta.email);
      await p.getByRole('button', { name: 'Dar de alta' }).click();
      const clave = (await p.locator('[data-clave-temporal]').textContent({ timeout: 15000 })).trim();
      comprobar(/^[A-Za-z0-9_-]{24}$/.test(clave), `${etiqueta}: alta → la clave temporal se muestra una vez (24 caracteres, no se imprime aquí)`);
      await p.getByRole('button', { name: 'Ya la entregué: ocultar' }).click();
      comprobar(!(await p.content()).includes(clave), `${etiqueta}: al ocultarla, la clave ya no está en la página`);
      await p.locator(`[data-usuario="${caso.consulta.email}"]`).waitFor({ timeout: 15000 });
      ok(`${etiqueta}: la persona nueva aparece en la lista`);
      await sinDesborde(p, `${etiqueta}, usuarios`);
      await foto(p, '4-usuarios');
      // «Olvidé mi clave»: una temporal nueva para la misma persona. Se ve UNA vez (solo en el aviso, nunca en la fila de la lista) y la
      // del alta deja de estar en la página; al ocultarla, ninguna de las dos queda.
      await p.locator(`[data-usuario="${caso.consulta.email}"] [data-asignar-temporal]`).click();
      await p.waitForFunction((anterior) => { const t = document.querySelector('[data-clave-temporal]')?.textContent?.trim(); return !!t && t !== anterior; }, clave, { timeout: 15000 });
      const otra = (await p.locator('[data-clave-temporal]').textContent()).trim();
      const html = await p.content();
      comprobar(/^[A-Za-z0-9_-]{24}$/.test(otra) && html.split(otra).length - 1 === 1 && !html.includes(clave),
        `${etiqueta}: asignar clave temporal → se muestra una vez, solo en el aviso (ni en la fila ni la del alta)`);
      comprobar(!(await p.locator(`[data-usuario="${caso.consulta.email}"]`).innerHTML()).includes(otra), `${etiqueta}: … la fila de la lista no la contiene`);
      await p.getByRole('button', { name: 'Ya la entregué: ocultar' }).click();
      comprobar(!(await p.content()).includes(otra), `${etiqueta}: al ocultarla, la clave asignada ya no está en la página`);
      // Los cuatro perfiles de sitio en el selector (revisión del 11/11/2026: antes solo consulta y administrador).
      const roles = await p.locator('[data-rol-alta] option').evaluateAll((os) => os.map((o) => o.value).join(','));
      comprobar(roles === 'consulta,investigador,operador,administrador', `${etiqueta}: el alta ofrece los cuatro perfiles de sitio`, roles);
      // Baja con motivo (el servidor lo exige) y, al intentar el alta con el mismo correo, el 409 `reactivable` ofrece «Reactivar»: vuelve
      // con una clave temporal nueva, que es la que usará la persona de consulta más abajo.
      const fila = p.locator(`[data-usuario="${caso.consulta.email}"]`);
      await fila.locator('[data-alternar-activo]').click();
      comprobar(await fila.locator('[data-confirmar-baja]').isDisabled(), `${etiqueta}: la baja sin motivo no se puede confirmar`);
      await fila.locator('[data-motivo-baja]').fill('prueba de baja y reactivación');
      await fila.locator('[data-confirmar-baja]').click();
      await p.waitForFunction((e) => document.querySelector(`[data-usuario="${e}"] [data-estado-usuario]`)?.textContent?.includes('inactivo'), caso.consulta.email, { timeout: 15000 });
      ok(`${etiqueta}: baja con motivo → la fila dice «inactivo»`);
      await p.locator('[data-alta-usuario]').getByLabel('Nombre').fill(caso.consulta.nombre);
      await p.locator('[data-alta-usuario]').getByLabel('Correo').fill(caso.consulta.email);
      await p.getByRole('button', { name: 'Dar de alta' }).click();
      await p.locator('[data-reactivar-alta]').click({ timeout: 15000 });
      await p.waitForFunction((anterior) => { const t = document.querySelector('[data-clave-temporal]')?.textContent?.trim(); return !!t && t !== anterior; }, otra, { timeout: 15000 });
      const vuelta = (await p.locator('[data-clave-temporal]').textContent()).trim();
      // La lista se recarga después de mostrar la clave: se espera a que la fila diga «activo» (sin esa espera, Firefox a veces leía la de antes).
      const activa = await p.waitForFunction((e) => { const s = document.querySelector(`[data-usuario="${e}"] [data-estado-usuario]`)?.textContent ?? ''; return s.includes('activo') && !s.includes('inactivo'); }, caso.consulta.email, { timeout: 15000 }).then(() => true, () => false);
      comprobar(/^[A-Za-z0-9_-]{24}$/.test(vuelta) && activa,
        `${etiqueta}: correo de una cuenta inactiva → «Reactivar» la deja activa con una clave temporal nueva`);
      await p.getByRole('button', { name: 'Ya la entregué: ocultar' }).click();
      caso.consulta.temporal = vuelta;
    });
  }

  await paso(`${etiqueta}: salir`, async () => {
    await abrirCuenta(p);
    await p.getByRole('button', { name: 'Salir', exact: true }).click();
    await p.getByRole('heading', { name: 'Entrar' }).waitFor({ timeout: 15000 });
    comprobar((await p.textContent('main')).includes('Cerraste la sesión.'), `${etiqueta}: «Salir» vuelve a «Entrar»`);
    comprobar((await p.evaluate(async () => (await fetch('/dispositivos')).status)) === 401, `${etiqueta}: después de salir, la API responde 401`);
    comprobar(!(await contexto.cookies()).some((c) => c.name === '__Host-sesion'), `${etiqueta}: la cookie se borró`);
  });

  if (caso.consulta?.temporal) {
    await paso(`${etiqueta}: consulta`, async () => {
      await entrar(p, caso.consulta.email, caso.consulta.temporal);
      await elegirClave(p, caso.consulta.nueva);
      await aceptarTerminos(p, `${etiqueta} (consulta)`);
      await p.evaluate(() => { location.hash = '#/inventario'; });
      await p.locator(`[data-id="${dispositivo}"] a`).click();
      const boton = p.getByRole('button', { name: 'Descargar CSV de este rango' });
      await boton.waitFor({ timeout: 15000 });
      comprobar(await boton.isDisabled(), `${etiqueta}: consulta ve «Descargar CSV» desactivado`);
      comprobar((await p.locator('[data-motivo-desactivado]').first().textContent()) === 'exportar exige el perfil de administrador o de investigador en este sitio', `${etiqueta}: … con el motivo escrito al lado`);
      comprobar((await p.getByRole('link', { name: 'Usuarios' }).count()) === 0, `${etiqueta}: consulta no ve «Usuarios»`);
      await foto(p, '5-consulta-ficha');
      comprobar((await p.locator('[data-ir-configurar]').count()) === 0, `${etiqueta}: consulta no ve «Configurar» en la ficha`);
      await abrirCuenta(p);
      await p.getByRole('button', { name: 'Cerrar en todos lados' }).click();
      await p.getByRole('heading', { name: 'Entrar' }).waitFor({ timeout: 15000 });
      ok(`${etiqueta}: «Cerrar en todos lados» vuelve a «Entrar»`);
    });
  }
  comprobar(errores.length === 0, `${etiqueta}: sin errores de JavaScript`, errores.join(' | ').slice(0, 300));
  await contexto.close();
}
await motor.close();
console.log(`${NAV}: ${comprobaciones - fallos} de ${comprobaciones} comprobaciones`);
process.exit(fallos === 0 ? 0 : 1);
