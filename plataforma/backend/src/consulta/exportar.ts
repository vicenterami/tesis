// Exportación de mediciones crudas (RF-34, HU-08; docs/19 P8): lo que el académico entrevistado llamó «crítico y no negociable».
// Funciones puras, con prueba; el controlador solo las encadena sobre un flujo (nunca arma todo el archivo en memoria).

export const FORMATOS = ['csv', 'json'] as const;
export type Formato = (typeof FORMATOS)[number];

export interface FilaExportada {
  tiempo_utc: string; // texto exacto de la base, con microsegundos (un Date de JavaScript solo guarda milisegundos)
  magnitud: string;
  valor: number;
  unidad: string;
  canal_id: string;
}

export const CABECERA_CSV = 'tiempo_utc,magnitud,valor,unidad,canal_id';

// CSV estándar (RFC 4180): coma como separador, punto decimal, UTF-8, fin de línea CRLF. Es lo que leen R, Python y QGIS sin
// configurar nada; la variante para Excel en español (punto y coma, coma decimal) llega con el XLSX (Etapa 4).
export function filaCsv(f: FilaExportada): string {
  return [celdaCsv(f.tiempo_utc), celdaCsv(f.magnitud), celdaNumerica(f.valor), celdaCsv(f.unidad), celdaCsv(f.canal_id)].join(',') + '\r\n';
}

// Una celda de TEXTO con coma, comillas o salto de línea va entre comillas, con las comillas internas duplicadas. Si empieza con
// =, +, -, @, tabulador o retorno de carro se antepone un apóstrofo: una planilla lo interpretaría como fórmula (inyección CSV).
// Se aplica a toda columna de texto aunque hoy salga de un catálogo cerrado: la defensa no depende del catálogo.
export function celdaCsv(v: string): string {
  const protegida = /^[=+\-@\t\r]/.test(v) ? `'${v}` : v;
  return /[",\r\n]/.test(protegida) ? `"${protegida.replace(/"/g, '""')}"` : protegida;
}

// La única columna numérica: un número (también negativo o en notación científica) sale tal cual; lo que no sea un número
// finito sale vacío, nunca como texto que una planilla pueda ejecutar.
export function celdaNumerica(v: number): string {
  return Number.isFinite(v) ? String(v) : '';
}

export function filaJson(f: FilaExportada): string {
  return JSON.stringify({ tiempo_utc: f.tiempo_utc, magnitud: f.magnitud, valor: f.valor, unidad: f.unidad, canal_id: f.canal_id });
}

// Nombre del archivo descargado: identificador físico saneado y el rango, sin nada que un navegador o un sistema de archivos
// pueda interpretar (solo letras, dígitos, guion, punto y guion bajo).
export function nombreDeArchivo(idFisico: string, desde: Date, hasta: Date, formato: Formato): string {
  const limpio = idFisico.replace(/[^A-Za-z0-9._-]/g, '_').slice(0, 60) || 'dispositivo';
  const dia = (d: Date): string => d.toISOString().slice(0, 10);
  return `${limpio}_${dia(desde)}_${dia(hasta)}.${formato}`;
}

// Rango razonable para no mandar a la base fechas que `timestamptz` no admite (año −5000) ni pedir el futuro.
export function rangoRazonable(desde: Date, hasta: Date, ahora = new Date()): string | null {
  if (desde >= hasta) return 'desde debe ser anterior a hasta';
  if (desde.getUTCFullYear() < 2000) return 'desde debe ser posterior al año 2000';
  if (hasta.getTime() > ahora.getTime() + 86_400_000) return 'hasta no puede estar más de un día en el futuro';
  return null;
}

export function formato(valor: unknown): Formato {
  if (valor === undefined) return 'csv';
  if (typeof valor === 'string' && (FORMATOS as readonly string[]).includes(valor)) return valor as Formato;
  throw new Error(`formato debe ser uno de: ${FORMATOS.join(', ')}`);
}
