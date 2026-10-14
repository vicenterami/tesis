// Decisiones de arranque que merecen prueba unitaria (docs/10 §6, docs/11 §3).

// Interfaz en la que escucha la API. Por defecto SOLO este equipo; en contenedor se fija 0.0.0.0.
// Se usa `||` y no `??` a propósito: una variable presente pero vacía (`HTTP_INTERFAZ=` en un .env)
// haría que Node escuchara en TODAS las interfaces en silencio. Vacío también significa «por defecto».
export function interfazDeEscucha(valor: string | undefined): string {
  return valor?.trim() || '127.0.0.1';
}

// ¿Se sirve la documentación interactiva /docs (Swagger UI)? Solo si HTTP_DOCS vale exactamente `si`
// (sin distinguir mayúsculas ni espacios). Ausente, vacía o cualquier otro valor = apagada: un servidor
// que olvide la variable queda cerrado, no abierto (seguro por omisión). En Internet, Swagger UI
// enumera las rutas y exige scripts en línea que la CSP del backend prohíbe; el contrato que se cita
// es el openapi.json versionado.
export function servirDocumentacion(valor: string | undefined): boolean {
  return (valor ?? '').trim().toLowerCase() === 'si';
}

// Formato de los registros (docs/10 §6): `json` = un evento por línea, sin color (contenedor, se filtra
// con jq); cualquier otro valor = texto con color para la terminal de desarrollo.
export function registrosEnJson(valor: string | undefined): boolean {
  return (valor ?? '').trim().toLowerCase() === 'json';
}

// ── Nombres de host permitidos (docs/11 §3; docs/10 §8.4 punto 40, decidido el 09/10/2026) ──────────────────────────
// Contra el DNS rebinding: una página maliciosa hace que su propio nombre resuelva a 127.0.0.1 y, como
// para el navegador sigue siendo su mismo origen, no la delatan ni Origin ni Sec-Fetch-Site; pero la
// petición llega con SU nombre en `Host`. Se compara ese nombre con una lista fija y lo demás se
// responde 421 (Misdirected Request). Solo el nombre, sin el puerto: el ataque cambia el nombre, y el
// puerto ya varía por entorno (3000, 5173 tras Vite, 8443 en el banco, 443 en el servidor); exigirlo
// sería una variable más por ambiente, lo que la decisión del 09/10 evitó para Origin. En el proxy, el
// `server_name` de nginx compara igual (sin puerto): las dos capas hacen lo mismo.

// Siempre aceptados: los nombres de loopback. Solo llegan desde el propio equipo o contenedor (el
// HEALTHCHECK del Dockerfile y el operador con curl; el proxy NO: reenvía el nombre público que mandó el
// cliente, y por eso ese nombre entra por HTTP_HOSTS), y una página ajena no puede hacer que el navegador
// los escriba en Host: para él, «localhost» es el equipo de la víctima.
export const HOSTS_LOCALES: readonly string[] = ['localhost', '127.0.0.1'];

// HTTP_HOSTS suma el nombre real del servidor (varios, separados por coma o espacio). Ausente o vacía =
// solo los locales, que es lo correcto en desarrollo y en el banco. Un IPv6 va entre corchetes ([::1]).
// Un nombre que no tenga forma de host (`;`, llaves, espacios, un salto de línea) detiene el arranque: el valor viene
// de PROXY_NOMBRE en el .env del servidor y nginx lo pega en su plantilla sin validarlo; si el backend no arranca, el
// proxy (que depende de él) tampoco, y el error se lee en el registro en vez de inyectarse en la configuración.
export function hostsPermitidos(valor: string | undefined): ReadonlySet<string> {
  const extra = (valor ?? '').split(/[\s,]+/).map((h) => h.trim().toLowerCase()).filter((h) => h !== '');
  const malo = extra.find((h) => !FORMA_NOMBRE.test(h));
  if (malo !== undefined) throw new Error(`HTTP_HOSTS: «${malo.slice(0, 80)}» no tiene forma de nombre de host`);
  return new Set([...HOSTS_LOCALES, ...extra]);
}

// Forma de un `Host` según RFC 9110 §7.2: nombre o IPv4, o IPv6 entre corchetes, y un puerto opcional.
// Cualquier otra cosa (vacío, «usuario@», barras, espacios) se trata como ilegible, no se intenta arreglar.
const FORMA_NOMBRE = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)$/i;
const FORMA_HOST = /^(\[[0-9a-f:.]+\]|[a-z0-9.-]+)(:[0-9]{1,5})?$/i;

// Nombre del `Host` en minúsculas y sin puerto, o undefined si no viene o es ilegible.
export function nombreDeHost(host: string | undefined): string | undefined {
  const m = FORMA_HOST.exec((host ?? '').trim());
  return m ? m[1].toLowerCase() : undefined;
}

// Por qué se rechaza la petición, o null si el Host está en la lista. El texto va al registro, acotado.
export function rechazoDeHost(host: string | undefined, permitidos: ReadonlySet<string>): string | null {
  const nombre = nombreDeHost(host);
  if (nombre === undefined) return `Host ausente o ilegible: ${String(host).slice(0, 80)}`;
  return permitidos.has(nombre) ? null : `Host ${nombre.slice(0, 80)} no está en la lista`;
}

// Avisos acotados (docs/11 §3): un rechazo se registra como WARN la primera vez y, después, a lo más una vez por
// ventana y por motivo, con cuántos se callaron. Sin esto, un cliente local que insista con un Host ajeno (o una página
// que abra el canal mil veces) escribe una línea por petición y la rotación de 10 MB × 5 descarta lo útil. Se silencia
// la repetición, no el hecho: el conteo sale en el aviso siguiente. Cota de memoria: con más de 1 000 motivos
// distintos (un atacante que varíe el nombre) se olvida todo y se empieza de nuevo.
export class AvisosAcotados {
  private readonly vistos = new Map<string, { desde: number; callados: number }>();
  constructor(private readonly ventanaMs = 60_000) {}

  // Texto a registrar ahora, o null si este motivo ya se avisó dentro de la ventana.
  registrar(motivo: string, ahora = Date.now()): string | null {
    const v = this.vistos.get(motivo);
    if (v !== undefined && ahora - v.desde < this.ventanaMs) {
      v.callados++;
      return null;
    }
    const callados = v?.callados ?? 0;
    if (this.vistos.size >= 1000) this.vistos.clear();
    this.vistos.set(motivo, { desde: ahora, callados: 0 });
    return callados > 0 ? `${motivo} (y ${callados} más en el último minuto)` : motivo;
  }
}

// Clave de administrador de las rutas que escriben, mientras no hay sesión (docs/10 §8.4 punto 41; docs/11 §3). Ausente o
// vacía: esas rutas responden 503, nunca quedan abiertas. Definida pero corta: el arranque falla, a propósito; una clave
// débil expuesta a la red es peor que ninguna. Mínimo 24 caracteres: lo que da `openssl rand -base64 24` son 32.
export const CLAVE_ADMIN_MINIMO = 24;
// Misma política para toda clave de administración que llega por el entorno (también MQTT_ADMIN_CLAVE, la del plugin del broker).
export function claveOpcional(nombre: string, valor: string | undefined): string | undefined {
  const v = (valor ?? '').trim();
  if (v === '') return undefined;
  if (v.length < CLAVE_ADMIN_MINIMO) {
    throw new Error(`${nombre} tiene ${v.length} caracteres; se exigen ${CLAVE_ADMIN_MINIMO} o más (openssl rand -base64 24)`);
  }
  return v;
}
export function claveAdmin(valor: string | undefined): string | undefined {
  return claveOpcional('HTTP_CLAVE_ADMIN', valor);
}

// Clave del rol de la aplicación en la base (migración 14; docs/10 §8.4 punto 44). Obligatoria: sin ella el backend no arranca y dice
// qué hacer, en vez de fallar después con un «password authentication failed» que no explica nada.
export function claveApp(valor: string | undefined): string {
  const v = claveOpcional('DB_APP_CLAVE', valor);
  if (v === undefined || v === 'CAMBIAR_ESTA_CLAVE') {
    throw new Error('DB_APP_CLAVE vacía o sin cambiar: escribirla en el .env (24 caracteres o más) y correr pruebas/base-rol-app.sh');
  }
  return v;
}

