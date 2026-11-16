import { describe, expect, it } from 'vitest';
import type { FilaInforme } from './lote';
import { DE_A, FILTROS, camposDeFila, coincide, conAvisoQueSeCrean, contar, filtroInicial, fraseDeFila, resumenDeFila } from './revision';

// La revisión del alta masiva (docs/19 §4, N7): la frase de cada fila, los cinco filtros que cuentan lo que muestran y el detalle por campo.
const base = { id: null, credencial: null, topico: null } as const;
const INTERPRETADA = {
  id_fisico: 'n-1', nombre: 'Uno', sitio: 'uct', zona: 'Zona norte', zona_id: 'z1', via: 'mqtt', formato: 'senml', intervalo_esperado_s: 300,
  canales: [{ magnitud: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }, { magnitud: 'humedad', nombre: 'Humedad', unidad: '%RH' }], pasarela: null, decodificador: null, topico: 'uct/n-1/senml',
};
const SE_CREA: FilaInforme = { ...base, n: 2, id_fisico: 'n-1', resultado: 'valida', motivo: null, interpretada: INTERPRETADA, por_defecto: ['via', 'formato'], avisos: [{ campo: 'zona', texto: 'zona «Zona norte» del sitio uct' }], motivos: [] };
const EXISTE: FilaInforme = { ...base, n: 3, id_fisico: 'n-2', resultado: 'existe', motivo: 'ya está dado de alta', interpretada: null, por_defecto: [], avisos: [], motivos: [{ campo: 'id_fisico', texto: 'ya está dado de alta' }] };
const EXISTE_BAJA: FilaInforme = { ...EXISTE, n: 4, motivo: 'ya está dado de alta; está en baja: reactivarlo desde su ficha' };
const NO_ENTRA: FilaInforme = { ...base, n: 5, id_fisico: 'n-3', resultado: 'rechazada', motivo: 'zona vacía; canales: falta', interpretada: null, por_defecto: [], avisos: [], motivos: [{ campo: 'zona', texto: 'zona vacía' }, { campo: 'canales', texto: 'falta' }, { campo: 'fila', texto: 'otra cosa' }] };
const TODAS = [SE_CREA, EXISTE, EXISTE_BAJA, NO_ENTRA];

describe('los cinco filtros', () => {
  it('cada tarjeta cuenta exactamente lo que su filtro muestra; «Con aviso» es transversal y «Leídas» las suma todas', () => {
    const c = contar(TODAS);
    expect(c).toEqual({ leidas: 4, valida: 1, existe: 2, rechazada: 1, aviso: 1 });
    for (const x of FILTROS) expect(TODAS.filter((f) => coincide(f, x.id))).toHaveLength(c[x.id]);
    expect(FILTROS.map((x) => x.rotulo)).toEqual(['Leídas', 'Se crean', 'Ya existen', 'No entran', 'Con aviso']);
  });
  it('abre con «No entran» si alguna fila no entra; si no, con «Leídas»; la línea de avisos cuenta solo las que se crean', () => {
    expect(filtroInicial(TODAS)).toBe('rechazada');
    expect(filtroInicial([SE_CREA, EXISTE])).toBe('leidas');
    expect(conAvisoQueSeCrean([SE_CREA, { ...EXISTE, avisos: [{ campo: 'x', texto: 'y' }] }])).toBe(1);
    expect(DE_A).toBe(100);
  });
});

describe('«Qué pasa»: una frase con su icono', () => {
  it('se crea (con su zona y su sitio), ya existe (y el caso dado de baja) y no entra (con su primer motivo y cuántos más)', () => {
    expect(fraseDeFila(SE_CREA)).toEqual({ tono: 'normal', icono: 'alta', texto: 'Se crea en Zona norte (sitio uct)' });
    expect(fraseDeFila(EXISTE)).toEqual({ tono: 'inactivo', icono: 'existe', texto: 'Ya existe: no se toca' });
    expect(fraseDeFila(EXISTE_BAJA).texto).toBe('Ya existe, dado de baja: se reactiva desde su ficha');
    expect(fraseDeFila(NO_ENTRA)).toEqual({ tono: 'sin_senal', icono: 'cerrar', texto: 'No entra: zona vacía (y 2 más)' });
    expect(fraseDeFila({ ...NO_ENTRA, motivos: [NO_ENTRA.motivos![0]!] }).texto).toBe('No entra: zona vacía');
  });
  it('el resumen de la fila dice lo que se creará', () => {
    expect(resumenDeFila(SE_CREA)).toBe('mqtt, senml, cada 300 s: temperatura, humedad');
    expect(resumenDeFila(NO_ENTRA)).toBe('');
  });
});

describe('una fila interpretada sin canales no rompe la tabla', () => {
  it('el resumen, la frase y el detalle se dibujan aunque `canales` no venga', () => {
    const { canales: _c, ...sinCanales } = INTERPRETADA;
    const f: FilaInforme = { ...SE_CREA, interpretada: sinCanales };
    expect(resumenDeFila(f)).toBe('mqtt, senml, cada 300 s: ');
    expect(fraseDeFila(f).texto).toBe('Se crea en Zona norte (sitio uct)');
    expect(camposDeFila(f, undefined, ['canales']).campos[0]!.valor).toBe('');
  });
});

describe('el detalle campo por campo', () => {
  const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
  it('una fila que se crea: lo interpretado, «por omisión» en vía y formato, el aviso junto a la zona y el tópico', () => {
    const { campos, sueltas } = camposDeFila(SE_CREA, undefined, COLS);
    const de = (c: string) => campos.find((x) => x.campo === c)!;
    expect(de('zona')).toMatchObject({ valor: 'Zona norte (sitio uct)', avisos: ['zona «Zona norte» del sitio uct'], porOmision: false });
    expect([de('via').porOmision, de('formato').porOmision, de('nombre').porOmision]).toEqual([true, true, false]);
    expect(de('canales').valor).toBe('temperatura en Cel | humedad en %RH');
    expect(de('pasarela').valor).toBe('');
    expect(de('topico').valor).toBe('uct/n-1/senml');
    expect(sueltas).toEqual([]);
  });
  it('una fila que no entra: lo que se escribió, con cada motivo junto a su campo y los que no son de una columna aparte', () => {
    const { campos, sueltas } = camposDeFila(NO_ENTRA, { n: 5, id_fisico: 'n-3', nombre: 'Tres', canales: 'x' }, COLS);
    expect(campos.find((c) => c.campo === 'zona')).toMatchObject({ valor: '', motivos: ['zona vacía'], porOmision: false });
    expect(campos.find((c) => c.campo === 'canales')).toMatchObject({ valor: 'x', motivos: ['falta'] });
    expect(campos.some((c) => c.campo === 'topico')).toBe(false);
    expect(sueltas).toEqual([{ tipo: 'motivo', campo: 'fila', texto: 'otra cosa' }]);
  });
});
