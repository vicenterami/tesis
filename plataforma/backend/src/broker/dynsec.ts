// Administración del plugin Dynamic Security de Mosquitto por su tópico de control (docs/10 §8.4 puntos 26, 41 y 42). El
// backend es el administrador: crea el cliente de cada dispositivo al darlo de alta y lo borra si el alta se deshace; la baja
// y la rotación usan las mismas órdenes. Cada orden va en un JSON a `$CONTROL/dynamic-security/v1` con un `correlationData`
// propio; la respuesta llega por `$CONTROL/dynamic-security/v1/response`, solo al cliente que ordenó, y se empareja por ese
// dato. Esta clase no toca la red: recibe una función para publicar y otra para avisar lo recibido, así se prueba sin broker
// (`dynsec.spec.ts`); contra el broker real lo prueba el banco (`pruebas/banco/banco.sh alta`, docs/16 §20).
import { randomUUID } from 'node:crypto';

export const TOPICO_ORDENES = '$CONTROL/dynamic-security/v1';
export const TOPICO_RESPUESTAS = '$CONTROL/dynamic-security/v1/response';
export const ESPERA_RESPUESTA_MS = 5000;
// Identidad administradora del backend en el broker: distinta de `backend`, que solo recibe tramas (punto 41).
export const USUARIO_ADMIN = 'backend-admin';
// El rol que limita a cada dispositivo a su propio tópico (`sitio/+/dispositivo/%u/+`); lo crea `pruebas/broker-inicializar.sh`.
export const ROL_DISPOSITIVO = 'dispositivo';
// Pasarela o servidor de red externo (rutas B y C, docs/10 §8.4 punto 47): publica bajo su árbol, se suscribe a sus comandos.
export const ROL_PASARELA = 'pasarela';

export interface OrdenDynsec {
  command: string;
  [k: string]: unknown;
}
export interface RespuestaDynsec {
  command: string;
  correlationData?: string;
  error?: string;
  data?: unknown;
}

export class ErrorDynsec extends Error {
  // `ambiguo`: la orden pudo haberse ejecutado sin que llegara la confirmación (sin respuesta en el plazo, conexión perdida
  // después de publicar). Quien llama deshace por si acaso; un rechazo explícito del plugin nunca es ambiguo.
  constructor(public readonly orden: string, mensaje: string, public readonly ambiguo = false) {
    super(`${orden}: ${mensaje}`);
    this.name = 'ErrorDynsec';
  }
}

interface Pendiente {
  resolver: (r: RespuestaDynsec[]) => void;
  rechazar: (e: Error) => void;
  temporizador: ReturnType<typeof setTimeout>;
}

export class AdministradorDynsec {
  private readonly pendientes = new Map<string, Pendiente>();

  constructor(
    private readonly publicar: (topico: string, carga: string) => Promise<void>,
    private readonly esperaMs = ESPERA_RESPUESTA_MS,
  ) {}

  // Varias órdenes en un solo mensaje: el plugin las ejecuta en orden y responde una por una, todas en un mensaje. Si alguna
  // trae `error`, se rechaza con la primera; quien llama decide qué deshacer (el alta deshace la transacción de la base).
  async ordenar(ordenes: OrdenDynsec[]): Promise<RespuestaDynsec[]> {
    const correlacion = randomUUID();
    const carga = JSON.stringify({ commands: ordenes.map((o) => ({ ...o, correlationData: correlacion })) });
    const nombre = ordenes.map((o) => o.command).join('+');
    const respuesta = new Promise<RespuestaDynsec[]>((resolver, rechazar) => {
      const temporizador = setTimeout(() => {
        this.pendientes.delete(correlacion);
        rechazar(new ErrorDynsec(nombre, `sin respuesta del broker en ${this.esperaMs} ms`, true));
      }, this.esperaMs);
      this.pendientes.set(correlacion, { resolver, rechazar, temporizador });
    });
    try {
      await this.publicar(TOPICO_ORDENES, carga);
    } catch (e) {
      const p = this.pendientes.get(correlacion);
      if (p !== undefined) {
        clearTimeout(p.temporizador);
        this.pendientes.delete(correlacion);
      }
      const msg = (e as Error).message;
      throw new ErrorDynsec(nombre, `no se pudo publicar la orden: ${msg}`, !/sin conexión/.test(msg)); // sin conexión = no salió
    }
    const respuestas = await respuesta;
    const conError = respuestas.find((r) => r.error !== undefined);
    if (conError !== undefined) throw new ErrorDynsec(conError.command, conError.error ?? 'error');
    return respuestas;
  }

  // Lo que llega por el tópico de respuestas: {"responses":[{command, correlationData, error?, data?}, …]}. Lo que no se
  // entiende o no corresponde a una orden pendiente se ignora (otro administrador, un mensaje viejo).
  recibir(carga: string): void {
    let m: unknown;
    try {
      m = JSON.parse(carga);
    } catch {
      return;
    }
    const respuestas = (m as { responses?: unknown }).responses;
    if (!Array.isArray(respuestas)) return;
    const porCorrelacion = new Map<string, RespuestaDynsec[]>();
    for (const r of respuestas as RespuestaDynsec[]) {
      if (typeof r.correlationData !== 'string') continue;
      porCorrelacion.set(r.correlationData, [...(porCorrelacion.get(r.correlationData) ?? []), r]);
    }
    for (const [correlacion, lista] of porCorrelacion) {
      const p = this.pendientes.get(correlacion);
      if (p === undefined) continue;
      this.pendientes.delete(correlacion);
      clearTimeout(p.temporizador);
      p.resolver(lista);
    }
  }

  // Al perder la conexión, las órdenes en vuelo no van a responder: se rechazan ya, no a los 5 s.
  cancelarTodo(motivo: string): void {
    for (const [c, p] of this.pendientes) {
      clearTimeout(p.temporizador);
      p.rechazar(new ErrorDynsec('pendiente', motivo, true));
      this.pendientes.delete(c);
    }
  }

  get enVuelo(): number {
    return this.pendientes.size;
  }
}

// Las órdenes del alta, la baja y la rotación (docs/10 §3). El alta es UNA orden: `createClient` admite los roles en el
// mismo comando, así el cliente nace con su ACL o no nace (si el rol no existiera, el plugin rechaza todo el comando).
export function ordenesAlta(usuario: string, clave: string, rol: string): OrdenDynsec[] {
  return [{ command: 'createClient', username: usuario, password: clave, roles: [{ rolename: rol, priority: 1 }] }];
}
export function ordenesAltaDispositivo(usuario: string, clave: string): OrdenDynsec[] {
  return ordenesAlta(usuario, clave, ROL_DISPOSITIVO);
}
export function ordenesAltaPasarela(usuario: string, clave: string): OrdenDynsec[] {
  return ordenesAlta(usuario, clave, ROL_PASARELA);
}
export function ordenBaja(usuario: string): OrdenDynsec[] {
  return [{ command: 'deleteClient', username: usuario }];
}
export function ordenRotacion(usuario: string, clave: string): OrdenDynsec[] {
  return [{ command: 'setClientPassword', username: usuario, password: clave }];
}
