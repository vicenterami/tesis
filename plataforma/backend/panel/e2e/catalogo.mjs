// P16 «Catálogo» (TT-12; docs/19 §4, T, punto 11), en navegadores reales con Playwright, contra la pila de desarrollo. Lo lanza
// `plataforma/pruebas/panel-catalogo-e2e.sh`, que crea un sitio con un equipo cuyo canal es de una magnitud de descarte con umbral sugerido, y
// las personas de descarte (administrador del sistema); pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes) y
// lo borra todo al final, también las magnitudes y recetas que esta prueba crea. Por caso (navegador × ancho): crear una magnitud, achicar su
// rango (sin mediciones: guarda sin preguntar), crear y probar una receta (y el resultado tachado al cambiarla), y en P6 «Usar el sugerido» llena
// una regla sin guardar; sin desplazamiento horizontal ni errores de JavaScript.
import { readFileSync } from 'node:fs';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, corrida, dispositivo, magnitudP6, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
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
    const c = await fetch('/terminos/aceptar', { method: 'POST', headers: h, body: JSON.stringify({ version: t.version }) });
    return c.ok ? 'ok' : `POST /terminos/aceptar ${c.status}`;
  }, c);
  if (r !== 'ok') throw new Error(`no se pudo entrar: ${r}`);
};

for (const c of casos) {
  const ctx = await motor.newContext({ viewport: { width: c.ancho, height: 900 }, locale: 'es-CL' });
  const p = await ctx.newPage();
  paginaActual = p;
  const errores = [];
  p.on('pageerror', (e) => errores.push(e.message));
  const sufijo = `${corrida}_${c.ancho}`;
  const codigoM = `e2e_${sufijo}`;
  const codigoR = `e2e-${sufijo.replace(/_/g, '-')}`;
  await paso(`${c.ancho} px: entrar como administrador del sistema`, () => iniciar(p, c));

  await paso(`${c.ancho} px: «Catálogo» en el menú y la lista de magnitudes`, async () => {
    await p.goto(`${base}/panel/#/catalogo`);
    await p.reload(); // la sesión se lee al cargar: entrar por la API no la cambia en una página ya abierta (como e2e/exportar.mjs)
    await p.waitForSelector('[data-lista-magnitudes]');
    comprobar((await p.locator('[data-magnitud="temperatura"]').count()) === 1, `${c.ancho} px: la lista trae la temperatura`);
    comprobar((await p.locator('[data-ir-catalogo]').count()) === 1, `${c.ancho} px: «Catálogo» está en el menú del administrador del sistema`);
    await sinDesborde(p, `${c.ancho} px, magnitudes`);
    await foto(p, 'catalogo-magnitudes');
  });

  await paso(`${c.ancho} px: crear una magnitud`, async () => {
    await p.click('[data-crear-magnitud]');
    await p.fill('[data-form-magnitud] [data-campo="codigo"]', codigoM);
    await p.selectOption('[data-form-magnitud] [data-campo="unidad"]', 'W/m2');
    await p.fill('[data-form-magnitud] [data-campo="nombre"]', `Radiación de prueba ${sufijo}`);
    await p.fill('[data-form-magnitud] [data-campo="rango_min"]', '0');
    await p.fill('[data-form-magnitud] [data-campo="rango_max"]', '1500');
    await p.fill('[data-form-magnitud] [data-campo="alias-nuevo"]', `${codigoM}_W`);
    await p.click('[data-agregar-alias]');
    await sinDesborde(p, `${c.ancho} px, formulario de magnitud`);
    await foto(p, 'catalogo-crear-magnitud');
    await p.click('[data-guardar-magnitud]');
    await p.waitForSelector(`[data-magnitud="${codigoM}"]`);
    const fila = limpio(await p.textContent(`[data-magnitud="${codigoM}"]`));
    // El panel escribe los miles como en Chile («1.500»).
    comprobar(fila.includes('de 0 a 1.500') && fila.includes(`${codigoM}_w`), `${c.ancho} px: la magnitud nueva aparece con su rango y su alias en minúsculas`, fila);
    comprobar(limpio(await p.textContent('[data-seccion-magnitudes] [data-aviso="exito"]')).includes('Rige desde la próxima trama'), `${c.ancho} px: «Guardado. Rige desde la próxima trama.»`);
  });

  await paso(`${c.ancho} px: achicar el rango sin mediciones guarda sin preguntar`, async () => {
    await p.click(`[data-editar-magnitud="${codigoM}"]`);
    await p.fill('[data-form-magnitud] [data-campo="rango_max"]', '1000');
    await p.click('[data-guardar-magnitud]');
    await p.waitForSelector('[data-seccion-magnitudes] [data-aviso="exito"]');
    comprobar((await p.locator('[data-confirmar-rango]').count()) === 0 && limpio(await p.textContent(`[data-magnitud="${codigoM}"]`)).includes('de 0 a 1.000'),
      `${c.ancho} px: el rango quedó de 0 a 1000, sin confirmación (0 mediciones afectadas)`);
  });

  await paso(`${c.ancho} px: crear y probar una receta`, async () => {
    await p.click('[data-pestana="recetas"]');
    await p.waitForSelector('[data-lista-recetas], [data-sin-recetas]');
    await p.click('[data-crear-receta]');
    await p.fill('[data-form-receta] [data-campo="codigo"]', codigoR);
    await p.fill('[data-form-receta] [data-campo="nombre"]', `Receta de prueba ${sufijo}`);
    await p.fill('[data-form-receta] [data-campo="largo_bytes"]', '2');
    await p.selectOption('[data-campo-receta="0"] [data-campo="magnitud"]', codigoM);
    await p.selectOption('[data-campo-receta="0"] [data-campo="tipo"]', 'u16be');
    await p.fill('[data-campo-receta="0"] [data-campo="dividir_por"]', '10');
    comprobar(limpio(await p.textContent('[data-formula="0"]')) === 'valor = (crudo + 0) × 1 ÷ 10', `${c.ancho} px: la fórmula al día`);
    await p.fill('[data-form-receta] [data-campo="bytes"]', '03 E8');
    await p.click('[data-probar]');
    await p.waitForSelector('[data-resultado-prueba="al-dia"]');
    comprobar(limpio(await p.textContent('[data-resultado-prueba="al-dia"]')).includes('100'), `${c.ancho} px: probar 03 E8 con u16be ÷ 10 → 100`);
    await p.fill('[data-campo-receta="0"] [data-campo="dividir_por"]', '100');
    comprobar((await p.locator('[data-resultado-prueba="viejo"] [data-prueba-vieja]').count()) === 1, `${c.ancho} px: al cambiar la receta, el resultado se tacha («vuelve a probar»)`);
    await sinDesborde(p, `${c.ancho} px, formulario de receta`);
    await foto(p, 'catalogo-crear-receta');
    await p.click('[data-guardar-receta]');
    await p.waitForSelector(`[data-receta="${codigoR}"]`);
    comprobar(limpio(await p.textContent(`[data-receta="${codigoR}"]`)).includes('2 bytes'), `${c.ancho} px: la receta nueva aparece en la lista`);
    await sinDesborde(p, `${c.ancho} px, recetas`);
  });

  await paso(`${c.ancho} px: «Usar el sugerido» en P6`, async () => {
    await p.goto(`${base}/panel/#/dispositivos/${dispositivo}/configurar`);
    await p.reload();
    const boton = p.locator('[data-usar-sugerido]').first();
    await boton.waitFor();
    comprobar(limpio(await boton.textContent()).includes('alto 40'), `${c.ancho} px: el botón dice el sugerido de la magnitud (${magnitudP6})`);
    const antes = await p.locator('[data-regla]').count();
    await boton.click();
    comprobar((await p.locator('[data-regla]').count()) === antes + 1, `${c.ancho} px: llena una regla nueva, sin guardar`);
    await sinDesborde(p, `${c.ancho} px, P6`);
    await foto(p, 'p6-sugerido');
  });
  comprobar(errores.length === 0, `${c.ancho} px: sin errores de JavaScript`, errores.join(' | '));
  await ctx.close();
}
await motor.close();
process.exit(fallos === 0 ? 0 : 1);
