import { describe, expect, it, vi } from 'vitest';
import { ErrorApi } from './api';
import { celda, celdasCsv, crearConReintento, csvCredenciales, csvEjemplo, csvRechazadas, excedeBytes, leerCsv, type FilaInforme, type PlantillaLote } from './lote';

// P7, alta masiva (docs/19 §4, F2 y bloque N): el CSV en el navegador con la plantilla del servidor, el `n` de cada fila contando las
// vacías, y la creación en una petición con la misma llave si la respuesta se pierde.
const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
const OBLIGATORIAS = ['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales'];
const PLANTILLA: PlantillaLote = {
  columnas: COLS.map((nombre) => ({ nombre, obligatoria: OBLIGATORIAS.includes(nombre), tope: 80, ayuda: '', ejemplo: nombre === 'canales' ? 'temperatura:Cel | humedad:%RH' : nombre === 'id_fisico' ? 'nodo-ejemplo-01' : '' })),
  max_filas: 500, max_bytes: 1_467_392, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] },
};
const CAB = COLS.join(',');

describe('el CSV', () => {
  it('RFC 4180: comillas con coma, comillas dobles, salto dentro de una celda, CRLF y la marca BOM; las filas vacías se descartan pero cuentan en el número', () => {
    expect(celdasCsv('﻿a,"b,c","d ""e"""\r\n\r\n"f\ng",h,\r\n\r\n')).toEqual([{ n: 1, celdas: ['a', 'b,c', 'd "e"'] }, { n: 3, celdas: ['f\ng', 'h', ''] }]);
  });
  it('un CSV con una fila vacía en medio: cada `n` es la fila de la planilla (la cabecera es la 1)', () => {
    const l = leerCsv(`${CAB}\nn-1,Uno,Lab,,,60,temperatura,,\n\nn-2,Dos,Lab,,,60,temperatura,,\n,,,,,,,,\nn-3,Tres,Lab,,,60,temperatura,,`, PLANTILLA);
    expect(l.filas.map((f) => [f.n, f.id_fisico])).toEqual([[2, 'n-1'], [4, 'n-2'], [6, 'n-3']]);
  });
  it('cabecera de la plantilla: una columna desconocida, una obligatoria que falta, una repetida o más filas que max_filas se dicen antes de enviar nada; «motivo» se ignora', () => {
    expect(leerCsv(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,,`, PLANTILLA).filas).toEqual([{ n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: '60', canales: 'temperatura:Cel' }]);
    expect(leerCsv('id_fisico,nombre,zona,intervalo_esperado_s,canales,color\nx,y,z,1,w,v', PLANTILLA).errores[0]).toMatch(/columnas no admitidas: color/);
    expect(leerCsv('id_fisico,nombre,zona,canales\nx,y,z,w', PLANTILLA).errores[0]).toBe('faltan columnas: intervalo_esperado_s'); // la quinta obligatoria, de la plantilla
    expect(leerCsv(`${CAB},nombre\nx`, PLANTILLA).errores).toContain('columnas repetidas: nombre');
    expect(leerCsv(`${CAB}\n${'a,b,c,,,1,d,,\n'.repeat(3)}`, { ...PLANTILLA, max_filas: 2 }).errores).toEqual(['el archivo trae 3 filas y el máximo es 2: divídelo']);
    expect(leerCsv(`${CAB},motivo\nn-1,Uno,Lab,,,60,humedad,,,zona «X» no existe`, PLANTILLA).filas[0]).toEqual({ n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', intervalo_esperado_s: '60', canales: 'humedad' });
    expect(leerCsv('', PLANTILLA).errores).toEqual(['el archivo está vacío']);
    expect(leerCsv('x'.repeat(11), { ...PLANTILLA, max_bytes: 10 }).errores[0]).toMatch(/^el archivo pesa más de/);
  });
  it('el cuerpo se mide contra max_bytes antes de enviar', () => {
    expect(excedeBytes({ filas: [{ n: 2, nombre: '€'.repeat(4) }] }, { ...PLANTILLA, max_bytes: 30 })).toBe(true);
    expect(excedeBytes({ filas: [{ n: 2 }] }, PLANTILLA)).toBe(false);
  });
  it('lo que se descarga: credenciales tal cual (son para máquinas); rechazadas por su n con su motivo y una celda con forma de fórmula neutralizada; el ejemplo sale de la plantilla', () => {
    const filas: FilaInforme[] = [
      { n: 2, id_fisico: 'n-1', resultado: 'creada', motivo: null, id: 'u1', credencial: '-abc,1', topico: 't/1' },
      { n: 5, id_fisico: 'n-2', resultado: 'rechazada', motivo: 'zona «X» no existe', id: null, credencial: null, topico: null },
    ];
    expect(csvCredenciales(filas)).toBe('id_fisico,id,credencial,topico\r\nn-1,u1,"-abc,1",t/1\r\n');
    expect(csvRechazadas(COLS, [{ n: 2 }, { n: 5, id_fisico: 'n-2', nombre: '=HYPERLINK("x")', zona: 'X' }], filas)).toBe(`${CAB},motivo\r\nn-2,"'=HYPERLINK(""x"")",X,,,,,,,zona «X» no existe\r\n`);
    expect(celda('+1')).toBe("'+1");
    expect(csvEjemplo(PLANTILLA)).toBe(`${CAB}\r\nnodo-ejemplo-01,,,,,,temperatura:Cel | humedad:%RH,,\r\n`);
  });
});

describe('crear con la misma llave si la respuesta se pierde', () => {
  const sinEspera = (): Promise<void> => Promise.resolve();
  it('sin respuesta (0) o 502: se repite con LA MISMA llave; a la tercera falla, se rinde', async () => {
    const llaves: string[] = [];
    let n = 0;
    const r = await crearConReintento(async (k) => { llaves.push(k); n++; if (n < 3) throw new ErrorApi(n === 1 ? 0 : 502, '', ''); return 'ok'; }, 'llave-1234567890ab', sinEspera);
    expect([r, llaves]).toEqual(['ok', ['llave-1234567890ab', 'llave-1234567890ab', 'llave-1234567890ab']]);
    const siempre = vi.fn(async () => { throw new ErrorApi(0, '', ''); });
    await expect(crearConReintento(siempre, 'k', sinEspera)).rejects.toBeInstanceOf(ErrorApi);
    expect(siempre).toHaveBeenCalledTimes(3);
  });
  it('un 409 plan_cambio o un 400 son respuestas: no se repiten; un 409 lote_en_curso tras un corte sí (puede ser la propia petición en curso)', async () => {
    const plan = vi.fn(async () => { throw new ErrorApi(409, '', '', [], null, { codigo: 'plan_cambio' }); });
    await expect(crearConReintento(plan, 'k', sinEspera)).rejects.toBeInstanceOf(ErrorApi);
    expect(plan).toHaveBeenCalledTimes(1);
    const enCurso = vi.fn(async () => { throw new ErrorApi(409, '', '', [], null, { codigo: 'lote_en_curso' }); });
    await expect(crearConReintento(enCurso, 'k', sinEspera)).rejects.toBeInstanceOf(ErrorApi);
    expect(enCurso).toHaveBeenCalledTimes(1);
    let i = 0;
    const r = await crearConReintento(async () => { i++; if (i === 1) throw new ErrorApi(0, '', ''); if (i === 2) throw new ErrorApi(409, '', '', [], null, { codigo: 'lote_en_curso' }); return 'misma'; }, 'k', sinEspera);
    expect([r, i]).toEqual(['misma', 3]);
  });
});
