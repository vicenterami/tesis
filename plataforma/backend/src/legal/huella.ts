// Huella de un texto legal (docs/21 §7, «Historial de versiones»): SHA-256 de una forma canónica y estable de lo que el servidor envía a la
// pantalla y NO depende de la instancia. Canónica = JSON con las claves de cada objeto en orden alfabético, los arreglos en su orden y las
// cadenas en Unicode NFC, sin espacios sobrantes: dos copias del mismo texto dan la misma huella en cualquier equipo, y cualquier cambio de un
// carácter (también una errata) da otra. La prueba legal.spec.ts compara la huella de hoy con la última fila del historial.
import { createHash } from 'node:crypto';

type Json = string | number | boolean | null | Json[] | { [clave: string]: Json };

function canonico(v: unknown): string {
  if (typeof v === 'string') return JSON.stringify(v.normalize('NFC'));
  if (typeof v === 'number') {
    if (!Number.isFinite(v)) throw new TypeError(`huella: un número no finito (${v}) se serializaría como null`);
    return JSON.stringify(v);
  }
  if (v === null || typeof v === 'boolean') return JSON.stringify(v);
  if (Array.isArray(v)) return `[${v.map(canonico).join(',')}]`;
  if (typeof v === 'object') {
    const o = v as Record<string, Json>;
    return `{${Object.keys(o).sort().map((k) => `${JSON.stringify(k.normalize('NFC'))}:${canonico(o[k])}`).join(',')}}`;
  }
  throw new TypeError(`huella: tipo no admitido (${typeof v})`);
}

export function formaCanonica(v: unknown): string { return canonico(v); }
export function huella(v: unknown): string { return createHash('sha256').update(canonico(v), 'utf8').digest('hex'); }
