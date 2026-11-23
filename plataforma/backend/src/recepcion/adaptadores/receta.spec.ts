import { describe, expect, it } from 'vitest';
import { TramaMalformada } from './adaptador.js';
import { M27, RECETA_CAMPUS } from './catalogo-semilla.prueba.js';
import { ANCHO_TIPO, CampoReceta, MAGNITUD_CODIGO, RECETA_CODIGO, RECETA_LIMITES, Receta, TIPOS_CAMPO, aplicarReceta, erroresDeReceta } from './receta.js';

// Intérprete de recetas (TT-12, bloque 2; docs/10 §8.4 punto 69 vi). La receta sembrada sale de la migración 27 tal cual, y las unidades,
// de las magnitudes sembradas (catalogo-semilla.prueba.ts): la prueba de equivalencia compara la semilla real de la base con la función
// que decodificaba hasta el bloque 3.
const m27 = M27;
const CAMPUS = RECETA_CAMPUS;
// La definición, como la escribiría alguien en la API o el panel: sin la unidad, que sale de la magnitud.
const definicion = (r: Receta) => ({ ...r, campos: r.campos.map(({ unidad: _u, ...c }) => c) });
const CAPTURA = Buffer.from('020000008f07181998af', 'hex'); // la captura real del 15/10 (docs/16 C-88)

// La función de perfiles.ts al 23/11/2026, congelada aquí: cuando el bloque 3 la retire del código, esta prueba sigue diciendo qué
// hacía. Sin cambios salvo el nombre.
const congelada = (b: Buffer) => [
  { magnitud: 'temperatura', valor: b.readInt16BE(5) / 100, unidad: 'Cel' },
  { magnitud: 'humedad', valor: b.readUInt16BE(7) / 100, unidad: '%RH' },
  { magnitud: 'tension', valor: (200 + b.readUInt8(9)) / 100, unidad: 'V' },
];

describe('receta del campus: la semilla de la migración 27 decodifica igual que la función que tenía perfiles.ts (congelada abajo)', () => {
  it('la captura real → 18,16 °C; 65,52 %RH; 3,75 V', () => {
    expect(aplicarReceta(CAMPUS, CAPTURA)).toEqual([
      { magnitud: 'temperatura', valor: 18.16, unidad: 'Cel' }, { magnitud: 'humedad', valor: 65.52, unidad: '%RH' },
      { magnitud: 'tension', valor: 3.75, unidad: 'V' },
    ]);
  });
  it('igualdad estricta para todos los valores de 16 bits (temperatura y humedad) y de 8 bits (tensión)', () => {
    const b = Buffer.from(CAPTURA);
    let distintos = 0; let casos = 0;
    const comparar = () => {
      const a = aplicarReceta(CAMPUS, b); const c = congelada(b); casos++;
      if (a.length !== c.length || a.some((l, i) => l.magnitud !== c[i].magnitud || l.unidad !== c[i].unidad || !Object.is(l.valor, c[i].valor))) distintos++;
    };
    for (let v = 0; v < 65536; v++) { b.writeUInt16BE(v, 5); comparar(); }
    b.writeUInt16BE(CAPTURA.readUInt16BE(5), 5);
    for (let v = 0; v < 65536; v++) { b.writeUInt16BE(v, 7); comparar(); }
    b.writeUInt16BE(CAPTURA.readUInt16BE(7), 7);
    for (let v = 0; v < 256; v++) { b.writeUInt8(v, 9); comparar(); }
    expect(casos).toBe(65536 * 2 + 256);
    expect(distintos).toBe(0);
  });
  it('el largo distinto conserva el texto de C-89: «perfil campus-heltec-v3-v1: se esperaban 10 bytes y llegaron 9»', () => {
    expect(() => aplicarReceta(CAMPUS, CAPTURA.subarray(0, 9))).toThrow(new TramaMalformada('perfil campus-heltec-v3-v1: se esperaban 10 bytes y llegaron 9'));
    expect(() => aplicarReceta(CAMPUS, Buffer.concat([CAPTURA, Buffer.from([0])]))).toThrow('se esperaban 10 bytes y llegaron 11');
  });
  it('la semilla es válida para el mismo validador que crear y probar, y sus unidades salen del catálogo sembrado', () => {
    expect(erroresDeReceta(definicion(CAMPUS))).toEqual([]);
    expect(CAMPUS.campos.map((c) => [c.magnitud, c.unidad])).toEqual([['temperatura', 'Cel'], ['humedad', '%RH'], ['tension', 'V']]);
  });
});

describe('los diez tipos de entero se leen en su orden de bytes y con su signo', () => {
  const b = Buffer.from('ff fe 01 02 80 00 00 01'.replace(/ /g, ''), 'hex');
  const uno = (tipo: CampoReceta['tipo'], d: number) => aplicarReceta(
    { codigo: 'tipos-v1', largo_bytes: 8, campos: [{ magnitud: 'x', unidad: 'u', desplazamiento: d, tipo, sumar_antes: 0, multiplicar_por: 1, dividir_por: 1 }] }, b)[0].valor;
  it.each([
    ['u8', 0, 255], ['i8', 0, -1], ['u16be', 0, 65534], ['u16le', 0, 65279], ['i16be', 0, -2], ['i16le', 0, -257],
    ['u32be', 4, 2147483649], ['u32le', 4, 16777344], ['i32be', 4, -2147483647], ['i32le', 4, 16777344],
  ] as const)('%s en el byte %i → %i', (tipo, d, esperado) => { expect(uno(tipo, d)).toBe(esperado); });
  it('las cotas y los tipos son los de los CHECK de la migración 27', () => {
    expect(m27).toContain(`largo_bytes BETWEEN ${RECETA_LIMITES.largoMin} AND ${RECETA_LIMITES.largoMax}`);
    expect(m27).toContain(`orden BETWEEN ${RECETA_LIMITES.camposMin} AND ${RECETA_LIMITES.camposMax}`);
    expect(m27).toContain(`sumar_antes BETWEEN -${RECETA_LIMITES.sumarMax} AND ${RECETA_LIMITES.sumarMax}`);
    expect(m27).toContain(`multiplicar_por BETWEEN 1 AND ${RECETA_LIMITES.factorMax} AND dividir_por BETWEEN 1 AND ${RECETA_LIMITES.factorMax}`);
    const lista = (re: RegExp) => [...(re.exec(m27)?.[1] ?? '').matchAll(/'([^']+)'/g)].map((x) => x[1]);
    expect(lista(/ck_receta_campo_tipo CHECK \(tipo IN \(([^)]*)\)\)/)).toEqual([...TIPOS_CAMPO]);
    // El ancho de cada tipo, contra su rama exacta del CHECK de cabida (1, 2 y el ELSE, que es 4).
    expect(lista(/WHEN tipo IN \(([^)]*)\) THEN 1/)).toEqual(TIPOS_CAMPO.filter((t) => ANCHO_TIPO[t] === 1));
    expect(lista(/WHEN tipo IN \(([^)]*)\) THEN 2/)).toEqual(TIPOS_CAMPO.filter((t) => ANCHO_TIPO[t] === 2));
    expect(m27).toMatch(/THEN 2 ELSE 4 END <= largo_bytes/);
    expect(TIPOS_CAMPO.filter((t) => ![1, 2].includes(ANCHO_TIPO[t])).every((t) => ANCHO_TIPO[t] === 4)).toBe(true);
    expect(m27).toContain(`codigo ~ '${RECETA_CODIGO.source}'`);
    expect(m27).toContain(`codigo ~ '${MAGNITUD_CODIGO.source}'`);
  });
  it('el validador acepta los valores límite que el SQL acepta', () => {
    const campos = Array.from({ length: 32 }, (_, i) => ({ magnitud: `m${i}`, desplazamiento: 250, tipo: 'u32le', sumar_antes: i % 2 ? 1_000_000 : -1_000_000,
      multiplicar_por: 1_000_000, dividir_por: 1_000_000 }));
    expect(erroresDeReceta({ codigo: 'limite-v1', nombre: 'x'.repeat(120), largo_bytes: 255, campos })).toEqual([]);
  });
});

describe('recetas malas plantadas: siempre TramaMalformada, nunca otro error', () => {
  const base = (c: Partial<CampoReceta> = {}, r: Partial<Receta> = {}): Receta => ({
    codigo: 'mala-v1', largo_bytes: 4,
    campos: [{ magnitud: 'humedad', unidad: '%RH', desplazamiento: 0, tipo: 'u16be', sumar_antes: 0, multiplicar_por: 1, dividir_por: 1, ...c }], ...r,
  });
  const b4 = Buffer.from([1, 2, 3, 4]);
  it.each<[string, Receta]>([
    ['sin campos', base({}, { campos: [] })],
    ['33 campos', base({}, { campos: Array.from({ length: 33 }, () => base().campos[0]) })],
    ['desplazamiento fuera de la trama', base({ desplazamiento: 3 })],
    ['desplazamiento negativo', base({ desplazamiento: -1 })],
    ['desplazamiento no entero', base({ desplazamiento: 0.5 })],
    ['tipo desconocido', base({ tipo: 'f32' as CampoReceta['tipo'] })],
    ['dividir por 0', base({ dividir_por: 0 })],
    ['factor NaN', base({ multiplicar_por: Number.NaN })],
    ['factor infinito', base({ dividir_por: Number.POSITIVE_INFINITY })],
    ['factor que llega como texto (numeric de node-postgres: 143 + "200" concatenaría)', base({ sumar_antes: '200' as unknown as number })],
    ['factor fuera de cota', base({ multiplicar_por: 1_000_001 })],
    ['sin unidad', base({ unidad: '' })],
    ['largo de la receta no válido', base({}, { largo_bytes: 0 })],
    ['campos que no son lista', base({}, { campos: null as unknown as CampoReceta[] })],
  ])('%s', (_, r) => {
    expect(() => aplicarReceta(r, b4)).toThrow(TramaMalformada);
  });
  it('sin bytes', () => { expect(() => aplicarReceta(base(), undefined as unknown as Buffer)).toThrow(TramaMalformada); });
  it('la misma magnitud dos veces (una receta que no pasó por el validador)', () => {
    expect(() => aplicarReceta(base({}, { campos: [base().campos[0], { ...base().campos[0], desplazamiento: 2 }] }), b4)).toThrow('magnitud repetida');
  });
  it.each<[string, unknown]>([
    ['un campo nulo', { codigo: 'mala-v1', largo_bytes: 4, campos: [null] }],
    ['un campo cuya lectura lanza', { codigo: 'mala-v1', largo_bytes: 4, campos: [{ get tipo(): string { throw new RangeError('x'); } }] }],
    ['la receta nula', null],
  ])('error interno convertido: %s → «no se pudo aplicar la receta»', (_, r) => {
    expect(() => aplicarReceta(r as Receta, b4)).toThrow(TramaMalformada);
    expect(() => aplicarReceta(r as Receta, b4)).toThrow('no se pudo aplicar la receta');
  });
  it('un código enorme o que no es texto no rompe el mensaje', () => {
    expect(() => aplicarReceta(base({}, { codigo: 'x'.repeat(1_000_000) }), Buffer.alloc(3))).toThrow(TramaMalformada);
    expect(() => aplicarReceta(base({}, { codigo: Object.create(null) as string }), Buffer.alloc(3))).toThrow('perfil ?: se esperaban 4 bytes');
  });
  it('un código con salto de línea no ensucia el registro', () => {
    expect(() => aplicarReceta(base({}, { codigo: 'mala\nv1' }), Buffer.alloc(3))).toThrow('perfil mala?v1: se esperaban 4 bytes y llegaron 3');
  });
  it('barrido aleatorio: 20 000 recetas y tramas al azar dan lecturas finitas o TramaMalformada; lo válido para el validador decodifica', () => {
    let s = 12345; const azar = () => { s = (s * 1103515245 + 12345) % 2147483648; return s / 2147483648; };
    const elegir = <T>(xs: readonly T[]) => xs[Math.floor(azar() * xs.length)];
    const raros = [0, -1, 1, 2, 3, 100, 255, 256, 1_000_000, 1_000_001, -1_000_001, 0.5, Number.NaN, Number.POSITIVE_INFINITY, '7', null, undefined];
    let otros = 0; let validas = 0; let validasQueFallan = 0;
    for (let i = 0; i < 20_000; i++) {
      const largo = azar() < 0.8 ? 1 + Math.floor(azar() * 12) : elegir(raros);
      const n = Math.floor(azar() * 4);
      const campos = Array.from({ length: n }, (_, j) => ({
        magnitud: `m${j}`, unidad: 'u', tipo: azar() < 0.9 ? elegir(TIPOS_CAMPO) : 'f64',
        desplazamiento: azar() < 0.8 ? Math.floor(azar() * 12) : elegir(raros),
        sumar_antes: azar() < 0.8 ? Math.floor(azar() * 2000) - 1000 : elegir(raros),
        multiplicar_por: azar() < 0.8 ? 1 + Math.floor(azar() * 100) : elegir(raros),
        dividir_por: azar() < 0.8 ? 1 + Math.floor(azar() * 100) : elegir(raros),
      })) as unknown as CampoReceta[];
      const r = { codigo: 'azar-v1', largo_bytes: largo, campos } as unknown as Receta;
      const bytes = Buffer.alloc(typeof largo === 'number' && Number.isInteger(largo) && largo >= 0 && largo < 300 ? (azar() < 0.8 ? largo : Math.floor(azar() * 12)) : 4, Math.floor(azar() * 256));
      const valida = erroresDeReceta(definicion(r)).length === 0 && bytes.length === largo;
      if (valida) validas++;
      // Lo válido se aplica como lo entrega la base: sin factor, 0 para sumar y 1 para multiplicar y dividir (DEFAULT de receta_campo).
      const conOmision = valida ? { ...r, campos: campos.map((c) => ({ ...c, sumar_antes: c.sumar_antes ?? 0, multiplicar_por: c.multiplicar_por ?? 1,
        dividir_por: c.dividir_por ?? 1 })) } : r;
      try {
        const l = aplicarReceta(conOmision, bytes);
        if (!l.every((x) => Number.isFinite(x.valor))) otros++;
      } catch (err) {
        if (!(err instanceof TramaMalformada)) otros++;
        else if (valida) validasQueFallan++;
      }
    }
    expect(otros).toBe(0);
    expect(validas).toBeGreaterThan(1000); // el barrido de verdad ejercita recetas buenas, no solo malas
    expect(validasQueFallan).toBe(0);
  });
});

describe('erroresDeReceta: el validador que comparten crear y probar', () => {
  const buena = { codigo: 'nodo-v1', largo_bytes: 4, campos: [{ magnitud: 'humedad', desplazamiento: 2, tipo: 'u16le', dividir_por: 10 }] };
  it('una receta buena no tiene errores (los factores son opcionales)', () => { expect(erroresDeReceta(buena)).toEqual([]); });
  it.each<[string, unknown, string]>([
    ['no es objeto', 'x', 'la receta debe ser un objeto'],
    ['código con mayúscula', { ...buena, codigo: 'Nodo-v1' }, 'codigo:'],
    ['código que empieza con guion', { ...buena, codigo: '-nodo' }, 'codigo:'],
    ['largo 256', { ...buena, largo_bytes: 256 }, 'largo_bytes:'],
    ['sin campos', { ...buena, campos: [] }, 'campos: una lista de 1 a 32'],
    ['campo que no cabe', { ...buena, campos: [{ ...buena.campos[0], desplazamiento: 3 }] }, 'u16le en el byte 3 no cabe en 4 bytes'],
    ['magnitud repetida', { ...buena, campos: [buena.campos[0], { ...buena.campos[0], desplazamiento: 0 }] }, 'ya está en otro campo'],
    ['tipo desconocido', { ...buena, campos: [{ ...buena.campos[0], tipo: 'f32' }] }, 'tipo debe ser uno de'],
    ['dividir por 0', { ...buena, campos: [{ ...buena.campos[0], dividir_por: 0 }] }, 'dividir_por debe ser un entero de 1 a 1000000'],
    ['sumar_antes decimal', { ...buena, campos: [{ ...buena.campos[0], sumar_antes: 0.5 }] }, 'sumar_antes debe ser un entero'],
    ['magnitud no válida', { ...buena, campos: [{ ...buena.campos[0], magnitud: 'Humedad' }] }, 'magnitud no válida'],
    ['clave mal escrita en un campo', { ...buena, campos: [{ ...buena.campos[0], dividir_pro: 100 }] }, 'campo 1: clave desconocida: dividir_pro'],
    ['clave desconocida en la receta', { ...buena, largo: 4 }, 'clave desconocida: largo'],
    ['nombre vacío', { ...buena, nombre: '  ' }, 'nombre: de 1 a 120 caracteres'],
  ])('%s', (_, r, texto) => {
    expect(erroresDeReceta(r).join(' | ')).toContain(texto);
  });
});
