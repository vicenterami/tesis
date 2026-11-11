import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { validarAlta } from './alta.dto.js';

const Z = '11111111-1111-4111-8111-111111111111';
const bueno = { id_fisico: 'Nodo-01', nombre: 'Invernadero', zona_id: Z, via: 'mqtt', intervalo_esperado_s: 60, canales: [{ magnitud: 'temperatura' }, { magnitud: 'humedad', etiqueta: 'suelo' }] };
const motivos = (c: unknown): string[] => {
  try { validarAlta(c); return []; } catch (e) { return ((e as BadRequestException).getResponse() as { message: string[] }).message; }
};

describe('validarAlta (HU-11): el cuerpo limpio o los motivos', () => {
  it('un cuerpo correcto se normaliza: id en minúsculas, formato senml por defecto, etiqueta nula si falta', () => {
    const v = validarAlta(bueno);
    expect(v.id_fisico).toBe('nodo-01');
    expect(v.formato).toBe('senml');
    expect(v.canales).toEqual([{ magnitud: 'temperatura', etiqueta: null, escala_cero: null, escala_cien: null }, { magnitud: 'humedad', etiqueta: 'suelo', escala_cero: null, escala_cien: null }]);
    expect(v.pasarela_id).toBeNull();
  });
  it('rechaza nombres reservados del broker, identificadores con otra forma y campos que solo pone el sistema', () => {
    expect(motivos({ ...bueno, id_fisico: 'backend' })).toEqual(expect.arrayContaining([expect.stringContaining('reservado')]));
    expect(motivos({ ...bueno, id_fisico: 'con espacio' })).toEqual(expect.arrayContaining([expect.stringContaining('id_fisico')]));
    expect(motivos({ ...bueno, id_fisico: 'con_guion_bajo' })).toEqual(expect.arrayContaining([expect.stringContaining('id_fisico')])); // la base tampoco lo admite
    expect(motivos({ ...bueno, id_fisico: 'backend-admin' })).toEqual(expect.arrayContaining([expect.stringContaining('reservado')]));
    expect(validarAlta({ ...bueno, id_fisico: 'a'.repeat(63) }).id_fisico).toHaveLength(63);
    expect(() => validarAlta({ ...bueno, id_fisico: 'vigia' }, ['vigia'])).toThrow(BadRequestException); // el usuario de la sonda, si no se llama sonda
    expect(motivos({ ...bueno, id_fisico: 'a'.repeat(64) }).length).toBeGreaterThan(0);
    expect(motivos({ ...bueno, estado: 'activo' })).toEqual(['campo no admitido: estado']);
    expect(motivos({ ...bueno, credencial: 'x' })).toEqual(['campo no admitido: credencial']);
  });
  it('formato según la vía (migración 15): directo senml o plano; lorawan no lo declara, lo hereda de su pasarela', () => {
    expect(validarAlta({ ...bueno, formato: 'plano' }).formato).toBe('plano');
    expect(motivos({ ...bueno, formato: 'milesight' })).toEqual(expect.arrayContaining([expect.stringContaining('formato debe ser una de: senml, plano')]));
    expect(validarAlta({ ...bueno, via: 'lorawan', pasarela_id: Z }).formato).toBeNull();
    expect(motivos({ ...bueno, via: 'lorawan', pasarela_id: Z, formato: 'milesight' })).toEqual(expect.arrayContaining([expect.stringContaining('hereda el de su pasarela')]));
  });
  it('decodificador (migración 17): solo en la vía lorawan y de la lista de perfiles; ausente o nulo → null', () => {
    expect(validarAlta({ ...bueno, via: 'lorawan', pasarela_id: Z, decodificador: 'campus-heltec-v3-v1' }).decodificador).toBe('campus-heltec-v3-v1');
    expect(validarAlta({ ...bueno, via: 'lorawan', pasarela_id: Z }).decodificador).toBeNull();
    expect(validarAlta({ ...bueno, decodificador: null }).decodificador).toBeNull();
    expect(motivos({ ...bueno, decodificador: 'campus-heltec-v3-v1' })).toEqual(['decodificador solo aplica a la vía lorawan']);
    expect(motivos({ ...bueno, via: 'lorawan', pasarela_id: Z, decodificador: 'otro' })).toEqual(['decodificador debe ser una de: campus-heltec-v3-v1']);
  });
  it('la vía manda sobre la pasarela: lorawan la exige; las otras la prohíben', () => {
    expect(motivos({ ...bueno, via: 'lorawan' })).toEqual(expect.arrayContaining([expect.stringContaining('pasarela_id')]));
    expect(motivos({ ...bueno, pasarela_id: Z })).toEqual(expect.arrayContaining([expect.stringContaining('solo aplica')]));
    expect(validarAlta({ ...bueno, via: 'lorawan', pasarela_id: Z }).pasarela_id).toBe(Z);
  });
  it('intervalo entero entre 5 y 86400; canales entre 1 y 20 sin magnitud repetida', () => {
    expect(motivos({ ...bueno, intervalo_esperado_s: 2.5 })).toEqual(expect.arrayContaining([expect.stringContaining('intervalo')]));
    expect(motivos({ ...bueno, intervalo_esperado_s: '60' })).toEqual(expect.arrayContaining([expect.stringContaining('intervalo')]));
    expect(motivos({ ...bueno, canales: [] })).toEqual(expect.arrayContaining([expect.stringContaining('canales')]));
    expect(motivos({ ...bueno, canales: [{ magnitud: 'temperatura' }, { magnitud: 'Temperatura' }] })).toEqual(expect.arrayContaining([expect.stringContaining('repetida')]));
  });
  it('calibración en el alta (punto 51 (i)): las dos escalas o ninguna, finitas y distintas; el orden no importa', () => {
    const suelo = (k: Record<string, unknown>) => ({ ...bueno, canales: [{ magnitud: 'humedad_suelo', ...k }] });
    expect(validarAlta(suelo({ escala_cero: 2.205, escala_cien: 1.17 })).canales[0]).toEqual({ magnitud: 'humedad_suelo', etiqueta: null, escala_cero: 2.205, escala_cien: 1.17 });
    expect(validarAlta(suelo({ escala_cero: null, escala_cien: null })).canales[0]).toMatchObject({ escala_cero: null, escala_cien: null });
    expect(motivos(suelo({ escala_cero: 2.205 }))).toEqual([expect.stringContaining('canales[0].escala_cero y escala_cien van juntas')]);
    expect(motivos(suelo({ escala_cero: null, escala_cien: 1.17 }))).toEqual([expect.stringContaining('van juntas')]);
    expect(motivos(suelo({ escala_cero: 1.5, escala_cien: 1.5 }))).toEqual([expect.stringContaining('canales[0].escala_cero y escala_cien deben ser distintas')]);
    expect(motivos(suelo({ escala_cero: Number.NaN, escala_cien: 1 }))).toEqual(['canales[0].escala_cero debe ser un número finito']);
    expect(motivos(suelo({ escala_cero: 0, escala_cien: JSON.parse('1e400') as number }))).toEqual(['canales[0].escala_cien debe ser un número finito']); // JSON da Infinity
    expect(motivos(suelo({ escala_cero: '2.2', escala_cien: 1 }))).toEqual(['canales[0].escala_cero debe ser un número finito']);
  });
  it('lo que no es un objeto, o una lista, es 400 con un solo motivo', () => {
    expect(motivos('texto')).toEqual(['el cuerpo debe ser un objeto JSON']);
    expect(motivos([bueno])).toEqual(['el cuerpo debe ser un objeto JSON']);
    expect(motivos({}).length).toBeGreaterThan(3); // id_fisico, nombre, zona_id, via, intervalo, canales
  });
});
