// «Quién lo hizo» (docs/20 §10 R29; docs/21 §2, 20/11/2026): la persona viaja como { id, nombre, correo } en los cuatro lugares
// donde el servidor la muestra a quien administra un sitio (actividad, eventos de la ficha, «creado por» y «revocado por» de los enlaces).
// El correo distingue a dos cuentas con el mismo nombre (RF-46). Una cuenta anonimizada (`usuario.anonimizado_en` no nulo) conserva solo su
// marcador: correo nulo (su correo real ya no existe; el que queda es un marcador técnico que no se muestra). Un solo lugar escribe esta forma.
export interface PersonaAutor { id: string; nombre: string; correo: string | null }

// Fragmento SQL para un alias de `usuario`: el objeto JSON de la persona, o NULL si el alias no encontró fila (LEFT JOIN sin cuenta).
export function sqlPersona(alias: string): string {
  return `CASE WHEN ${alias}.id IS NULL THEN NULL ELSE json_build_object('id', ${alias}.id, 'nombre', ${alias}.nombre, ` +
    `'correo', CASE WHEN ${alias}.anonimizado_en IS NULL THEN ${alias}.email END) END`;
}
