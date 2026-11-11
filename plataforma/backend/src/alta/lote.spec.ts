import { describe, expect, it } from 'vitest';
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { Catalogos, MAX_FILAS_LOTE, TasaPorPersona, filasDelCuerpo, modoLote, totales, validarLote } from './lote.js';

// Alta por lote (docs/19 §4, F2; docs/10 §8.4 punto 65 iv): fila por fila, con la misma validación del alta de a uno; las rechazadas no
// bloquean a las válidas; un id_fisico ya dado de alta es «existe» con su id. Catálogos falsos: sin base.
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const Z1 = '00000000-0000-4000-8000-0000000000a1';
const cat: Catalogos = {
  zonas: [
    { id: Z1, nombre: 'Laboratorio', sitio_id: S1, sitio_codigo: 'uct' },
    { id: '00000000-0000-4000-8000-0000000000a2', nombre: 'Patio', sitio_id: S1, sitio_codigo: 'uct' },
    { id: '00000000-0000-4000-8000-0000000000b1', nombre: 'Patio', sitio_id: S2, sitio_codigo: 'otro' },
  ],
  magnitudes: new Map([['temperatura', 'Cel'], ['humedad', '%RH']]),
  pasarelas: [{ id: '00000000-0000-4000-8000-0000000000c1', id_fisico: 'ug65-campus', sitio_id: S1, activo: true, formato: 'milesight' }],
  existentes: new Map([['nodo-viejo', { id: '00000000-0000-4000-8000-0000000000d1', estado: 'baja' }]]),
  idsDePasarela: new Set(['ug65-campus']),
  ajenos: new Set(['nodo-de-otro', 'pasarela-de-otro']),
};
const fila = (x: Record<string, unknown> = {}): Record<string, unknown> =>
  ({ id_fisico: 'nodo-01', nombre: 'Nodo 1', zona: 'Laboratorio', via: 'mqtt', formato: '', intervalo_esperado_s: '60', canales: 'temperatura:Cel;humedad', pasarela: '', ...x });

describe('validarLote', () => {
  it('RF-41: un id_fisico de un dispositivo o pasarela de otro sitio se rechaza sin id ni estado ni «existe»', () => {
    const r = validarLote([fila({ id_fisico: 'nodo-de-otro' }), fila({ id_fisico: 'pasarela-de-otro' }), fila({ id_fisico: 'nodo-viejo' })], cat);
    expect(r.informe.slice(0, 2).map((f) => [f.resultado, f.motivo, f.id])).toEqual([
      ['rechazada', 'identificador no disponible', null], ['rechazada', 'identificador no disponible', null],
    ]);
    expect(r.informe[2]).toMatchObject({ resultado: 'existe', id: '00000000-0000-4000-8000-0000000000d1' }); // el propio sí dice su id
    // Plantada: sin el conjunto de ajenos, el de otro sitio (si estuviera en `existentes`, como antes) devolvería su id.
    const antes = validarLote([fila({ id_fisico: 'nodo-de-otro' })], { ...cat, ajenos: new Set(), existentes: new Map([['nodo-de-otro', { id: 'x', estado: 'activo' }]]) });
    expect(antes.informe[0]).toMatchObject({ resultado: 'existe', id: 'x' });
  });
  it('una fila buena es «valida», con el número de su fila en el archivo (la 1 es la cabecera)', () => {
    const r = validarLote([fila()], cat);
    expect(r.informe).toEqual([{ n: 2, id_fisico: 'nodo-01', resultado: 'valida', motivo: null, id: null, credencial: null, topico: null }]);
    expect(r.altas[0]).toMatchObject({ n: 2, formato: 'senml', sitio_codigo: 'uct', alta: { zona_id: Z1, intervalo_esperado_s: 60, canales: [{ magnitud: 'temperatura' }, { magnitud: 'humedad' }] } });
  });
  it('las rechazadas no bloquean a las válidas, y cada una dice por qué (mismas reglas que el alta de a uno)', () => {
    const r = validarLote([
      fila(),
      fila({ id_fisico: 'Nodo_2' }), // forma del id_fisico
      fila({ id_fisico: 'nodo-03', canales: 'presion:hPa' }), // magnitud fuera del catálogo
      fila({ id_fisico: 'nodo-04', canales: 'temperatura:K' }), // unidad que no es la canónica
      fila({ id_fisico: 'nodo-05', zona: 'Patio' }), // nombre de zona en dos sitios
      fila({ id_fisico: 'nodo-06', zona: 'Bodega' }), // zona inexistente (o de un sitio ajeno: lo mismo)
      fila({ id_fisico: 'nodo-07', intervalo_esperado_s: '2' }),
      fila({ id_fisico: 'nodo-01' }), // repetida en el archivo
    ], cat);
    expect(r.informe.map((f) => f.resultado)).toEqual(['valida', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada', 'rechazada']);
    expect(r.informe[1]?.motivo).toMatch(/id_fisico: minúsculas/);
    expect(r.informe[2]?.motivo).toMatch(/magnitud desconocida: presion/);
    expect(r.informe[3]?.motivo).toMatch(/la unidad es Cel, no K/);
    expect(r.informe[4]?.motivo).toMatch(/más de un sitio: usa su id/);
    expect(r.informe[5]?.motivo).toMatch(/no existe en tus sitios/);
    expect(r.informe[6]?.motivo).toMatch(/intervalo_esperado_s/);
    expect(r.informe[7]?.motivo).toBe('id_fisico repetido: ya está en la fila 2');
    expect(r.altas).toHaveLength(1);
    expect(totales(r.informe)).toEqual({ validas: 1, rechazadas: 7, existentes: 0 });
  });
  it('un id_fisico que ya existe (aunque esté de baja) es «existe» con su id: reactivarlo es de su ficha, no se duplica', () => {
    const r = validarLote([fila({ id_fisico: 'nodo-viejo' })], cat);
    expect(r.informe[0]).toMatchObject({ resultado: 'existe', id: '00000000-0000-4000-8000-0000000000d1' });
    expect(r.informe[0]?.motivo).toMatch(/reactivarlo desde su ficha/);
    expect(totales(r.informe).existentes).toBe(1);
  });
  it('lorawan: la pasarela por su id_fisico, del mismo sitio; el nodo hereda su formato', () => {
    const r = validarLote([fila({ id_fisico: 'a84041000181b0e1', via: 'lorawan', pasarela: 'ug65-campus' })], cat);
    expect(r.informe[0]?.resultado).toBe('valida');
    expect(r.altas[0]?.formato).toBe('milesight');
    expect(validarLote([fila({ id_fisico: 'ug65-campus' })], cat).informe[0]?.motivo).toMatch(/ya lo usa una pasarela/);
  });
});

describe('forma del cuerpo, modo y límite de tasa', () => {
  it('justo en el tope pasa; una fila más es 413; vacío o sin `filas`, 400', () => {
    expect(filasDelCuerpo({ filas: Array.from({ length: MAX_FILAS_LOTE }, () => fila()) })).toHaveLength(MAX_FILAS_LOTE);
    expect(() => filasDelCuerpo({ filas: Array.from({ length: MAX_FILAS_LOTE + 1 }, () => fila()) })).toThrow(PayloadTooLargeException);
    for (const malo of [{}, { filas: [] }, [], null]) expect(() => filasDelCuerpo(malo)).toThrow(BadRequestException);
  });
  it('modo: validar o crear; otra cosa, 400', () => {
    expect(modoLote('crear')).toBe('crear');
    expect(() => modoLote('borrar')).toThrow(BadRequestException);
  });
  it('tasa: 10 por minuto por persona; la 11.ª no; otra persona sí; pasado el minuto, de nuevo', () => {
    const t = new TasaPorPersona(10, 60_000);
    for (let i = 0; i < 10; i++) expect(t.admitir('ana', 1_000)).toBe(true);
    expect(t.admitir('ana', 1_000)).toBe(false);
    expect(t.admitir('bruno', 1_000)).toBe(true);
    expect(t.admitir('ana', 61_001)).toBe(true);
  });
});
