import type { EventoVivo } from './modelo';

// Canal en vivo con reconexión (docs/19 F4). `EventSource` reintenta solo ante un corte de red, pero NO ante un 503
// (cupo lleno), un 403 ni una respuesta que no sea un flujo: en esos casos queda cerrado (readyState 2) y hay que
// abrirlo de nuevo. Además, si pasan 60 s sin ningún evento (el backend manda un latido cada 25 s), se da por muerto.
export const ESPERA_MAX_MS = 30_000;
export const SIN_LATIDO_MS = 60_000;
const CERRADO = 2; // EventSource.CLOSED, sin depender del global (las pruebas corren sin navegador)
const TIPOS = ['medicion', 'visto', 'condicion', 'latido'] as const;

export type EstadoCanal = 'conectando' | 'en_vivo' | 'reconectando';

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

// 1, 2, 4, 8, 16, 30, 30… segundos: nunca más de 30 s entre intentos.
export function esperaReintento(intento: number): number {
  return Math.min(1000 * 2 ** intento, ESPERA_MAX_MS);
}

export function abrirCanal(
  url: string,
  alEvento: (e: EventoVivo) => void,
  alEstado: (estado: EstadoCanal, motivo?: string) => void,
  crear: (url: string) => FuenteDeEventos = (u) => new EventSource(u) as unknown as FuenteDeEventos,
): Canal {
  let fuente: FuenteDeEventos | null = null;
  let intento = 0;
  let cerrado = false;
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
    alEstado('reconectando', motivo);
    reintento = setTimeout(abrir, esperaReintento(intento++));
  };

  const abrir = (): void => {
    if (cerrado) return;
    alEstado('conectando');
    const f = crear(url);
    fuente = f;
    f.onopen = () => {
      intento = 0;
      alEstado('en_vivo');
      armarVigilante();
    };
    f.onerror = () => {
      // Cerrado por el servidor (403, 503, respuesta inválida): el navegador no reintenta; lo hacemos nosotros.
      // En otro estado, el navegador ya está reintentando solo (corte de red): solo se avisa.
      if (f.readyState === CERRADO) reconectar('el servidor rechazó o cerró el canal');
      else alEstado('reconectando', 'sin red');
    };
    for (const tipo of TIPOS) {
      f.addEventListener(tipo, (ev) => {
        armarVigilante();
        alEvento(JSON.parse(ev.data as string) as EventoVivo);
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
