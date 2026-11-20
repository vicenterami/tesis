// La zona horaria propia de la persona (docs/19 §4, tablero v2, H y D7). Un solo lugar: App la fija desde las preferencias de la sesión
// y toda hora que el panel MUESTRA pasa por `zonaVista` (lib/tiempo.ts). Es estado reactivo ($state): al cambiarla en P13, las horas
// visibles se redibujan sin recargar. Lo que la persona ESCRIBE (fechas de un filtro, días de una exportación) no la usa: sigue en la
// zona del sitio.
let propia = $state<string | null>(null);

// Una zona IANA que este navegador conozca; todo lo demás («sitio», vacío, un nombre roto) vale como «la del sitio» (null).
function valida(z: unknown): string | null {
  if (typeof z !== 'string' || z === '' || z === 'sitio') return null;
  try {
    new Intl.DateTimeFormat('es-CL', { timeZone: z });
    return z;
  } catch {
    return null;
  }
}

export const zonaPropia = (): string | null => propia;
export function fijarZonaPropia(z: unknown): void {
  propia = valida(z);
}
