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
  | { tipo: 'condicion'; dispositivo_id: string; condicion: string; estado: 'abierta' | 'cerrada' }
  | { tipo: 'latido'; tiempo: string };
