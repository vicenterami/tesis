import type { DispositivoInventario, TipoCondicion } from './modelo';

// Estado visual en cinco valores (docs/19 §2): una regla de presentación, calculada aquí con lo que la API ya devuelve. La primera regla
// que aplica manda, en este orden. Una sola tabla de casos (estado-visual-casos.json) prueba esta función, la del servidor (tablero.ts) y
// la versión SQL contra una base real. «esperando» («Esperando primera trama») desde el 18/11/2026.
export type EstadoVisual = 'inactivo' | 'sin_senal' | 'alerta' | 'esperando' | 'normal';

export const ROTULO: Readonly<Record<EstadoVisual, string>> = {
  inactivo: 'Inactivo',
  sin_senal: 'Sin señal',
  alerta: 'Alerta',
  esperando: 'Esperando primera trama',
  normal: 'Normal',
};

// Orden de atención en las listas: lo que requiere acción primero (docs/19 §4); quien espera su primera trama, después de Normal (aún no
// se le exige reportar) y antes de Inactivo. El mismo orden que ORDEN_ATENCION del servidor (tablero.ts).
export const ORDEN_ATENCION: readonly EstadoVisual[] = ['sin_senal', 'alerta', 'normal', 'esperando', 'inactivo'];

// tope_superado (docs/10 §8.4 punto 53) es una alerta del dispositivo, no del enlace: manda más de lo que cabe en su hora.
// reloj_desviado (punto 54) también: los datos siguen entrando, pero fechados por la recepción porque el reloj de su pasarela se desvió.
const TIPOS_DE_ALERTA: readonly TipoCondicion[] = ['umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado'];

// Lo que la regla necesita de un dispositivo (los campos de GET /dispositivos y de la ficha). `espera_hasta`: en_servicio_desde + la
// espera del sitio, solo mientras no haya enviado ninguna trama.
export type DatosEstado = Pick<DispositivoInventario, 'estado' | 'visto_por_ultima_vez' | 'intervalo_esperado_s' | 'en_servicio_desde' | 'espera_hasta'>;

export function estadoVisual(d: DatosEstado, abiertas: readonly TipoCondicion[], ahora: Date): EstadoVisual {
  if (d.estado !== 'activo') return 'inactivo';
  if (abiertas.includes('sin_comunicacion')) return 'sin_senal';
  if (d.visto_por_ultima_vez === null) return d.espera_hasta !== null && ahora.getTime() < Date.parse(d.espera_hasta) ? 'esperando' : 'sin_senal';
  if (enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora, d.en_servicio_desde) === false) return 'sin_senal';
  if (abiertas.some((t) => TIPOS_DE_ALERTA.includes(t))) return 'alerta';
  return 'normal';
}

// ¿Sigue en línea? La misma regla que la API (tablero.ts, SQL_EN_LINEA: el más reciente entre el último `visto` y `en_servicio_desde`,
// dentro de 2 × intervalo esperado), repetida aquí para recalcularla cuando llega un `visto` por el canal en vivo o pasa el tiempo, sin
// volver a pedir el inventario. Sin ninguna trama todavía → null (ni en línea ni fuera: manda la espera de la primera trama). Sin
// `enServicioDesde`, solo el `visto` (el canal callado de la ficha mira lo que de verdad llegó).
export function enLinea(visto: string | null, intervaloEsperadoS: number, ahora: Date, enServicioDesde: string | null = null): boolean | null {
  if (visto === null) return null;
  const desde = enServicioDesde === null ? Date.parse(visto) : Math.max(Date.parse(visto), Date.parse(enServicioDesde));
  return ahora.getTime() - desde <= intervaloEsperadoS * 2 * 1000;
}

// ¿Canal callado? (docs/19 §4, P3): el dispositivo está en línea pero ese canal no tiene lectura dentro de 2 × el intervalo
// esperado, la misma tolerancia de enLinea. Un canal sin ninguna lectura de un dispositivo que ya reporta también calla. Regla de
// presentación: no abre condición ni cambia el estado visual (corrida de 24 h: la presión calló 3 h con el equipo en «Normal»).
export function canalCallado(ultima: string | null, visto: string | null, intervaloEsperadoS: number, ahora: Date): boolean {
  if (enLinea(visto, intervaloEsperadoS, ahora) !== true) return false;
  return ultima === null || ahora.getTime() - Date.parse(ultima) > intervaloEsperadoS * 2 * 1000;
}

export function conteoPorEstado(estados: readonly EstadoVisual[]): Record<EstadoVisual, number> {
  const c: Record<EstadoVisual, number> = { sin_senal: 0, alerta: 0, normal: 0, esperando: 0, inactivo: 0 };
  for (const e of estados) c[e]++;
  return c;
}

// Primero por estado (orden de atención), después por nombre, sin distinguir mayúsculas ni acentos. El comparador de
// textos se crea una vez (con `localeCompare` se creaba uno por comparación: con 500 dispositivos son miles por reordenamiento).
const RANGO = Object.fromEntries(ORDEN_ATENCION.map((e, i) => [e, i])) as Readonly<Record<EstadoVisual, number>>;
const comparadorDeNombres = new Intl.Collator('es', { sensitivity: 'base' });
export function compararAtencion(a: { estado: EstadoVisual; nombre: string }, b: { estado: EstadoVisual; nombre: string }): number {
  return RANGO[a.estado] - RANGO[b.estado] || comparadorDeNombres.compare(a.nombre, b.nombre);
}

// Lo que una persona lee en vez del código del tipo de condición (docs/19 §6: ningún código interno a la vista).
export const ROTULO_CONDICION: Readonly<Record<string, string>> = {
  sin_comunicacion: 'Sin comunicación',
  umbral: 'Umbral',
  bateria: 'Batería',
  manipulacion: 'Manipulación',
  tope_superado: 'Tope superado',
  reloj_desviado: 'Reloj de pasarela desviado',
};
export const rotuloCondicion = (tipo: string): string => ROTULO_CONDICION[tipo] ?? tipo;

