// Lo que la vista pública guarda en la memoria del proceso (docs/19 §4, O, puntos 7 y 8): la respuesta guardada con espera compartida, el
// cupo propio de consultas y el contador de accesos. Sin base ni Nest: cada pieza con su prueba. Con varias instancias, cada una lleva lo
// suyo (como los cupos del tablero); la vigencia del enlace NO vive aquí: se lee de la base en cada petición.
import { ServiceUnavailableException } from '@nestjs/common';

// ── Respuesta guardada (punto 7) ────────────────────────────────────────────────────────────────────────────────────────────────────
// Guarda SOLO los datos, por clave (enlace y ventana), `duracionMs`. Mientras una clave se recalcula, las demás peticiones de esa clave
// esperan ese mismo resultado en vez de consultar (espera compartida). Acotada en cantidad y en bytes: al pasar un tope se descartan las
// más antiguas; un valor que solo ya pasa el tope de bytes no se guarda (se sirve igual). Un cálculo que falla lo reciben todos los que lo
// esperaban; por omisión no se guarda y el siguiente que llegue lo reintenta. Un fallo que `guardarFallo` reconoce (el tiempo máximo
// vencido; revisión del 17/11/2026) SÍ se guarda, `duracionMs`: mientras tanto esa clave falla sin calcular, para que un enlace de una vista
// pesada pedido cada segundo no ocupe el cupo sin fin.
export class RespuestaGuardada<T> {
  private readonly guardadas = new Map<string, { valor?: T; fallo?: unknown; vence: number; bytes: number }>();
  private readonly enCurso = new Map<string, Promise<T>>();
  private bytes = 0;
  constructor(private readonly o: {
    duracionMs: number; maxEntradas: number; maxBytes: number; medir: (v: T) => number; ahora?: () => number; guardarFallo?: (e: unknown) => boolean;
  }) {}

  private ahora(): number {
    return (this.o.ahora ?? Date.now)();
  }

  obtener(clave: string, calcular: () => Promise<T>): Promise<T> {
    const g = this.guardadas.get(clave);
    // eslint-disable-next-line @typescript-eslint/prefer-promise-reject-errors -- es el mismo error que lanzó el cálculo, guardado tal cual
    if (g !== undefined && g.vence > this.ahora()) return 'fallo' in g ? Promise.reject(g.fallo) : Promise.resolve(g.valor as T);
    const pendiente = this.enCurso.get(clave);
    if (pendiente !== undefined) return pendiente;
    // Promise.resolve().then: aunque `calcular` lance de forma síncrona, la promesa queda registrada antes de que el finally la borre.
    const p = Promise.resolve()
      .then(calcular)
      .then(
        (v) => {
          this.guardar(clave, { valor: v }, this.o.medir(v));
          return v;
        },
        (e: unknown) => {
          if (this.o.guardarFallo?.(e) === true) this.guardar(clave, { fallo: e }, 64);
          throw e;
        },
      )
      .finally(() => this.enCurso.delete(clave));
    this.enCurso.set(clave, p);
    return p;
  }

  // Quita todo lo guardado de un enlace (al revocarlo). No es lo que corta el acceso —eso lo hace la lectura de la fila en cada
  // petición—: solo libera memoria.
  olvidar(prefijo: string): void {
    for (const [k, g] of this.guardadas) {
      if (k.startsWith(prefijo)) {
        this.bytes -= g.bytes;
        this.guardadas.delete(k);
      }
    }
  }

  get tamano(): { entradas: number; bytes: number } {
    return { entradas: this.guardadas.size, bytes: this.bytes };
  }

  private guardar(clave: string, entrada: { valor?: T; fallo?: unknown }, bytes: number): void {
    const vieja = this.guardadas.get(clave);
    if (vieja !== undefined) {
      this.bytes -= vieja.bytes;
      this.guardadas.delete(clave);
    }
    if (bytes > this.o.maxBytes) return;
    const ahora = this.ahora();
    for (const [k, g] of this.guardadas) {
      if (g.vence <= ahora) {
        this.bytes -= g.bytes;
        this.guardadas.delete(k);
      }
    }
    // Map conserva el orden de inserción: la primera es la más antigua.
    while (this.guardadas.size >= this.o.maxEntradas || this.bytes + bytes > this.o.maxBytes) {
      const primera = this.guardadas.keys().next();
      if (primera.done === true) break;
      this.bytes -= this.guardadas.get(primera.value)?.bytes ?? 0;
      this.guardadas.delete(primera.value);
    }
    this.guardadas.set(clave, { ...entrada, vence: ahora + this.o.duracionMs, bytes });
    this.bytes += bytes;
  }
}

// ── Cupo de consultas (punto 7) ─────────────────────────────────────────────────────────────────────────────────────────────────────
// Como mucho `maxEnCurso` a la vez; las demás esperan en fila, en orden de llegada; con la fila llena, 503 sin tocar la base. Al soltar, el
// cupo pasa directo a quien espera primero (el mismo mecanismo del histórico del sitio, tablero.service.ts, con su propio contador).
export const MENSAJE_SIN_CUPO = 'los datos están tardando: hay muchas vistas públicas calculándose; la página volverá a intentarlo en un minuto';
export class Cupo {
  private enCurso = 0;
  private readonly fila: (() => void)[] = [];
  constructor(private readonly maxEnCurso: number, private readonly maxEnEspera: number) {}

  // `maxEsperaMs`: cuánto puede esperar en la fila (segunda revisión del 17/11/2026); pasado ese tiempo sale de la fila con 503.
  async tomar(maxEsperaMs = Infinity): Promise<void> {
    if (this.enCurso < this.maxEnCurso) {
      this.enCurso++;
      return;
    }
    if (this.fila.length >= this.maxEnEspera) throw new ServiceUnavailableException(MENSAJE_SIN_CUPO);
    await new Promise<void>((seguir, fallar) => {
      let reloj: NodeJS.Timeout | undefined;
      const turno = (): void => {
        clearTimeout(reloj);
        seguir();
      };
      this.fila.push(turno);
      if (Number.isFinite(maxEsperaMs)) {
        reloj = setTimeout(() => {
          const i = this.fila.indexOf(turno);
          if (i >= 0) {
            this.fila.splice(i, 1);
            fallar(new ServiceUnavailableException(MENSAJE_SIN_CUPO));
          }
        }, maxEsperaMs);
      }
    });
  }
  soltar(): void {
    const siguiente = this.fila.shift();
    if (siguiente !== undefined) siguiente();
    else this.enCurso--;
  }
  get estado(): { enCurso: number; enEspera: number } {
    return { enCurso: this.enCurso, enEspera: this.fila.length };
  }
}

// ── Contador de accesos (punto 8) ───────────────────────────────────────────────────────────────────────────────────────────────────
// Por (enlace, día en la zona del sitio), en memoria; se vuelca a la base una vez por minuto. Sin direcciones ni nada de quien visita.
// Acotado: con `maxClaves` claves distintas sin volcar, un acceso que traería una clave nueva no se cuenta (se pierde un conteo, nunca la
// memoria). Si el volcado falla, lo tomado vuelve (respetando el tope) y se reintenta en el siguiente.
export interface FilaContador { enlace_id: string; dia: string; cuenta: number }
export class ContadorAccesos {
  private cuentas = new Map<string, number>();
  constructor(private readonly maxClaves: number) {}

  sumar(enlaceId: string, dia: string, n = 1): boolean {
    const k = `${enlaceId}|${dia}`;
    const actual = this.cuentas.get(k);
    if (actual === undefined && this.cuentas.size >= this.maxClaves) return false;
    this.cuentas.set(k, (actual ?? 0) + n);
    return true;
  }
  tomar(): FilaContador[] {
    const filas = [...this.cuentas].map(([k, cuenta]) => {
      const [enlace_id, dia] = k.split('|');
      return { enlace_id, dia, cuenta };
    });
    this.cuentas = new Map();
    return filas;
  }
  devolver(filas: readonly FilaContador[]): void {
    for (const f of filas) this.sumar(f.enlace_id, f.dia, f.cuenta);
  }
  get claves(): number {
    return this.cuentas.size;
  }
}
