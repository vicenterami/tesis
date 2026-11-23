// Recetas de decodificación que el alta acepta en `decodificador` (alta de a uno, lote y el enum del OpenAPI). Desde el bloque 3 de TT-12
// (23/11/2026) la recepción NO usa esta lista: aplica la receta que lee de la base (receta_decodificacion, migración 27; receta.ts). Es la
// misma lista que las recetas sembradas (una prueba unitaria compara las dos); el bloque 5 la retira y el alta lee las recetas de la base.
export const PERFILES = ['campus-heltec-v3-v1'] as const;
export type Perfil = (typeof PERFILES)[number];

export const esPerfil = (v: unknown): v is Perfil => typeof v === 'string' && (PERFILES as readonly string[]).includes(v);
