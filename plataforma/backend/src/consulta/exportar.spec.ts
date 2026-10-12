import { CABECERA_CSV, celdaCsv, filaCsv, filaJson, formato, nombreDeArchivo } from './exportar';

const F = { tiempo: new Date('2026-10-12T15:00:00Z'), magnitud: 'temperatura', valor: 21.5, unidad: 'Cel', canal_id: 'c1' };

describe('exportación (RF-34): CSV estándar y JSON por fila', () => {
  it('una fila CSV: ISO UTC, punto decimal, coma, CRLF; y la cabecera fija', () => {
    expect(filaCsv(F)).toBe('2026-10-12T15:00:00.000Z,temperatura,21.5,Cel,c1\r\n');
    expect(CABECERA_CSV).toBe('tiempo_utc,magnitud,valor,unidad,canal_id');
  });
  it('celdas con coma, comillas o salto de línea van entrecomilladas; las comillas se duplican', () => {
    expect(celdaCsv('a,b')).toBe('"a,b"');
    expect(celdaCsv('di "hola"')).toBe('"di ""hola"""');
    expect(celdaCsv('dos\nlíneas')).toBe('"dos\nlíneas"');
    expect(celdaCsv('simple')).toBe('simple');
  });
  it('inyección CSV: un texto que empieza con =, +, @ se protege; un número negativo no', () => {
    expect(celdaCsv('=1+1')).toBe("'=1+1");
    expect(celdaCsv('@cmd')).toBe("'@cmd");
    expect(celdaCsv('-3.5')).toBe('-3.5');
  });
  it('JSON: una línea por fila con los mismos campos', () =>
    expect(JSON.parse(filaJson(F))).toEqual({ tiempo_utc: '2026-10-12T15:00:00.000Z', magnitud: 'temperatura', valor: 21.5, unidad: 'Cel', canal_id: 'c1' }));
  it('nombre del archivo: identificador saneado y rango por día', () => {
    expect(nombreDeArchivo('dev 01/../x', new Date('2026-10-01T00:00:00Z'), new Date('2026-10-12T15:00:00Z'), 'csv')).toBe('dev_01_.._x_2026-10-01_2026-10-12.csv');
    expect(nombreDeArchivo('', F.tiempo, F.tiempo, 'json')).toBe('dispositivo_2026-10-12_2026-10-12.json');
  });
  it('formato: csv por defecto; json; otro o repetido → error', () => {
    expect(formato(undefined)).toBe('csv');
    expect(formato('json')).toBe('json');
    expect(() => formato('xlsx')).toThrow('formato');
    expect(() => formato(['csv'])).toThrow('formato');
  });
});
