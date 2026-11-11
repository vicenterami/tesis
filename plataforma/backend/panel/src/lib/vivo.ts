import { comprobarSesion } from './api';
import type { EventoVivo } from './modelo';

// Canal en vivo con reconexión (docs/19 F4). `EventSource` reintenta solo ante un corte de red, pero NO ante un 503
// (cupo lleno), un 403 ni una respuesta que no sea un flujo: en esos casos queda cerrado (readyState 2) y hay que
// abrirlo de nuevo. Además, si pasan 60 s sin ningún evento (el backend manda un latido cada 25 s), se da por muerto.
export const ESPERA_MAX_MS = 30_000;
export const SIN_LATIDO_MS = 60_000;
const CERRADO = 2; // EventSource.CLOSED, sin depender del global (las pruebas corren sin navegador)
const TIPOS = ['medicion', 'visto', 'condicion', 'latido'] as const;

// El tipo lo dice el nombre del evento SSE (`event:`), que el backend pone en los cuatro casos; los datos lo repiten en
// medicion, visto y condicion, pero el latido trae solo {tiempo} (eventos.controller.ts). El emisor es nuestro backend,
// pero un proxy intermedio o una versión vieja pueden mandar algo distinto: lo que no tenga la forma esperada se descarta
// sin romper la pantalla (12/10). Se mira lo que el panel usa.
export function esEventoVivo(tipo: string, x: unknown): x is Omit<EventoVivo, 'tipo'> {
  if (typeof x !== 'object' || x === null) return false;
  const e = x as Record<string, unknown>;
  switch (tipo) {
    case 'latido': return typeof e.tiempo === 'string';
    case 'visto': return typeof e.dispositivo_id === 'string' && typeof e.tiempo === 'string';
    case 'medicion': return typeof e.dispositivo_id === 'string' && typeof e.canal_id === 'string' && typeof e.valor === 'number' && Number.isFinite(e.valor) && typeof e.tiempo === 'string';
    case 'condicion': return typeof e.dispositivo_id === 'string' && typeof e.condicion === 'string' && (e.estado === 'abierta' || e.estado === 'cerrada');
    default: return false;
  }
}

function decodificar(tipo: string, texto: unknown): EventoVivo | null {
  try {
    const x: unknown = JSON.parse(String(texto));
    return esEventoVivo(tipo, x) ? ({ ...x, tipo } as EventoVivo) : null;
  } catch {
    return null;
  }
}

export type EstadoCanal = 'conectando' | 'en_vivo' | 'reconectando';
// Al volver a «en_vivo» después de una caída, el motivo es «reconectado»: la pantalla vuelve a pedir lo que muestra (docs/19 F4).
export const RECONECTADO = 'reconectado';

// Lo mínimo que usamos de EventSource; el EventSource real lo cumple y las pruebas usan uno falso.
export interface FuenteDeEventos {
  readyState: number;
  onopen: ((ev: Event) => void) | null;
  onerror: ((ev: Event) => void) | null;
  addEventListener(tipo: string, oyente: (ev: MessageEvent) => void): void;
  close(): void;
}

export interface Canal {
  cerrar(): void;
}

// 1, 2, 4, 8, 16, 30, 30… segundos: nunca más de 30 s entre intentos. La espera vuelve a 1 s con el primer mensaje del servidor (un
// latido o un evento), no al abrir (corrección del 11/11/2026): un servidor que acepta el flujo y lo cierra enseguida producía una
// reconexión, y con ella una recarga de la pantalla, cada segundo sin retroceso.
export function esperaReintento(intento: number): number {
  return Math.min(1000 * 2 ** intento, ESPERA_MAX_MS);
}

export function abrirCanal(
  url: string,
  alEvento: (e: EventoVivo) => void,
  alEstado: (estado: EstadoCanal, motivo?: string) => void,
  crear: (url: string) => FuenteDeEventos = (u) => new EventSource(u) as unknown as FuenteDeEventos,
  // Con sesión (docs/20 §3 y §10, R2), el servidor cierra el canal cuando la sesión vence o se cierra, y EventSource no dice el código.
  // Al primer rechazo después de haber estado en vivo se pregunta por la sesión (una petición liviana): si venció, el cliente HTTP lleva
  // al inicio de sesión y la pantalla, al desmontarse, cierra este canal. Solo al primero: los reintentos siguientes no preguntan, así
  // un canal rechazado en bucle (cupo lleno) no mantiene viva la sesión de una pantalla sin nadie delante.
  alRechazo: () => void = () => comprobarSesion(),
): Canal {
  let fuente: FuenteDeEventos | null = null;
  let intento = 0;
  let cerrado = false;
  let caido = false; // hubo una caída desde la última apertura buena
  let vigilante: ReturnType<typeof setTimeout> | null = null;
  let reintento: ReturnType<typeof setTimeout> | null = null;

  const armarVigilante = (): void => {
    if (vigilante !== null) clearTimeout(vigilante);
    vigilante = setTimeout(() => reconectar('sin latido en 60 s'), SIN_LATIDO_MS);
  };

  const reconectar = (motivo: string): void => {
    if (cerrado) return;
    if (vigilante !== null) clearTimeout(vigilante);
    fuente?.close();
    fuente = null;
    caido = true;
    alEstado('reconectando', motivo);
    reintento = setTimeout(abrir, esperaReintento(intento++));
  };

  const abrir = (): void => {
    if (cerrado) return;
    alEstado('conectando');
    const f = crear(url);
    fuente = f;
    f.onopen = () => {
      const volvio = caido;
      caido = false;
      alEstado('en_vivo', volvio ? RECONECTADO : undefined);
      armarVigilante();
    };
    f.onerror = () => {
      // Cerrado por el servidor (403, 503, respuesta inválida): el navegador no reintenta; lo hacemos nosotros.
      // En otro estado, el navegador ya está reintentando solo (corte de red): solo se avisa.
      if (f.readyState === CERRADO) {
        if (intento === 0) alRechazo(); // el primer rechazo tras un canal que entregó algo (o el primero de todos)
        reconectar('el servidor rechazó o cerró el canal');
      }
      else {
        caido = true; // el navegador reintenta solo; al reabrir, también se vuelve a pedir
        alEstado('reconectando', 'sin red');
      }
    };
    for (const tipo of TIPOS) {
      f.addEventListener(tipo, (ev) => {
        armarVigilante(); // cualquier mensaje del servidor, válido o no, prueba que el canal vive
        intento = 0; // y que vale la pena volver a intentar pronto si se corta
        const e = decodificar(tipo, ev.data);
        if (e !== null) alEvento(e);
      });
    }
  };

  abrir();
  return {
    cerrar() {
      cerrado = true;
      if (vigilante !== null) clearTimeout(vigilante);
      if (reintento !== null) clearTimeout(reintento);
      fuente?.close();
      fuente = null;
    },
  };
}
