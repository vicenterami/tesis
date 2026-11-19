import { describe, expect, it } from 'vitest';
import type { FilaInforme } from './lote';
import { DE_A, FILTROS, ROTULO_TOPICO, camposDeFila, coincide, conAvisoQueSeCrean, contar, filtroInicial, fraseDeFila, resumenDeFila, resumenRevision } from './revision';

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
    expect(fraseDeFila(EXISTE)).toEqual({ tono: 'alerta', icono: 'existe', texto: 'Ya existe: no se toca' });
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

describe('bloque S: las palabras del servidor, el resumen y «Ya existe» en ámbar (docs/19 §4)', () => {
  const COLS = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela', 'decodificador'];
  const ROTULOS = { id_fisico: 'Identificador', nombre: 'Nombre', zona: 'Zona', via: 'Vía', formato: 'Formato', intervalo_esperado_s: 'Cada cuánto reporta', canales: 'Canales', pasarela: 'Pasarela', decodificador: 'Decodificador' };
  const LEGIBLE = {
    donde: 'Zona norte (sitio Campus)', resumen: 'MQTT, SenML, cada 5 min: temperatura (°C), humedad (% de humedad)',
    campos: { id_fisico: 'n-1', nombre: 'Uno', zona: 'Zona norte (sitio Campus)', via: 'MQTT', formato: 'SenML', intervalo_esperado_s: 'cada 5 min', canales: 'temperatura en °C | humedad en % de humedad', pasarela: '', decodificador: '', topico: 'uct/n-1/senml' },
  };
  const CON_PALABRAS: FilaInforme = { ...SE_CREA, avisos: [], legible: LEGIBLE };
  it('S4: la frase, el resumen y el detalle usan lo que escribió el servidor (el sitio por su nombre, «MQTT», «cada 5 min», «°C»), con el rótulo de cada campo', () => {
    expect(fraseDeFila(CON_PALABRAS).texto).toBe('Se crea en Zona norte (sitio Campus)');
    expect(resumenDeFila(CON_PALABRAS)).toBe(LEGIBLE.resumen);
    const { campos } = camposDeFila(CON_PALABRAS, undefined, COLS, ROTULOS);
    expect(campos.map((c) => [c.rotulo, c.valor])).toEqual([
      ['Identificador', 'n-1'], ['Nombre', 'Uno'], ['Zona', 'Zona norte (sitio Campus)'], ['Vía', 'MQTT'], ['Formato', 'SenML'], ['Cada cuánto reporta', 'cada 5 min'],
      ['Canales', 'temperatura en °C | humedad en % de humedad'], ['Pasarela', ''], ['Decodificador', ''], [ROTULO_TOPICO, 'uct/n-1/senml'],
    ]);
    // Ningún rótulo ni valor a la vista trae un nombre de columna o de variable, ni el código de una vía o un formato.
    const JERGA = /\b[a-z]+_[a-z_]+\b|\b(mqtt|senml)\b|%RH/;
    expect(campos.filter((c) => c.campo !== 'topico').flatMap((c) => [c.rotulo, c.valor]).filter((t) => JERGA.test(t))).toEqual([]);
  });
  it('S5: «Ya existe» va en ámbar (alerta) con su icono, no con la cruz roja', () => {
    expect([fraseDeFila(EXISTE).tono, fraseDeFila(EXISTE).icono]).toEqual(['alerta', 'existe']);
    expect(fraseDeFila(EXISTE_BAJA).tono).toBe('alerta');
  });
  it('S6: el resumen sobre la lista dice cuántas se leyeron, se crean, ya existen y no entran', () => {
    expect(resumenRevision(contar(TODAS))).toBe('4 leídas: 1 se crea, 2 ya existen y 1 no entra.');
    expect(resumenRevision(contar([SE_CREA]))).toBe('1 leída: 1 se crea.');
    expect(resumenRevision({ leidas: 60, valida: 44, existe: 1, rechazada: 15, aviso: 3 })).toBe('60 leídas: 44 se crean, 1 ya existe y 15 no entran.');
  });
});
