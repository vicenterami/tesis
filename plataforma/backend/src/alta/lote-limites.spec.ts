import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { MAX_CANALES } from './alta.dto.js';
import {
  COLUMNAS_LOTE, MAX_BYTES_LOTE, MAX_FILAS_LOTE, MAX_MAGNITUD, MAX_UNIDAD, TOPES_COLUMNA, TOPE_CANALES, filasDelCuerpo, plantillaLote,
} from './lote.js';
import { TOPE_CUERPO_LOTE } from '../arranque.js';

// Los límites del alta por lote, en el límite (docs/19 §4, N5 y N11): el peor caso de 500 filas con cada columna en su tope se MIDE en
// bytes UTF-8 (no se estima) y fija el tope del cuerpo, que es uno solo en el backend (MAX_BYTES_LOTE, que usa el lector de JSON) y en el
// proxy (client_max_body_size). 501 filas es 413; una celda sobre su tope es 400 con su fila.
const tres = (n: number): string => '€'.repeat(n); // tres bytes en UTF-8 y un carácter: el peor caso del texto libre
const CANALES_LLENOS = Array.from({ length: MAX_CANALES }, (_, i) => `${String(i).padStart(2, '0')}${'m'.repeat(MAX_MAGNITUD - 2)}:${tres(MAX_UNIDAD)}`).join(' | ');
const llena = (n: number): Record<string, unknown> => ({
  n, id_fisico: 'a'.repeat(63), nombre: tres(80), zona: tres(80), via: 'v'.repeat(80), formato: 'f'.repeat(80), intervalo_esperado_s: '9'.repeat(80),
  canales: CANALES_LLENOS, pasarela: 'p'.repeat(80), decodificador: 'd'.repeat(80),
});
// `n` con 16 cifras (el mayor entero seguro), creciente.
const peorCaso = (filas = MAX_FILAS_LOTE): { filas: Record<string, unknown>[]; huella: string } =>
  ({ filas: Array.from({ length: filas }, (_, i) => llena(Number.MAX_SAFE_INTEGER - filas + i + 1)), huella: 'a'.repeat(64) });

describe('el tope del cuerpo sale del peor caso medido', () => {
  it('cada columna llena está exactamente en su tope (la fila de la medición es el peor caso, no uno parecido)', () => {
    const f = llena(1);
    for (const c of COLUMNAS_LOTE) expect([c, String(f[c]).length]).toEqual([c, TOPES_COLUMNA[c]]);
    expect(CANALES_LLENOS.length).toBe(TOPE_CANALES);
  });
  it(`500 filas llenas caben en MAX_BYTES_LOTE (${MAX_BYTES_LOTE} bytes), y el tope no las pasa en más de 16 KiB`, () => {
    const bytes = Buffer.byteLength(JSON.stringify(peorCaso()));
    expect(bytes).toBeLessThanOrEqual(MAX_BYTES_LOTE);
    expect(MAX_BYTES_LOTE - bytes).toBeLessThan(16 * 1024);
    expect(TOPE_CUERPO_LOTE).toBe(MAX_BYTES_LOTE); // el lector de JSON usa el mismo número
  });
  it('500 filas llenas pasan la forma del cuerpo (ninguna celda sobre su tope); 501 es 413', () => {
    expect(filasDelCuerpo(peorCaso(), 'crear').filas).toHaveLength(MAX_FILAS_LOTE);
    expect(() => filasDelCuerpo(peorCaso(MAX_FILAS_LOTE + 1), 'crear')).toThrow(PayloadTooLargeException);
  });
  it('una celda un carácter sobre su tope es 400 con su fila; también una que no es texto ni número o que trae NUL', () => {
    const motivos = (fila: Record<string, unknown>): string[] => {
      try {
        filasDelCuerpo({ filas: [llena(1), fila] });
        return [];
      } catch (e) {
        expect(e).toBeInstanceOf(BadRequestException);
        return ((e as BadRequestException).getResponse() as { message: string[] }).message;
      }
    };
    for (const c of COLUMNAS_LOTE) {
      const t = TOPES_COLUMNA[c];
      expect(motivos({ ...llena(7), [c]: 'x'.repeat(t + 1) })).toEqual([`fila 7: ${c} pasa su tope de ${t} caracteres (trae ${t + 1})`]);
    }
    expect(motivos({ n: 8, nombre: true })).toEqual(['fila 8: nombre debe ser texto o número']);
    expect(motivos({ n: 8, nombre: null })).toEqual(['fila 8: nombre debe ser texto o número']);
    expect(motivos({ n: 8, canales: ['temperatura'] })).toEqual(['fila 8: canales debe ser texto o número']);
    expect(motivos({ n: 8, nombre: 'a\u0000b' })).toEqual(['fila 8: nombre trae el carácter NUL']);
    expect(motivos({ n: 8, color: 'x'.repeat(81) })).toEqual(['fila 8: color pasa su tope de 80 caracteres (trae 81)']); // columna desconocida: 80
    expect(motivos({ n: 8, intervalo_esperado_s: 60 })).toEqual([]); // un número es una celda válida
  });
  it('el proxy fija el mismo tope (client_max_body_size en bytes) que el backend', () => {
    const conf = readFileSync(new URL('../../../proxy/nginx.conf', import.meta.url), 'utf8');
    const topes = [...conf.matchAll(/^\s*client_max_body_size\s+(\S+);/gm)].map((m) => m[1]);
    expect(topes).toEqual([String(MAX_BYTES_LOTE)]);
  });
  it('la plantilla publica los mismos topes, max_filas, max_bytes y los separadores; las obligatorias son las que exige la validación', () => {
    const p = plantillaLote();
    expect(p.columnas.map((c) => c.nombre)).toEqual([...COLUMNAS_LOTE]);
    expect(Object.fromEntries(p.columnas.map((c) => [c.nombre, c.tope]))).toEqual(TOPES_COLUMNA);
    expect(p.columnas.filter((c) => c.obligatoria).map((c) => c.nombre)).toEqual(['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales']);
    expect(p).toMatchObject({ max_filas: MAX_FILAS_LOTE, max_bytes: MAX_BYTES_LOTE, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] } });
    expect(p.columnas.find((c) => c.nombre === 'canales')?.ejemplo).not.toContain(';'); // el ejemplo ya no trae «;» sin comillas
  });
});
