// La sesión vista desde el panel (docs/20 §3; P10 en docs/19 §4). Lo que dice `GET /sesion` (sesion.service.ts, describir), qué puede
// hacer la persona en cada sitio según la matriz que trae la propia respuesta (`permisos`: rol → acciones, la tabla que decide en el
// servidor) y la renovación mientras la persona interactúa. El panel nunca decide un permiso: oculta o desactiva lo que el servidor
// rechazaría, y si se equivoca, el servidor responde 403 y el aviso lo dice.
import type { Preferencias } from './modelo';

export type Rol = 'administrador' | 'consulta' | 'investigador' | 'operador';
export type Matriz = Readonly<Record<string, readonly string[]>>;

export interface SitioDeSesion {
  sitio_id: string;
  codigo: string;
  nombre: string;
  rol: Rol;
}

// Una persona con cookie, o el «usuario del sistema» (la clave de administrador por cabecera: solo la usan guiones y pruebas).
export type Sesion =
  | {
      sistema: false;
      usuario: { id: string; nombre: string; email: string };
      clave_temporal: boolean;
      sitios: SitioDeSesion[];
      expira_en: string | null;
      inactividad_vence_en: string | null;
      permisos: Matriz;
      // Las preferencias de la persona (docs/19 §4, tablero v2, H): llegan con la sesión cuando el backend las tenga; hasta entonces, nada.
      preferencias?: Preferencias | null;
      administrador_sistema?: boolean; // los cinco perfiles (docs/20 §2): administrador del sistema como persona
      // Términos de uso (docs/20 §12): con `pendiente`, el panel abre la pantalla de aceptación sin esperar el 403 de la primera lectura.
      terminos?: { version_vigente: number; version_aceptada: number | null; aceptados_en: string | null; pendiente: boolean };
    }
  | { sistema: true; nombre: string; sitios: 'todos'; rol: 'administrador'; permisos: Matriz; preferencias?: Preferencias | null; administrador_sistema?: boolean; terminos?: undefined };

// ¿Puede `accion` en el sitio de código `codigo`? Con el usuario del sistema, sí en todos. Sin la matriz (un backend anterior), no se
// supone nada: se deja al servidor (true) y su 403 se muestra.
export function puedeEn(s: Sesion | null, accion: string, codigo: string): boolean {
  if (s === null) return true;
  if (s.sistema) return true;
  const sitio = s.sitios.find((x) => x.codigo === codigo);
  if (sitio === undefined) return false;
  const acciones = s.permisos?.[sitio.rol];
  return acciones === undefined ? true : acciones.includes(accion);
}

// ¿Puede `accion` en algún sitio? (la pantalla de usuarios aparece solo para quien administra alguno).
export function puedeEnAlguno(s: Sesion | null, accion: string): boolean {
  if (s === null) return false;
  if (s.sistema) return true;
  return s.sitios.some((x) => (s.permisos?.[x.rol] ?? []).includes(accion));
}

// Respuesta de POST /sesion y de POST /sesion/clave (sesion.controller.ts).
export interface SesionAbierta {
  usuario: { id: string; nombre: string; email: string; clave_temporal: boolean };
  expira_en: string;
}
// ── Lo que hace el panel cuando el cliente HTTP avisa que la sesión se perdió (401) o tiene clave temporal (403) ─────────────────
// Puro, para probarlo sin DOM (App.svelte lo aplica). 401: «Entrar», guardando la ruta si se estaba dentro; se olvida la sesión y la
// temporal recién escrita (que no quede en memoria tras perder la sesión). 403 por clave temporal: el cambio obligatorio, pero solo con
// sesión; en «Entrar» o sin sesión es un aviso atrasado y se ignora (el cliente HTTP ya descarta los de una sesión anterior).
export type Fase = 'comprobando' | 'sin_servicio' | 'entrar' | 'cambiar' | 'terminos' | 'dentro';
export interface EstadoPanel {
  fase: Fase;
  sesion: Sesion | null;
  claveRecienUsada: string | null;
  cambiandoClave: boolean;
  rutaGuardada: string | null;
  mensajeEntrar: string | null;
}
export const TEXTO_VENCIDA = 'Tu sesión venció o se cerró: entra de nuevo para seguir donde estabas.';
// 403 por términos sin aceptar (docs/20 §12): la pantalla «Términos de uso», solo con sesión; la clave temporal va primero (si la fase
// es «cambiar», se queda ahí: el servidor pedirá los términos después del cambio). La ruta se guarda para volver tras aceptar.
export function trasAvisoDeSesion(e: EstadoPanel, motivo: 'sin_sesion' | 'clave_temporal' | 'terminos', rutaActual: string): EstadoPanel {
  if (motivo === 'clave_temporal') return e.fase === 'entrar' || e.sesion === null ? e : { ...e, fase: 'cambiar' };
  if (motivo === 'terminos') {
    if (e.fase === 'entrar' || e.fase === 'cambiar' || e.sesion === null) return e;
    return { ...e, fase: 'terminos', cambiandoClave: false, rutaGuardada: e.fase === 'dentro' ? rutaActual : e.rutaGuardada };
  }
  const estaba = e.fase === 'dentro' || e.fase === 'cambiar' || e.fase === 'terminos';
  return {
    fase: 'entrar',
    sesion: null,
    claveRecienUsada: null,
    cambiandoClave: false,
    rutaGuardada: estaba ? rutaActual : e.rutaGuardada,
    mensajeEntrar: estaba ? TEXTO_VENCIDA : e.mensajeEntrar,
  };
}

// El texto de P10 ante cualquier rechazo de credenciales: uno solo, sea cual sea la causa (docs/20 §4).
export const TEXTO_CREDENCIALES = 'Correo o clave incorrectos. Revisa los dos y vuelve a intentarlo.';

export const ROTULO_ROL: Readonly<Record<Rol, string>> = { administrador: 'administrador', consulta: 'consulta', investigador: 'investigación', operador: 'operación técnica' };

// «Ana · Campus (administrador), Magallanes (consulta)»: quién soy, para la cabecera.
export function quienSoy(s: Sesion): { nombre: string; sitios: string } {
  if (s.sistema) return { nombre: s.nombre, sitios: 'todos los sitios (administrador)' };
  return { nombre: s.usuario.nombre, sitios: s.sitios.length === 0 ? 'sin sitios asignados' : s.sitios.map((x) => `${x.nombre} (${ROTULO_ROL[x.rol] ?? x.rol})`).join(', ') };
}

// ── Renovación (docs/20 §3): un `GET /sesion` liviano como mucho cada 5 minutos, y solo si la persona interactúa ───────────────────
// La sesión vence a los 30 min sin actividad. Cada petición a la API ya la renueva (el guardia), pero una pantalla que solo recibe el
// canal en vivo no hace peticiones: si la persona mueve el ratón o teclea, se renueva aquí. Una pantalla fija sin nadie delante vence
// (para eso está la vista pública, §7). `ahora` se inyecta para probarlo con un reloj simulado.
export const RENOVAR_CADA_MS = 5 * 60_000;
export interface Renovador {
  actividad(): void; // la persona interactuó
  renovado(): void; // otra parte del panel acaba de hablar con el servidor (la sesión ya se renovó)
}
export function crearRenovador(renovar: () => Promise<unknown>, ahora: () => number = Date.now, cada = RENOVAR_CADA_MS): Renovador {
  let ultima = ahora();
  let enVuelo = false;
  return {
    actividad() {
      if (enVuelo || ahora() - ultima < cada) return;
      enVuelo = true;
      ultima = ahora();
      renovar()
        .catch(() => undefined) // un 401 lo trata el cliente HTTP (vuelve al inicio de sesión); sin red, se intenta en la próxima
        .finally(() => (enVuelo = false));
    },
    renovado() {
      ultima = ahora();
    },
  };
}
