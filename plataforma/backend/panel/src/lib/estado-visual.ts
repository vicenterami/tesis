import type { DispositivoInventario, TipoCondicion } from './modelo';

// Estado visual en cuatro valores (docs/19 §2): una regla de presentación, calculada aquí con lo que la API ya devuelve.
// No cambia el modelo de datos. La primera regla que aplica manda, en este orden.
export type EstadoVisual = 'inactivo' | 'sin_senal' | 'alerta' | 'normal';

export const ROTULO: Readonly<Record<EstadoVisual, string>> = {
  inactivo: 'Inactivo',
  sin_senal: 'Sin señal',
  alerta: 'Alerta',
  normal: 'Normal',
};

// Orden de atención en las listas: lo que requiere acción primero (docs/19 §4).
export const ORDEN_ATENCION: readonly EstadoVisual[] = ['sin_senal', 'alerta', 'normal', 'inactivo'];

const TIPOS_DE_ALERTA: readonly TipoCondicion[] = ['umbral', 'bateria', 'manipulacion'];

export function estadoVisual(
  d: Pick<DispositivoInventario, 'estado' | 'en_linea'>,
  abiertas: readonly TipoCondicion[],
): EstadoVisual {
  if (d.estado !== 'activo') return 'inactivo';
  if (abiertas.includes('sin_comunicacion') || d.en_linea === false) return 'sin_senal';
  if (abiertas.some((t) => TIPOS_DE_ALERTA.includes(t))) return 'alerta';
  return 'normal';
}

// ¿Sigue en línea? La misma regla que la API (consulta.service.ts: visto dentro de 2 × intervalo esperado), repetida aquí
// para recalcularla cuando llega un `visto` por el canal en vivo o pasa el tiempo, sin repedir el inventario. Sin
// ninguna trama todavía → null (ni en línea ni fuera: «sin tramas aún»).
export function enLinea(visto: string | null, intervaloEsperadoS: number, ahora: Date): boolean | null {
  if (visto === null) return null;
  return ahora.getTime() - Date.parse(visto) <= intervaloEsperadoS * 2 * 1000;
}

export function conteoPorEstado(estados: readonly EstadoVisual[]): Record<EstadoVisual, number> {
  const c: Record<EstadoVisual, number> = { sin_senal: 0, alerta: 0, normal: 0, inactivo: 0 };
  for (const e of estados) c[e]++;
  return c;
}

// Primero por estado (orden de atención), después por nombre, sin distinguir mayúsculas ni acentos.
export function compararAtencion(a: { estado: EstadoVisual; nombre: string }, b: { estado: EstadoVisual; nombre: string }): number {
  const pa = ORDEN_ATENCION.indexOf(a.estado);
  const pb = ORDEN_ATENCION.indexOf(b.estado);
  if (pa !== pb) return pa - pb;
  return a.nombre.localeCompare(b.nombre, 'es', { sensitivity: 'base' });
}
