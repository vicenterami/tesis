// La persona que hizo algo (20/11/2026; RF-46; docs/19 §4, G): `{ id, nombre, correo }`. El correo distingue a dos cuentas con
// el mismo nombre; es null en una cuenta anonimizada (queda solo su marcador). Solo lo reciben quienes administran el sitio: el servidor decide.
// Un solo ayudante la escribe en los cuatro lugares (Persona.svelte: actividad, eventos de la ficha, «creado por» y «revocado por» de los
// enlaces) y, como texto para una lista desplegable, `rotuloPersona`.
export interface Persona { id: string; nombre: string; correo: string | null }

// «Nombre — correo» (el filtro de «Actividad»); sin correo, solo el nombre.
export function rotuloPersona(p: { nombre: string; correo?: string | null }): string {
  return p.correo === undefined || p.correo === null || p.correo === '' ? p.nombre : `${p.nombre} — ${p.correo}`;
}
