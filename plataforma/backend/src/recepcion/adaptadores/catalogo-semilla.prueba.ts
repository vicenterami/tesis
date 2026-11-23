import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { DestinoClave, resolverDesde } from './mapa-claves.js';
import { CampoReceta, Receta } from './receta.js';

// SOLO PARA PRUEBAS (tsconfig.build.json excluye *.prueba.ts: no llega a dist). El catálogo que siembran las migraciones de db/init,
// leído del SQL tal cual: las unidades canónicas de las magnitudes, los alias de magnitud_alias y las recetas de fn_crear_receta
// (migración 27). Desde el bloque 3 de TT-12 la recepción lee todo eso de la base; las pruebas lo toman de aquí, de la misma fuente que
// la base, en vez de una copia en el código.
const DIR = join(import.meta.dirname, '../../../../db/init');
export const SQL_MIGRACIONES = readdirSync(DIR).filter((x) => x.endsWith('.sql')).sort()
  .map((f) => readFileSync(join(DIR, f), 'utf8')).join('\n');
export const M27 = readFileSync(join(DIR, '27-catalogo-editable.sql'), 'utf8');

// Código → unidad canónica, de los INSERT INTO magnitud (código, nombre, unidad, …). La regex exige «magnitud (» o «magnitud\n»: no toma
// los INSERT INTO magnitud_alias.
export const UNIDADES = new Map<string, string>();
for (const bloque of SQL_MIGRACIONES.match(/INSERT INTO magnitud[\s(][\s\S]*?;/g) ?? []) {
  for (const m of bloque.matchAll(/\(\s*'([a-z0-9_]+)',\s*'[^']*',\s*'([^']+)'/g)) UNIDADES.set(m[1], m[2]);
}

// Clave → magnitud y unidad, de los INSERT INTO magnitud_alias (clave, magnitud_codigo).
export const ALIAS_SEMILLA: Record<string, DestinoClave> = {};
for (const bloque of SQL_MIGRACIONES.match(/INSERT INTO magnitud_alias \(clave, magnitud_codigo\) VALUES[\s\S]*?;/g) ?? []) {
  for (const m of bloque.matchAll(/\('([^']+)',\s*'([^']+)'\)/g)) ALIAS_SEMILLA[m[1]] = { magnitud: m[2], unidad: UNIDADES.get(m[2]) ?? '' };
}
export const resolverSemilla = resolverDesde(ALIAS_SEMILLA);

// La receta sembrada con ese código, con la unidad de cada campo (como la entrega la consulta de la recepción).
export function recetaSembrada(codigo: string): Receta {
  const m = new RegExp(`PERFORM fn_crear_receta\\('${codigo}', '[^']*', (\\d+), '(\\[[\\s\\S]*?\\])'::jsonb`).exec(M27);
  if (!m) throw new Error(`la migración 27 no siembra ${codigo}`);
  const campos = (JSON.parse(m[2]) as Record<string, unknown>[]).map((c): CampoReceta => ({
    magnitud: c.magnitud_codigo as string, unidad: UNIDADES.get(c.magnitud_codigo as string) ?? '',
    desplazamiento: c.desplazamiento as number, tipo: c.tipo as CampoReceta['tipo'],
    sumar_antes: (c.sumar_antes as number | undefined) ?? 0, multiplicar_por: (c.multiplicar_por as number | undefined) ?? 1,
    dividir_por: (c.dividir_por as number | undefined) ?? 1,
  }));
  return { codigo, largo_bytes: Number(m[1]), campos };
}
export const RECETA_CAMPUS = recetaSembrada('campus-heltec-v3-v1');
// Las recetas sembradas, por código (lo que la consulta de la recepción encontraría para un nodo con ese decodificador).
export const recetaSiSembrada = (codigo: string | null | undefined): Receta | null => {
  if (!codigo) return null;
  try { return recetaSembrada(codigo); } catch { return null; }
};
