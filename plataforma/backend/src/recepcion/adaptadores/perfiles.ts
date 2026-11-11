import { Lectura } from '../lectura.js';
import { limpia } from '../texto.js';
import { TramaMalformada } from './adaptador.js';

// Perfiles de decodificación por dispositivo (docs/10 §8.4 punto 47; migración 17). Cuando la pasarela entrega el uplink sin
// decodificar (`data` en base64), el nodo puede declarar en el alta con qué perfil la decodifica la plataforma. La lista es la misma
// del CHECK ck_dispositivo_decodificador (una prueba unitaria compara las dos): agregar un perfil exige migración, no solo código.
// En la Etapa 4 los perfiles pasan al catálogo editable, por el mismo camino que el mapa de claves.
export const PERFILES = ['campus-heltec-v3-v1'] as const;
export type Perfil = (typeof PERFILES)[number];

// Un perfil traduce los bytes de la trama a lecturas, sin hora: la pone el adaptador. Lanza TramaMalformada si los bytes no
// tienen la forma que el perfil espera.
type Decodificar = (b: Buffer) => Omit<Lectura, 'tiempo'>[];

const DECODIFICADORES: Readonly<Record<Perfil, Decodificar>> = {
  // Nodos de la red del campus: 10 bytes, escritos desde la descripción de bytes de su operador (no se copió código) y verificados
  // con los de la captura del 15/10 (02 00 00 00 8f 07 18 19 98 af → 18,16 °C, 65,52 %, 3,75 V). Byte 0, identificador del nodo, y
  // 1 a 4, secuencia: no son magnitudes y quedan solo en la trama cruda.
  'campus-heltec-v3-v1': (b) => {
    if (b.length !== 10) throw new TramaMalformada(`perfil campus-heltec-v3-v1: se esperaban 10 bytes y llegaron ${b.length}`);
    return [
      { magnitud: 'temperatura', valor: b.readInt16BE(5) / 100, unidad: 'Cel' }, // ×100, entero de 16 bits con signo
      { magnitud: 'humedad', valor: b.readUInt16BE(7) / 100, unidad: '%RH' }, // ×100, sin signo
      { magnitud: 'tension', valor: (200 + b.readUInt8(9)) / 100, unidad: 'V' }, // V = 2,0 + valor/100; así, sin sumar decimales
    ];
  },
};

export const esPerfil = (v: unknown): v is Perfil => typeof v === 'string' && (PERFILES as readonly string[]).includes(v);

// Base64 estricto (RFC 4648 §4, con relleno): Buffer.from(…, 'base64') ignora en silencio lo que no es base64, y una `data`
// corrupta se decodificaría como otros bytes en vez de rechazarse.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

export function decodificar(perfil: string, data: unknown, tiempo: Date | undefined): Lectura[] {
  // El CHECK de la base ya cierra la lista; esto cubre una base sin migrar o un perfil retirado del código.
  if (!esPerfil(perfil)) throw new TramaMalformada(`perfil de decodificación desconocido: ${limpia(perfil)}`);
  if (typeof data !== 'string' || data === '' || !BASE64.test(data)) throw new TramaMalformada('data no es base64');
  return DECODIFICADORES[perfil](Buffer.from(data, 'base64')).map((l) => ({ ...l, tiempo }));
}
