// Unidades para personas (docs/19 §4, tablero v2, D7; P13). La base guarda siempre la unidad del catálogo (códigos de SenML, RFC 8428:
// «Cel», «%RH», «hPa»…); el panel la muestra con su símbolo desde ESTA tabla y, según la preferencia de la persona (°C o °F; mm, m o
// km), convierte solo al mostrar, con la unidad escrita al lado. Sin preferencia no se convierte nada: se muestra la unidad del
// catálogo (corrección del 11/11/2026; antes, «mm» por defecto convertía metros a milímetros sin que nadie lo pidiera). Nada vuelve a la base convertido: `aBase` existe para las pruebas de ida
// y vuelta y para cuando un formulario (P6) reciba un umbral en la unidad de la persona.
import type { Preferencias } from './modelo';

export interface PreferenciaUnidades {
  temperatura: 'C' | 'F' | null; // null: la del catálogo
  longitud: 'mm' | 'm' | 'km' | null;
}
// Sin preferencia guardada (o mientras `GET /sesion` no la traiga): ninguna conversión, la unidad del catálogo.
export const UNIDADES_POR_DEFECTO: PreferenciaUnidades = { temperatura: null, longitud: null };

// Las magnitudes de longitud, distancia o nivel, las únicas a las que se aplica la preferencia de longitud; nunca la precipitación en
// mm (una lámina de agua, que se lee en mm aunque la persona prefiera km). Lista explícita, de la tabla `magnitud` de la base
// (`plataforma/db/init/*.sql`, revisado el 11/11/2026): temperatura y temperatura_suelo (Cel), humedad (%RH), presion (hPa), bateria
// (%EL), rssi (dBm), pm2_5 y pm10 (ug/m3), tension y humedad_suelo (V). Ninguna es de longitud: la lista está vacía y se completa con
// el código de la magnitud el día que la base sume una (un nivel de estanque, una distancia).
export const MAGNITUDES_LONGITUD: readonly string[] = [];

export function preferenciaUnidades(p: Preferencias | null | undefined): PreferenciaUnidades {
  return {
    temperatura: p?.unidad_temperatura === 'C' || p?.unidad_temperatura === 'F' ? p.unidad_temperatura : null,
    longitud: p?.unidad_longitud === 'mm' || p?.unidad_longitud === 'm' || p?.unidad_longitud === 'km' ? p.unidad_longitud : null,
  };
}

// Código de SenML (o del catálogo) → símbolo para personas. Lo que no está aquí se muestra tal cual (nunca se inventa).
export const SIMBOLO: Readonly<Record<string, string>> = {
  Cel: '°C', K: 'K', '%RH': '%RH', '%EL': '%', '%': '%', hPa: 'hPa', Pa: 'Pa', kPa: 'kPa', dBm: 'dBm', dB: 'dB', V: 'V', mV: 'mV',
  A: 'A', W: 'W', Wh: 'Wh', lx: 'lx', ppm: 'ppm', 'm/s': 'm/s', m: 'm', mm: 'mm', km: 'km', s: 's', deg: '°', 'mm/h': 'mm/h',
  'g/m3': 'g/m³', 'ug/m3': 'µg/m³',
};

export interface Conversion {
  simbolo: string;
  desdeBase: (v: number) => number;
  aBase: (v: number) => number;
}
const identidad = (v: number): number => v;
// Longitudes: cuántos metros vale cada unidad.
const METROS: Readonly<Record<string, number>> = { mm: 0.001, m: 1, km: 1000 };

// `magnitud`: el código del catálogo; la longitud se convierte solo si está en `longitudes` (MAGNITUDES_LONGITUD).
export function conversion(unidad: string, p: PreferenciaUnidades = UNIDADES_POR_DEFECTO, magnitud: string | null = null, longitudes: readonly string[] = MAGNITUDES_LONGITUD): Conversion {
  if (unidad === 'Cel' && p.temperatura === 'F') return { simbolo: '°F', desdeBase: (c) => (c * 9) / 5 + 32, aBase: (f) => ((f - 32) * 5) / 9 };
  if (p.longitud !== null && magnitud !== null && longitudes.includes(magnitud) && unidad in METROS && unidad !== p.longitud) {
    const factor = METROS[unidad]! / METROS[p.longitud]!; // de la unidad guardada a la elegida
    return { simbolo: p.longitud, desdeBase: (v) => v * factor, aBase: (v) => v / factor };
  }
  return { simbolo: SIMBOLO[unidad] ?? unidad, desdeBase: identidad, aBase: identidad };
}

export const simbolo = (unidad: string, p?: PreferenciaUnidades, magnitud: string | null = null): string => conversion(unidad, p, magnitud).simbolo;

// Una serie entera (null queda null), para el gráfico.
export function convertirSerie(valores: readonly (number | null)[], c: Conversion): (number | null)[] {
  return c.desdeBase === identidad ? [...valores] : valores.map((v) => (v === null ? null : c.desdeBase(v)));
}
