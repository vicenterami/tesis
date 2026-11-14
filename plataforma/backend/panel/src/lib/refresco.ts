// Gráficas vivas donde sirve (docs/19 §4, bloque L, punto 4a). Con «última hora» y «24 horas» las gráficas de Tendencias y de Red se
// repiden solas mientras llegan avisos de dispositivos del sitio: como mucho una vez cada sexta parte del cubo y nunca fuera de 5 a 60 s
// (cubos de un minuto → cada 10 s; de 15 minutos → cada 60 s), sin dos pedidos en vuelo y solo con la pestaña del navegador visible. La
// ventana avanza de cubo en cubo: su inicio se alinea al cubo, así los promedios ya dibujados no cambian. Con 7 o 30 días no hay
// refresco automático (botón «Actualizar»): el último cubo, de una o seis horas, casi no cambia y cada pedido lee el rango entero.
import { rango as datosRango, type ClaveRango } from './grafico';

const SEGUNDOS: Readonly<Record<string, number>> = {
  '1 minute': 60, '5 minutes': 300, '15 minutes': 900, '1 hour': 3600, '6 hours': 21_600, '1 day': 86_400,
};
export const RANGOS_VIVOS: readonly ClaveRango[] = ['1h', '24h'];
export const esRangoVivo = (r: ClaveRango | null): boolean => r !== null && RANGOS_VIVOS.includes(r);

// La sexta parte del cubo, acotada a [5 s, 60 s].
export function periodoRefrescoMs(intervalo: string): number {
  const s = SEGUNDOS[intervalo] ?? 3600;
  return Math.min(60, Math.max(5, s / 6)) * 1000;
}

// La ventana de un preajuste que termina en «ahora», con el inicio en el borde de su cubo (el cubo parcial del comienzo no se pide).
export function ventanaAlineada(clave: ClaveRango, ahora: Date): { desde: Date; hasta: Date; intervalo: string } {
  const r = datosRango(clave);
  const cubo = (SEGUNDOS[r.intervalo] ?? 3600) * 1000;
  return { desde: new Date(Math.floor((ahora.getTime() - r.ms) / cubo) * cubo), hasta: ahora, intervalo: r.intervalo };
}

// Limitador: cada `aviso()` pide un refresco; corre como mucho uno por período, nunca dos a la vez, y con la pestaña oculta espera a que
// vuelva a verse (un aviso que llegó oculto se atiende una sola vez al volver). `marcar()` dice «recién se pidió todo» (una carga
// completa): el período cuenta desde ahí y lo que estaba pendiente o programado se olvida, porque esa carga ya lo trae (sin esto, el
// refresco programado antes de un cambio de rango corría después y pisaba la carga que la persona pidió). `soltar()` olvida lo pendiente
// sin mover el período (al pausar: lo programado no debe correr en pausa).
export interface Limitador {
  aviso(): void;
  marcar(): void;
  soltar(): void;
  cancelar(): void;
}
export function limitador(
  accion: () => Promise<unknown>,
  periodoMs: () => number,
  visible: () => boolean = () => typeof document === 'undefined' || document.visibilityState !== 'hidden',
): Limitador {
  let ultimo = Date.now();
  let pendiente = false;
  let enVuelo = false;
  let cancelado = false;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  const programar = (): void => {
    if (cancelado || temporizador !== null || enVuelo || !pendiente) return;
    const espera = Math.max(0, ultimo + periodoMs() - Date.now());
    temporizador = setTimeout(correr, espera);
  };
  function correr(): void {
    temporizador = null;
    if (cancelado || !pendiente) return;
    if (!visible()) return; // se retoma con visibilitychange
    pendiente = false;
    enVuelo = true;
    ultimo = Date.now();
    void accion().catch(() => undefined).finally(() => {
      enVuelo = false;
      programar();
    });
  }
  const alVolver = (): void => {
    if (visible()) programar();
  };
  const olvidar = (): void => {
    pendiente = false;
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = null;
  };
  if (typeof document !== 'undefined') document.addEventListener('visibilitychange', alVolver);
  return {
    aviso() {
      if (cancelado) return;
      pendiente = true;
      programar();
    },
    marcar() {
      ultimo = Date.now();
      olvidar();
    },
    soltar() {
      olvidar();
    },
    cancelar() {
      cancelado = true;
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
      if (typeof document !== 'undefined') document.removeEventListener('visibilitychange', alVolver);
    },
  };
}
