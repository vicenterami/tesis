import { describe, expect, it, vi } from 'vitest';
import { ErrorApi } from './api';
import {
  ACCION_DE, ACCIONES_LOTE, CASOS_ERROR, FalloDeCreacion, ROTULO_ACCION, TEXTO_DE, celda, celdasCsv, crearConReintento, csvCredenciales, csvEjemplo, csvRechazadas,
  describirCambios, excedeBytes, explicarError, leerCsv, type CasoError, type FilaInforme, type PlantillaLote,
} from './lote';

// P7, alta masiva (docs/19 §4, F2 y bloque N): el CSV en el navegador con la plantilla del servidor, el `n` de cada fila contando las
// vacías, y la creación en una petición con la misma llave si la respuesta se pierde.
const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
const OBLIGATORIAS = ['id_fisico', 'nombre', 'zona', 'intervalo_esperado_s', 'canales'];
const PLANTILLA: PlantillaLote = {
  columnas: COLS.map((nombre) => ({ nombre, obligatoria: OBLIGATORIAS.includes(nombre), tope: 80, texto_libre: nombre === 'nombre' || nombre === 'zona', ayuda: '', ejemplo: nombre === 'canales' ? 'temperatura:Cel | humedad:%RH' : nombre === 'id_fisico' ? 'nodo-ejemplo-01' : '' })),
  max_filas: 500, max_bytes: 1_147_904, separadores: { columnas: [';', ',', '\t'], canales: ['|', ';'] },
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
    expect(leerCsv('id_fisico,nombre,zona,intervalo_esperado_s,canales,color\nx,y,z,1,w,v', PLANTILLA).errores[0]).toEqual({ caso: 'columna_desconocida', texto: `La columna «color» no es de la plantilla. Las columnas son: ${COLS.join(', ')}.` });
    expect(leerCsv('id_fisico,nombre,zona,canales\nx,y,z,w', PLANTILLA).errores[0]).toEqual({ caso: 'falta_obligatoria', texto: 'Falta la columna obligatoria «intervalo_esperado_s».' }); // la quinta obligatoria, de la plantilla
    expect(leerCsv(`${CAB},nombre\nx`, PLANTILLA).errores).toContainEqual({ caso: 'columna_repetida', texto: 'La columna «nombre» está repetida en la cabecera.' });
    expect(leerCsv(`${CAB}\n${'a,b,c,,,1,d,,\n'.repeat(3)}`, { ...PLANTILLA, max_filas: 2 }).errores).toEqual([{ caso: 'demasiadas_filas', texto: 'El archivo trae 3 filas y el máximo es 2: divídelo en partes de 2 o menos.' }]);
    expect(leerCsv(`${CAB},motivo\nn-1,Uno,Lab,,,60,humedad,,,zona «X» no existe`, PLANTILLA).filas[0]).toEqual({ n: 2, id_fisico: 'n-1', nombre: 'Uno', zona: 'Lab', intervalo_esperado_s: '60', canales: 'humedad' });
    expect(leerCsv('', PLANTILLA).errores).toEqual([{ caso: 'archivo_vacio', texto: 'El archivo está vacío.' }]);
    expect(leerCsv('x'.repeat(11), { ...PLANTILLA, max_bytes: 10 }).errores[0]?.caso).toBe('archivo_pesado');
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
    const e = await crearConReintento(siempre, 'k', sinEspera).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(FalloDeCreacion);
    expect([(e as FalloDeCreacion).intento, (e as FalloDeCreacion).causa instanceof ErrorApi]).toEqual([3, true]); // en qué intento llegó
    expect(siempre).toHaveBeenCalledTimes(3);
    // Un 503 con `codigo` del backend es una respuesta: no se repite.
    const definitivo = vi.fn(async () => { throw new ErrorApi(503, '', '', [], null, { codigo: 'nada_creado' }); });
    await crearConReintento(definitivo, 'k', sinEspera).catch(() => undefined);
    expect(definitivo).toHaveBeenCalledTimes(1);
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
  ['una sola columna (separado por «;»)', 'id_fisico;nombre;zona\nx;y;z', 'una_columna', 'no está separado por comas'],
  ['una columna que no es de la plantilla', `${CAB},color\nn-1,Uno,Lab,,,60,temperatura,,,rojo`, 'columna_desconocida', 'La columna «color» no es de la plantilla'],
  ['falta una obligatoria', 'id_fisico,nombre,zona,canales\nx,y,z,w', 'falta_obligatoria', 'Falta la columna obligatoria «intervalo_esperado_s»'],
  ['una columna repetida', `${CAB},zona\nx`, 'columna_repetida', 'La columna «zona» está repetida'],
  ['una fila con celdas de más', `${CAB}\nn-1,Uno,Lab,,,60,temperatura,,,de más`, 'celdas_de_mas_o_de_menos', 'La fila 2 trae 10 celdas y la cabecera 9'],
  ['demasiadas filas', `${CAB}\n${'n,a,b,,,60,t,,\n'.repeat(501)}`, 'demasiadas_filas', 'El archivo trae 501 filas y el máximo es 500'],
  ['muy pesado', 'x'.repeat(2_000_000), 'archivo_pesado', 'El archivo pesa 2 MB y el máximo es 1,1 MB'],
  ['una celda sobre su tope', `${CAB}\nn-1,${'N'.repeat(81)},Lab,,,60,temperatura,,`, 'celda_invalida', 'Fila 2, columna «nombre»: tiene 81 caracteres y el máximo es 80'],
  ['un carácter no admitido en un código', `${CAB}\nnodo-ñ,Uno,Lab,,,60,temperatura,,`, 'celda_invalida', 'Fila 2, columna «id_fisico»: solo admite letras sin acento'],
  ['un carácter de control', `${CAB}\nn-1,"Uno\nDos",Lab,,,60,temperatura,,`, 'celda_invalida', 'Fila 2, columna «nombre»: trae un carácter que no se admite'],
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
      const l = leerCsv(texto, PLANTILLA);
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
