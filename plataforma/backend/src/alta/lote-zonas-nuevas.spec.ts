import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  Catalogos, ClaveEnLaBase, FilaEntrada, MAX_ZONAS_NUEVAS_LOTE, ZonaCatalogo, candidatasZonasNuevas, filasDelCuerpo, huellaDelPlan, respuestaLote, validarLote, zonasNuevasDelLote,
  zonasNuevasEn,
} from './lote.js';

// Zonas nuevas desde el alta masiva (docs/19 §4 U2): con `zonas_nuevas_en`, una zona escrita por su nombre que no existe en ningún sitio de
// quien carga entra como zona nueva de ese sitio (una por nombre normalizado), la revisión la marca `nueva` y la huella la incluye. Sin el
// campo, todo sigue como antes. Lo que decide la base (si un nombre ya existe en el sitio con SU normalización) llega aquí como el conjunto
// `enLaBase` (la clave que la base da a cada candidata y si ya existe en el sitio); la consulta y la inserción en la base (crearLote, en la misma transacción) van en la integración.
const S1 = '00000000-0000-4000-8000-000000000001';
const S2 = '00000000-0000-4000-8000-000000000002';
const Z1 = '00000000-0000-4000-8000-0000000000a1';
const ZR = '00000000-0000-4000-8000-0000000000a2';
const sitio = { id: S1, codigo: 'uct', nombre: 'Campus' };
const retiradaS1: ZonaCatalogo = { id: ZR, nombre: 'Bodega', sitio_id: S1, sitio_codigo: 'uct', sitio_nombre: 'Campus', retirada: true };
const cat: Catalogos = {
  zonas: [
    { id: Z1, nombre: 'Laboratorio', sitio_id: S1, sitio_codigo: 'uct', sitio_nombre: 'Campus' },
    { id: '00000000-0000-4000-8000-0000000000b1', nombre: 'Patio', sitio_id: S2, sitio_codigo: 'otro', sitio_nombre: 'Otro sitio' },
  ],
  magnitudes: new Map([['temperatura', { nombre: 'Temperatura', unidad: 'Cel' }]]),
  pasarelas: [], existentes: new Map(), idsDePasarela: new Set(), recetas: [], ajenos: new Set(),
};
const fila = (n: number, zona: string, id = `nodo-${n}`): FilaEntrada =>
  ({ n, id_fisico: id, nombre: `Nodo ${n}`, zona, via: 'mqtt', formato: '', intervalo_esperado_s: '60', canales: 'temperatura', pasarela: '' });
// El plan como lo arma el controlador (AltaController.planLote), con la respuesta de la base ya dada.
// La respuesta de la base simulada (AltaService.zonasEnLaBase): por cada candidata, su clave (por omisión, la de JS; `igualA` da otra) y
// si ya existe en el sitio.
const bd = (filas: FilaEntrada[], existen: string[] = [], igualA: Record<string, string> = {}, c: Catalogos = cat): Map<string, ClaveEnLaBase> =>
  new Map(candidatasZonasNuevas(filas, c.zonas).map((n) => [n, { clave: igualA[n] ?? n.trim().toLowerCase(), existe: existen.includes(n) }]));
const plan = (filas: FilaEntrada[], c: Catalogos = cat, existen: string[] = [], igualA: Record<string, string> = {}) => {
  const nuevas = zonasNuevasDelLote(filas, c.zonas, sitio, bd(filas, existen, igualA, c));
  return { ...validarLote(filas, { ...c, zonas: [...c.zonas, ...nuevas.zonas], zonasNoOfrecidas: nuevas.noOfrecidas }), excedidas: nuevas.excedidas };
};

describe('candidatasZonasNuevas y zonasNuevasDelLote: qué zonas se ofrecen como nuevas', () => {
  it('una por nombre normalizado, con el nombre de la primera fila; las conocidas (de cualquier sitio), los UUID y los vacíos no', () => {
    const filas = [fila(2, ' Norte '), fila(3, 'norte'), fila(4, 'Galpón Sur'), fila(5, 'laboratorio'), fila(6, 'Patio'), fila(7, Z1), fila(8, '')];
    expect(candidatasZonasNuevas(filas, cat.zonas)).toEqual(['Norte', 'Galpón Sur']);
    const { zonas, excedidas } = zonasNuevasDelLote(filas, cat.zonas, sitio, bd(filas));
    expect(zonas.map((z) => [z.id, z.nombre, z.sitio_id, z.nueva])).toEqual([['nueva:norte', 'Norte', S1, true], ['nueva:galpón sur', 'Galpón Sur', S1, true]]);
    expect(excedidas).toBeNull();
  });
  it('un nombre de más de 80 caracteres, con un carácter de control o con uno invisible (ancho cero, inversión bidi) no es candidato', () => {
    const filas = [fila(2, 'x'.repeat(81)), fila(3, 'a\u0007b'), fila(6, 'Patio\u2028Norte'), fila(7, 'Patio\u2029Sur'), fila(4, 'Nor​te'), fila(5, '‮Sur')];
    expect(candidatasZonasNuevas(filas, cat.zonas)).toEqual([]);
    expect(zonasNuevasDelLote(filas, cat.zonas, sitio, bd(filas)).zonas).toEqual([]);
  });
  it('lo que la base ya tiene en el sitio (otra escritura según lower() de PostgreSQL) no se ofrece y queda con su motivo', () => {
    const f = [fila(2, 'Ärea'), fila(3, 'Norte')];
    const r = zonasNuevasDelLote(f, cat.zonas, sitio, bd(f, ['Ärea']));
    expect(r.zonas.map((z) => z.nombre)).toEqual(['Norte']);
    expect([...r.noOfrecidas.keys()]).toEqual(['ärea']);
  });
  it('dos candidatas del mismo archivo que para la base son la misma zona (y para JS no): se ofrece la primera; la otra queda con «otra escritura»', () => {
    // «İnvernadero» y «invernadero»: toLowerCase de JS da «i̇nvernadero» (con punto combinante), lower() de la base puede dar «invernadero».
    const f = [fila(2, 'invernadero'), fila(3, 'İnvernadero'), fila(4, 'invernadero')];
    const r = zonasNuevasDelLote(f, cat.zonas, sitio, bd(f, [], { 'İnvernadero': 'invernadero' }));
    expect(r.zonas.map((z) => z.nombre)).toEqual(['invernadero']);
    expect(r.noOfrecidas.get('İnvernadero'.toLowerCase())).toBe('la zona «İnvernadero» es la misma que «invernadero» de otra fila, con otra escritura: escríbela igual en todas las filas');
    const p = plan(f, cat, [], { 'İnvernadero': 'invernadero' });
    expect(p.informe.map((x) => x.resultado)).toEqual(['valida', 'rechazada', 'valida']);
    expect(p.informe[1].motivo).toContain('con otra escritura: escríbela igual en todas las filas');
  });
  it(`el tope: con ${MAX_ZONAS_NUEVAS_LOTE} zonas nuevas distintas se ofrecen todas; con una más, ninguna, y se dice cuántas pedía`, () => {
    const filas = (k: number) => Array.from({ length: k }, (_, i) => fila(i + 2, `Zona ${i}`));
    expect(zonasNuevasDelLote(filas(MAX_ZONAS_NUEVAS_LOTE), cat.zonas, sitio, bd(filas(MAX_ZONAS_NUEVAS_LOTE))).zonas).toHaveLength(MAX_ZONAS_NUEVAS_LOTE);
    const r = zonasNuevasDelLote(filas(MAX_ZONAS_NUEVAS_LOTE + 1), cat.zonas, sitio, bd(filas(MAX_ZONAS_NUEVAS_LOTE + 1)));
    expect(r.zonas).toEqual([]);
    expect(r.excedidas).toEqual({ pedidas: MAX_ZONAS_NUEVAS_LOTE + 1, maximo: MAX_ZONAS_NUEVAS_LOTE });
    // Las que la base ya tiene no cuentan para el tope: no se crearían.
    expect(zonasNuevasDelLote(filas(MAX_ZONAS_NUEVAS_LOTE + 1), cat.zonas, sitio, bd(filas(MAX_ZONAS_NUEVAS_LOTE + 1), ['Zona 0'])).excedidas).toBeNull();
  });
});

describe('validarLote: motivos de zona', () => {
  const filas = [fila(2, 'Norte'), fila(3, 'norte'), fila(4, 'Laboratorio')];
  it('sin zonas nuevas, la fila con una zona inexistente no entra y el motivo dice a quién pedírsela (sin «desde esta misma alta»)', () => {
    const r = validarLote(filas, cat);
    expect(r.informe.map((f) => f.resultado)).toEqual(['rechazada', 'rechazada', 'valida']);
    expect(r.informe[0].motivo).toBe('la zona «Norte» no existe en tus sitios: revisa cómo se escribe; si es nueva, pídele a quien administra el sitio que la cree (Ajustes del sitio → Zonas)');
  });
  it('una zona retirada, por nombre o por UUID, tiene su propio motivo; con zonas nuevas tampoco se recrea', () => {
    const c = { ...cat, zonas: [...cat.zonas, retiradaS1] };
    const esperado = (z: string) => `la zona «${z}» está retirada: vuelve a ofrecerla en Ajustes del sitio → Zonas, o elige otra`;
    const r = validarLote([fila(2, 'bodega'), fila(3, ZR)], c);
    expect(r.informe.map((f) => [f.resultado, f.motivos.find((m) => m.campo === 'zona')?.texto])).toEqual([['rechazada', esperado('bodega')], ['rechazada', esperado(ZR)]]);
    const p = plan([fila(2, 'bodega')], c);
    expect(p.zonas).toEqual([]);
    expect(p.informe[0].motivo).toBe(esperado('bodega'));
  });
  it('un nombre que calza con una activa y con una retirada de otro sitio: gana la activa; «en más de un sitio» cuenta solo activas', () => {
    const c = { ...cat, zonas: [...cat.zonas, { ...retiradaS1, nombre: 'Patio' }] };
    const r = validarLote([fila(2, 'patio')], c);
    expect(r.informe[0].resultado).toBe('valida');
    expect(r.informe[0].interpretada?.sitio).toBe('otro');
  });
  it('con zonas nuevas, el nombre que la base ya tiene en el sitio con otra escritura queda fuera con ese motivo', () => {
    const p = plan([fila(2, 'Ärea')], cat, ['Ärea']);
    expect(p.informe[0].motivo).toBe('la zona «Ärea» ya existe en el sitio con otra escritura: escríbela como aparece en Ajustes del sitio → Zonas');
  });
  it('con zonas nuevas, una zona con un carácter invisible queda fuera con ese motivo; sin zonas nuevas, el de siempre', () => {
    expect(plan([fila(2, 'Nor​te')]).informe[0].motivo).toBe('la zona «Nor​te» trae un carácter invisible que no se admite: escríbela de nuevo sin copiarla');
    expect(validarLote([fila(2, 'Nor​te')], cat).informe[0].motivo).toContain('no existe en tus sitios');
  });
  it('con ellas, entran; la revisión dice una vez «nueva» con cuántas filas; la huella cambia y es estable', () => {
    const r = plan(filas);
    expect(r.informe.map((f) => f.resultado)).toEqual(['valida', 'valida', 'valida']);
    expect(r.zonas).toEqual([{ zona: 'Norte', sitio: 'Campus', filas: 2, nueva: true }, { zona: 'Laboratorio', sitio: 'Campus', filas: 1 }]);
    expect(r.altas.slice(0, 2).map((a) => [a.alta.zona_id, a.zonaNueva])).toEqual([
      ['nueva:norte', { sitio_id: S1, nombre: 'Norte' }], ['nueva:norte', { sitio_id: S1, nombre: 'Norte' }],
    ]);
    expect(r.altas[2].zonaNueva).toBeUndefined();
    expect(huellaDelPlan(r.informe)).toBe(huellaDelPlan(plan(filas).informe));
    expect(huellaDelPlan(r.informe)).not.toBe(huellaDelPlan(validarLote(filas, cat).informe));
  });
  it('120 filas con la misma zona nueva escrita con mayúsculas distintas: una sola zona nueva', () => {
    const muchas = Array.from({ length: 120 }, (_, i) => fila(i + 2, i % 3 === 0 ? 'Invernadero' : i % 3 === 1 ? 'INVERNADERO' : ' invernadero '));
    const r = plan(muchas);
    expect(r.zonas).toEqual([{ zona: 'Invernadero', sitio: 'Campus', filas: 120, nueva: true }]);
    expect(new Set(r.altas.map((a) => a.alta.zona_id))).toEqual(new Set(['nueva:invernadero']));
  });
  it('sobre el tope, esas filas siguen fuera con el motivo de siempre y la respuesta suma zonas_nuevas_excedidas', () => {
    const muchas = Array.from({ length: MAX_ZONAS_NUEVAS_LOTE + 1 }, (_, i) => fila(i + 2, `Zona ${i}`));
    const r = plan(muchas);
    expect(r.informe.every((f) => f.resultado === 'rechazada' && f.motivo?.includes('no existe en tus sitios'))).toBe(true);
    expect(respuestaLote(r.informe, r.zonas, r.excedidas).zonas_nuevas_excedidas).toEqual({ pedidas: MAX_ZONAS_NUEVAS_LOTE + 1, maximo: MAX_ZONAS_NUEVAS_LOTE });
    expect(respuestaLote(r.informe, r.zonas)).not.toHaveProperty('zonas_nuevas_excedidas');
  });
});

describe('el cuerpo: zonas_nuevas_en', () => {
  it('se admite con un UUID y se lee en minúsculas; con otra cosa, 400', () => {
    const filas = [fila(2, 'Norte')];
    expect(() => filasDelCuerpo({ filas, zonas_nuevas_en: S1 })).not.toThrow();
    expect(zonasNuevasEn({ filas, zonas_nuevas_en: S1.toUpperCase() })).toBe(S1);
    expect(zonasNuevasEn({ filas })).toBeNull();
    for (const malo of ['uct', 5, null]) expect(() => filasDelCuerpo({ filas, zonas_nuevas_en: malo }), String(malo)).toThrow(BadRequestException);
  });
});
