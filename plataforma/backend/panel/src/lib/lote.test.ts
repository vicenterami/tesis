import { describe, expect, it } from 'vitest';
import { celda, celdasCsv, crearPorTandas, csvCredenciales, csvRechazadas, leerCsv, renumerar, type FilaInforme, type InformeLote } from './lote';

// P7, alta masiva (docs/19 §4, tablero v2, F2; D-103 A): el CSV en el navegador y la creación por tandas de 50.
const CAB = 'id_fisico,nombre,zona,via,formato,intervalo_esperado_s,canales,pasarela';

describe('el CSV', () => {
  it('RFC 4180: comillas con coma, comillas dobles, salto dentro de una celda, CRLF y la marca BOM de Excel; las filas vacías no cuentan', () => {
    expect(celdasCsv('﻿a,"b,c","d ""e"""\r\n"f\ng",h,\r\n\r\n')).toEqual([['a', 'b,c', 'd "e"'], ['f\ng', 'h', '']]);
  });
  it('cabecera fija: una columna desconocida, una que falta, una repetida o más de 500 filas se dicen antes de enviar nada; «motivo» se ignora', () => {
    expect(leerCsv(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,`).filas).toEqual([{ id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: '60', canales: 'temperatura:Cel' }]);
    expect(leerCsv('id_fisico,nombre,zona,canales,color\nx,y,z,w,v').errores[0]).toMatch(/columnas no admitidas: color/);
    expect(leerCsv('id_fisico,nombre,canales\nx,y,z').errores[0]).toBe('faltan columnas: zona');
    expect(leerCsv(`${CAB},nombre\nx`).errores).toContain('columnas repetidas: nombre');
    expect(leerCsv(`${CAB}\n${'a,b,c,,,,d,\n'.repeat(501)}`).errores).toEqual(['el archivo trae 501 filas y el máximo es 500: divídelo']);
    expect(leerCsv(`${CAB},motivo\nn-1,Uno,Lab,,,,humedad,,zona «X» no existe`).filas[0]).toEqual({ id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', canales: 'humedad' });
    expect(leerCsv('').errores).toEqual(['el archivo está vacío']);
  });
  it('lo que se descarga: credenciales tal cual (son para máquinas); rechazadas con su motivo y una celda con forma de fórmula neutralizada', () => {
    const filas: FilaInforme[] = [
      { n: 2, id_fisico: 'n-1', resultado: 'creada', motivo: null, id: 'u1', credencial: '-abc,1', topico: 't/1' },
      { n: 3, id_fisico: 'n-2', resultado: 'rechazada', motivo: 'zona «X» no existe', id: null, credencial: null, topico: null },
    ];
    expect(csvCredenciales(filas)).toBe('id_fisico,id,credencial,topico\r\nn-1,u1,"-abc,1",t/1\r\n');
    expect(csvRechazadas([{}, { id_fisico: 'n-2', nombre: '=HYPERLINK("x")', zona: 'X' }], filas)).toBe(`${CAB},motivo\r\nn-2,"'=HYPERLINK(""x"")",X,,,,,,zona «X» no existe\r\n`);
    expect(celda('+1')).toBe("'+1");
  });
});

describe('crear por tandas (D-103 A)', () => {
  const informe = (filas: { id_fisico?: string }[], resultado: FilaInforme['resultado'] = 'creada'): InformeLote =>
    ({ validas: 0, rechazadas: 0, existentes: 0, filas: filas.map((f, i) => ({ n: i + 2, id_fisico: f.id_fisico ?? '', resultado, motivo: null, id: `id-${f.id_fisico}`, credencial: `c-${f.id_fisico}`, topico: null })) });

  it('el n del servidor vuelve a la fila del archivo', () => {
    expect(renumerar(informe([{ id_fisico: 'a' }, { id_fisico: 'b' }]), [7, 40]).map((f) => [f.n, f.id_fisico])).toEqual([[7, 'a'], [40, 'b']]);
  });
  it('120 filas → 3 tandas de 50, 50 y 20, una tras otra; si la segunda falla, se detiene con lo creado y las 70 restantes pendientes; reintentar las crea', async () => {
    const filas = Array.from({ length: 120 }, (_, i) => i + 2);
    const enviadas: number[] = [];
    let enVuelo = 0;
    let fallar = true;
    const enviar = async (lote: { id_fisico?: string }[]): Promise<InformeLote> => {
      enVuelo++;
      expect(enVuelo).toBe(1); // nunca dos en vuelo
      await Promise.resolve();
      enVuelo--;
      enviadas.push(lote.length);
      if (enviadas.length === 2 && fallar) throw new Error('el proxy cortó');
      return informe(lote);
    };
    const avances: string[] = [];
    const r = await crearPorTandas(filas, (n) => ({ id_fisico: `n-${n}` }), enviar, (a) => avances.push(`${a.creadas} de ${a.total}`));
    expect(enviadas).toEqual([50, 50]);
    expect(r.filas).toHaveLength(50);
    expect(r.filas[49]).toMatchObject({ n: 51, id_fisico: 'n-51', credencial: 'c-n-51' });
    expect(r.pendientes).toEqual(filas.slice(50));
    expect(String(r.error)).toContain('el proxy cortó');
    expect(avances).toEqual(['50 de 120']);
    fallar = false;
    enviadas.length = 0;
    const r2 = await crearPorTandas(r.pendientes, (n) => ({ id_fisico: `n-${n}` }), enviar, (a) => avances.push(`${a.creadas} de ${a.total}`));
    expect(enviadas).toEqual([50, 20]);
    expect(r2).toMatchObject({ pendientes: [], error: null });
    expect(r2.filas.at(-1)).toMatchObject({ n: 121, id_fisico: 'n-121' });
    expect(avances.slice(1)).toEqual(['50 de 70', '70 de 70']);
  });
});
