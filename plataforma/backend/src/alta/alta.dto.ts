// Validación del cuerpo del alta (HU-11; docs/10 §3 y §8.4 punto 25): todo lo que llega es hostil hasta demostrar lo
// contrario. Devuelve el cuerpo limpio o lanza 400 con la lista de motivos. Lo que solo pone el sistema (estado inicial,
// instantes, credencial) no está en el tipo de entrada: ningún cliente puede mandarlo.
import { BadRequestException } from '@nestjs/common';
import { PERFILES, Perfil } from '../recepcion/adaptadores/perfiles';

export const VIAS = ['mqtt', 'http', 'lorawan'] as const;
// Formatos que declara un dispositivo directo (mqtt, http). Uno lorawan no declara formato: hereda el de su pasarela
// (milesight o chirpstack), y la base lo garantiza (fk_dispositivo_pasarela_formato y ck_dispositivo_via_formato, migración 15).
export const FORMATOS_DIRECTOS = ['senml', 'plano'] as const;
export const FORMATOS_PASARELA = ['milesight', 'chirpstack'] as const;
export const FORMATOS = [...FORMATOS_DIRECTOS, ...FORMATOS_PASARELA] as const;
export type Via = (typeof VIAS)[number];
export type Formato = (typeof FORMATOS)[number];

// Nombres que el broker reserva para el propio sistema (docs/11 §7): nunca pueden ser un dispositivo.
export const RESERVADOS = ['backend', 'backend-admin', 'sonda', 'admin'] as const;
// La misma lista blanca que exige la base (ck_dispositivo_id_fisico, migración 11): minúsculas, dígitos y guion, de 3 a 63.
// Es también el usuario del broker y se sustituye en el tópico de la ACL (%u), por eso no admite «_», «:» ni mayúsculas.
export const FORMA_ID_FISICO = /^[a-z0-9][a-z0-9-]{2,62}$/;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const MAX_CANALES = 20;

export interface CanalAlta {
  magnitud: string;
  etiqueta: string | null;
}
export interface AltaValidada {
  id_fisico: string;
  nombre: string;
  zona_id: string;
  via: Via;
  formato: Formato | null; // null en lorawan: lo pone el servicio desde la pasarela
  pasarela_id: string | null;
  decodificador: Perfil | null; // solo lorawan: perfil de decodificación cuando la pasarela entrega la trama sin decodificar (migración 17)
  intervalo_esperado_s: number;
  canales: CanalAlta[];
}

class Motivos {
  readonly lista: string[] = [];
  texto(v: unknown, nombre: string, min: number, max: number): string {
    if (typeof v !== 'string') {
      this.lista.push(`${nombre} debe ser texto`);
      return '';
    }
    const t = v.trim();
    if (t.length < min || t.length > max) this.lista.push(`${nombre} debe tener entre ${min} y ${max} caracteres`);
    return t;
  }
  uuid(v: unknown, nombre: string): string {
    const t = this.texto(v, nombre, 36, 36).toLowerCase();
    if (t !== '' && !UUID.test(t)) this.lista.push(`${nombre} no es un UUID válido`);
    return t;
  }
  opcion<T extends string>(v: unknown, nombre: string, opciones: readonly T[], porDefecto: T): T {
    if (typeof v === 'string' && (opciones as readonly string[]).includes(v)) return v as T;
    this.lista.push(`${nombre} debe ser una de: ${opciones.join(', ')}`);
    return porDefecto;
  }
}

export function validarAlta(cuerpo: unknown, reservadosExtra: readonly string[] = []): AltaValidada {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON']);
  const c = cuerpo as Record<string, unknown>;
  const m = new Motivos();
  const id_fisico = m.texto(c.id_fisico, 'id_fisico', 3, 63).toLowerCase();
  if (id_fisico !== '' && !FORMA_ID_FISICO.test(id_fisico)) m.lista.push('id_fisico: minúsculas, dígitos y guion, de 3 a 63 caracteres (la misma forma que exige la base)');
  if ((RESERVADOS as readonly string[]).includes(id_fisico) || reservadosExtra.includes(id_fisico)) m.lista.push(`id_fisico reservado para el sistema: ${id_fisico}`);
  const nombre = m.texto(c.nombre, 'nombre', 1, 80);
  const zona_id = m.uuid(c.zona_id, 'zona_id');
  const via = m.opcion(c.via, 'via', VIAS, 'mqtt');
  let formato: Formato | null = null;
  if (via === 'lorawan') {
    if (c.formato !== undefined) m.lista.push('formato: un dispositivo lorawan no lo declara, hereda el de su pasarela');
  } else {
    formato = c.formato === undefined ? 'senml' : m.opcion(c.formato, 'formato', FORMATOS_DIRECTOS, 'senml');
  }
  const pasarela_id = c.pasarela_id === undefined || c.pasarela_id === null ? null : m.uuid(c.pasarela_id, 'pasarela_id');
  if (via === 'lorawan' && pasarela_id === null) m.lista.push('un dispositivo lorawan necesita pasarela_id');
  if (via !== 'lorawan' && pasarela_id !== null) m.lista.push('pasarela_id solo aplica a la vía lorawan');
  // El mismo dominio que ck_dispositivo_decodificador y ck_dispositivo_decodificador_via (migración 17), con el mensaje claro.
  let decodificador: Perfil | null = null;
  if (c.decodificador !== undefined && c.decodificador !== null) {
    if (via !== 'lorawan') m.lista.push('decodificador solo aplica a la vía lorawan');
    else decodificador = m.opcion(c.decodificador, 'decodificador', PERFILES, PERFILES[0]);
  }
  const intervalo = c.intervalo_esperado_s;
  const intervaloValido = typeof intervalo === 'number' && Number.isInteger(intervalo) && intervalo >= 5 && intervalo <= 86_400;
  if (!intervaloValido) m.lista.push('intervalo_esperado_s debe ser un entero entre 5 y 86400 (segundos)');
  const canales: CanalAlta[] = [];
  if (!Array.isArray(c.canales) || c.canales.length < 1 || c.canales.length > MAX_CANALES) {
    m.lista.push(`canales debe ser una lista de 1 a ${MAX_CANALES} elementos`);
  } else {
    const vistas = new Set<string>();
    for (const [i, k] of (c.canales as unknown[]).entries()) {
      if (typeof k !== 'object' || k === null || Array.isArray(k)) {
        m.lista.push(`canales[${i}] debe ser un objeto`);
        continue;
      }
      const kk = k as Record<string, unknown>;
      const magnitud = m.texto(kk.magnitud, `canales[${i}].magnitud`, 1, 40).toLowerCase();
      if (vistas.has(magnitud)) m.lista.push(`canales[${i}].magnitud repetida: ${magnitud}`);
      vistas.add(magnitud);
      const etiqueta = kk.etiqueta === undefined || kk.etiqueta === null ? null : m.texto(kk.etiqueta, `canales[${i}].etiqueta`, 1, 40);
      canales.push({ magnitud, etiqueta });
    }
  }
  const permitidas = new Set(['id_fisico', 'nombre', 'zona_id', 'via', 'formato', 'pasarela_id', 'decodificador', 'intervalo_esperado_s', 'canales']);
  for (const k of Object.keys(c)) if (!permitidas.has(k)) m.lista.push(`campo no admitido: ${k}`);
  if (m.lista.length > 0) throw new BadRequestException(m.lista);
  return { id_fisico, nombre, zona_id, via, formato, pasarela_id, decodificador, intervalo_esperado_s: intervalo as number, canales };
}
