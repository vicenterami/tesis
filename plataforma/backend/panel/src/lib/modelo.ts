// Lo que devuelve la API (consulta.service.ts: la forma la fijan sus consultas; openapi.json describe las rutas pero no el cuerpo de
// cada respuesta) y lo que emite el canal en vivo (eventos.service.ts). Los nombres son los de las columnas: el panel no renombra nada.
// El panel y la API van siempre juntos (el backend sirve el panel desde la misma imagen): no se tolera un backend de otra versión.
export type EstadoAdministrativo = 'activo' | 'mantenimiento' | 'baja';
export type TipoCondicion = 'sin_comunicacion' | 'umbral' | 'bateria' | 'manipulacion' | 'tope_superado' | 'reloj_desviado';

export interface CanalResumen {
  id: string;
  magnitud: string;
  unidad: string;
}

export interface DispositivoInventario {
  id: string;
  id_fisico: string;
  nombre: string;
  estado: EstadoAdministrativo;
  via: string;
  formato: string;
  intervalo_esperado_s: number;
  visto_por_ultima_vez: string | null;
  en_linea: boolean | null;
  zona: string;
  sitio: string;
  zona_horaria: string;
  // Para filtrar (docs/19 P2): únicos, a diferencia de los nombres.
  sitio_codigo: string;
  zona_id: string;
  condiciones_abiertas: number;
  canales: CanalResumen[];
  // Tablero v2 (docs/19 §4, C): el estado visual con la regla de §2 escrita en SQL y la entrega del rango (B4c), en porcentaje o null
  // sin intervalo esperado. Opcionales: un backend anterior no los manda, y el panel recalcula el estado igual.
  estado_visual?: 'inactivo' | 'sin_senal' | 'alerta' | 'normal';
  entrega?: number | null;
}

export interface Condicion {
  id: string;
  tipo: TipoCondicion;
  abierta_en: string;
  cerrada_en: string | null;
  duracion_s: number;
  dispositivo_id: string;
  id_fisico: string;
  dispositivo: string;
  umbral_alto: number | null;
  umbral_bajo: number | null;
  magnitud: string | null;
}

export interface Salud {
  estado: string;
  base: string;
  tablas: number;
}

export type EventoVivo =
  | { tipo: 'medicion'; dispositivo_id: string; canal_id: string; valor: number; unidad: string; tiempo: string; porcentaje?: number | null } // opcional: un backend anterior no lo manda
  | { tipo: 'visto'; dispositivo_id: string; tiempo: string }
  | { tipo: 'condicion'; dispositivo_id: string; condicion: TipoCondicion | string; estado: 'abierta' | 'cerrada' }
  | { tipo: 'latido'; tiempo: string };

export interface ReglaUmbral {
  id: string;
  umbral_alto: number | null;
  umbral_bajo: number | null;
  histeresis: number | null;
}

export interface CanalFicha {
  id: string;
  magnitud: string;
  magnitud_nombre: string;
  unidad: string;
  etiqueta: string | null;
  reglas: ReglaUmbral[] | null;
  // porcentaje: con la calibración del canal (docs/10 §8.4 punto 51); null sin calibración
  ultima_medicion: { valor: number; tiempo: string; porcentaje: number | null } | null;
}

// GET /dispositivos/{id}: los campos del inventario más `creado_en`, con los canales ampliados (reglas y última lectura); su
// `condiciones_abiertas` es una lista de filas, no un número, y la ficha no la usa (pide /condiciones): por eso se omite.
export interface DispositivoFicha extends Omit<DispositivoInventario, 'canales' | 'condiciones_abiertas'> {
  creado_en: string;
  // Mediana de los intervalos entre las últimas 20 tramas, en segundos; null con menos de 3 (docs/19 §4, incremento 1, punto 3).
  intervalo_observado_s: number | null;
  canales: CanalFicha[];
}

// GET /canales/{id}/historico: columnar, listo para uPlot (tiempos en segundos Unix).
export interface Historico {
  canal_id: string;
  magnitud: string;
  unidad: string;
  zona_horaria: string;
  intervalo: string;
  desde: string;
  hasta: string;
  puntos: number;
  tiempos: number[];
  valores: number[];
  muestras: number[];
  // Tablero v2 (D3): mínimo y máximo por cubo (campos nuevos, compatibles: un backend anterior no los manda).
  minimos?: (number | null)[];
  maximos?: (number | null)[];
}

// ── Tablero v2 (docs/19 §4, I y «Campos»): lo que el panel lee de las rutas nuevas ─────────────────────────────────────────────────
export interface Sitio {
  id: string;
  codigo: string;
  nombre: string;
  zona_horaria: string;
  rol: string;
  zonas: { id: string; nombre: string }[];
}

export interface ResumenSitio {
  sitio: { id: string; codigo: string; nombre: string; zona_horaria: string };
  ventana: { desde: string; hasta: string; intervalo: string };
  dispositivos: { total: number; normal: number; alerta: number; sin_senal: number; inactivo: number };
  salud: { reportan: number; supervisados: number; porcentaje: number | null };
  condiciones_abiertas: { tipo: string; n: number }[];
  // cubos[].tiempo en segundos Unix, como `tiempos` de los históricos (lo declara el OpenAPI del resumen).
  tramas: { recibidas: number; rechazadas: number; cubos: { tiempo: number; recibidas: number; rechazadas: number }[] };
  atencion: { id: string; nombre: string; estado_visual: 'sin_senal' | 'alerta'; visto_por_ultima_vez: string | null; tipos: string[] }[];
  magnitudes: { codigo: string; nombre: string; unidad: string; canales: number }[];
  entrega: { id: string; nombre: string; recibidas: number; esperadas: number; porcentaje: number | null }[];
}

// GET /sitios/{id}/historico: la forma de Historico (sin canal) más mínimos, máximos y cuántos canales aportan por cubo.
export interface HistoricoSitio {
  magnitud: string;
  unidad: string;
  zona_horaria: string;
  intervalo: string;
  desde: string;
  hasta: string;
  puntos: number;
  tiempos: number[];
  valores: (number | null)[];
  minimos: (number | null)[];
  maximos: (number | null)[];
  n: number[];
}

// GET /dispositivos/{id}/historico: todos los canales alineados por cubo.
export interface HistoricoDispositivo {
  tiempos: number[];
  intervalo?: string;
  canales: { id: string; magnitud: string; magnitud_nombre: string; unidad: string; valores: (number | null)[]; minimos: (number | null)[]; maximos: (number | null)[] }[];
}

export interface EventoDispositivo {
  id: string;
  tipo: string;
  detalle: unknown;
  ocurrido_en: string;
  usuario: { id: string; nombre: string } | null;
}

export interface Preferencias {
  unidad_temperatura?: 'C' | 'F';
  unidad_longitud?: 'mm' | 'm' | 'km';
  zona_horaria?: string;
  tema?: 'sistema' | 'claro' | 'oscuro';
  sitio_predeterminado?: string | null;
}

export interface TramaRechazada {
  id: string;
  origen: string;
  topico: string | null;
  motivo: 'no_registrado' | 'dado_de_baja' | 'malformada' | 'invalida' | 'tope';
  detalle: string | null;
  dispositivo: string | null;
  recibido_en: string;
  payload: string | null;
  payload_formato: string | null;
}
