import { describe, expect, it, vi } from 'vitest';
import { ErrorApi, descargarTexto } from './api';
import {
  ACCION_DE, ACCIONES_LOTE, CASOS_ERROR, FalloDeCreacion, ROTULO_ACCION, TEXTO_DE, baseDeDescarga, celda, celdasTabla, crearConReintento, csvCredenciales, csvPlantilla,
  csvRechazadas, describirCambios, excedeBytes, explicarError, filaQueNoEntra, leerCsv, leerJson, leerOrigen, mezclarPlan, motivoDeCelda, type CasoError, type FilaInforme, type PlantillaLote,
} from './lote';
// Las palabras del servidor para una celda mal formada (alta/lote.ts, TEXTOS_CELDA), como texto: el panel no puede decir otras (S1 y S4).
import fuenteLote from '../../../src/alta/lote.ts?raw';
import fuentePanel from './lote.ts?raw';
// El catálogo fijo de escenarios del alta masiva (docs/19 §4, S11): el mismo archivo que recorre el e2e en navegador real.
import ESCENARIOS_CSV from '../../e2e/datos/lote-escenarios.csv?raw';
import ESCENARIOS from '../../e2e/datos/lote-escenarios.json';

// P7, alta masiva (docs/19 §4, F2 y bloque N): el CSV en el navegador con la plantilla del servidor, el `n` de cada fila contando las
// vacías, y la creación en una petición con la misma llave si la respuesta se pierde.
const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
const OBLIGATORIAS = ['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales'];
// Los rótulos y los símbolos de la plantilla del servidor (alta/lote.ts, ROTULOS y SIMBOLOS_COLUMNA).
const ROTULOS: Record<string, string> = {
  id_fisico: 'Identificador', nombre: 'Nombre', zona: 'Zona', via: 'Vía', formato: 'Formato', intervalo_esperado_s: 'Cada cuánto reporta', canales: 'Canales', pasarela: 'Pasarela', decodificador: 'Decodificador',
};
const PLANTILLA: PlantillaLote = {
  columnas: COLS.map((nombre) => ({
    nombre, obligatoria: OBLIGATORIAS.includes(nombre), tope: 80, texto_libre: nombre === 'nombre' || nombre === 'zona', ayuda: '', ejemplo: nombre === 'canales' ? 'temperatura:Cel | humedad:%RH' : nombre === 'id_fisico' ? 'nodo-ejemplo-01' : '',
    rotulo: ROTULOS[nombre], simbolos: nombre === 'canales' ? '°º' : '',
  })),
  max_filas: 500, max_bytes: 1_147_904, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] },
};
const CAB = COLS.join(',');

describe('el CSV', () => {
  const SEPS = PLANTILLA.separadores.columnas;
  it('RFC 4180: comillas con el separador, comillas dobles, salto dentro de una celda, CRLF y la marca BOM; las filas vacías se descartan pero cuentan en el número', () => {
    expect(celdasTabla('\uFEFFa,"b,c","d ""e"""\r\n\r\n"f\ng",h,\r\n\r\n', SEPS).registros).toEqual([{ n: 1, celdas: ['a', 'b,c', 'd "e"'] }, { n: 3, celdas: ['f\ng', 'h', ''] }]);
    expect(celdasTabla('a;"b;c";d\n1;2;3', SEPS).registros).toEqual([{ n: 1, celdas: ['a', 'b;c', 'd'] }, { n: 2, celdas: ['1', '2', '3'] }]);
  });
  it('el separador es el de la cabecera, fuera de comillas: «;» con comas en una celda, tabulador de una planilla y coma', () => {
    expect(celdasTabla('a;b\n1,5;2', SEPS).registros[1]!.celdas).toEqual(['1,5', '2']);
    expect(celdasTabla('"a,b";c\n1;2', SEPS).registros[0]!.celdas).toEqual(['a,b', 'c']);
    expect(celdasTabla('a\tb\n1,5\t2', SEPS).registros[1]!.celdas).toEqual(['1,5', '2']);
    expect(celdasTabla('a,b\n1;5,2', SEPS).registros[1]!.celdas).toEqual(['1;5', '2']);
  });
  it('un CSV con una fila vacía en medio: cada `n` es la fila de la planilla (la cabecera es la 1)', () => {
    const l = leerCsv(`${CAB}\nn-1,Uno,Lab,,,60,temperatura,,\n\nn-2,Dos,Lab,,,60,temperatura,,\n,,,,,,,,\nn-3,Tres,Lab,,,60,temperatura,,`, PLANTILLA);
    expect(l.filas.map((f) => [f.n, f.id_fisico])).toEqual([[2, 'n-1'], [4, 'n-2'], [6, 'n-3']]);
  });
  it('cabecera de la plantilla: una columna desconocida, una obligatoria que falta, una repetida o más filas que max_filas se dicen antes de enviar nada; «fila» y «motivo» se ignoran', () => {
    expect(leerCsv(`${CAB}\nn-1,Uno,Lab,mqtt,senml,60,temperatura:Cel,,`, PLANTILLA).filas).toEqual([{ n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', via: 'mqtt', formato: 'senml', intervalo_esperado_s: '60', canales: 'temperatura:Cel' }]);
    expect(leerCsv('id_fisico,nombre,zona,intervalo_esperado_s,canales,color\nx,y,z,1,w,v', PLANTILLA).errores[0]).toEqual({ caso: 'columna_desconocida', texto: `La columna «color» no es de la plantilla. Las columnas son: ${COLS.join(', ')}.` });
    expect(leerCsv('id_fisico,nombre,zona,canales\nx,y,z,w', PLANTILLA).errores[0]).toEqual({ caso: 'falta_obligatoria', texto: 'Falta la columna obligatoria «intervalo_esperado_s».' }); // la quinta obligatoria, de la plantilla
    expect(leerCsv(`${CAB},nombre\nx`, PLANTILLA).errores).toContainEqual({ caso: 'columna_repetida', texto: 'La columna «nombre» está repetida en la cabecera.' });
    expect(leerCsv(`${CAB}\n${'a,b,c,,,1,d,,\n'.repeat(3)}`, { ...PLANTILLA, max_filas: 2 }).errores).toEqual([{ caso: 'demasiadas_filas', texto: 'El archivo trae 3 filas y el máximo es 2: divídelo en partes de 2 o menos.' }]);
    expect(leerCsv(`${CAB},fila,motivo\nn-1,Uno,Lab,,,60,humedad,,,7,zona «X» no existe`, PLANTILLA).filas[0]).toEqual({ n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', intervalo_esperado_s: '60', canales: 'humedad' });
    expect(leerCsv('', PLANTILLA).errores).toEqual([{ caso: 'archivo_vacio', texto: 'El archivo está vacío.' }]);
    expect(leerOrigen('x'.repeat(11), { ...PLANTILLA, max_bytes: 10 }).errores[0]?.caso).toBe('archivo_pesado');
  });
  it('S1: una fila con más o menos celdas que la cabecera no se envía y NO frena a las demás: «No entra», con lo que sobra o falta dicho en su motivo', () => {
    const l = leerCsv(`${CAB}\nn-1,Uno,Lab,,,60,temperatura,,,sobra\nn-2,Dos,Lab,,,60,temperatura,,\nn-3,Tres,Lab`, PLANTILLA);
    expect(l.errores).toEqual([]);
    expect(l.filas.map((f) => f.n)).toEqual([3]);
    expect(l.noEntran).toEqual([
      { fila: { n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', intervalo_esperado_s: '60', canales: 'temperatura' }, motivos: [{ campo: 'fila', texto: 'la fila trae 1 celda más que la cabecera («sobra»): ¿un separador de más dentro de una celda?' }] },
      { fila: { n: 4, id_fisico: 'n-3', nombre: 'Tres', zona: 'Lab' }, motivos: [{ campo: 'fila', texto: 'la fila trae 6 celdas menos que la cabecera: ¿falta un separador?' }] },
    ]);
  });
  it('S1: una celda con un carácter que no se admite, de control o sobre su tope deja fuera su fila, con todos sus motivos por campo, en las palabras de la persona', () => {
    const l = leerCsv(`${CAB}\nnodo-ñ,${'N'.repeat(81)},Lab,,,60,temperatura,,\nn-2,"Uno\nDos",Lab,,,60,temperatura:°C | humedad:%,,\nn-3,Tres,Lab,,,60,temperatura:°F,,`, PLANTILLA);
    expect(l.errores).toEqual([]);
    expect(l.noEntran?.map((x) => [x.fila.n, x.motivos])).toEqual([
      [2, [{ campo: 'id_fisico', texto: 'Identificador: trae «ñ», que no se admite: solo letras sin tilde ni eñe, dígitos y signos simples, sin comillas dobles ni barra invertida' },
        { campo: 'nombre', texto: 'Nombre: tiene 81 caracteres y el máximo es 80' }]],
      [3, [{ campo: 'nombre', texto: 'Nombre: trae un salto de línea, un tabulador u otro carácter de control, que no se admite' }]],
    ]);
    // «°» se admite en `canales` (la plantilla lo publica en `simbolos`), así que «°C» y «°F» llegan al servidor, que decide la unidad (S2).
    expect(l.filas.map((f) => f.n)).toEqual([4]);
    expect(motivoDeCelda(PLANTILLA.columnas.find((c) => c.nombre === 'canales')!, `${'°'.repeat(40)}x`)).toBe('Canales: tiene 81 caracteres, contando como dos cada «°», y el máximo es 80'); // en bytes, como el servidor, y dicho
  });
  it('S1 y S4: las palabras de una celda mal formada son las del servidor (alta/lote.ts): el bloque TEXTOS_CELDA es el mismo, letra por letra', () => {
    const bloque = (fuente: string): string => /export const TEXTOS_CELDA = \{[\s\S]*?\} as const;/.exec(fuente)?.[0] ?? 'no está';
    expect(bloque(fuentePanel)).toBe(bloque(fuenteLote));
    expect(bloque(fuenteLote)).not.toBe('no está');
    // Lo que se admite y cómo se contó, dicho (S2): en `canales`, «°» y «º» sí; el tope en bytes, con cada «°» como dos.
    const canales = PLANTILLA.columnas.find((c) => c.nombre === 'canales')!;
    expect(motivoDeCelda(canales, 'temperatura:é')).toBe('Canales: trae «é», que no se admite: solo letras sin tilde ni eñe, dígitos y signos simples, y también «°» y «º», sin comillas dobles ni barra invertida');
    expect(motivoDeCelda(PLANTILLA.columnas[0]!, 'nodo-é')).toBe('Identificador: trae «é», que no se admite: solo letras sin tilde ni eñe, dígitos y signos simples, sin comillas dobles ni barra invertida');
    expect(motivoDeCelda(canales, 'x'.repeat(81))).toBe('Canales: tiene 81 caracteres y el máximo es 80');
  });
  it('una sola columna (ningún separador de la plantilla) se avisa antes de enviar; con «;» o tabulador la cabecera se separa sola', () => {
    const l = leerCsv('id_fisico|nombre|zona\nx|y|z', PLANTILLA);
    expect([l.filas, l.errores[0]?.caso, l.errores[0]?.texto]).toEqual([[], 'una_columna', expect.stringContaining('La cabecera tiene una sola columna («id_fisico|nombre|zona»)')]);
    expect(leerCsv(CAB.replaceAll(',', ';') + '\nn-1;Uno;Lab;;;60;temperatura;;', PLANTILLA).filas).toHaveLength(1);
  });
  it('el BOM de Excel no se cuela en el primer nombre de columna', () => {
    expect(leerCsv(`﻿${CAB}\nn-1,Uno,Lab,,,60,temperatura,,`, PLANTILLA).filas[0]).toMatchObject({ id_fisico: 'n-1' });
    expect(leerCsv(`﻿${CAB}\nn-1,Uno,Lab,,,60,temperatura,,`, PLANTILLA).errores).toEqual([]);
  });
  it('el apóstrofo que agrega la descarga se quita cuando lo sigue un carácter de fórmula; un apóstrofo cualquiera se conserva', () => {
    const f = leerCsv(`${CAB}\nn-1,'-1+cmd|x,'＝1+2,,,60,temperatura,,\nn-2,'hola,Lab,,,'5,temperatura,,`, PLANTILLA).filas;
    expect([f[0]!.nombre, f[0]!.zona, f[1]!.nombre, f[1]!.intervalo_esperado_s]).toEqual(['-1+cmd|x', '＝1+2', "'hola", "'5"]);
  });
  it('el cuerpo se mide contra max_bytes antes de enviar', () => {
    expect(excedeBytes({ filas: [{ n: 2, nombre: '€'.repeat(4) }] }, { ...PLANTILLA, max_bytes: 30 })).toBe(true);
    expect(excedeBytes({ filas: [{ n: 2 }] }, PLANTILLA)).toBe(false);
  });
});

describe('los tres orígenes dan las mismas filas (docs/19 §4, N6)', () => {
  const sinN = (fs: { n: number }[]): Record<string, unknown>[] => fs.map(({ n: _n, ...resto }) => resto);
  const A = { id_fisico: 'n-1', nombre: 'Uno', zona: 'Zona norte', via: 'mqtt', intervalo_esperado_s: '60', canales: 'temperatura:Cel | humedad:%RH' };
  const B = { id_fisico: 'n-2', nombre: 'Dos, con coma', zona: 'Lab', intervalo_esperado_s: '300', canales: 'humedad' };
  const celdasDe = (o: Record<string, string>): string[] => COLS.map((c) => o[c] ?? '');
  const unir = (sep: string, o: Record<string, string>): string => celdasDe(o).map((c) => (c.includes(sep) || c.includes(',') ? `"${c}"` : c)).join(sep);
  const texto = (sep: string): string => `${COLS.join(sep)}\n${unir(sep, A)}\n\n${unir(sep, B)}`;
  it('archivo con coma, archivo con «;», pegado con tabuladores y JSON: la misma lista, y los números de fila de la planilla (la vacía cuenta)', () => {
    const coma = leerOrigen(texto(','), PLANTILLA);
    expect(coma.errores).toEqual([]);
    expect(coma.filas.map((f) => f.n)).toEqual([2, 4]);
    expect(leerOrigen(texto(';'), PLANTILLA)).toEqual(coma);
    expect(leerOrigen(texto('\t'), PLANTILLA)).toEqual(coma);
    const json = leerOrigen(JSON.stringify([A, B]), PLANTILLA);
    expect(json.errores).toEqual([]);
    expect(sinN(json.filas)).toEqual(sinN(coma.filas));
    expect(json.filas.map((f) => f.n)).toEqual([1, 2]); // en JSON, la posición más 1
    expect(coma.filas[1]!.nombre).toBe('Dos, con coma');
  });
  it('JSON: un número se vuelve texto como en un CSV; lo que no es una lista de objetos, una celda que no es texto ni número y una columna desconocida se dicen', () => {
    expect(leerJson(JSON.stringify([{ ...A, intervalo_esperado_s: 60, nombre: null }]), PLANTILLA).filas).toEqual([{ n: 1, id_fisico: 'n-1', zona: 'Zona norte', via: 'mqtt', intervalo_esperado_s: '60', canales: 'temperatura:Cel | humedad:%RH' }]);
    expect(leerJson('{"a":1}', PLANTILLA).errores[0]).toEqual({ caso: 'celda_invalida', texto: 'El JSON debe ser una lista de objetos con las columnas de la plantilla.' });
    expect(leerJson('[1, 2]', PLANTILLA).errores[0]?.caso).toBe('celda_invalida');
    expect(leerJson('[{', PLANTILLA).errores[0]?.texto).toContain('no se puede leer');
    // S1: una celda que no es texto ni número deja fuera su fila, no el archivo.
    const j = leerJson(JSON.stringify([{ ...A, nombre: true }, B]), PLANTILLA);
    expect([j.errores, j.filas.map((f) => f.n), j.noEntran?.map((x) => [x.fila.n, x.motivos])]).toEqual([[], [2], [[1, [{ campo: 'nombre', texto: 'Nombre: no es texto ni número' }]]]]);
    expect(leerJson(JSON.stringify([{ ...A, id_fisico: 12345678901234567890 }]), PLANTILLA).noEntran?.[0]?.motivos[0]?.texto).toBe('Identificador: el número no se puede leer tal como está escrito; escríbelo entre comillas');
    expect(leerJson(JSON.stringify([{ ...A, color: 'rojo' }]), PLANTILLA).errores[0]?.caso).toBe('columna_desconocida');
    expect(leerJson('[]', PLANTILLA).errores[0]?.caso).toBe('archivo_vacio');
    expect(leerJson(JSON.stringify([{ ...A, nombre: 'N'.repeat(81) }]), PLANTILLA).noEntran?.[0]?.motivos[0]?.texto).toBe('Nombre: tiene 81 caracteres y el máximo es 80');
  });
});

describe('lo que se descarga (docs/19 §4, N9)', () => {
  const rechazada = (n: number, motivo: string): FilaInforme => ({ n, id_fisico: 'n-2', resultado: 'rechazada', motivo, id: null, credencial: null, topico: null });
  it('credenciales tal cual (son para máquinas, con coma); el ejemplo sale de la plantilla con «;», BOM y CRLF', () => {
    const creada: FilaInforme = { n: 2, id_fisico: 'n-1', resultado: 'creada', motivo: null, id: 'u1', credencial: '-abc,1', topico: 't/1' };
    expect(csvCredenciales([creada])).toBe('id_fisico,id,credencial,destino\r\nn-1,u1,"-abc,1",t/1\r\n');
    expect(csvPlantilla(PLANTILLA)).toBe(`﻿${COLS.join(';')}\r\nnodo-ejemplo-01;;;;;;temperatura:Cel | humedad:%RH;;\r\n`);
  });
  it('el archivo de credenciales dice a dónde envía cada equipo según su vía: MQTT, su tópico; HTTP, POST /recepcion/<id>; LoRaWAN, por su pasarela, sin credencial', () => {
    const creada = (id_fisico: string, credencial: string | null, destino: string): FilaInforme => ({ n: 2, id_fisico, resultado: 'creada', motivo: null, id: `u-${id_fisico}`, credencial, topico: null, destino });
    expect(csvCredenciales([
      creada('n-1', 'c1', 'sitio/uct/dispositivo/n-1/<magnitud>'), creada('n-2', 'c2', 'POST /recepcion/n-2'), creada('0101010101010101', null, 'por su pasarela ug65-campus'),
    ]).split('\r\n')).toEqual([
      'id_fisico,id,credencial,destino', 'n-1,u-n-1,c1,sitio/uct/dispositivo/n-1/<magnitud>', 'n-2,u-n-2,c2,POST /recepcion/n-2', '0101010101010101,u-0101010101010101,,por su pasarela ug65-campus', '',
    ]);
  });
  it('fórmulas: «-1+cmd|…» y «＝1+2» salen con apóstrofo; un número entero («-5», «+3,2») queda intacto; tabulador y salto de línea también se neutralizan', () => {
    expect(celda('-1+cmd|\'!A0')).toBe("'-1+cmd|'!A0");
    expect(celda('＝1+2')).toBe("'＝1+2");
    for (const c of ['＋1', '－1', '＠x', '=SUMA(1)', '@x']) expect(celda(c)).toBe(`'${c}`);
    expect(celda('\tx')).toBe("'\tx");
    expect(celda('\nx')).toBe("\"'\nx\"");
    expect([celda('-5'), celda('+3,2'), celda('+3.2')]).toEqual(['-5', '"+3,2"', '+3.2']);
    expect(celda('-5 x')).toBe("'-5 x");
    expect(celda('-1+cmd', true)).toBe('-1+cmd'); // las credenciales no se alteran
  });
  it('«las que no entran»: «;», BOM, CRLF, las columnas de la plantilla en su orden y, al final, «fila» y «motivo»', () => {
    const texto = csvRechazadas(COLS, [{ n: 2 }, { n: 5, id_fisico: 'n-2', nombre: '=HYPERLINK("x")', zona: 'X; Y' }], [{ ...rechazada(5, 'zona «X» no existe') }, { n: 2, id_fisico: 'n-1', resultado: 'valida', motivo: null, id: null, credencial: null, topico: null }]);
    expect(texto).toBe(`﻿${COLS.join(';')};fila;motivo\r\nn-2;"'=HYPERLINK(""x"")";"X; Y";;;;;;;5;zona «X» no existe\r\n`);
  });
  it('lo descargado y vuelto a subir sin tocar da las mismas filas (con fórmulas, comillas, «;», números negativos, acentos y espacios en los bordes)', () => {
    // El origen es un archivo leído por el propio lector: el valor con espacios en los bordes llega ya recortado y debe hacer la ida y vuelta intacto.
    const origen = [CAB, `n-1,"-1+cmd|'!A0",＝1+2,,,-5,a:b; c:d,,`, `n-2,"@x ""con comillas"", y ñandú",+3,2,,,60,humedad,,`, 'n-3,"  con espacios  ",Lab,,,60,humedad,,']
      .join('\r\n').replace('＝1+2,,,-5', '"＝1+2",,,-5').replace('+3,2,,,60', '"+3,2",,,60');
    const primera = leerOrigen(origen, PLANTILLA);
    expect(primera.errores).toEqual([]);
    expect(primera.filas[2]!.nombre).toBe('con espacios');
    const texto = csvRechazadas(COLS, primera.filas, primera.filas.map((o) => rechazada(o.n, 'prueba')));
    expect(texto).toContain("n-1;'-1+cmd|'!A0;'＝1+2;"); // neutralizado al salir
    const l = leerOrigen(texto, PLANTILLA);
    expect(l.errores).toEqual([]);
    expect(l.filas.map(({ n: _n, ...f }) => f)).toEqual(primera.filas.map(({ n: _n, ...f }) => f));
    expect(l.filas.map((f) => f.n)).toEqual([2, 3, 4]); // los números del archivo nuevo; «fila» no se usa
    expect(celda('  con espacios  ')).toBe('"  con espacios  "'); // un valor con espacios en los bordes sale entre comillas
  });
  it('un valor escrito a mano que empieza con «=» se guarda tal cual y toda descarga lo neutraliza al salir; un apóstrofo escrito a mano antes de «=» se lee como el de la descarga (docs/19 §4, N9)', () => {
    const l = leerCsv(`${CAB}\nn-1,=hola,Lab,,,60,temperatura,,\nn-2,'=hola,Lab,,,60,temperatura,,`, PLANTILLA);
    expect(l.filas.map((f) => f.nombre)).toEqual(['=hola', '=hola']);
    expect(csvRechazadas(COLS, l.filas, l.filas.map((f) => rechazada(f.n, 'x')))).toContain("n-1;'=hola;Lab");
    expect(csvRechazadas(COLS, l.filas, l.filas.map((f) => rechazada(f.n, 'x')))).not.toContain(';=hola;');
  });
  it('el CSV de credenciales deja el identificador tal cual, aunque empiece con un carácter de fórmula', () => {
    const creada: FilaInforme = { n: 2, id_fisico: '-nodo', resultado: 'creada', motivo: null, id: 'u1', credencial: '-abc', topico: 't/1' };
    expect(csvCredenciales([creada])).toBe('id_fisico,id,credencial,destino\r\n-nodo,u1,-abc,t/1\r\n');
  });
  it('el nombre de la descarga de «las que no entran» conserva lo que admite el alfabeto de nombreDeArchivo y no cae al de por omisión', () => {
    expect(baseDeDescarga('lote (1).csv')).toBe('lote 1');
    expect(baseDeDescarga('../../ñandú*?.json')).toBe('ñandú');
    expect(baseDeDescarga('...csv')).toBe('lote');
    expect(baseDeDescarga(null)).toBe('lote');
    expect(descargarTexto('x', `no-entran-${baseDeDescarga('lote (1).csv')}.csv`, 'text/csv', { crearUrl: () => 'u', pulsar: () => undefined, liberarUrl: () => undefined }).nombre).toBe('no-entran-lote 1.csv');
  });
});

describe('comillas mal cerradas y números que pierden precisión', () => {
  it('una comilla sin cerrar, al final o en medio, se dice con su fila; texto pegado a una comilla de cierre también', () => {
    const sinCerrar = leerCsv(`${CAB}\nn-1,"Uno,Lab,,,60,temperatura,,`, PLANTILLA);
    expect(sinCerrar).toEqual({ filas: [], errores: [{ caso: 'celda_invalida', texto: 'Fila 2: comilla sin cerrar.' }] });
    const enMedio = leerCsv(`${CAB}\nn-1,"Uno,Lab,,,60,temperatura,,\nn-2,Dos,Lab,,,60,temperatura,,`, PLANTILLA);
    expect(enMedio.errores).toEqual([{ caso: 'celda_invalida', texto: 'Fila 2: comilla sin cerrar.' }]);
    const pegado = leerCsv(`${CAB}\nn-1\t"Uno"x\tLab`.replaceAll(CAB, CAB.replaceAll(',', '\t')), PLANTILLA);
    expect(pegado.errores[0]).toEqual({ caso: 'celda_invalida', texto: 'Fila 2: hay texto pegado a una comilla de cierre; separa las celdas con «tabulador».' });
    expect(leerCsv(`${CAB}\nn-1,"Uno",Lab,,,60,temperatura,,`, PLANTILLA).errores).toEqual([]); // lo legítimo pasa
  });
  it('JSON: dos claves que solo difieren en mayúsculas son una columna repetida; un número que pierde su escritura se rechaza, un entero seguro pasa', () => {
    expect(leerJson('[{"id_fisico":"a","ID_FISICO":"b"}]', PLANTILLA).errores).toEqual([{ caso: 'columna_repetida', texto: 'La columna «id_fisico» está repetida en la cabecera.' }]);
    const grande = leerJson('[{"id_fisico":12345678901234567890,"nombre":"x","zona":"Lab","intervalo_esperado_s":60,"canales":"humedad"}]', PLANTILLA);
    expect([grande.errores, grande.filas, grande.noEntran?.[0]?.motivos]).toEqual([[], [], [{ campo: 'id_fisico', texto: 'Identificador: el número no se puede leer tal como está escrito; escríbelo entre comillas' }]]);
    expect(leerJson('[{"id_fisico":"12345678901234567890","nombre":"x","zona":"Lab","intervalo_esperado_s":60,"canales":"humedad"}]', PLANTILLA).filas[0]).toMatchObject({ id_fisico: '12345678901234567890', intervalo_esperado_s: '60' });
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
    const e = await crearConReintento(siempre, 'k', sinEspera).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FalloDeCreacion);
    expect([(e as FalloDeCreacion).intento, (e as FalloDeCreacion).causa instanceof ErrorApi]).toEqual([3, true]); // en qué intento llegó
    expect(siempre).toHaveBeenCalledTimes(3);
    // Un 503 con `codigo` del backend es una respuesta: no se repite.
    const definitivo = vi.fn(async () => { throw new ErrorApi(503, '', '', [], null, { codigo: 'nada_creado' }); });
    await crearConReintento(definitivo, 'k', sinEspera).catch(() => undefined);
    expect(definitivo).toHaveBeenCalledTimes(1);
  });
  it('un 500 del servidor sin código es «no se sabe si se creó»: se repite con LA MISMA llave y, agotados los intentos, no ofrece una creación nueva', async () => {
    const llaves: string[] = [];
    const e = await crearConReintento(async (k) => { llaves.push(k); throw new ErrorApi(500, '', ''); }, 'llave-1234567890ab', sinEspera).catch((x: unknown) => x);
    expect(llaves).toEqual(['llave-1234567890ab', 'llave-1234567890ab', 'llave-1234567890ab']);
    const x = explicarError(e, { operacion: 'crear' });
    expect([x.caso, x.accion]).toEqual(['sin_respuesta', 'inventario']);
  });
  it('un 409 plan_cambio o un 400 son respuestas: no se repiten; un 409 lote_en_curso tras un corte sí (puede ser la propia petición en curso)', async () => {
    const plan = vi.fn(async () => { throw new ErrorApi(409, '', '', [], null, { codigo: 'plan_cambio' }); });
    await expect(crearConReintento(plan, 'k', sinEspera)).rejects.toBeInstanceOf(FalloDeCreacion);
    expect(plan).toHaveBeenCalledTimes(1);
    const enCurso = vi.fn(async () => { throw new ErrorApi(409, '', '', [], null, { codigo: 'lote_en_curso' }); });
    await expect(crearConReintento(enCurso, 'k', sinEspera)).rejects.toBeInstanceOf(FalloDeCreacion);
    expect(enCurso).toHaveBeenCalledTimes(1);
    let i = 0;
    const r = await crearConReintento(async () => { i++; if (i === 1) throw new ErrorApi(0, '', ''); if (i === 2) throw new ErrorApi(409, '', '', [], null, { codigo: 'lote_en_curso' }); return 'misma'; }, 'k', sinEspera);
    expect([r, i]).toEqual(['misma', 3]);
  });
});

// ── Qué falló, por qué y qué hacer (docs/19 §4, N8b): una prueba por fila de la tabla ───────────────────────────────────────────────
const api = (estado: number, cuerpo: Record<string, unknown> = {}, motivos: string[] = [], espera: number | null = null): ErrorApi => new ErrorApi(estado, '', '', motivos, espera, cuerpo);
const VISTO: FilaInforme[] = [
  { n: 12, id_fisico: 'nodo-12', resultado: 'valida', motivo: null, id: null, credencial: null, topico: null, interpretada: { formato: 'milesight', pasarela: 'ug65' } },
  { n: 30, id_fisico: 'nodo-30', resultado: 'valida', motivo: null, id: null, credencial: null, topico: null, interpretada: { formato: 'milesight', pasarela: 'ug65' } },
  { n: 31, id_fisico: 'nodo-31', resultado: 'valida', motivo: null, id: null, credencial: null, topico: null, interpretada: { formato: 'milesight', pasarela: 'ug65' } },
];
const NUEVO: FilaInforme[] = [
  { ...VISTO[0]!, resultado: 'existe', id: 'd-12', motivo: 'ya está dado de alta', interpretada: null },
  { ...VISTO[1]!, resultado: 'rechazada', motivo: 'la pasarela ug65 está dada de baja', interpretada: null },
  { ...VISTO[2]!, interpretada: { formato: 'chirpstack', pasarela: 'ug65' } },
];
// [qué pasó, error, contexto, caso esperado, el texto debe contener]
const DEL_SERVIDOR: [string, unknown, Parameters<typeof explicarError>[1], CasoError, string][] = [
  ['la sesión venció', api(401), { operacion: 'crear' }, 'sesion_vencida', 'Tu sesión venció'],
  ['sin permiso', api(403), { operacion: 'validar' }, 'sin_permiso', 'Tu perfil no permite dar de alta'],
  ['otra creación en curso', new FalloDeCreacion(api(409, { codigo: 'lote_en_curso' }), 1), { operacion: 'crear' }, 'lote_en_curso', 'Hay otra alta por lote en curso'],
  ['el plan cambió', new FalloDeCreacion(api(409, { codigo: 'plan_cambio', plan: { filas: NUEVO } }), 1), { operacion: 'crear', visto: VISTO }, 'plan_cambio', 'no se creó ninguno'],
  ['demasiadas peticiones, con la espera', api(429, { codigo: 'demasiadas_peticiones', reintentar_en_s: 37 }, [], 37), { operacion: 'validar' }, 'demasiadas_peticiones', 'Espera 37 s'],
  ['sin respuesta tras los intentos', new FalloDeCreacion(api(0), 3), { operacion: 'crear' }, 'sin_respuesta', 'no se sabe si se crearon'],
  ['un 409 en un intento posterior al primero', new FalloDeCreacion(api(409, { codigo: 'plan_cambio', plan: { filas: NUEVO } }), 2), { operacion: 'crear', visto: VISTO }, 'sin_respuesta', 'no se sabe si se crearon'],
  ['sin conexión al validar', api(0), { operacion: 'validar' }, 'sin_conexion', 'Validar no crea nada'],
  ['nada creado (broker o base)', new FalloDeCreacion(api(503, { codigo: 'nada_creado' }), 1), { operacion: 'crear' }, 'nada_creado', 'No se creó ninguno'],
  ['el servidor no pudo confirmar', new FalloDeCreacion(api(503, { codigo: 'lote_incierto' }), 1), { operacion: 'crear' }, 'lote_incierto', 'no pudo confirmar'],
  ['la llave ya se usó con otro contenido', new FalloDeCreacion(api(422, { codigo: 'llave_reutilizada' }), 1), { operacion: 'crear' }, 'llave_reutilizada', 'se cruzó con una anterior'],
  ['el servidor rechazó el cuerpo', api(400, { codigo: 'cuerpo_invalido' }, ['fila 7: nombre pasa su tope de 80 caracteres (trae 81)']), { operacion: 'validar' }, 'rechazo_del_servidor', 'El servidor rechazó el archivo'],
  ['demasiadas filas según el servidor', api(413, { codigo: 'demasiadas_filas' }, ['el lote trae 501 filas y el máximo es 500: divídelo']), { operacion: 'validar' }, 'demasiadas_filas', 'el lote trae 501 filas'],
  ['cuerpo demasiado pesado según el servidor', api(413, {}, ['cuerpo de más de 1147904 bytes']), { operacion: 'validar' }, 'archivo_pesado', 'cuerpo de más de 1147904 bytes'],
  ['otro error', new Error('raro'), { operacion: 'crear' }, 'otro', 'No se pudo completar'],
];
const DEL_ARCHIVO: [string, string, CasoError, string][] = [
  ['vacío', '', 'archivo_vacio', 'El archivo está vacío.'],
  ['solo la cabecera', `${CAB}\n`, 'solo_cabecera', 'ninguna fila de datos'],
  ['una sola columna (ningún separador de la plantilla)', 'id_fisico|nombre|zona\nx|y|z', 'una_columna', 'no hay «;», «,» ni tabulador entre las columnas'],
  ['una columna que no es de la plantilla', `${CAB},color\nn-1,Uno,Lab,,,60,temperatura,,,rojo`, 'columna_desconocida', 'La columna «color» no es de la plantilla'],
  ['falta una obligatoria', 'id_fisico,nombre,zona,canales\nx,y,z,w', 'falta_obligatoria', 'Falta la columna obligatoria «intervalo_esperado_s»'],
  ['una columna repetida', `${CAB},zona\nx`, 'columna_repetida', 'La columna «zona» está repetida'],
  ['un libro de Excel (la firma de un zip)', 'PK\u0003\u0004\u0014\u0000\u0006\u0000[Content_Types].xml', 'libro_excel', 'Es un libro de Excel. Guárdalo como CSV (Archivo → Guardar como) o copia las celdas y pégalas aquí.'],
  ['demasiadas filas', `${CAB}\n${'n,a,b,,,60,t,,\n'.repeat(501)}`, 'demasiadas_filas', 'El archivo trae 501 filas y el máximo es 500'],
  ['muy pesado', 'x'.repeat(2_000_000), 'archivo_pesado', 'El archivo pesa 2 MB y el máximo es 1,1 MB'],
  ['una comilla sin cerrar (lo que impide leer el resto del archivo)', `${CAB}\nn-1,"Uno,Lab,,,60,temperatura,,`, 'celda_invalida', 'Fila 2: comilla sin cerrar.'],
];

describe('la tabla de errores del alta masiva (docs/19 §4, N8b)', () => {
  it('cada caso del código tiene mensaje y acción, y cada acción su rótulo: un caso nuevo sin ellos rompe aquí', () => {
    for (const c of CASOS_ERROR) {
      expect([c, TEXTO_DE[c].length > 10, ACCIONES_LOTE.includes(ACCION_DE[c])]).toEqual([c, true, true]);
    }
    for (const a of ACCIONES_LOTE) expect(ROTULO_ACCION[a].length).toBeGreaterThan(3);
  });
  it('cada caso de la tabla tiene su prueba aquí (del servidor o del archivo)', () => {
    const probados = new Set<CasoError>([...DEL_SERVIDOR.map((x) => x[3]), ...DEL_ARCHIVO.map((x) => x[2])]);
    expect(CASOS_ERROR.filter((c) => !probados.has(c))).toEqual([]);
  });
  for (const [que, e, ctx, caso, contiene] of DEL_SERVIDOR) {
    it(`servidor: ${que} → ${caso}, con su acción`, () => {
      const x = explicarError(e, ctx);
      expect([x.caso, x.accion]).toEqual([caso, ACCION_DE[caso]]);
      expect(x.texto).toContain(contiene);
    });
  }
  for (const [que, texto, caso, contiene] of DEL_ARCHIVO) {
    it(`archivo: ${que} → ${caso}, antes de enviar`, () => {
      const l = leerOrigen(texto, PLANTILLA);
      expect(l.filas).toEqual([]);
      expect(l.errores[0]?.caso).toBe(caso);
      expect(l.errores[0]?.texto).toContain(contiene);
    });
  }
  it('el plan cambió: las filas que cambiaron, con su antes → ahora (ya existe, la pasarela dada de baja, otro formato)', () => {
    expect(describirCambios(VISTO, NUEVO)).toEqual([
      'Fila 12 (nodo-12): se crea → ya existe: ya está dado de alta',
      'Fila 30 (nodo-30): se crea → no entra: la pasarela ug65 está dada de baja',
      'Fila 31 (nodo-31): sigue entrando, pero cambió formato milesight → chirpstack',
    ]);
    expect(explicarError(new FalloDeCreacion(api(409, { codigo: 'plan_cambio', plan: { filas: NUEVO } }), 1), { operacion: 'crear', visto: VISTO }).detalles).toHaveLength(3);
  });
});

describe('el catálogo fijo de escenarios (docs/19 §4, S11; e2e/datos/lote-escenarios.*)', () => {
  const COLS7 = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales'];
  it('S1: las 60 filas se leen; las dos mal formadas (tilde en el identificador y una celda de más) no entran con su motivo y las otras 58 se envían', () => {
    const l = leerOrigen(ESCENARIOS_CSV, PLANTILLA);
    expect(l.errores).toEqual([]);
    expect(l.filas).toHaveLength(ESCENARIOS.totales.enviadas);
    expect(l.filas.length + (l.noEntran ?? []).length).toBe(ESCENARIOS.totales.leidas);
    const delPanel = ESCENARIOS.casos.filter((c) => c.donde === 'panel');
    expect((l.noEntran ?? []).map((x) => x.fila.n)).toEqual(delPanel.map((c) => c.n));
    for (const c of delPanel) expect([c.caso, l.noEntran!.find((x) => x.fila.n === c.n)!.motivos.map((m) => m.texto).join('; ')]).toEqual([c.caso, expect.stringContaining(c.contiene)]);
    // Los números de fila son los de la planilla: la vacía después de la fila de datos 20 cuenta.
    expect(l.filas.slice(18, 22).map((f) => f.n)).toEqual([20, 21, 23, 24]);
  });
  it('S1: las que no entran por cómo están escritas van al plan con su motivo, en el orden del archivo, y al CSV de las que no entran, alineadas a la cabecera', () => {
    const l = leerOrigen(ESCENARIOS_CSV, PLANTILLA);
    const locales = (l.noEntran ?? []).map(filaQueNoEntra);
    const servidor: FilaInforme[] = l.filas.map((f) => ({ n: f.n, id_fisico: String(f.id_fisico), resultado: 'valida', motivo: null, id: null, credencial: null, topico: null }));
    const plan = mezclarPlan(servidor, locales);
    expect(plan.map((f) => f.n)).toEqual([...plan.map((f) => f.n)].sort((a, b) => a - b));
    expect(plan.filter((f) => f.resultado === 'rechazada').map((f) => [f.n, f.motivos![0]!.campo])).toEqual([[59, 'id_fisico'], [60, 'fila']]);
    const csv = csvRechazadas(COLS7, [...l.filas, ...(l.noEntran ?? []).map((x) => x.fila)], plan).split('\r\n');
    expect(csv[1]).toBe('xprefijo-sensór;Nodo 57 invernadero;Galpón Sur;;;60;"temperatura:Cel;humedad:%RH";59;"Identificador: trae «ó», que no se admite: solo letras sin tilde ni eñe, dígitos y signos simples, sin comillas dobles ni barra invertida"');
    expect(csv[2]).toMatch(/^xprefijo-e58;Nodo 58 invernadero;Norte;;;60;"temperatura:Cel;humedad:%RH";60;la fila trae 1 celda más que la cabecera \(«sobra»\)/);
    // Vuelto a subir sin tocar: la de la tilde no entra otra vez con el mismo motivo; la de la celda de más ya viene alineada y la revisa el servidor.
    const otra = leerOrigen(csv.join('\r\n'), PLANTILLA);
    expect([otra.errores, otra.filas.map((f) => f.id_fisico), otra.noEntran?.map((x) => x.motivos[0]!.texto)]).toEqual([[], ['xprefijo-e58'], [locales[0]!.motivo]]);
  });
});
