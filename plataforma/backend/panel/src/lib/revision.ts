// La revisión del alta masiva (docs/19 §4, N7): lo que la tabla dice de cada fila, los cinco filtros y el detalle campo por campo. Funciones
// puras sobre el plan que devuelve el servidor (`FilaInforme`); la pantalla solo las dibuja.
import type { FilaInforme, FilaLote, Nota } from './lote';

export type FiltroLote = 'leidas' | 'valida' | 'existe' | 'rechazada' | 'aviso';
// Las cinco tarjetas, en su orden. «Leídas» no filtra; «Con aviso» es transversal: cuenta filas de cualquier resultado (no fuerza la fila en los otros).
export const FILTROS: readonly { id: FiltroLote; rotulo: string }[] = [
  { id: 'leidas', rotulo: 'Leídas' },
  { id: 'valida', rotulo: 'Se crean' },
  { id: 'existe', rotulo: 'Ya existen' },
  { id: 'rechazada', rotulo: 'No entran' },
  { id: 'aviso', rotulo: 'Con aviso' },
];

export function coincide(f: FilaInforme, filtro: FiltroLote): boolean {
  if (filtro === 'leidas') return true;
  if (filtro === 'aviso') return (f.avisos ?? []).length > 0;
  return f.resultado === filtro;
}
export function contar(informe: readonly FilaInforme[]): Record<FiltroLote, number> {
  return Object.fromEntries(FILTROS.map((x) => [x.id, informe.filter((f) => coincide(f, x.id)).length])) as Record<FiltroLote, number>;
}
// La revisión abre con «No entran» si hay alguna fila que no entra.
export const filtroInicial = (informe: readonly FilaInforme[]): FiltroLote => (informe.some((f) => f.resultado === 'rechazada') ? 'rechazada' : 'leidas');
// Las filas que se crean y traen avisos (la línea sobre la tabla).
export const conAvisoQueSeCrean = (informe: readonly FilaInforme[]): number => informe.filter((f) => f.resultado === 'valida' && (f.avisos ?? []).length > 0).length;

// «Qué pasa»: una frase con su icono; el tono es el del estado (§2) y nunca va solo: la frase y el icono lo dicen.
export type TonoFila = 'normal' | 'inactivo' | 'sin_senal';
export interface Frase { tono: TonoFila; icono: 'alta' | 'existe' | 'cerrar'; texto: string }
export function fraseDeFila(f: FilaInforme): Frase {
  const i = f.interpretada;
  if (f.resultado === 'valida' || f.resultado === 'creada') {
    const donde = i === null || i === undefined ? '' : ` en ${i.zona as string} (sitio ${i.sitio as string})`;
    return { tono: 'normal', icono: 'alta', texto: `${f.resultado === 'creada' ? 'Se creó' : 'Se crea'}${donde}` };
  }
  if (f.resultado === 'existe') {
    const estado = /está en (\S+?):/.exec(f.motivo ?? '')?.[1];
    if (estado === undefined) return { tono: 'inactivo', icono: 'existe', texto: 'Ya existe: no se toca' };
    return { tono: 'inactivo', icono: 'existe', texto: `Ya existe, ${estado === 'baja' ? 'dado de baja' : `en ${estado}`}: se reactiva desde su ficha` };
  }
  const m = f.motivos ?? [];
  const primero = m[0]?.texto ?? f.motivo ?? 'fila inválida';
  return { tono: 'sin_senal', icono: 'cerrar', texto: `No entra: ${primero}${m.length > 1 ? ` (y ${m.length - 1} más)` : ''}` };
}

// «Detalle» de la fila, en una línea: lo que se creará.
export function resumenDeFila(f: FilaInforme): string {
  const i = f.interpretada;
  if (i === null || i === undefined) return '';
  const canales = ((i.canales ?? []) as { magnitud: string }[]).map((c) => c.magnitud).join(', ');
  return `${i.via as string}, ${i.formato as string}, cada ${i.intervalo_esperado_s as number} s: ${canales}`;
}

// Lo interpretado campo por campo, en el orden de la plantilla, con la marca «por omisión» y los avisos y motivos junto a su campo. En una
// fila que no entra no hay nada interpretado: se muestra lo que la persona escribió, con sus motivos al lado.
export interface CampoRevisado { campo: string; valor: string; porOmision: boolean; avisos: string[]; motivos: string[] }
export interface RevisionDeFila { campos: CampoRevisado[]; sueltas: { tipo: 'aviso' | 'motivo'; campo: string; texto: string }[] }
export const CAMPO_TOPICO = 'topico';
export function camposDeFila(f: FilaInforme, origen: FilaLote | undefined, columnas: readonly string[]): RevisionDeFila {
  const i = f.interpretada ?? null;
  const valorDe = (c: string): string => {
    if (i === null) return origen?.[c] === undefined ? '' : String(origen[c]);
    if (c === 'zona') return `${i.zona as string} (sitio ${i.sitio as string})`;
    if (c === 'canales') return ((i.canales ?? []) as { magnitud: string; unidad: string }[]).map((k) => `${k.magnitud} en ${k.unidad}`).join(' | ');
    const v = i[c];
    return v === null || v === undefined ? '' : String(v);
  };
  const nombres = i === null ? [...columnas] : [...columnas, CAMPO_TOPICO];
  const delCampo = (lista: readonly Nota[] | undefined, c: string): string[] => (lista ?? []).filter((x) => x.campo === c).map((x) => x.texto);
  const campos = nombres.map((c) => ({
    campo: c,
    valor: c === CAMPO_TOPICO ? String(i?.topico ?? '') : valorDe(c),
    porOmision: i !== null && (f.por_defecto ?? []).includes(c),
    avisos: delCampo(f.avisos, c),
    motivos: delCampo(f.motivos, c),
  }));
  const sueltas = [
    ...(f.avisos ?? []).filter((x) => !nombres.includes(x.campo)).map((x) => ({ tipo: 'aviso' as const, campo: x.campo, texto: x.texto })),
    ...(f.motivos ?? []).filter((x) => !nombres.includes(x.campo)).map((x) => ({ tipo: 'motivo' as const, campo: x.campo, texto: x.texto })),
  ];
  return { campos, sueltas };
}

// De a cuántas filas se dibuja la revisión («Mostrar 100 más»).
export const DE_A = 100;
