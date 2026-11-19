// La memoria del alta masiva en la pestaña (docs/19 §4, bloques N y S), aparte de lib/lote.ts para que App.svelte la limpie al cerrar la
// sesión sin cargar el alta masiva en la primera carga (Alta.svelte se carga al abrirla).
import { alPerderSesion } from './api';
import type { ErrorExplicado, FilaInforme, FilaLote, FilaNoEntra } from './lote';

// Lo que se conserva de la pantalla en la memoria de la pestaña mientras la persona vuelve a entrar (la sesión venció: la aplicación muestra
// «Entrar» y, al volver, el alta masiva retoma el archivo leído). Nunca las credenciales: esas se olvidan al perder la sesión. `persona`: quién
// lo leyó; si después entra OTRA persona en esta pestaña, no lo ve: `retomarLoteDe` lo descarta entero antes de dibujar nada.
export const borradorLote: { persona: string | null; archivo: string | null; filas: FilaLote[]; noEntran: FilaNoEntra[]; aviso: ErrorExplicado | null } = {
  persona: null, archivo: null, filas: [], noEntran: [], aviso: null,
};
// Las credenciales sin descargar, en la memoria del módulo (docs/19 §4, bloque S, punto 7): «atrás» o un enlace del panel desmontan la
// pantalla y volver a `#/alta?modo=lote` reabre el paso 3 con ellas. Nunca en el almacenamiento del navegador ni en la dirección, y nunca se
// dibujan. Se borran al confirmar «Ya las guardé», al salir de la pantalla ya descargadas, al cerrar la sesión (App.svelte) o al vencer (abajo).
export const credencialesLote: { filas: FilaInforme[]; creadas: number; descargadas: boolean } = { filas: [], creadas: 0, descargadas: false };
export function olvidarCredencialesLote(): void {
  Object.assign(credencialesLote, { filas: [], creadas: 0, descargadas: false });
}
// Al cerrar la sesión, también lo leído: quien entre después en esta pestaña no ve el archivo de otra persona.
export function olvidarLote(): void {
  olvidarCredencialesLote();
  Object.assign(borradorLote, { persona: null, archivo: null, filas: [], noEntran: [], aviso: null });
}
// Al abrir el alta masiva: si lo que hay en memoria es de otra persona (su sesión venció y entró otra), se descarta entero (archivo, filas,
// aviso y credenciales); si es de la misma, se retoma. Sin persona conocida, no se decide nada.
export function retomarLoteDe(persona: string | null): void {
  if (persona !== null && borradorLote.persona !== null && borradorLote.persona !== persona) olvidarLote();
}
alPerderSesion((m) => { if (m === 'sin_sesion') olvidarCredencialesLote(); });
