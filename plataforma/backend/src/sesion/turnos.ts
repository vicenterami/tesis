// Turnos para el hash de claves de personas (decidido al implementar, 08/11/2026). scrypt con N = 2^17 ocupa 128 MiB por cálculo
// (credenciales.ts) y el contenedor del backend tiene un techo de 512 MB (docker-compose.yml): con los cuatro hilos del pool de Node
// calculando a la vez serían 512 MiB y el contenedor moriría por memoria. Como mucho 2 cálculos simultáneos (256 MiB); los demás
// esperan su turno en orden y, con 20 esperando, el siguiente recibe 503 en vez de encolarse sin fin.
// Además, un tope POR DIRECCIÓN (revisión del 08/11/2026): como mucho 2 cálculos de una misma dirección en curso o en cola; el tercero
// recibe 429 antes de encolarse, sin costo. Sin él, una sola dirección llenaba la cola y dejaba a todas las demás esperando o con 503.
import { HttpException, HttpStatus, ServiceUnavailableException } from '@nestjs/common';

export const MAX_SIMULTANEOS = 2;
export const MAX_EN_ESPERA = 20;
export const MAX_POR_ORIGEN = 2;

export class Turnos {
  private enCurso = 0;
  private readonly espera: (() => void)[] = [];
  // Cálculos en curso o en cola por origen (la dirección del cliente). Se borra al llegar a cero: como mucho 22 entradas.
  private readonly porOrigen = new Map<string, number>();

  constructor(private readonly maximo = MAX_SIMULTANEOS, private readonly maxEspera = MAX_EN_ESPERA, private readonly maxPorOrigen = MAX_POR_ORIGEN) {}

  // `origen`: la dirección del cliente, para el tope por dirección; sin ella (el alta de usuarios, que ya exige un administrador), solo
  // cuentan los topes globales.
  async con<T>(trabajo: () => Promise<T>, origen?: string): Promise<T> {
    if (origen !== undefined && (this.porOrigen.get(origen) ?? 0) >= this.maxPorOrigen) {
      throw new HttpException({ statusCode: 429, message: 'demasiados inicios de sesión a la vez desde tu dirección; reintenta en un momento' }, HttpStatus.TOO_MANY_REQUESTS);
    }
    if (this.enCurso >= this.maximo && this.espera.length >= this.maxEspera) {
      throw new ServiceUnavailableException('demasiados inicios de sesión a la vez; reintenta en un momento');
    }
    if (origen !== undefined) this.porOrigen.set(origen, (this.porOrigen.get(origen) ?? 0) + 1);
    try {
      if (this.enCurso >= this.maximo) await new Promise<void>((resolver) => this.espera.push(resolver));
      else this.enCurso++;
      try {
        return await trabajo();
      } finally {
        // El turno pasa directo al siguiente en espera (el contador no baja ni sube): nadie se cuela entre medio.
        const siguiente = this.espera.shift();
        if (siguiente !== undefined) siguiente();
        else this.enCurso--;
      }
    } finally {
      if (origen !== undefined) {
        const n = (this.porOrigen.get(origen) ?? 1) - 1;
        if (n <= 0) this.porOrigen.delete(origen);
        else this.porOrigen.set(origen, n);
      }
    }
  }

  get ocupados(): number {
    return this.enCurso;
  }
  get esperando(): number {
    return this.espera.length;
  }
  get origenes(): number {
    return this.porOrigen.size;
  }
}
