// «Cargar en el equipo» (docs/19 §4, bloque Z), en navegadores reales con Playwright, contra la pila de desarrollo. Lo lanza
// `plataforma/pruebas/panel-cargar-e2e.sh`, que crea un sitio de descarte con la zona «Norte» y las personas de descarte (administración del
// sitio), pasa los datos por la ENTRADA ESTÁNDAR (las claves nunca van en la línea de órdenes ni se imprimen) y lo borra todo al final.
// No hay placa: en Chromium, el puerto serie es SIMULADO (un `navigator.serial` inyectado en la página que habla el protocolo del firmware,
// include/protocolo.h: saludo, configurar, estado, sus errores y su reinicio); en Firefox se QUITA `navigator.serial` de la página y se prueba lo
// que se ofrece a un navegador sin Web Serial (Safari, teléfonos). Medido el 25/11/2026: el Firefox 159 de Playwright sí expone Web Serial; la
// prueba lo informa en una nota. Por cada caso (navegador × ancho):
//   Z1  el alta de a uno por MQTT: la ficha de conexión con sus siete «Copiar», la clave oculta hasta «Mostrar la clave» (ni en el DOM, ni en el
//       almacenamiento, ni en la dirección), la descarga de la ficha en texto;
//   Z2  (Chromium) «Cargar en el equipo»: la red mal escrita no abre el selector; cancelar el selector; el permiso negado; el puerto ocupado (otro programa u otra
//       pestaña); un equipo que no es nuestro firmware (no contesta el protocolo) y uno de otro firmware; el equipo rechaza la clave de la red; el
//       cable se desconecta en medio de `configurar`; la clave de la red no sirve (el equipo no conecta: se adelanta el reloj de la página); y la
//       carga completa con ruido y una línea enorme en el cable: cargada → red → broker → primera trama (esta última, un evento del canal en vivo
//       entregado por la prueba), con DTR y RTS abajo, el puerto cerrado y su permiso soltado al terminar; recargar el mismo equipo con una
//       red mala (su sesión vieja sigue conectada hasta reiniciarse) termina en falla; uno cargado como otro pide escribir su identificador;
//   Z3  (Firefox, sin Web Serial) el botón no está: se dice por qué y se ofrecen copiar, descargar y el guion de terminal;
//   Z4  el alta masiva: «Cargar en el equipo» lista los creados por MQTT y cuenta aparte el de HTTP; en Chromium, carga uno de los dos;
//   en todo el recorrido, ninguna clave (la del equipo ni la de la red) en el DOM, el almacenamiento, la dirección, una petición al servidor o la
//   consola; sin desplazamiento horizontal ni errores de JavaScript. Al final da de baja (DELETE) cada equipo MQTT creado: borra su cliente del
//   broker; el guion de la prueba cuenta que no quede ninguno.
import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { chromium, firefox } from 'playwright';

const { base, navegador: NAV, prefijo: P, capturas, casos } = JSON.parse(readFileSync(0, 'utf8'));
const motores = { firefox, chromium };
if (!motores[NAV]) { console.log(`FALLA navegador ${NAV}: se admite firefox o chromium`); process.exit(2); }
const OCULTA = '••••••••••••';
// La versión que imita el equipo simulado: la de src/nodo.cpp (el verificador, paso 2y5, comprueba que coincidan).
const VERSION_FIRMWARE = '2.1.0';
const PROTOCOLO = 2;
const CLAVE_RED = `clave-de-red-falsa-${P}`; // de descarte: no es la de ninguna red
const RED = 'red-de-prueba-e2e';

let fallos = 0;
let total = 0;
const ok = (m) => { total++; console.log(`OK    [${NAV}] ${m}`); };
const falla = (m) => { total++; fallos++; console.log(`FALLA [${NAV}] ${m}`); };
const comprobar = (cond, m, detalle = '') => (cond ? ok(m) : falla(`${m}${detalle ? `: ${detalle}` : ''}`));
const limpio = (s) => (s ?? '').replace(/\s+/g, ' ').trim();

// El puerto serie simulado y el canal en vivo observable, inyectados antes de que cargue el panel. El equipo de detrás contesta como el firmware
// (src/nodo.cpp, protocolo 2): una respuesta por línea con el prefijo «@plataforma », su registro entre medio, cada escritura en dos trozos
// y, tras `configurar`, una ventana en la que SIGUE contestando con la configuración vieja (como el firmware mientras vacía la salida), un
// reinicio en el que lo que llega se pierde y otro `arranque`. `window.__e2e.opciones` elige cómo se porta el próximo equipo (`config`: lo que
// ya tiene cargado; `conectado`: su sesión vieja está conectada).
function inyectar({ sinSerie, VERSION_FIRMWARE, PROTOCOLO }) {
  const e2e = { opciones: {}, recibidas: [], pedidos: 0, aperturas: 0, abierto: false, olvidados: 0, senales: [], fuentes: [], serieNativa: 'serial' in navigator };
  Object.defineProperty(window, '__e2e', { value: e2e });
  const PREFIJO = '@plataforma ';
  class Puerto {
    constructor(o) {
      this.o = o; this.readable = null; this.writable = null; this.ctl = null; this.resto = ''; this.dormidoHasta = 0; this.estados = 0;
      this.config = o.config ?? null; this.conectado = o.config !== undefined && o.conectado === true; this.basura = o.basuraInicial === true;
      this.arranque = 7; this.reinicioEn = 0; this.configNueva = null;
    }
    async forget() { e2e.olvidados++; }
    quizasReiniciar() {
      if (this.reinicioEn === 0 || Date.now() < this.reinicioEn) return;
      this.reinicioEn = 0; this.arranque++; this.config = this.configNueva; this.configNueva = null; this.conectado = false; this.estados = 0;
      this.dormidoHasta = Date.now() + 300;
      this.escribir('reinicio: arranca con la configuración nueva\r\nets Jun  8 2016 00:22:57\r\n');
    }
    async open() {
      e2e.aperturas++;
      if (this.o.abrirFalla) throw new DOMException('Failed to open serial port.', 'NetworkError');
      e2e.abierto = true;
      this.readable = new ReadableStream({ start: (c) => { this.ctl = c; } });
      this.writable = new WritableStream({ write: (t) => this.recibir(t) });
    }
    async close() { e2e.abierto = false; try { this.ctl?.close(); } catch { /* ya cerrado */ } }
    async setSignals(s) { e2e.senales.push(s); }
    escribir(texto) {
      const b = typeof texto === 'string' ? new TextEncoder().encode(texto) : texto;
      const m = Math.floor(b.length / 2);
      setTimeout(() => { try { this.ctl?.enqueue(b.slice(0, m)); } catch { /* cerrado */ } }, 0);
      setTimeout(() => { try { this.ctl?.enqueue(b.slice(m)); } catch { /* cerrado */ } }, 1);
    }
    responder(r) {
      // Con ruido: 64 kB sin salto de línea y bytes que no son UTF-8 antes de cada respuesta (un registro roto o basura en el cable).
      if (this.o.ruido) this.escribir(new Uint8Array([0xff, 0xfe, ...new TextEncoder().encode('x'.repeat(65536)), 0xc3, 0x0d, 0x0a]));
      this.escribir(`registro: el equipo dice algo entre medio\r\n${PREFIJO}${JSON.stringify(r)}\r\n`);
    }
    recibir(t) {
      this.resto += new TextDecoder().decode(t);
      let i;
      while ((i = this.resto.indexOf('\n')) >= 0) {
        const linea = this.resto.slice(0, i);
        this.resto = this.resto.slice(i + 1);
        this.quizasReiniciar();
        if (Date.now() < this.dormidoHasta) continue; // reiniciándose
        if (this.o.mudo) { this.escribir('ets Jun  8 2016 00:22:57\r\nrst:0x1 (POWERON_RESET),boot:0x13\r\n'); continue; } // otro programa: nunca el protocolo
        if (this.basura) { this.basura = false; this.escribir(`${PREFIJO}{"ok":false,"orden":"","error":"json"}\r\n`); continue; } // un trozo viejo en su búfer
        this.atender(JSON.parse(linea));
      }
    }
    atender(o) {
      e2e.recibidas.push(o);
      if (o.orden === 'hola') {
        this.responder({ ok: true, orden: 'hola', firmware: this.o.firmware ?? 'nodo', version: VERSION_FIRMWARE, protocolo: this.o.protocolo ?? PROTOCOLO, arranque: this.arranque,
          configurado: this.config !== null, origen: this.config === null ? 'ninguno' : 'memoria', ...(this.config === null ? {} : { id: this.config.id }) });
      } else if (o.orden === 'configurar') {
        if (this.o.cortaEnConfigurar) { setTimeout(() => { try { this.ctl?.error(new DOMException('The device has been lost.', 'NetworkError')); } catch { /* ya */ } }, 5); return; }
        if (this.o.rechaza) { this.responder({ ok: false, orden: 'configurar', error: 'campo', campo: this.o.rechaza }); return; }
        this.configNueva = { id: o.id };
        this.responder({ ok: true, orden: 'configurar', reinicia: true });
        this.reinicioEn = Date.now() + 250; // la ventana vieja: sigue contestando con lo anterior
        setTimeout(() => this.quizasReiniciar(), 260);
      } else if (o.orden === 'estado') {
        this.estados++;
        const red = this.conectado || (this.reinicioEn === 0 && !this.o.sinRed && this.estados >= 2);
        const broker = this.conectado || (red && this.estados >= 3);
        this.responder({ ok: true, orden: 'estado', configurado: true, wifi: red ? 'conectado' : 'conectando', broker: broker ? 'conectado' : 'desconectado',
          ultimo_error: this.o.sinRed ? 'wifi' : 'ninguno', publicados: 0, fallidos: 0 });
      } else this.responder({ ok: false, orden: typeof o.orden === 'string' ? o.orden : '', error: 'orden' });
    }
  }
  if (sinSerie) {
    try { delete Navigator.prototype.serial; } catch { /* no estaba */ }
    try { Object.defineProperty(navigator, 'serial', { configurable: true, value: undefined }); } catch { /* ídem */ }
  } else {
    Object.defineProperty(navigator, 'serial', {
      configurable: true,
      value: {
        requestPort: async () => {
          e2e.pedidos++;
          if (e2e.opciones.cancelar) throw new DOMException('No port selected by the user.', 'NotFoundError');
          if (e2e.opciones.sinPermiso) throw new DOMException('Permission denied.', 'SecurityError');
          return new Puerto({ ...e2e.opciones });
        },
      },
    });
  }
  // El canal en vivo sigue siendo el real; además, cada EventSource queda a mano para entregarle «la primera trama».
  const Original = window.EventSource;
  window.EventSource = class extends Original {
    constructor(u, o) { super(u, o); e2e.fuentes.push({ url: String(u), fuente: this }); }
  };
}

const motor = await motores[NAV].launch();
console.log(`navegador: ${NAV} ${motor.version()}`);

for (const c of casos) {
  const A = c.ancho;
  const tag = `${NAV === 'chromium' ? 'c' : 'f'}${A}`;
  const tactil = A === 390 ? { hasTouch: true, isMobile: NAV === 'chromium' } : {};
  const ctx = await motor.newContext({ viewport: { width: A, height: A === 390 ? 844 : 800 }, acceptDownloads: true, locale: 'es-CL', ...tactil });
  await ctx.addInitScript(inyectar, { sinSerie: NAV === 'firefox', VERSION_FIRMWARE, PROTOCOLO });
  const p = await ctx.newPage();
  // El reloj de la página (Playwright): corre normal; se adelanta solo para no esperar 20 s o 90 s reales en dos casos de Z2.
  if (NAV === 'chromium') await p.clock.install();
  const errores = [];
  p.on('pageerror', (e) => errores.push(String(e).slice(0, 200)));
  const consola = [];
  p.on('console', (m) => consola.push(m.text()));
  p.on('dialog', (d) => void d.dismiss());
  const pedidos = [];
  p.on('request', (r) => pedidos.push({ url: r.url(), metodo: r.method(), cuerpo: r.postData() ?? '' }));
  const secretos = []; // la credencial de cada equipo creado y la clave de la red: nunca deben aparecer
  const dispositivos = []; // los MQTT creados, para darlos de baja al final
  const paso = async (nombre, f) => {
    try { await f(); } catch (e) {
      const visto = limpio(await p.textContent('main').catch(() => '')).slice(0, 240);
      falla(`${A} px, ${nombre}: se cortó (${e instanceof Error ? e.message.split('\n')[0] : String(e)})${visto ? ` · en pantalla: «${visto}»` : ''}`);
    }
  };
  const foto = async (nombre) => { if (capturas) await p.screenshot({ path: `${capturas}/cargar-${nombre}-${NAV}-${A}.png`, fullPage: true }); };
  const sinDesborde = async (donde) => {
    let sobra = 0;
    for (let i = 0; i < 3; i++) { sobra = Math.max(sobra, await p.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)); await p.waitForTimeout(100); }
    comprobar(sobra <= 0, `${A} px, ${donde}: sin desplazamiento horizontal`, `${sobra} px de más`);
  };
  // Ninguna clave en el HTML (texto y atributos), el almacenamiento o la dirección. El valor de un campo de contraseña no es parte del HTML.
  const sinClaves = async (donde, opciones = { credencialVisible: false }) => {
    const html = await p.content();
    const resto = await p.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + location.href + document.cookie);
    const enHtml = secretos.filter((s) => html.includes(s) && !(opciones.credencialVisible && s !== CLAVE_RED)).length;
    const enResto = secretos.filter((s) => resto.includes(s)).length;
    comprobar(secretos.length > 0 && enHtml === 0 && enResto === 0, `${A} px, ${donde}: ninguna clave en el DOM, el almacenamiento ni la dirección`, `en el DOM ${enHtml}, fuera ${enResto}`);
  };
  const filaDe = (idf) => `[data-equipo-carga="${idf}"]`;
  const estadoFila = (idf) => p.getAttribute(filaDe(idf), 'data-estado-carga');
  const esperarFin = (idf, ms = 30000) => p.waitForFunction((s) => ['falla', 'hecho'].includes(document.querySelector(s)?.getAttribute('data-estado-carga') ?? ''), filaDe(idf), { timeout: ms });
  const conectar = async (idf, opciones) => {
    await p.evaluate((o) => { window.__e2e.opciones = o; window.__e2e.recibidas.length = 0; window.__e2e.senales.length = 0; }, opciones);
    await p.click(`[data-conectar-cargar="${idf}"]`);
  };
  const fallaDe = async (idf) => limpio(await p.textContent(`${filaDe(idf)} [data-falla-carga]`).catch(() => ''));
  const ordenes = () => p.evaluate(() => window.__e2e.recibidas.map((o) => o.orden));

  // ── Entrar ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
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
    pedidos.length = 0; // lo que sigue ya no lleva las claves de la persona
  });
  const serie = await p.evaluate(() => ({ nativa: window.__e2e.serieNativa, ahora: navigator.serial !== undefined && navigator.serial !== null }));
  console.log(`nota  [${NAV}] ${A} px: este ${NAV} ${serie.nativa ? 'tiene' : 'no tiene'} Web Serial propio; la prueba ${NAV === 'firefox' ? 'lo quita' : 'lo simula'}`);
  comprobar(NAV === 'firefox' ? !serie.ahora : serie.ahora, `${A} px: ${NAV === 'firefox' ? 'sin' : 'con'} navigator.serial en la página (${NAV === 'firefox' ? 'quitado' : 'simulado'})`);

  // ── Z1: alta de a uno por MQTT; la ficha y la clave oculta ─────────────────────────────────────────────────────────────────────
  const uno = `${P}-${tag}-u`;
  await paso('Z1 alta de a uno', async () => {
    await p.evaluate(() => { location.hash = '#/alta'; });
    await p.locator('[data-campo="id_fisico"]').fill(uno);
    await p.locator('[data-campo="nombre"]').fill('Carga USB e2e');
    await p.locator('[data-siguiente]').click();
    await p.locator('[data-campo="via"]').selectOption('mqtt');
    await p.locator('[data-siguiente]').click();
    await p.locator('[data-campo="canal"]').fill('temperatura');
    const [resp] = await Promise.all([
      p.waitForResponse((r) => new URL(r.url()).pathname === '/dispositivos' && r.request().method() === 'POST', { timeout: 20000 }),
      p.getByRole('button', { name: 'Crear el dispositivo' }).click(),
    ]);
    const creado = await resp.json();
    comprobar(resp.status() === 201 && creado.conexion?.via === 'mqtt' && String(creado.conexion?.credencial ?? '').length >= 16, `${A} px, Z1: el alta por MQTT entrega la credencial una vez`, `HTTP ${resp.status()}`);
    secretos.push(String(creado.conexion.credencial), CLAVE_RED);
    dispositivos.push(creado.id);
    await p.locator('[data-ficha-conexion]').waitFor({ timeout: 15000 });
    const rotulos = await p.locator('[data-ficha-conexion] dt').allTextContents();
    comprobar(JSON.stringify(rotulos) === JSON.stringify(['Servidor', 'Puerto (MQTT sobre TLS)', 'Usuario', 'Identificador de cliente', 'Clave', 'Tópico', 'Formato'])
      && (await p.locator('[data-ficha-conexion] [data-copiar]').count()) === 7, `${A} px, Z1: la ficha de conexión, campo por campo, con siete «Copiar»`, rotulos.join(' · '));
    comprobar((await p.textContent('[data-credencial]')) === OCULTA, `${A} px, Z1: la clave se dibuja oculta`);
    await sinClaves('Z1 con la clave oculta');
    await p.click('[data-copiar="credencial"]');
    await p.waitForFunction(() => /Copiada/.test(document.querySelector('[data-copiar="credencial"]')?.textContent ?? '') || document.querySelector('[data-copiar-manual]') !== null, null, { timeout: 5000 });
    const manual = await p.$('[data-copiar-manual]');
    comprobar(manual === null || (await manual.textContent()).includes('Mostrar la clave'), `${A} px, Z1: «Copiar la credencial» copia sin dibujarla (o, si el navegador no deja, remite a «Mostrar la clave»)`,
      manual === null ? '' : limpio(await manual.textContent()));
    await sinClaves('Z1 tras copiar');
    await p.click('[data-ver-credencial]');
    comprobar((await p.textContent('[data-credencial]')) === secretos[0], `${A} px, Z1: «Mostrar la clave» la dibuja`);
    await p.click('[data-ver-credencial]');
    comprobar((await p.textContent('[data-credencial]')) === OCULTA && !(await p.content()).includes(secretos[0]), `${A} px, Z1: «Ocultar la clave» la saca del DOM`);
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-ficha]')]);
    const dir = mkdtempSync(join(tmpdir(), 'cargar-'));
    let texto = '';
    try { await d.saveAs(join(dir, 'ficha.txt')); texto = readFileSync(join(dir, 'ficha.txt'), 'utf8'); } finally { rmSync(dir, { recursive: true, force: true }); }
    comprobar(d.suggestedFilename() === `conexion-${uno}.txt` && texto.includes('TRAE LA CLAVE') && texto.includes(`Clave: ${secretos[0]}`) && texto.includes(`Usuario: ${uno}`),
      `${A} px, Z1: «Descargar la ficha» da conexion-<id>.txt con cada campo y el aviso de que trae la clave (el archivo se borra)`, d.suggestedFilename());
    await sinDesborde('Z1 ficha de conexión');
    await foto('ficha');
  });

  if (NAV === 'chromium') {
    // ── Z2: «Cargar en el equipo» con el puerto simulado ──────────────────────────────────────────────────────────────────────────
    await paso('Z2 la red se pide una vez', async () => {
      await p.click('[data-cargar-equipo]');
      await p.locator('[data-red-carga]').waitFor({ timeout: 5000 });
      // Enmascarada sin ser un campo de contraseña donde el navegador sabe enmascarar un texto (así no invita al gestor de contraseñas).
      const campo = await p.$eval('[data-campo-carga="clave_red"]', (x) => ({ tipo: x.type, mascara: getComputedStyle(x).getPropertyValue('-webkit-text-security') }));
      comprobar(campo.tipo === 'password' || (campo.tipo === 'text' && campo.mascara === 'disc'), `${A} px, Z2: la clave de la red se escribe oculta (${campo.tipo === 'text' ? 'texto enmascarado' : 'campo de contraseña'})`, JSON.stringify(campo));
      await p.fill('[data-campo-carga="red"]', RED);
      await p.fill('[data-campo-carga="clave_red"]', 'corta');
      await conectar(uno, {});
      await p.waitForFunction(() => (document.querySelector('[data-error-red-carga]')?.textContent ?? '') !== '', null, { timeout: 3000 });
      comprobar((await limpio(await p.textContent('[data-error-red-carga]'))).startsWith('Revisa la clave de la red') && (await p.evaluate(() => window.__e2e.pedidos)) === 0,
        `${A} px, Z2: una clave de red de menos de 8 caracteres se dice arriba, sin abrir el selector`, limpio(await p.textContent('[data-error-red-carga]')));
      await p.fill('[data-campo-carga="clave_red"]', CLAVE_RED);
      await sinClaves('Z2 con la clave de la red escrita');
      await sinDesborde('Z2 formulario de la red');
    });
    await paso('Z2 cancelar el selector', async () => {
      await conectar(uno, { cancelar: true });
      await esperarFin(uno, 5000);
      comprobar((await fallaDe(uno)).startsWith('No elegiste un puerto') && (await p.evaluate(() => window.__e2e.aperturas)) === 0,
        `${A} px, Z2: cerrar el selector sin elegir: «No elegiste un puerto…», sin abrir nada`, await fallaDe(uno));
    });
    await paso('Z2 permiso negado', async () => {
      await conectar(uno, { sinPermiso: true });
      await esperarFin(uno, 5000);
      comprobar((await fallaDe(uno)).startsWith('El navegador no dio permiso para usar el puerto serie'), `${A} px, Z2: si el navegador niega el permiso del sitio, lo dice (no «no elegiste»)`, await fallaDe(uno));
    });
    await paso('Z2 puerto ocupado', async () => {
      await conectar(uno, { abrirFalla: true });
      await esperarFin(uno, 5000);
      comprobar((await fallaDe(uno)).startsWith('No se pudo abrir el puerto: si otro programa'), `${A} px, Z2: el puerto ocupado (un monitor serie u otra pestaña): lo dice y cómo seguir`, await fallaDe(uno));
    });
    await paso('Z2 otro firmware', async () => {
      await conectar(uno, { firmware: 'tasmota' });
      await esperarFin(uno, 10000);
      comprobar((await fallaDe(uno)).includes('no tiene el firmware de la plataforma') && !(await ordenes()).includes('configurar'),
        `${A} px, Z2: un equipo con otro firmware no recibe la carga («…grábalo primero»)`, `${await fallaDe(uno)} · ${(await ordenes()).join(',')}`);
    });
    await paso('Z2 no es nuestro firmware', async () => {
      await conectar(uno, { mudo: true });
      await p.waitForFunction(() => window.__e2e.recibidas.length === 0 && window.__e2e.aperturas > 0 && window.__e2e.abierto, null, { timeout: 5000 });
      await p.waitForTimeout(500);
      await p.clock.fastForward(21000); // los 20 s de saludo, sin esperarlos
      await esperarFin(uno, 15000);
      comprobar((await fallaDe(uno)).startsWith('El equipo no responde') && (await p.evaluate(() => window.__e2e.abierto)) === false,
        `${A} px, Z2: un equipo que no habla el protocolo (solo su registro de arranque): «El equipo no responde…» y el puerto queda cerrado`, await fallaDe(uno));
    });
    await paso('Z2 rechaza la clave de la red', async () => {
      await conectar(uno, { rechaza: 'clave_red' });
      await esperarFin(uno, 10000);
      comprobar((await fallaDe(uno)).startsWith('No se cargó nada: revisa la clave de la red') && (await estadoFila(uno)) === 'falla'
        && limpio(await p.textContent(`${filaDe(uno)} [data-texto-carga]`)) === 'Sin cargar', `${A} px, Z2: el equipo rechaza la clave de la red: «No se cargó nada: revisa la clave de la red…»`, await fallaDe(uno));
    });
    await paso('Z2 cable desconectado en configurar', async () => {
      await conectar(uno, { cortaEnConfigurar: true });
      await esperarFin(uno, 10000);
      comprobar((await fallaDe(uno)).startsWith('El equipo no confirmó la carga') && limpio(await p.textContent(`${filaDe(uno)} [data-texto-carga]`)) === 'Sin cargar'
        && (await p.evaluate(() => window.__e2e.abierto)) === false, `${A} px, Z2: el cable se desconecta en medio de «configurar»: no se da por cargado y el puerto queda cerrado`, await fallaDe(uno));
    });
    await paso('Z2 la clave de la red no sirve', async () => {
      await conectar(uno, { sinRed: true });
      await p.waitForSelector(`${filaDe(uno)} [data-paso-carga="cargada"][data-hecho="true"]`, { timeout: 15000 });
      await p.waitForFunction(() => window.__e2e.recibidas.filter((o) => o.orden === 'estado').length >= 2, null, { timeout: 15000 });
      await p.clock.fastForward(91000); // los 90 s que espera la conexión
      await esperarFin(uno, 15000);
      comprobar((await fallaDe(uno)) === 'No encuentra la red o la clave de la red no es correcta.' && limpio(await p.textContent(`${filaDe(uno)} [data-texto-carga]`)) === 'Cargado, sin conectar',
        `${A} px, Z2: la red no acepta la clave: cargada, «No encuentra la red o la clave de la red no es correcta.» y «Cargado, sin conectar»`, await fallaDe(uno));
    });
    await paso('Z2 recargar el mismo equipo con una red mala', async () => {
      // El caso que el firmware anterior dejaba pasar: el equipo ya tiene este identificador y su sesión vieja está conectada; tras
      // `configurar` sigue contestando con ella hasta reiniciarse. Debe terminar en falla, nunca en «el broker la aceptó».
      await conectar(uno, { config: { id: uno }, conectado: true, sinRed: true });
      await p.waitForSelector(`${filaDe(uno)} [data-paso-carga="cargada"][data-hecho="true"]`, { timeout: 15000 });
      await p.waitForFunction(() => window.__e2e.recibidas.filter((o) => o.orden === 'estado').length >= 2, null, { timeout: 15000 });
      await p.clock.fastForward(91000);
      await esperarFin(uno, 15000);
      const pasos = await p.$$eval(`${filaDe(uno)} [data-paso-carga]`, (es) => es.map((e) => `${e.getAttribute('data-paso-carga')}:${e.getAttribute('data-hecho')}`));
      comprobar((await fallaDe(uno)) === 'No encuentra la red o la clave de la red no es correcta.' && pasos.join(' ') === 'cargada:true red:false broker:false trama:false',
        `${A} px, Z2: recargar el mismo identificador con una red mala termina en falla, no en «el broker la aceptó» (la sesión vieja no cuenta)`, `${pasos.join(' ')} · ${await fallaDe(uno)}`);
    });
    await paso('Z2 equipo con otro identificador', async () => {
      await conectar(uno, { config: { id: `${P}-ajeno` } });
      await p.waitForSelector(`[data-reemplazo="${uno}"]`, { timeout: 10000 });
      const boton = `[data-reemplazo="${uno}"] [data-confirmar-reemplazo]`;
      comprobar(limpio(await p.textContent(`[data-reemplazo="${uno}"]`)).includes(`ya está cargado como ${P}-ajeno`) && (await p.isDisabled(boton)),
        `${A} px, Z2: un equipo cargado como otro: lo nombra y «Reemplazar» no se puede pulsar sin escribir su identificador`);
      await p.fill(`[data-reemplazo="${uno}"] [data-confirmar-actual]`, `${P}-ajen`);
      const sigue = await p.isDisabled(boton);
      await p.click(`[data-reemplazo="${uno}"] [data-no-reemplazar]`);
      await esperarFin(uno, 10000);
      comprobar(sigue && (await fallaDe(uno)) === `No se cargó nada: el equipo sigue cargado como ${P}-ajeno.` && !(await ordenes()).includes('configurar'),
        `${A} px, Z2: mal escrito no habilita; «No reemplazar» no le manda nada`, await fallaDe(uno));
      await sinDesborde('Z2 pedido de reemplazo');
    });
    await paso('Z2 carga completa', async () => {
      await conectar(uno, { ruido: true, basuraInicial: true });
      await p.waitForSelector(`${filaDe(uno)}[data-estado-carga="cargando"]`, { timeout: 5000 });
      await sinClaves('Z2 durante la carga');
      await esperarFin(uno, 40000);
      const pasos = await p.$$eval(`${filaDe(uno)} [data-paso-carga]`, (es) => es.map((e) => `${e.getAttribute('data-paso-carga')}:${e.getAttribute('data-hecho')}`));
      comprobar((await estadoFila(uno)) === 'hecho' && pasos.join(' ') === 'cargada:true red:true broker:true trama:false',
        `${A} px, Z2: con ruido, una línea de 64 kB y un trozo viejo en el búfer: cargada → red → broker; espera la primera trama`, `${await estadoFila(uno)} · ${pasos.join(' ')} · ${await fallaDe(uno)}`);
      const r = await p.evaluate(({ id, sitio, clave, red, claveRed }) => {
        const conf = window.__e2e.recibidas.find((o) => o.orden === 'configurar');
        return { primero: window.__e2e.recibidas[0]?.orden, conf: conf !== undefined && conf.id === id && conf.sitio === sitio && conf.clave === clave && conf.red === red && conf.clave_red === claveRed && conf.puerto === 8883,
          senales: JSON.stringify(window.__e2e.senales), abierto: window.__e2e.abierto };
      }, { id: uno, sitio: c.sitio, clave: secretos[0], red: RED, claveRed: CLAVE_RED });
      comprobar(r.primero === 'hola' && r.conf, `${A} px, Z2: primero saluda; «configurar» lleva la red, su clave, el puerto 8883, el sitio, el identificador y la credencial del alta`);
      comprobar(r.senales === '[{"dataTerminalReady":false,"requestToSend":false}]' && !r.abierto, `${A} px, Z2: baja DTR y RTS al abrir y cierra el puerto al terminar`, `${r.senales} · abierto ${r.abierto}`);
      comprobar((await p.evaluate(() => window.__e2e.olvidados)) > 0, `${A} px, Z2: al terminar suelta el permiso del puerto (forget)`);
      // La primera trama: el panel escucha el canal en vivo del equipo nuevo; la prueba le entrega una medición (no hay equipo real).
      const entregada = await p.evaluate((id) => {
        const f = window.__e2e.fuentes.find((x) => x.url.includes(`/eventos?dispositivo=${encodeURIComponent(id)}`));
        if (f === undefined) return false;
        f.fuente.dispatchEvent(new MessageEvent('medicion', { data: JSON.stringify({ dispositivo_id: id, canal_id: '00000000-0000-4000-8000-0000000000c1', valor: 21.5, tiempo: new Date().toISOString(), sitio_id: null }) }));
        return true;
      }, dispositivos[0]);
      comprobar(entregada, `${A} px, Z2: tras «cargada», el panel abrió el canal en vivo de ESE equipo`);
      await p.waitForSelector(`${filaDe(uno)} [data-paso-carga="trama"][data-hecho="true"]`, { timeout: 5000 });
      comprobar(limpio(await p.textContent(`${filaDe(uno)} [data-texto-carga]`)) === 'Listo: ya envía datos', `${A} px, Z2: con la primera trama, «Listo: ya envía datos»`);
      await sinDesborde('Z2 avance de la carga');
      await foto('carga');
    });
  } else {
    // ── Z3: sin Web Serial ───────────────────────────────────────────────────────────────────────────────────────────────────────
    await paso('Z3 sin puerto serie', async () => {
      const t = limpio(await p.textContent('[data-sin-serie]'));
      comprobar(t.includes('no está disponible en este navegador') && t.includes('Chrome, Edge y Opera') && t.includes('copia los datos o descarga la ficha') && t.includes('herramientas/cargar-equipo.py'),
        `${A} px, Z3: sin Web Serial, dice por qué y ofrece copiar, descargar y el guion de terminal`, t);
      comprobar((await p.$('[data-cargar-equipo]')) === null && (await p.locator('[data-ficha-conexion] [data-copiar]').count()) === 7 && (await p.$('[data-descargar-ficha]')) !== null,
        `${A} px, Z3: sin el botón «Cargar en el equipo»; con los siete «Copiar» y «Descargar la ficha»`);
    });
  }
  await sinClaves('al terminar el alta de a uno');

  // ── Z4: el alta masiva ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  await paso('Z4 alta masiva', async () => {
    await p.evaluate(() => { location.hash = '#/alta?modo=lote'; });
    await p.waitForSelector('[data-pegado]', { timeout: 10000 });
    const ids = [`${P}-${tag}-l1`, `${P}-${tag}-l2`, `${P}-${tag}-l3`];
    await p.fill('[data-pegado]', ['id_fisico\tnombre\tzona\tvia\tformato\tintervalo_esperado_s\tcanales',
      `${ids[0]}\tLote USB 1\tNorte\tmqtt\tsenml\t300\ttemperatura`, `${ids[1]}\tLote USB 2\tNorte\tmqtt\tsenml\t300\ttemperatura`, `${ids[2]}\tLote USB 3\tNorte\thttp\tsenml\t300\ttemperatura`].join('\n'));
    await p.click('[data-leer-pegado]');
    await p.waitForFunction(() => /3 filas leídas/.test(document.querySelector('[data-filas-leidas]:not([data-leyendo])')?.textContent ?? ''), null, { timeout: 10000 });
    await p.click('[data-revisar]');
    await p.waitForSelector('[data-paso-lote="2"] [data-informe-lote]', { timeout: 15000 });
    const [resp] = await Promise.all([
      p.waitForResponse((r) => new URL(r.url()).pathname === '/dispositivos/lote' && r.request().method() === 'POST', { timeout: 30000 }),
      p.click('[data-crear-lote="arriba"]'),
    ]);
    const cuerpo = await resp.json().catch(() => ({}));
    const filas = Array.isArray(cuerpo.credenciales) ? cuerpo.credenciales : Array.isArray(cuerpo.filas) ? cuerpo.filas : Array.isArray(cuerpo) ? cuerpo : [];
    for (const f of filas) {
      if (typeof f?.credencial === 'string' && f.credencial !== '') secretos.push(f.credencial);
      if (typeof f?.id === 'string' && (f.via === 'mqtt' || String(f.destino ?? f.topico ?? '').startsWith('sitio/'))) dispositivos.push(f.id);
    }
    await p.waitForSelector('[data-paso-lote="3"]', { timeout: 20000 });
    comprobar(secretos.length >= 5, `${A} px, Z4: el lote creó 3 (2 por MQTT y 1 por HTTP) con su credencial`, `${secretos.length - 2} credenciales en la respuesta`);
    if (NAV === 'chromium') {
      await p.click('[data-paso-lote="3"] [data-cargar-equipo]');
      await p.locator('[data-red-carga]').waitFor({ timeout: 5000 });
      const filasCarga = await p.$$eval('[data-equipo-carga]', (es) => es.map((e) => e.getAttribute('data-equipo-carga')));
      comprobar(JSON.stringify(filasCarga) === JSON.stringify(ids.slice(0, 2)) && limpio(await p.textContent('[data-otros-carga]')).startsWith('1 creado no va por MQTT')
        && limpio(await p.textContent('[data-resumen-carga]')).startsWith('0 de 2 cargados'), `${A} px, Z4: lista los 2 creados por MQTT y cuenta aparte el de HTTP («0 de 2 cargados»)`, filasCarga.join(' '));
      await p.fill('[data-campo-carga="red"]', RED);
      await p.fill('[data-campo-carga="clave_red"]', CLAVE_RED);
      await conectar(ids[0], {});
      await p.waitForSelector(`${filaDe(ids[0])}[data-estado-carga="cargando"]`, { timeout: 5000 });
      comprobar(await p.isDisabled(`[data-conectar-cargar="${ids[1]}"]`) || (await p.getAttribute(`[data-conectar-cargar="${ids[1]}"]`, 'aria-disabled')) === 'true',
        `${A} px, Z4: mientras carga uno, el otro espera (de a un equipo)`);
      await esperarFin(ids[0], 40000);
      comprobar((await estadoFila(ids[0])) === 'hecho' && limpio(await p.textContent('[data-resumen-carga]')).startsWith('1 de 2 cargados'), `${A} px, Z4: cargado el primero, «1 de 2 cargados»`, await fallaDe(ids[0]));
      comprobar(await p.evaluate((x) => window.__e2e.recibidas.find((o) => o.orden === 'configurar')?.id === x, ids[0]), `${A} px, Z4: «configurar» llevó el identificador de esa fila`);
      // El equipo equivocado en la fila 2 (ya cargado como el de la fila 1): no se reemplaza por descuido; escribiéndolo, sí.
      await conectar(ids[1], { config: { id: ids[0] } });
      await p.waitForSelector(`[data-reemplazo="${ids[1]}"]`, { timeout: 10000 });
      const boton = `[data-reemplazo="${ids[1]}"] [data-confirmar-reemplazo]`;
      const antes = await p.isDisabled(boton);
      await p.fill(`[data-reemplazo="${ids[1]}"] [data-confirmar-actual]`, ids[0]);
      await p.click(boton);
      await esperarFin(ids[1], 40000);
      comprobar(antes && (await estadoFila(ids[1])) === 'hecho' && (await p.evaluate((x) => window.__e2e.recibidas.find((o) => o.orden === 'configurar')?.id === x, ids[1])),
        `${A} px, Z4: el equipo de otra fila conectado por error: sin escribir su identificador no se reemplaza; escrito, se carga`, await fallaDe(ids[1]));
    } else {
      const t = limpio(await p.textContent('[data-paso-lote="3"] [data-sin-serie]'));
      comprobar(t.includes('no está disponible en este navegador') && t.includes('el archivo de credenciales'), `${A} px, Z4: sin Web Serial, el lote remite al archivo de credenciales`, t);
    }
    await sinClaves('Z4 resultado del lote');
    await sinDesborde('Z4 resultado del lote');
    await foto('lote');
    const [d] = await Promise.all([p.waitForEvent('download', { timeout: 10000 }), p.click('[data-descargar-credenciales]')]);
    await d.delete(); // de descarte: no se guardan
    await p.click('[data-olvidar-credenciales]');
    await p.waitForSelector('[data-sin-credenciales]', { timeout: 5000 });
  });

  // ── Ninguna clave salió de la página; baja de los equipos MQTT (su cliente del broker se borra) ─────────────────────────────────
  const fuera = pedidos.filter((r) => secretos.some((s) => r.url.includes(s) || r.cuerpo.includes(s))).map((r) => `${r.metodo} ${new URL(r.url).pathname}`);
  comprobar(pedidos.length > 0 && fuera.length === 0, `${A} px: ninguna clave (del equipo ni de la red) en las ${pedidos.length} peticiones de la página`, fuera.join(' · '));
  comprobar(!consola.some((m) => secretos.some((s) => m.includes(s))), `${A} px: ninguna clave en la consola (${consola.length} mensajes)`);
  await paso('baja', async () => {
    const r = await p.evaluate(async (ids) => {
      const h = { accept: 'application/json', 'X-Pedido': 'panel' };
      const s = [];
      for (const id of ids) s.push((await fetch(`/dispositivos/${id}`, { method: 'DELETE', headers: h })).status);
      return s;
    }, dispositivos);
    comprobar(dispositivos.length === 3 && r.every((s) => s === 200), `${A} px: los ${dispositivos.length} equipos MQTT creados se dan de baja (su cliente del broker se borra)`, r.join(','));
  });
  comprobar(errores.length === 0, `${A} px: sin errores de JavaScript en la página`, errores.join(' | '));
  secretos.length = 0;
  await ctx.close();
}
await motor.close();
console.log(fallos === 0 ? `\nCARGAR EN EL EQUIPO OK (${total} de ${total} comprobaciones, ${NAV})` : `\n${fallos} de ${total} comprobación(es) con falla (${NAV})`);
process.exit(fallos === 0 ? 0 : 1);
