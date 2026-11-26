// «Cargar en el equipo» (docs/19 §4, bloque Z): el protocolo serie con el firmware del proyecto, sin pantalla. La interfaz del puerto se
// inyecta (`PuertoSerie`): en el navegador es la de Web Serial; en las pruebas, un puerto simulado que contesta como el firmware.
//   - Una orden por línea, un objeto JSON plano; el equipo responde en una línea que empieza con «@plataforma » (el resto es su registro).
//   - Las reglas de cada campo son las del firmware (plataforma/firmware/include/protocolo.h) y las del guion de terminal
//     (plataforma/firmware/herramientas/cargar-equipo.py): si cambian, cambian en los tres.
// Ninguna respuesta del equipo trae un secreto, y nada de aquí escribe una clave en un texto, un registro o el almacenamiento.

export const PREFIJO = '@plataforma ';
export const FIRMWARE = 'nodo';
// 2 (25/11/2026): `hola` trae `arranque`, que cambia en cada inicio; tras `configurar` se exige un arranque distinto (docs/19 §4, Z).
export const PROTOCOLO = 2;
export const BAUDIOS = 115_200;

// Lo mínimo de Web Serial que se usa (https://wicg.github.io/serial/): la página nunca ve otro puerto que el que la persona eligió.
export interface PuertoSerie {
  open(o: { baudRate: number }): Promise<void>;
  close(): Promise<void>;
  readonly readable: ReadableStream<Uint8Array> | null;
  readonly writable: WritableStream<Uint8Array> | null;
  setSignals?(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void>;
  // Suelta el permiso del origen sobre el puerto (MDN, SerialPort.forget: «resetting any previously-set permissions»). Puede no existir.
  forget?(): Promise<void>;
}
export interface SerieDelNavegador {
  requestPort(o?: Record<string, unknown>): Promise<PuertoSerie>;
}

// Web Serial: en contexto seguro (HTTPS o localhost) y solo en los navegadores que la tienen. Según los datos de compatibilidad de MDN
// (browser-compat-data, api/Serial.json, consultados el 25/11/2026): Chrome desde la 89 (Edge y Opera la heredan), Firefox de escritorio
// desde la 151, Chrome en Android desde la 148; Safari, no. Se decide por la función, nunca por el nombre del navegador.
export function serieDelNavegador(nav: unknown = globalThis.navigator, seguro: boolean = globalThis.isSecureContext === true): SerieDelNavegador | null {
  const s = (nav as { serial?: unknown } | undefined)?.serial;
  return seguro && s !== undefined && s !== null && typeof (s as SerieDelNavegador).requestPort === 'function' ? (s as SerieDelNavegador) : null;
}

export interface DatosCarga {
  red: string;
  clave_red: string;
  servidor: string;
  puerto: number;
  sitio: string;
  id: string;
  clave: string;
}
export type CampoCarga = keyof DatosCarga;

const FORMA_SITIO = /^[a-z0-9][a-z0-9-]{1,62}$/;
const FORMA_ID = /^[a-z0-9][a-z0-9-]{2,62}$/;
const FORMA_SERVIDOR = /^[A-Za-z0-9][A-Za-z0-9.-]{0,62}$/;
const IMPRIMIBLES = /^[\x20-\x7e]*$/;
const SIN_ESPACIOS = /^[\x21-\x7e]*$/;

// El primer campo que no cumple su regla, o null: el mismo orden y las mismas reglas que `campoInvalido` del firmware.
export function validarDatos(d: DatosCarga): CampoCarga | null {
  const red = new TextEncoder().encode(d.red);
  if (red.length < 1 || red.length > 32 || [...red].some((b) => b < 0x20 || b === 0x7f)) return 'red';
  if ((d.clave_red !== '' && (d.clave_red.length < 8 || d.clave_red.length > 63)) || !IMPRIMIBLES.test(d.clave_red)) return 'clave_red';
  if (!FORMA_SERVIDOR.test(d.servidor)) return 'servidor';
  if (!Number.isInteger(d.puerto) || d.puerto < 1 || d.puerto > 65_535) return 'puerto';
  if (!FORMA_SITIO.test(d.sitio)) return 'sitio';
  if (!FORMA_ID.test(d.id)) return 'id';
  if (d.clave.length < 16 || d.clave.length > 128 || !SIN_ESPACIOS.test(d.clave)) return 'clave';
  return null;
}

// Cada campo en palabras de la persona (para «revisa …»).
export const TEXTO_CAMPO: Readonly<Record<CampoCarga, string>> = {
  red: 'el nombre de la red (de 1 a 32 caracteres)',
  clave_red: 'la clave de la red (vacía si la red es abierta, o de 8 a 63 caracteres)',
  servidor: 'la dirección del servidor (letras, números, punto y guion)',
  puerto: 'el puerto (un número de 1 a 65535)',
  sitio: 'el código del sitio',
  id: 'el identificador del equipo',
  clave: 'la credencial del equipo',
};

// El sitio y el identificador desde el tópico del alta (`sitio/<sitio>/dispositivo/<id>/<magnitud>`); null si no es de un equipo MQTT.
export function sitioDeTopico(topico: string | null | undefined): string | null {
  const m = /^sitio\/([^/]+)\/dispositivo\/[^/]+\//.exec(topico ?? '');
  return m === null ? null : m[1]!;
}

export interface Respuesta {
  ok: boolean;
  orden: string;
  error?: string;
  campo?: string;
  [k: string]: unknown;
}

// Una línea del puerto → la respuesta del equipo, o null si es su registro normal (o algo que no se entiende).
export function interpretarLinea(linea: string): Respuesta | null {
  const l = linea.replace(/\r$/, '');
  if (!l.startsWith(PREFIJO)) return null;
  try {
    const r: unknown = JSON.parse(l.slice(PREFIJO.length));
    if (typeof r !== 'object' || r === null || Array.isArray(r)) return null;
    const x = r as Record<string, unknown>;
    return typeof x.ok === 'boolean' && typeof x.orden === 'string' ? (x as Respuesta) : null;
  } catch {
    return null;
  }
}

export function lineaDeOrden(o: Record<string, unknown>): string {
  return `${JSON.stringify(o)}\n`;
}

export interface Tiempos {
  esperaOrden: number; // ms para la respuesta a una orden
  esperaSaludo: number; // ms para que el equipo conteste `hola` (pudo reiniciarse al abrir el puerto o estar en un saludo TLS)
  esperaConexion: number; // ms para que se conecte a la red y al broker
  intervalo: number; // ms entre consultas de `estado` y entre saludos
}
export const TIEMPOS: Tiempos = { esperaOrden: 3_000, esperaSaludo: 20_000, esperaConexion: 90_000, intervalo: 2_000 };

const dormir = (ms: number): Promise<void> => new Promise((r) => setTimeout(r, ms));
// Una promesa con plazo: si no termina en `ms`, gana el plazo (`false`). Lo que no termina sigue en vuelo, pero ya nadie lo espera.
async function conPlazo(p: Promise<unknown>, ms: number): Promise<boolean> {
  let t: ReturnType<typeof setTimeout> | undefined;
  try {
    return await Promise.race([p.then(() => true, () => false), new Promise<boolean>((r) => { t = setTimeout(() => r(false), ms); })]);
  } finally {
    clearTimeout(t);
  }
}

// El puerto abierto: lee en segundo plano, separa las líneas y guarda solo las respuestas (el registro se descarta).
export class Enlace {
  private respuestas: Respuesta[] = [];
  private resto = '';
  private avisar: (() => void) | null = null;
  cerrado = false;
  private readonly leyendo: Promise<void>;

  constructor(
    private readonly puerto: PuertoSerie,
    private readonly lector: ReadableStreamDefaultReader<Uint8Array>,
    private readonly escritor: WritableStreamDefaultWriter<Uint8Array>,
  ) {
    this.leyendo = this.leer();
  }

  private async leer(): Promise<void> {
    const dec = new TextDecoder();
    try {
      for (;;) {
        const { value, done } = await this.lector.read();
        if (done) break;
        this.resto += dec.decode(value, { stream: true });
        let i: number;
        while ((i = this.resto.indexOf('\n')) >= 0) {
          const r = interpretarLinea(this.resto.slice(0, i));
          this.resto = this.resto.slice(i + 1);
          if (r !== null) this.respuestas.push(r);
          if (this.respuestas.length > 64) this.respuestas.shift(); // un equipo que inunda de respuestas no hace crecer la lista sin tope
        }
        if (this.resto.length > 8_192) this.resto = this.resto.slice(-8_192); // un registro sin saltos de línea no crece sin tope
        this.avisar?.();
      }
    } catch {
      // el puerto se cerró o se desconectó el cable: quien espera lo ve en `cerrado`
    } finally {
      this.cerrado = true;
      this.avisar?.();
    }
  }

  async respuesta(orden: string, ms: number): Promise<Respuesta | null> {
    const limite = Date.now() + ms;
    for (;;) {
      const i = this.respuestas.findIndex((r) => r.orden === orden || r.orden === '');
      if (i >= 0) return this.respuestas.splice(i, 1)[0]!;
      const queda = limite - Date.now();
      if (this.cerrado || queda <= 0) return null;
      await new Promise<void>((listo) => {
        const t = setTimeout(listo, queda);
        this.avisar = () => {
          clearTimeout(t);
          listo();
        };
      });
      this.avisar = null;
    }
  }

  // Envía y espera su respuesta. Las respuestas viejas (de un `hola` repetido) se descartan antes, para no tomarlas por esta.
  async orden(o: Record<string, unknown> & { orden: string }, ms: number): Promise<Respuesta | null> {
    this.respuestas = [];
    // Con plazo: un equipo que no drena lo que recibe (USB nativo trabado) dejaba la escritura sin resolver y la carga colgada.
    if (!(await conPlazo(this.escritor.write(new TextEncoder().encode(lineaDeOrden(o))), ms))) {
      this.cerrado = true;
      return null;
    }
    return await this.respuesta(o.orden, ms);
  }

  // Nunca se cuelga: `abort` (no `close`, que espera la escritura pendiente) y cada paso con su plazo. Al final suelta el permiso del puerto.
  async cerrar(): Promise<void> {
    if (this.cerrando !== null) return this.cerrando;
    this.cerrando = (async () => {
      await conPlazo(this.lector.cancel(), 1_000);
      await conPlazo(this.leyendo, 1_000);
      try { this.lector.releaseLock(); } catch { /* ya cerrado */ }
      await conPlazo(this.escritor.abort(), 1_000);
      try { this.escritor.releaseLock(); } catch { /* ídem */ }
      await conPlazo(this.puerto.close(), 2_000);
      if (typeof this.puerto.forget === 'function') await conPlazo(this.puerto.forget(), 1_000);
    })();
    return this.cerrando;
  }
  private cerrando: Promise<void> | null = null;
}

export type PasoCarga = 'cargada' | 'red' | 'broker';
export type CodigoFalla =
  | 'datos' // un dato no cumple su regla: no se abrió el puerto
  | 'puerto' // no se pudo abrir (otro programa lo tiene, o se desconectó)
  | 'no_responde'
  | 'otro_firmware'
  | 'otra_version' // nuestro firmware, de otra versión del protocolo
  | 'reemplazo' // el equipo ya tiene otro identificador y la persona no confirmó reemplazarlo
  | 'rechazado' // el equipo rechazó un campo: no guardó nada
  | 'no_guardo'
  | 'no_confirmo'
  | 'otro_id' // volvió con otro identificador: la carga no quedó
  | 'wifi'
  | 'dns'
  | 'tls'
  | 'credencial'
  | 'broker'
  | 'sin_conexion' // no se conectó a tiempo, sin un motivo del equipo
  | 'cancelado';
export interface FallaCarga {
  codigo: CodigoFalla;
  campo?: CampoCarga;
  actual?: string; // en «reemplazo», el identificador que ya tiene el equipo (no es un secreto)
  protocolo?: number; // en «otra_version», el que dijo el equipo
}
export interface ResultadoCarga {
  cargada: boolean;
  red: boolean;
  broker: boolean;
  falla: FallaCarga | null;
  // El puerto se cerró al reiniciar (USB nativo, sin puente USB-serie): lo que sigue se ve solo por la primera trama.
  sinSeguimiento: boolean;
}

// Qué pasó y qué hacer, en palabras simples (docs/19 §4, Z, punto 4). Nunca nombra un valor: solo el campo.
export function textoDeFalla(f: FallaCarga): string {
  switch (f.codigo) {
    case 'datos':
    case 'rechazado':
      return `No se cargó nada: revisa ${f.campo === undefined ? 'los datos' : TEXTO_CAMPO[f.campo]}.`;
    case 'puerto':
      return 'No se pudo abrir el puerto: si otro programa (un monitor serie) lo tiene abierto, ciérralo y vuelve a intentar.';
    case 'no_responde':
      return 'El equipo no responde. Revisa el cable y que elegiste el puerto correcto.';
    case 'otro_firmware':
      return 'El equipo contestó, pero no tiene el firmware de la plataforma: grábalo primero.';
    case 'otra_version':
      return `El equipo tiene el firmware de la plataforma, pero de otra versión (protocolo ${f.protocolo ?? 'desconocido'}; este panel habla el ${PROTOCOLO}): grábale la imagen actual.`;
    case 'reemplazo':
      return `No se cargó nada: el equipo sigue cargado como ${f.actual ?? 'otro equipo'}.`;
    case 'no_guardo':
      return 'El equipo no pudo guardar la configuración: vuelve a intentar.';
    case 'no_confirmo':
      return 'El equipo no confirmó la carga: vuelve a intentar.';
    case 'otro_id':
      return 'El equipo volvió con otro identificador: la carga no quedó guardada. Vuelve a intentar.';
    case 'wifi':
      return 'No encuentra la red o la clave de la red no es correcta.';
    case 'dns':
      return 'El servidor no se encontró: revisa la dirección.';
    case 'tls':
      return 'El equipo no reconoce el certificado del servidor: grábale la imagen de esta instalación.';
    case 'credencial':
      return 'El broker rechazó la credencial: rótala desde la ficha del equipo y vuelve a cargarla.';
    case 'broker':
      return 'El servidor no respondió como broker: revisa la dirección y el puerto.';
    case 'sin_conexion':
      return 'El equipo no se conectó a tiempo. Revisa que la red alcance al servidor.';
    case 'cancelado':
      return 'Se detuvo la carga.';
  }
}

const ERRORES_DEL_EQUIPO: readonly CodigoFalla[] = ['wifi', 'dns', 'tls', 'credencial', 'broker'];
// Propio del objeto (Object.hasOwn): con `in`, un equipo que contestara «toString» como campo pasaba y el texto mostraba código.
const esCampo = (c: unknown): c is CampoCarga => typeof c === 'string' && Object.hasOwn(TEXTO_CAMPO, c);

// `hola` hasta que el equipo conteste o venza la espera. Devuelve su respuesta, o la falla.
async function saludar(e: Enlace, t: Tiempos, senal?: AbortSignal): Promise<Respuesta | FallaCarga> {
  const limite = Date.now() + t.esperaSaludo;
  while (Date.now() < limite && !e.cerrado) {
    if (senal?.aborted === true) return { codigo: 'cancelado' };
    const r = await e.orden({ orden: 'hola' }, Math.max(1, Math.min(t.intervalo, limite - Date.now())));
    // Un error de forma sin orden («json» o «larga») es por lo que había antes en la línea (un trozo de otra orden o ruido del arranque),
    // no por este `hola`: se repite. Revisión del 25/11/2026: tomarlo por respuesta decía «no tiene el firmware» a un equipo nuestro.
    if (r === null || (!r.ok && r.orden === '')) continue;
    if (!r.ok || r.firmware !== FIRMWARE) return { codigo: 'otro_firmware' };
    if (r.protocolo !== PROTOCOLO || typeof r.arranque !== 'number') return { codigo: 'otra_version', protocolo: typeof r.protocolo === 'number' ? r.protocolo : undefined };
    return r;
  }
  return { codigo: 'no_responde' };
}
const esFalla = (x: Respuesta | FallaCarga): x is FallaCarga => 'codigo' in x;

// Todo el recorrido sobre un puerto ya elegido por la persona: abrir, saludar, `configurar`, esperar el reinicio y seguir `estado` hasta que
// el broker la acepte. `alAvance` recibe cada paso logrado. Siempre cierra el puerto.
export async function cargarEnEquipo(
  puerto: PuertoSerie,
  datos: DatosCarga,
  alAvance: (p: PasoCarga) => void,
  // `confirmarReemplazo`: el equipo ya está cargado con OTRO identificador; sin ella, o si responde false, no se carga nada.
  o: { tiempos?: Partial<Tiempos>; senal?: AbortSignal; confirmarReemplazo?: (actual: string) => Promise<boolean> } = {},
): Promise<ResultadoCarga> {
  const t: Tiempos = { ...TIEMPOS, ...o.tiempos };
  const abortado = (): boolean => o.senal?.aborted === true; // función: tras cada espera vale lo que valga en ese momento
  const r: ResultadoCarga = { cargada: false, red: false, broker: false, falla: null, sinSeguimiento: false };
  const malo = validarDatos(datos);
  if (malo !== null) return { ...r, falla: { codigo: 'datos', campo: malo } };
  try {
    await puerto.open({ baudRate: BAUDIOS });
  } catch {
    return { ...r, falla: { codigo: 'puerto' } };
  }
  // En estas placas DTR y RTS van a EN y a BOOT (docs/17; platformio.ini): se bajan para no dejarla retenida ni reiniciándose.
  try { await puerto.setSignals?.({ dataTerminalReady: false, requestToSend: false }); } catch { /* un adaptador sin esas líneas */ }
  if (puerto.readable === null || puerto.writable === null) {
    try { await puerto.close(); } catch { /* ya cerrado */ }
    return { ...r, falla: { codigo: 'puerto' } };
  }
  const e = new Enlace(puerto, puerto.readable.getReader(), puerto.writable.getWriter());
  const cancelar = (): void => void e.cerrar();
  o.senal?.addEventListener('abort', cancelar);
  try {
    const hola = await saludar(e, t, o.senal);
    if (esFalla(hola)) return { ...r, falla: abortado() ? { codigo: 'cancelado' } : hola };
    const actual = hola.configurado === true && typeof hola.id === 'string' && hola.id !== datos.id ? hola.id : null;
    if (actual !== null && !(o.confirmarReemplazo !== undefined && (await o.confirmarReemplazo(actual)) && !abortado())) {
      return { ...r, falla: abortado() ? { codigo: 'cancelado' } : { codigo: 'reemplazo', actual } };
    }
    if (e.cerrado) return { ...r, falla: { codigo: abortado() ? 'cancelado' : 'no_responde' } };
    // `configurar` espera lo que un saludo: el equipo pudo entrar justo ahora en un intento de conexión que bloquea (TLS, hasta 10 s).
    const conf = await e.orden({ orden: 'configurar', ...datos }, Math.max(t.esperaOrden, t.esperaSaludo));
    if (conf === null) return { ...r, falla: { codigo: abortado() ? 'cancelado' : 'no_confirmo' } };
    if (!conf.ok) {
      return { ...r, falla: conf.error === 'campo' && esCampo(conf.campo) ? { codigo: 'rechazado', campo: conf.campo } : { codigo: 'no_guardo' } };
    }
    r.cargada = true;
    alAvance('cargada');
    // El equipo se reinicia: se espera un `hola` de OTRO arranque (el que todavía contesta con lo anterior no cuenta, aunque traiga el
    // mismo identificador: así una recarga del mismo equipo no toma el `estado` de la sesión vieja), y con el identificador cargado. Si el
    // puerto se cerró (USB nativo), se sigue por la trama.
    const limite = Date.now() + t.esperaSaludo;
    for (;;) {
      const h = await saludar(e, { ...t, esperaSaludo: Math.max(1, limite - Date.now()) }, o.senal);
      if (e.cerrado && !abortado()) return { ...r, sinSeguimiento: true };
      if (esFalla(h)) return { ...r, falla: abortado() ? { codigo: 'cancelado' } : h.codigo === 'no_responde' ? { codigo: 'otro_id' } : h };
      if (h.arranque !== hola.arranque) {
        if (h.id === datos.id) break;
        return { ...r, falla: { codigo: 'otro_id' } }; // arrancó de nuevo, pero sin lo cargado
      }
      if (Date.now() >= limite) return { ...r, falla: { codigo: 'otro_id' } };
      await dormir(Math.min(300, t.intervalo)); // todavía no se reinició: contesta con lo anterior
    }
    let ultimo = 'ninguno';
    const hasta = Date.now() + t.esperaConexion;
    while (Date.now() < hasta) {
      if (abortado()) return { ...r, falla: { codigo: 'cancelado' } };
      const s = await e.orden({ orden: 'estado' }, t.esperaOrden);
      if (e.cerrado && s === null) return { ...r, sinSeguimiento: !r.broker && !abortado(), falla: abortado() ? { codigo: 'cancelado' } : null };
      if (s !== null && s.ok) {
        ultimo = typeof s.ultimo_error === 'string' ? s.ultimo_error : 'ninguno';
        if (!r.red && (s.wifi === 'conectado' || s.broker === 'conectado')) {
          r.red = true;
          alAvance('red');
        }
        if (s.broker === 'conectado') {
          r.broker = true;
          alAvance('broker');
          return r;
        }
      }
      await dormir(t.intervalo);
    }
    const codigo = (ERRORES_DEL_EQUIPO as readonly string[]).includes(ultimo) ? (ultimo as CodigoFalla) : 'sin_conexion';
    return { ...r, falla: { codigo } };
  } finally {
    o.senal?.removeEventListener('abort', cancelar);
    await e.cerrar();
  }
}
