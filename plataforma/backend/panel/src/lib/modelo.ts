// Lo que devuelve la API (plataforma/backend/openapi.json y consulta.service.ts) y lo que emite el canal en vivo
// (eventos.service.ts). Los nombres son los de las columnas: el panel no renombra nada.
export type EstadoAdministrativo = 'activo' | 'mantenimiento' | 'baja';
export type TipoCondicion = 'sin_comunicacion' | 'umbral' | 'bateria' | 'manipulacion';

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
  condiciones_abiertas: number;
  canales: CanalResumen[];
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
  | { tipo: 'medicion'; dispositivo_id: string; canal_id: string; valor: number; unidad: string; tiempo: string }
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
  ultima_medicion: { valor: number; tiempo: string } | null;
}

// GET /dispositivos/{id}: lo mismo que el inventario más `creado_en`, y los canales con reglas y última lectura.
export interface DispositivoFicha extends Omit<DispositivoInventario, 'canales' | 'condiciones_abiertas'> {
  creado_en: string;
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
}

export interface TramaRechazada {
  id: string;
  origen: string;
  topico: string | null;
  motivo: 'no_registrado' | 'dado_de_baja' | 'malformada' | 'invalida';
  detalle: string | null;
  dispositivo: string | null;
  recibido_en: string;
  payload: string | null;
  payload_formato: string | null;
}
