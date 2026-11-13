// Topes de la recepción por HTTP (docs/10 §8.4 punto 52). Se diseñaron cuando verificar un token costaba CPU a propósito (scrypt: 65 ms
// medidos el 16/10/2026 en el portátil; 57 por segundo con los 4 hilos de Node): sin topes, mandar tokens falsos saturaba el backend.
// Desde el 13/11/2026 la credencial se guarda con SHA-256 (docs/11 §4) y ese costo queda solo para las anteriores; (b), (c) y (e) siguen
// frenando un barrido de tokens. Los contadores viven en la memoria del proceso y se reinician con él (aceptado). El reloj se inyecta
// para probarlos sin esperar.
export type Reloj = () => number;

// Una dirección IPv6 se cuenta por su prefijo /64, lo que suele recibir un solo equipo: con una dirección por petición dentro de él,
// un mismo atacante esquivaría el bloqueo. IPv4 (también la mapeada en IPv6, `::ffff:a.b.c.d`), tal cual.
export function claveDeDireccion(direccion: string): string {
  const d = direccion.toLowerCase(); // «::FFFF:» en mayúsculas es la misma dirección (revisión del 17/10)
  const ip = d.startsWith('::ffff:') ? d.slice(7) : d;
  if (!ip.includes(':')) return ip;
  const [izq, der = ''] = ip.split('::');
  const a = izq ? izq.split(':') : [], b = der ? der.split(':') : [];
  const grupos = ip.includes('::') ? [...a, ...Array<string>(Math.max(0, 8 - a.length - b.length)).fill('0'), ...b] : a;
  return grupos.slice(0, 4).map((g) => g.replace(/^0+(?=.)/, '')).join(':') + '::/64';
}

// (b) y (c) Una clave con `maxFallos` fallos de autenticación dentro de `ventanaMs` queda bloqueada `bloqueoMs`. El controlador usa
// dos instancias: una por par dirección + dispositivo (5 fallos: un vecino detrás del mismo NAT no paga por otro) y una gruesa por
// dirección (50 fallos, cualquier identificador: cuánta CPU de scrypt puede gastar una dirección por minuto). La clave la arma quien
// llama (la dirección ya normalizada con claveDeDireccion).
export class FallosPorClave {
  private readonly fallos = new Map<string, number[]>();
  private readonly bloqueadas = new Map<string, number>();
  private ultimaPoda = -Infinity;

  constructor(
    private readonly maxFallos = 5,
    private readonly ventanaMs = 60_000,
    private readonly bloqueoMs = 60_000,
    private readonly ahora: Reloj = Date.now,
    private readonly maxClaves = 10_000,
  ) {}

  // Milisegundos que le quedan de bloqueo a la clave; 0 si no está bloqueada.
  bloqueo(clave: string): number {
    const hasta = this.bloqueadas.get(clave);
    if (hasta === undefined) return 0;
    const resto = hasta - this.ahora();
    if (resto > 0) return resto;
    this.bloqueadas.delete(clave);
    return 0;
  }

  registrarFallo(clave: string): void {
    const t = this.ahora();
    const recientes = (this.fallos.get(clave) ?? []).filter((x) => t - x < this.ventanaMs);
    recientes.push(t);
    if (recientes.length >= this.maxFallos) {
      this.bloqueadas.set(clave, t + this.bloqueoMs);
      this.fallos.delete(clave);
    } else {
      this.fallos.set(clave, recientes);
    }
    this.podar(t);
  }

  // Sin esto, un barrido desde muchas direcciones haría crecer los mapas sin límite. Se recorren como mucho una vez por segundo (no en
  // cada fallo: con muchas claves vivas, recorrerlas cada vez costaría en el hilo principal) y, si aun así sobran, se sueltan las más
  // antiguas de los fallos (un Map conserva el orden de inserción): se pierde la cuenta de alguien, nunca un bloqueo vigente.
  private podar(t: number): void {
    if (this.fallos.size + this.bloqueadas.size < this.maxClaves) return;
    if (t - this.ultimaPoda >= 1_000) {
      this.ultimaPoda = t;
      for (const [k, v] of this.fallos) if (v.every((x) => t - x >= this.ventanaMs)) this.fallos.delete(k);
      for (const [k, hasta] of this.bloqueadas) if (hasta <= t) this.bloqueadas.delete(k);
    }
    for (const k of this.fallos.keys()) {
      if (this.fallos.size + this.bloqueadas.size < this.maxClaves) break;
      this.fallos.delete(k);
    }
  }

  get claves(): number {
    return this.fallos.size + this.bloqueadas.size;
  }
}

// (d) Como mucho `max` verificaciones de scrypt a la vez: nunca más de la mitad del pool de hilos. Desde el 13/11/2026 solo las pagan las
// credenciales anteriores (`scrypt$…`): la primera trama tras arrancar, que además la convierte, y los tokens equivocados; las demás las
// resuelve la caché, y las credenciales `sha256$…` no pasan por aquí (verificacion.ts).
export class Cupo {
  private enCurso = 0;
  constructor(private readonly max = 2) {}
  tomar(): boolean {
    if (this.enCurso >= this.max) return false;
    this.enCurso++;
    return true;
  }
  soltar(): void {
    if (this.enCurso > 0) this.enCurso--;
  }
}

// (e) Cada dispositivo, como mucho una trama aceptada cada `intervaloMs` (el intervalo mínimo del alta es 5 s). El presupuesto por
// hora, común a todas las vías, es el tope por emisor del pipeline (docs/10 §8.4 punto 53).
export class RitmoPorDispositivo {
  private readonly ultima = new Map<string, number>();
  constructor(
    private readonly intervaloMs = 1_000,
    private readonly ahora: Reloj = Date.now,
  ) {}
  // true y lo anota si puede pasar; false si llegó antes de tiempo (no se anota: no alarga su espera).
  pasar(dispositivoId: string): boolean {
    const t = this.ahora();
    const antes = this.ultima.get(dispositivoId);
    if (antes !== undefined && t - antes < this.intervaloMs) return false;
    this.ultima.set(dispositivoId, t);
    return true;
  }
}
