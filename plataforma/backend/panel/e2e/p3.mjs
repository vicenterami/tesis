// Pantalla P3 (ficha del dispositivo) en un navegador real: Firefox con Playwright, contra el banco (docs/19 §6 y §7, fila P3;
// docs/16 §39). Lo lanza `banco.sh navegador`, que siembra el histórico y pasa los datos; no se corre suelto contra la pila de
// desarrollo (detiene y arranca el backend del banco).
//   node e2e/p3.mjs <url_base> <dispositivo_id> <canal_id> <id_fisico> <sitio> <red_docker> <imagen_broker> <contenedor_backend> <captura.png>
import { firefox } from 'playwright';
import { execFileSync } from 'node:child_process';

const [BASE, dispId, canalId, idFisico, sitio, red, imagen, backend, captura] = process.argv.slice(2);
if (!captura) {
  console.log('FALLA faltan argumentos (ver la cabecera de e2e/p3.mjs)');
  process.exit(2);
}
let fallos = 0;
const ok = (m) => console.log(`OK    ${m}`);
const falla = (m) => { console.log(`FALLA ${m}`); fallos++; };
const docker = (...args) => execFileSync('docker', args, { stdio: 'ignore' });
// Publica como un emulado anónimo del banco (rol «emulado»: solo sitio/+/dispositivo/+/+), con la marca del emisor EN MILISEGUNDOS
// (SenML admite decimales en bt): dos lecturas en el mismo segundo serían, por la regla de idempotencia (docs/10 §4.1), la misma
// lectura, y la segunda se ignoraría como duplicada (pasó en la segunda corrida del 16/10).
const publicar = (valor) => docker('run', '--rm', '--network', red, imagen, 'mosquitto_pub', '-h', 'mosquitto', '-q', '1',
  '-t', `sitio/${sitio}/dispositivo/${idFisico}/temperatura`,
  '-m', JSON.stringify([{ bn: idFisico, bt: Date.now() / 1000, n: 'temperatura', u: 'Cel', v: valor }]));
const tarjeta = `[data-canal-id="${canalId}"]`;
const lecturaEs = (texto, ms) => pagina.waitForFunction(([sel, t]) => document.querySelector(`${sel} [data-ultima]`)?.textContent === t, [tarjeta, texto], { timeout: ms });
// El estado del canal en vivo se lee en su propio elemento (`p[data-canal]`, que también lleva el botón de pausa), no en toda la
// página: el atributo dice el estado y el texto, lo que ve la persona (revisión del 16/10).
const textoVisible = (texto, ms) => pagina.waitForFunction((t) => (document.querySelector('p[data-canal]')?.textContent ?? '').trim().startsWith(t), texto, { timeout: ms });

const navegador = await firefox.launch();
const pagina = await navegador.newPage({ viewport: { width: 1280, height: 900 } });
const errores = [];
pagina.on('pageerror', (e) => errores.push(String(e)));
// Peticiones de histórico que hace la página: al reconectar debe pedirlo de nuevo (docs/19 F4).
let pedidosHistorico = 0;
pagina.on('request', (r) => { if (r.url().includes(`/canales/${canalId}/historico`)) pedidosHistorico++; });
try {
  await pagina.goto(`${BASE}/panel/#/dispositivos/${dispId}`);
  await pagina.waitForSelector('[data-historico]', { timeout: 15000 });
  // La ficha abre el primer canal en orden alfabético: se elige la temperatura con un clic, como lo haría una persona.
  await pagina.click(tarjeta);
  await pagina.waitForFunction((sel) => document.querySelector(sel)?.getAttribute('aria-pressed') === 'true', tarjeta, { timeout: 15000 });
  await pagina.waitForFunction(() => !(document.querySelector('[data-historico]')?.textContent ?? '').startsWith('0 puntos'), null, { timeout: 15000 }).catch(() => {});
  // 1. Los puntos del gráfico son los de /historico (mismo rango por defecto: 24 h cada 15 minutos).
  const api = await (await fetch(`${BASE}/canales/${canalId}/historico`)).json();
  const texto = await pagina.textContent('[data-historico]');
  const puntosGrafico = Number(await pagina.getAttribute('.grafico', 'data-puntos'));
  if (api.puntos >= 3 && texto.startsWith(`${api.puntos} puntos`) && puntosGrafico === api.puntos) ok(`el gráfico tiene los ${api.puntos} puntos de /historico (en el texto y en el gráfico)`);
  else falla(`puntos: API ${api.puntos}, texto «${texto}», gráfico ${puntosGrafico}`);
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
  await lecturaEs('27,5 Cel', 15000).then(() => ok('una trama publicada por MQTT aparece en su tarjeta sin recargar (27,5 Cel)'), () => falla('la lectura en vivo no apareció'));
  // 4. Caída del backend: «reconectando»; lo publicado mientras tanto aparece al volver, porque la ficha se repide (docs/19 F4).
  const historicosAntes = pedidosHistorico;
  docker('stop', backend);
  try {
    await textoVisible('en vivo: reconectando', 20000).then(() => ok('con el backend detenido, la ficha dice «reconectando»'), () => falla('no mostró «reconectando»'));
    publicar(28.25);
  } finally {
    docker('start', backend); // pase lo que pase, el banco no queda con el backend detenido (revisión del 16/10)
  }
  await lecturaEs('28,25 Cel', 60000).then(() => ok('al volver el backend, la ficha muestra la lectura publicada durante la caída (28,25 Cel)'), () => falla('la lectura de la caída no apareció'));
  await textoVisible('en vivo: conectado', 30000).then(() => ok('y el canal vuelve a «conectado»'), () => falla('el canal no volvió a «conectado»'));
  // Al reconectar también se repide el histórico con una ventana nueva: debe traer las lecturas recién guardadas (más puntos que
  // antes). Sin esperarlo, la captura salía antes de esa respuesta y parecía que faltaban (visto en la primera corrida, 16/10).
  // Se comprueba por la petición que hace la página (no por el número de puntos, que no sube si las lecturas nuevas caen en un bloque
  // de 15 minutos que ya existía) y después que el texto diga los puntos que la API tiene ahora.
  const hasta = Date.now() + 30000;
  while (pedidosHistorico === historicosAntes && Date.now() < hasta) await pagina.waitForTimeout(250);
  await pagina.waitForTimeout(500);
  const ahoraApi = await (await fetch(`${BASE}/canales/${canalId}/historico`)).json();
  const textoAhora = await pagina.textContent('[data-historico]');
  if (pedidosHistorico > historicosAntes && textoAhora.startsWith(`${ahoraApi.puntos} puntos`)) ok(`al volver, la página repidió el histórico y muestra lo que la API tiene ahora (${ahoraApi.puntos} puntos)`);
  else falla(`histórico tras la caída: ${pedidosHistorico - historicosAntes} pedido(s) nuevo(s), texto «${textoAhora}», API ${ahoraApi.puntos}`);
  await pagina.screenshot({ path: captura, fullPage: true });
  if (errores.length === 0) ok('sin errores de JavaScript en la página'); else falla(`errores en la página: ${errores.join(' | ')}`);
} catch (e) {
  falla(`la prueba se cortó: ${e instanceof Error ? e.message.split('\n')[0] : String(e)}`);
} finally {
  await navegador.close();
}
console.log(fallos === 0 ? '\nP3 NAVEGADOR OK' : `\n${fallos} comprobación(es) con falla`);
process.exit(fallos === 0 ? 0 : 1);
