import { esperaS, lectura, marcaDelNodo, mulberry32, pack, perfiles, semillaSQL } from './modelo';

// El modelo de tráfico se prueba solo: sin red ni reloj. Lo que importa es que sea reproducible (misma semilla,
// misma corrida), que respete lo que docs/10 §9.6 pide y que la semilla SQL no duplique nada al reejecutarse.
describe('modelo del emulador (TT-28)', () => {
  const o = { dispositivos: 100, periodoS: 2, jitterS: 0.3, pPerdida: 0.01, derivaMs: 20, fraccionCaidas: 0.1, semilla: 1, sitio: 'banco' };

  it('misma semilla → mismos perfiles; otra semilla → distintos', () => {
    expect(perfiles(o)).toEqual(perfiles(o));
    expect(perfiles({ ...o, semilla: 2 })).not.toEqual(perfiles(o));
  });

  it('periodos distintos y no sincronizados: entre 0,5× y 1,5× del nominal, con fase propia', () => {
    const ps = perfiles(o);
    expect(new Set(ps.map((p) => p.periodoS)).size).toBeGreaterThan(5);
    for (const p of ps) {
      expect(p.periodoS).toBeGreaterThanOrEqual(1);
      expect(p.periodoS).toBeLessThanOrEqual(3);
      expect(p.faseS).toBeLessThanOrEqual(p.periodoS);
    }
    // tasa agregada ≈ ln(3) · n / periodo: con 100 nodos a 2 s, unos 55 mensajes/s (RNF-01 pide ≥ 50)
    const tasa = ps.reduce((s, p) => s + 1 / p.periodoS, 0);
    expect(tasa).toBeGreaterThan(45);
    expect(tasa).toBeLessThan(70);
  });

  it('una fracción con caídas, dos relojes rotos y uno de cada diez caliente', () => {
    const ps = perfiles(o);
    const conCaida = ps.filter((p) => p.caida).length;
    expect(conCaida).toBeGreaterThanOrEqual(4);
    expect(conCaida).toBeLessThanOrEqual(20);
    expect(ps.filter((p) => p.relojRoto).map((p) => p.id)).toEqual(['emu-0001', 'emu-0002']);
    expect(ps.filter((p) => p.caliente)).toHaveLength(10);
  });

  it('la espera nunca baja de medio periodo y el jitter la mueve', () => {
    const [p] = perfiles(o);
    const rnd = mulberry32(7);
    const esperas = Array.from({ length: 50 }, () => esperaS(p, rnd));
    expect(Math.min(...esperas)).toBeGreaterThanOrEqual(p.periodoS / 2);
    expect(new Set(esperas).size).toBeGreaterThan(10);
  });

  it('marca del nodo: normal con deriva; «epoch» cae antes del 2000; «futuro» va una hora adelante', () => {
    const [epoch, futuro, normal] = perfiles(o);
    const ahora = 1_760_000_000_000;
    expect(marcaDelNodo(normal, ahora, 1500)).toBeCloseTo((ahora + 1500) / 1000, 3);
    expect(marcaDelNodo(epoch, ahora, 0)).toBeLessThan(946_684_800); // 2000-01-01
    expect(marcaDelNodo(futuro, ahora, 0)).toBe((ahora + 3_600_000) / 1000);
  });

  it('los calientes cruzan 30 Cel en algún momento; los normales nunca', () => {
    const ps = perfiles(o);
    const rnd = mulberry32(3);
    const maximo = (p: (typeof ps)[number]) => Math.max(...Array.from({ length: 300 }, (_, t) => lectura(p, t, rnd).temperatura));
    expect(maximo(ps.find((p) => p.caliente)!)).toBeGreaterThan(30);
    expect(maximo(ps.find((p) => !p.caliente)!)).toBeLessThan(30);
  });

  it('el pack es SenML válido con bn, bt y dos registros', () => {
    const [, , p] = perfiles(o);
    const registros = JSON.parse(pack(p, 1760000000.123, { temperatura: 21.5, humedad: 50 })) as Record<string, unknown>[];
    expect(registros).toHaveLength(2);
    expect(registros[0]).toMatchObject({ bn: 'emu-0003', bt: 1760000000.123, n: 'temperatura', u: 'Cel', v: 21.5 });
    expect(registros[1]).toMatchObject({ n: 'humedad', u: '%RH', v: 50 });
  });

  it('la semilla SQL es reejecutable: todo INSERT lleva ON CONFLICT o NOT EXISTS, y trae los n dispositivos', () => {
    const sql = semillaSQL(perfiles(o), 'banco');
    const inserts = sql.split('INSERT INTO').length - 1;
    expect(inserts).toBe(5);
    expect((sql.match(/ON CONFLICT/g) ?? []).length + (sql.match(/NOT EXISTS/g) ?? []).length).toBe(5);
    expect((sql.match(/'emu-\d{4}'/g) ?? []).length).toBe(100);
    const [p1] = perfiles(o); // el intervalo esperado del supervisor es el periodo del nodo redondeado hacia arriba
    expect(sql).toContain(`('00000000-0000-0000-0000-00000000ba7d', 'emu-0001', 'Emulado 0001', ${Math.ceil(p1.periodoS)})`);
  });

  it('el factor de intervalo (experimento D-02) multiplica el periodo antes de redondear', () => {
    const ps = perfiles(o);
    const sql = semillaSQL(ps, 'banco', 2);
    expect(sql).toContain(`'emu-0001', 'Emulado 0001', ${Math.ceil(ps[0].periodoS * 2)})`);
    expect(sql).toContain('intervalo = periodo × 2');
  });
});
