// P10 (sesión) en un navegador real con Playwright, contra la pila de desarrollo en http://127.0.0.1:3000 (docs/19 §4 y §6; docs/20;
// docs/16 §59). Lo lanza `plataforma/pruebas/panel-sesion-e2e.sh` (paso 4c del guardián), que crea las personas y el dispositivo de
// prueba, pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes ni se imprimen) y lo borra todo al final.
// Recorre, por cada caso (navegador × ancho): entrar con la clave temporal, cambiarla, ver el inventario y quién soy, abrir la ficha y
// exportar el CSV (descarga por Blob), la pantalla de usuarios (guía de perfiles, alta y «asignar clave temporal» con la temporal mostrada
// una vez y fuera de la lista), la sesión que
// vence (vuelve al inicio y, tras entrar, a la misma ficha) y salir. Un caso además entra como consulta y ve la exportación desactivada.
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const datos = JSON.parse(readFileSync(0, 'utf8'));
const { base, navegador: NAV, dispositivo, idFisico, capturas, casos } = datos;
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
// (revisión de privacidad del 08/11/2026: ni el largo de una clave de prueba se publica).
const MASCARA = ['[data-hora-sitio]', '.grafico', '[data-estado-usuario]', '[data-ultima-lectura]', 'input[type=password]'];
const foto = async (p, nombre) => {
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

for (const caso of casos) {
  const ancho = caso.ancho;
  const contexto = await motor.newContext({ viewport: { width: ancho, height: ancho < 500 ? 844 : 900 }, acceptDownloads: true, timezoneId: 'America/Santiago' });
  const p = await contexto.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e)));
  const etiqueta = `${ancho} px`;

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
  });

  await paso(`${etiqueta}: la sesión vence y se vuelve a la misma ficha`, async () => {
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
      await p.getByLabel('Nombre').fill(caso.consulta.nombre);
      await p.getByLabel('Correo').fill(caso.consulta.email);
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
      caso.consulta.temporal = otra;
    });
  }

  await paso(`${etiqueta}: salir`, async () => {
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
      await p.evaluate(() => { location.hash = '#/inventario'; });
      await p.locator(`[data-id="${dispositivo}"] a`).click();
      const boton = p.getByRole('button', { name: 'Descargar CSV de este rango' });
      await boton.waitFor({ timeout: 15000 });
      comprobar(await boton.isDisabled(), `${etiqueta}: consulta ve «Descargar CSV» desactivado`);
      comprobar((await p.locator('[data-motivo-desactivado]').first().textContent()) === 'exportar exige el rol administrador en este sitio', `${etiqueta}: … con el motivo escrito al lado`);
      comprobar((await p.getByRole('link', { name: 'Usuarios' }).count()) === 0, `${etiqueta}: consulta no ve «Usuarios»`);
      await foto(p, '5-consulta-ficha');
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
