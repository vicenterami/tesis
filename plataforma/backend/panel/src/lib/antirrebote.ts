// Antirrebote con un solo vuelo (12/10): varios eventos seguidos (un sensor que oscila sobre su umbral abre y
// cierra condiciones muchas veces por segundo) producen UNA consulta como mucho cada `ms`, y nunca dos a la vez: si llega
// otro aviso mientras una consulta está en vuelo, se anota y se repite una sola vez al terminar. Así una pestaña no
// amplifica hacia la base, y la respuesta más vieja nunca pisa a la más nueva (siempre hay una sola en curso).
export function antirrebote(accion: () => Promise<unknown>, ms = 1000): { pedir: () => void; cancelar: () => void } {
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  let enVuelo = false;
  let pendiente = false;
  let cancelado = false;
  const correr = (): void => {
    temporizador = null;
    if (cancelado) return;
    if (enVuelo) {
      pendiente = true;
      return;
    }
    enVuelo = true;
    void accion().finally(() => {
      enVuelo = false;
      if (pendiente && !cancelado) {
        pendiente = false;
        temporizador = setTimeout(correr, ms);
      }
    });
  };
  return {
    pedir() {
      if (cancelado || temporizador !== null) return;
      temporizador = setTimeout(correr, ms);
    },
    cancelar() {
      cancelado = true;
      if (temporizador !== null) clearTimeout(temporizador);
    },
  };
}

// Acumula valores y los entrega en lote como mucho cada `ms` (el gráfico se redibuja una vez por lote, no por lectura).
export function porLotes<T>(entregar: (lote: T[]) => void, ms = 250): { agregar: (v: T) => void; cancelar: () => void } {
  let lote: T[] = [];
  let temporizador: ReturnType<typeof setTimeout> | null = null;
  return {
    agregar(v) {
      lote.push(v);
      if (temporizador === null) {
        temporizador = setTimeout(() => {
          temporizador = null;
          const l = lote;
          lote = [];
          entregar(l);
        }, ms);
      }
    },
    cancelar() {
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
      lote = [];
    },
  };
}
