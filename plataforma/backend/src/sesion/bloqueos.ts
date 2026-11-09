// Bloqueos por intentos fallidos de inicio de sesión (docs/20 §4, decidido el 12/10/2026):
//   · por usuario: 5 fallos en 15 minutos → bloqueo de 1 minuto; si vuelve a juntar 5, 5 minutos; después, 15 (creciente). El nivel
//     vuelve a cero tras 15 minutos sin fallos desde que terminó el último bloqueo, o con un inicio de sesión correcto.
//   · por IP: 50 fallos en 15 minutos → 429 mientras sigan dentro de la ventana.
// La clave del bloqueo por usuario es el EMAIL escrito (normalizado), no el id: un email inexistente se bloquea igual que uno real,
// así el bloqueo no revela qué cuentas existen. En memoria, con la dirección exacta (docs/10 §8.4 punto 43): un solo proceso
// (RNF-14); al reiniciar el backend se olvidan, lo que no le sirve a quien ataca desde fuera. El reloj entra por el constructor.
export const VENTANA_MS = 15 * 60_000;
export const FALLOS_POR_USUARIO = 5;
export const ESCALONES_MS: readonly number[] = [60_000, 5 * 60_000, 15 * 60_000];
export const FALLOS_POR_IP = 50;
// Cota de memoria: con más claves que esto se descartan las que ya no pesan (sin fallos en la ventana y sin bloqueo vigente). Es un
// tope DURO (revisión del 08/11/2026): si tras podar sigue lleno, un intento que necesitaría una clave nueva se trata como bloqueado
// (429) en vez de crecer sin fin. Llenarlo exige 10 000 emails o direcciones con fallos dentro de 15 minutos, cada fallo con su scrypt y
// a lo más dos a la vez por dirección (turnos.ts): con un solo proceso son más de 40 minutos de cálculo, fuera de la ventana.
export const MAX_CLAVES = 10_000;
// Lo que espera quien llega con el registro lleno: el primer escalón. Para entonces la poda ya habrá liberado claves.
export const ESPERA_SI_LLENO_MS = 60_000;

interface EstadoUsuario {
  fallos: number[];
  nivel: number;
  bloqueadoHasta: number;
  ultimoFallo: number;
}

export class Bloqueos {
  private readonly usuarios = new Map<string, EstadoUsuario>();
  private readonly ips = new Map<string, number[]>();
  // Último instante en que se registró en `acceso` un rechazo «bloqueado» de cada (email, dirección): uno por ventana de 15 minutos
  // (revisión del 08/11/2026: un INSERT por cada 429 dejaba a quien insiste escribir en la base al ritmo que quisiera).
  private readonly registrados = new Map<string, number>();

  constructor(private readonly reloj: () => number = Date.now) {}

  // Milisegundos que le faltan al bloqueo de este email (0 = puede intentar).
  restanteUsuario(email: string): number {
    const e = this.usuarios.get(email);
    return e === undefined ? 0 : Math.max(0, e.bloqueadoHasta - this.reloj());
  }

  // Lo que le falta a un intento de (email, dirección) para poder hacerse: el mayor de los dos bloqueos y, si el registro está lleno y
  // el intento traería una clave nueva, el escalón inicial (tope duro, MAX_CLAVES). 0 = puede intentar.
  restante(email: string, ip: string): number {
    const espera = Math.max(this.restanteIp(ip), this.restanteUsuario(email));
    if (espera > 0) return espera;
    return this.lleno(email, ip) ? ESPERA_SI_LLENO_MS : 0;
  }

  // ¿Va este rechazo «bloqueado» a la tabla `acceso`? Sí la primera vez de cada (email, dirección) en la ventana; después, no.
  debeRegistrarBloqueo(email: string, ip: string): boolean {
    const ahora = this.reloj();
    const clave = `${email}\u0000${ip}`;
    const ultimo = this.registrados.get(clave);
    if (ultimo !== undefined && ahora - ultimo < VENTANA_MS) return false;
    if (ultimo === undefined && this.lleno(email, ip, clave)) return false; // sin lugar: el aviso del registro (log) sigue, la fila no
    this.registrados.set(clave, ahora);
    return true;
  }

  // Milisegundos hasta que la IP vuelve a tener menos de 50 fallos en la ventana (0 = puede intentar).
  restanteIp(ip: string): number {
    const ahora = this.reloj();
    const f = this.podar(this.ips.get(ip), ahora);
    if (f.length < FALLOS_POR_IP) return 0;
    return f[f.length - FALLOS_POR_IP] + VENTANA_MS - ahora;
  }

  // Un intento con clave mala, usuario inexistente o inactivo. Devuelve el bloqueo que empieza ahora (ms) o 0.
  registrarFallo(email: string, ip: string): number {
    const ahora = this.reloj();
    this.registrarFalloIp(ip);
    if (!this.usuarios.has(email) && this.lleno(email, ip)) return 0; // sin lugar: el próximo intento recibirá 429 (restante)

    const e = this.usuarios.get(email) ?? { fallos: [], nivel: 0, bloqueadoHasta: 0, ultimoFallo: 0 };
    if (ahora - Math.max(e.ultimoFallo, e.bloqueadoHasta) > VENTANA_MS) e.nivel = 0;
    e.fallos = this.podar(e.fallos, ahora);
    e.fallos.push(ahora);
    e.ultimoFallo = ahora;
    let bloqueo = 0;
    if (e.fallos.length >= FALLOS_POR_USUARIO) {
      bloqueo = ESCALONES_MS[Math.min(e.nivel, ESCALONES_MS.length - 1)];
      e.nivel = Math.min(e.nivel + 1, ESCALONES_MS.length);
      e.bloqueadoHasta = ahora + bloqueo;
      e.fallos = [];
    }
    this.usuarios.set(email, e);
    return bloqueo;
  }

  // Un fallo que cuenta solo para la dirección: el 503 por la cola del hash llena (turnos.ts; revisión del 08/11/2026). Quien satura la
  // cola desde una dirección llega antes al bloqueo de esa dirección; ningún usuario se bloquea por eso.
  registrarFalloIp(ip: string): void {
    const ahora = this.reloj();
    this.acotar(ahora);
    if (!this.ips.has(ip) && this.tamano >= MAX_CLAVES) return;
    const fi = this.podar(this.ips.get(ip), ahora);
    fi.push(ahora);
    this.ips.set(ip, fi.slice(-FALLOS_POR_IP));
  }

  // Inicio de sesión correcto: el usuario queda sin fallos ni nivel. Los fallos de la IP no se borran (una IP compartida no se limpia
  // porque una persona acertó).
  registrarExito(email: string): void {
    this.usuarios.delete(email);
  }

  get tamano(): number {
    return this.usuarios.size + this.ips.size + this.registrados.size;
  }

  // ¿Lleno aun después de podar, para un intento que traería una clave nueva (email, dirección o par registrado)?
  private lleno(email: string, ip: string, par?: string): boolean {
    this.acotar(this.reloj());
    if (this.tamano < MAX_CLAVES) return false;
    return !this.usuarios.has(email) || !this.ips.has(ip) || (par !== undefined && !this.registrados.has(par));
  }

  private podar(f: number[] | undefined, ahora: number): number[] {
    return (f ?? []).filter((t) => ahora - t < VENTANA_MS);
  }

  private acotar(ahora: number): void {
    if (this.tamano < MAX_CLAVES) return;
    for (const [k, e] of this.usuarios) {
      if (e.bloqueadoHasta <= ahora && ahora - e.ultimoFallo >= VENTANA_MS) this.usuarios.delete(k);
    }
    for (const [k, f] of this.ips) if (this.podar(f, ahora).length === 0) this.ips.delete(k);
    for (const [k, t] of this.registrados) if (ahora - t >= VENTANA_MS) this.registrados.delete(k);
  }
}
