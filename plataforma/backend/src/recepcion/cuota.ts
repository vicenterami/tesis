// Cuota de cuarentena por hora (docs/10 §8.4 punto 53 (iii)). Para un dispositivo dado de alta los contadores viven en su fila de
// estado (migración 19) y los lee y escribe el pipeline; esto es para lo que el filtro 1 rechaza (una pasarela que publica un DevEUI
// desconocido, un identificador sin alta): nadie lo dio de alta, así que no tiene fila, y su cuota vive en memoria por emisor
// autenticado. La ventana es la hora del reloj, la misma que en la base; se reinicia con el proceso (aceptado).
export interface ContadorCuota {
  guardadas: number; // tramas guardadas completas en cuarentena en la ventana
  omitidas: number; // tramas rechazadas que solo se contaron (la cuota ya estaba llena)
}

export function inicioDeVentana(t: Date): Date {
  return new Date(Math.floor(t.getTime() / 3_600_000) * 3_600_000);
}

export class CuotaPorEmisor {
  private readonly ventanas = new Map<string, { inicio: number; contador: ContadorCuota }>();
  constructor(private readonly maxClaves = 10_000) {}

  // El contador de este emisor en la ventana de `ahora`; uno nuevo (en cero) si la ventana cambió o no se había visto.
  contador(emisor: string, ahora: Date): ContadorCuota {
    const inicio = inicioDeVentana(ahora).getTime();
    const v = this.ventanas.get(emisor);
    if (v !== undefined && v.inicio === inicio) return v.contador;
    if (this.ventanas.size >= this.maxClaves) this.podar(inicio);
    const nuevo = { inicio, contador: { guardadas: 0, omitidas: 0 } };
    this.ventanas.set(emisor, nuevo);
    return nuevo.contador;
  }

  // Primero se sueltan las ventanas vencidas; si aun así no cabe, las más antiguas (un Map conserva el orden de inserción).
  private podar(inicioVigente: number): void {
    for (const [k, v] of this.ventanas) if (v.inicio !== inicioVigente) this.ventanas.delete(k);
    for (const k of this.ventanas.keys()) {
      if (this.ventanas.size < this.maxClaves) break;
      this.ventanas.delete(k);
    }
  }

  get claves(): number {
    return this.ventanas.size;
  }
}
