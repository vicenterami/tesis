// Actividad de un sitio (P14; docs/19 §4, G; RF-46, HU-11, HU-26): lo que hicieron las personas sobre los dispositivos del sitio (`evento`
// con `usuario_id`) y las entradas, salidas y bloqueos de quienes tienen membresía activa en él (`acceso`), mezclados por cursor
// (instante, id). La respuesta lleva el nombre de la persona (solo la ven quienes administran el sitio: docs/21 §2) y un texto para personas;
// nunca correos ni direcciones IP. Aquí, lo puro: el texto por tipo y la validación del filtro; la consulta, en ActividadService.

export const CLASES_ACTIVIDAD = ['evento', 'acceso'] as const;
export type ClaseActividad = (typeof CLASES_ACTIVIDAD)[number];
export const MAX_DIAS_ACTIVIDAD = 92; // un trimestre: la bitácora de accesos se borra a los 90 días
export const DIAS_ACTIVIDAD_POR_DEFECTO = 7;

// Texto por tipo de evento (los que escribe el backend con persona: alta, configuración, reglas, calibración, credenciales, baja, pasarelas)
// y por resultado de acceso (ck_acceso_resultado). Un tipo nuevo sin texto cae en el genérico: nunca un 500 ni un texto vacío.
const TEXTOS_EVENTO: Readonly<Record<string, (d: string) => string>> = {
  alta: (d) => `dio de alta ${d}`,
  baja: (d) => `dio de baja ${d}`,
  rotacion: (d) => `rotó la credencial de ${d}`,
  canal_calibrado: (d) => `calibró un canal de ${d}`,
  dispositivo_configurado: (d) => `cambió la configuración de ${d}`,
  reglas_cambiadas: (d) => `cambió los umbrales de ${d}`,
  condicion_abierta: (d) => `se abrió una condición en ${d}`,
  condicion_cerrada: (d) => `se cerró una condición en ${d}`,
};
// Eventos sin dispositivo (corrección del 11/11/2026): `o` es el nombre de la pasarela o de la persona sobre la que se hizo, o null.
const p = (o: string | null): string => (o === null ? 'una pasarela' : `la pasarela «${o}»`);
const c = (o: string | null): string => (o === null ? 'una cuenta' : `la cuenta de «${o}»`);
// Enlaces públicos (docs/19 §4, O, punto 4): `o` es el título del enlace (público por definición), o null.
const e = (o: string | null): string => (o === null ? 'un enlace público' : `el enlace público «${o}»`);
const TEXTOS_SIN_DISPOSITIVO: Readonly<Record<string, (o: string | null) => string>> = {
  pasarela_alta: (o) => `dio de alta ${p(o)}`,
  pasarela_baja: (o) => `dio de baja ${p(o)}`,
  pasarela_rotacion: (o) => `rotó la credencial de ${p(o)}`,
  usuario_alta: (o) => `dio de alta ${c(o)}`,
  usuario_cambio: (o) => `cambió ${c(o)}`,
  usuario_baja: () => 'se dio de baja (cuenta anonimizada)',
  usuario_clave: () => 'cambió su clave',
  terminos_aceptados: () => 'aceptó los términos de uso',
  enlace_creado: (o) => `publicó ${e(o)}`,
  enlace_renovado: (o) => `renovó ${e(o)}`,
  enlace_revocado: (o) => `revocó ${e(o)}`,
};
const TEXTOS_ACCESO: Readonly<Record<string, string>> = {
  ok: 'entró al sistema',
  cierre: 'cerró su sesión',
  clave_incorrecta: 'intentó entrar con una clave incorrecta',
  bloqueado: 'quedó bloqueada por intentos fallidos',
  inactivo: 'intentó entrar con la cuenta desactivada',
};

export function textoActividad(clase: ClaseActividad, tipo: string, dispositivo: string | null, detalle?: unknown, objeto: string | null = null): string {
  if (clase === 'acceso') return TEXTOS_ACCESO[tipo] ?? `acceso: ${tipo}`;
  // El tope de enlaces públicos del sitio (decidido el 17/11/2026): el número sale del detalle, solo si es un entero.
  if (tipo === 'enlace_tope') {
    const n = (detalle as { max_enlaces?: unknown } | undefined)?.max_enlaces;
    return Number.isInteger(n) ? `fijó en ${String(n)} el tope de enlaces públicos del sitio` : 'cambió el tope de enlaces públicos del sitio';
  }
  // El k de la vista pública del sitio (decidido el 17/11/2026, tras la tercera revisión).
  if (tipo === 'enlace_minimo') {
    const n = (detalle as { minimo_dispositivos?: unknown } | undefined)?.minimo_dispositivos;
    return Number.isInteger(n) ? `fijó en ${String(n)} el mínimo de dispositivos de la vista pública del sitio` : 'cambió el mínimo de dispositivos de la vista pública del sitio';
  }
  const sin = dispositivo === null ? TEXTOS_SIN_DISPOSITIVO[tipo] : undefined;
  if (sin !== undefined) return sin(objeto);
  const d = dispositivo === null ? 'un dispositivo' : `«${dispositivo}»`;
  const base = TEXTOS_EVENTO[tipo]?.(d) ?? `${tipo.replace(/_/g, ' ')} en ${d}`;
  // El canal de las reglas, si el detalle lo nombra (p. ej. «cambió los umbrales de "Nodo 3" (Humedad)»): solo texto corto y del sistema.
  const det = typeof detalle === 'object' && detalle !== null ? (detalle as Record<string, unknown>) : {};
  const magnitud = typeof det.magnitud === 'string' && det.magnitud.length <= 40 ? det.magnitud : null;
  return magnitud === null ? base : `${base} (${magnitud})`;
}

// El filtro `tipo`: un tipo de evento o un resultado de acceso, en minúsculas y con guion bajo (no se valida contra una lista: un tipo que no
// existe trae la lista vacía, como cualquier filtro sin coincidencias).
export function tipoValido(v: string): boolean {
  return /^[a-z_]{1,40}$/.test(v);
}
