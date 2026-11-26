// Un puerto serie SIMULADO con un equipo detrás que contesta como el firmware del proyecto (plataforma/firmware/src/nodo.cpp y
// include/protocolo.h): solo para las pruebas de lib/serie.ts y de «Cargar en el equipo» (docs/19 §4, Z, punto 8). Responde con el prefijo,
// mezcla líneas de su registro, parte cada respuesta en dos trozos y, tras `configurar`, sigue contestando con la configuración VIEJA durante
// una ventana (`ventanaVieja`, como el firmware real mientras vacía la salida antes de reiniciarse), y después se reinicia: lo que llega
// mientras tanto se pierde y vuelve con otro `arranque`.
import { PREFIJO, PROTOCOLO, type PuertoSerie } from './serie';

// La versión del firmware que imitan los equipos simulados: la de src/nodo.cpp (el verificador, paso 2y5, comprueba que coincidan).
export const VERSION_FIRMWARE = '2.1.0';

export interface OpcionesEquipo {
  firmware?: string;
  rechaza?: string; // un campo que el equipo rechaza en `configurar`
  sinRed?: boolean; // nunca conecta a la red
  errorBroker?: string; // conecta a la red; el broker lo rechaza con este motivo
  mudo?: boolean; // no contesta nada
  holaTrasIntentos?: number; // contesta `hola` desde el intento N (ocupado o reiniciándose al abrir)
  cierraAlReiniciar?: boolean; // USB nativo: el puerto se cierra al reiniciar
  noGuarda?: boolean; // tras reiniciar sigue con lo anterior (otro identificador)
  abrirFalla?: boolean; // otro programa tiene el puerto
  basuraInicial?: boolean; // la primera línea llega mal formada (un trozo viejo en su búfer): responde el error de forma, sin orden
  cortaEnConfigurar?: boolean; // el cable se desconecta al llegar `configurar`: no responde y el puerto se cierra
  config?: Record<string, unknown> | null; // lo que ya tiene cargado (con `id`)
  conectado?: boolean; // con `config`: la sesión vieja está conectada a la red y al broker
  ventanaVieja?: number; // ms tras `configurar` en que sigue contestando con lo anterior (por omisión 40)
  protocolo?: number; // el que dice en `hola` (por omisión, el del panel)
  sinArranque?: boolean; // un firmware viejo, sin `arranque` en `hola`
  escrituraTrabada?: boolean; // no drena lo que recibe: la escritura nunca termina (USB nativo trabado)
}

export class PuertoSimulado implements PuertoSerie {
  readable: ReadableStream<Uint8Array> | null = null;
  writable: WritableStream<Uint8Array> | null = null;
  recibidas: Record<string, unknown>[] = [];
  senales: { dataTerminalReady?: boolean; requestToSend?: boolean }[] = [];
  abierto = false;
  aperturas = 0;
  olvidado = false;
  arranque = 1;
  private ctl: ReadableStreamDefaultController<Uint8Array> | null = null;
  private resto = '';
  private dormidoHasta = 0;
  private holas = 0;
  private basuraDicha = false;
  private estados = 0;
  private config: Record<string, unknown> | null;
  private conectado: boolean;
  private reinicioEn = 0; // instante del reinicio pendiente (0: ninguno)
  private configNueva: Record<string, unknown> | null = null;

  constructor(private readonly o: OpcionesEquipo = {}) {
    this.config = o.config ?? null;
    this.conectado = o.config !== undefined && o.config !== null && o.conectado === true;
  }

  async forget(): Promise<void> {
    this.olvidado = true;
  }

  // Si ya pasó la ventana vieja: arranca con lo nuevo (otro número de arranque, sin sesión).
  private quizasReiniciar(): void {
    if (this.reinicioEn === 0 || Date.now() < this.reinicioEn) return;
    this.reinicioEn = 0;
    this.arranque++;
    if (this.o.noGuarda !== true) this.config = this.configNueva;
    this.configNueva = null;
    this.conectado = false;
    this.estados = 0;
    this.dormidoHasta = Date.now() + 30;
    if (this.o.cierraAlReiniciar === true) setTimeout(() => { try { this.ctl?.close(); } catch { /* ya */ } }, 0);
  }

  async open(): Promise<void> {
    this.aperturas++;
    if (this.o.abrirFalla === true) throw new Error('Failed to open serial port.');
    this.abierto = true;
    this.readable = new ReadableStream<Uint8Array>({ start: (c) => { this.ctl = c; } });
    this.writable = new WritableStream<Uint8Array>({ write: (trozo) => (this.o.escrituraTrabada === true ? new Promise<void>(() => {}) : this.recibir(trozo)) });
  }

  async close(): Promise<void> {
    this.abierto = false;
    try { this.ctl?.close(); } catch { /* ya cerrado */ }
  }

  async setSignals(s: { dataTerminalReady?: boolean; requestToSend?: boolean }): Promise<void> {
    this.senales.push(s);
  }

  // Lo que el equipo escribe: el registro y la respuesta, en dos trozos, en turnos distintos (como llega por un cable).
  private escribir(texto: string): void {
    const b = new TextEncoder().encode(texto);
    const mitad = Math.floor(b.length / 2);
    setTimeout(() => { try { this.ctl?.enqueue(b.slice(0, mitad)); } catch { /* cerrado */ } }, 0);
    setTimeout(() => { try { this.ctl?.enqueue(b.slice(mitad)); } catch { /* cerrado */ } }, 1);
  }
  private responder(r: Record<string, unknown>): void {
    this.escribir(`registro: el equipo dice algo entre medio\r\n${PREFIJO}${JSON.stringify(r)}\r\n`);
  }

  private recibir(trozo: Uint8Array): void {
    this.resto += new TextDecoder().decode(trozo);
    let i: number;
    while ((i = this.resto.indexOf('\n')) >= 0) {
      const linea = this.resto.slice(0, i);
      this.resto = this.resto.slice(i + 1);
      this.quizasReiniciar();
      if (Date.now() < this.dormidoHasta || this.o.mudo === true) continue;
      if (this.o.basuraInicial === true && this.recibidas.length === 0 && !this.basuraDicha) {
        this.basuraDicha = true;
        this.escribir(`${PREFIJO}{"ok":false,"orden":"","error":"json"}\r\n`);
        continue;
      }
      this.atender(JSON.parse(linea) as Record<string, unknown>);
    }
  }

  private atender(o: Record<string, unknown>): void {
    this.recibidas.push(o);
    if (o.orden === 'hola') {
      this.holas++;
      if (this.holas < (this.o.holaTrasIntentos ?? 1)) return;
      this.responder({ ok: true, orden: 'hola', firmware: this.o.firmware ?? 'nodo', version: VERSION_FIRMWARE, protocolo: this.o.protocolo ?? PROTOCOLO,
        ...(this.o.sinArranque === true ? {} : { arranque: this.arranque }), configurado: this.config !== null,
        origen: this.config === null ? 'ninguno' : 'memoria', ...(this.config === null ? {} : { id: this.config.id }) });
    } else if (o.orden === 'configurar') {
      if (this.o.cortaEnConfigurar === true) {
        setTimeout(() => { try { this.ctl?.error(new Error('The device has been lost.')); } catch { /* ya */ } }, 1);
        return;
      }
      if (this.o.rechaza !== undefined) {
        this.responder({ ok: false, orden: 'configurar', error: 'campo', campo: this.o.rechaza });
        return;
      }
      this.configNueva = Object.fromEntries(Object.entries(o).filter(([k]) => k !== 'orden'));
      this.responder({ ok: true, orden: 'configurar', reinicia: true });
      this.reinicioEn = Date.now() + (this.o.ventanaVieja ?? 40);
      setTimeout(() => this.quizasReiniciar(), (this.o.ventanaVieja ?? 40) + 1);
    } else if (o.orden === 'estado') {
      this.estados++;
      // En la ventana vieja (o antes de cargar), la sesión de lo anterior; después, la de lo nuevo.
      const red = this.conectado || (this.reinicioEn === 0 && this.o.sinRed !== true && this.estados >= 2);
      const broker = this.conectado || (red && this.o.errorBroker === undefined && this.estados >= 3);
      this.responder({ ok: true, orden: 'estado', configurado: this.config !== null, wifi: red ? 'conectado' : 'conectando', broker: broker ? 'conectado' : 'desconectado',
        ultimo_error: this.o.sinRed === true ? 'wifi' : (this.o.errorBroker ?? 'ninguno'), publicados: 0, fallidos: 0 });
    } else {
      this.responder({ ok: false, orden: typeof o.orden === 'string' ? o.orden : '', error: 'orden' });
    }
  }
}

// Tiempos cortos para las pruebas (los reales, en TIEMPOS de lib/serie.ts).
export const TIEMPOS_PRUEBA = { esperaOrden: 150, esperaSaludo: 600, esperaConexion: 600, intervalo: 15 };
