// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { LIENZO, SERIES, aplicarTema, colorLecturaActual, colorPromedio, contraste, leerPreferenciaTema, temaEfectivo } from './tema';

// Tokens y tema (docs/19 §4, tablero v2, A2 y A3), comprobados sobre el propio app.css: los dos temas pasan el contraste de WCAG 2.2
// (texto ≥ 4,5:1, controles y foco ≥ 3:1), las series son las validadas y en su orden, y el bloque oscuro no se desincroniza.
function bloque(selector: string): Record<string, string> {
  const i = css.indexOf(selector);
  if (i < 0) throw new Error(`falta el bloque ${selector}`);
  const cuerpo = css.slice(css.indexOf('{', i) + 1, css.indexOf('}', i));
  return Object.fromEntries([...cuerpo.matchAll(/--([\w-]+):\s*([^;]+);/g)].map((m) => [m[1]!, m[2]!.trim()]));
}
// La raíz de vitest es la carpeta del panel (vite.config.ts); `?raw` no sirve aquí: vitest no procesa CSS en las pruebas.
const css = readFileSync(resolve(process.cwd(), 'src/app.css'), 'utf-8');
const claro = bloque(':root {');
const oscuro = bloque(":root[data-theme='oscuro'] {");
const oscuroDelSistema = bloque(":root:not([data-theme='claro']) {");

// Las parejas que la interfaz pinta, texto sobre fondo (4,5:1) y controles o foco sobre fondo (3:1).
const TEXTO: [string, string][] = [
  ['texto', 'fondo'], ['texto', 'superficie'], ['texto', 'superficie-elevada'], ['texto', 'superficie-tenue'],
  ['texto-secundario', 'fondo'], ['texto-secundario', 'superficie'], ['texto-secundario', 'superficie-tenue'],
  ['enlace', 'fondo'], ['enlace', 'superficie'],
  ['estado-normal', 'estado-normal-fondo'], ['estado-alerta', 'estado-alerta-fondo'], ['estado-sin-senal', 'estado-sin-senal-fondo'],
  ['estado-inactivo', 'estado-inactivo-fondo'], ['estado-sin-senal', 'superficie'], ['aviso', 'aviso-fondo'],
  ['sobre-acento', 'acento'], ['sobre-acento-secundario', 'acento'], ['tooltip-texto', 'tooltip-fondo'], ['grafico-texto', 'superficie'],
];
const CONTROLES: [string, string][] = [['borde-control', 'superficie'], ['borde-control', 'fondo'], ['foco', 'superficie'], ['foco', 'fondo']];

describe('tokens de app.css: contraste WCAG 2.2 en los dos temas', () => {
  it('la función de contraste da los valores de referencia (negro/blanco 21:1, iguales 1:1, #767676 sobre blanco ≈ 4,54:1)', () => {
    expect(contraste('#000000', '#ffffff')).toBeCloseTo(21, 5);
    expect(contraste('#123456', '#123456')).toBe(1);
    expect(contraste('#767676', '#ffffff')).toBeCloseTo(4.54, 2);
  });
  for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]] as const) {
    it(`tema ${nombre}: todo texto ≥ 4,5:1 y todo control o foco ≥ 3:1`, () => {
      const malos = [
        ...TEXTO.map(([a, b]) => [a, b, contraste(t[a]!, t[b]!), 4.5] as const),
        ...CONTROLES.map(([a, b]) => [a, b, contraste(t[a]!, t[b]!), 3] as const),
      ].filter(([, , r, min]) => r < min).map(([a, b, r]) => `${a}/${b} ${r.toFixed(2)}`);
      expect(malos).toEqual([]);
    });
  }
  it('en los dos sentidos: un texto gris claro sobre blanco (#999999) no pasaría', () => expect(contraste('#999999', '#ffffff')).toBeLessThan(4.5));
  // Series de datos contra la superficie del gráfico (WCAG 1.4.11): 3:1 para todo lo demás, pero 2,2:1 para las series, por la excepción
  // escrita en docs/19 §4, A3 (corrección del 11/11/2026): en el tema claro, amarillo (2,25:1) y celeste (2,31:1) no llegan a 3:1 y se
  // aceptan porque toda gráfica con varias series lleva leyenda con nombres y la tabla de valores (Grafico.svelte, «Ver los datos»;
  // lo comprueba Tablero.test.ts). Los colores no se cambian: el orden está validado y re-validarlo es otro trabajo.
  for (const [nombre, t] of [['claro', claro], ['oscuro', oscuro]] as const) {
    it(`tema ${nombre}: las seis series ≥ 2,2:1 sobre la superficie (excepción de A3); solo las de la excepción bajo 3:1`, () => {
      const r = [1, 2, 3, 4, 5, 6].map((i) => contraste(t[`serie-${i}`]!, t['superficie']!));
      expect(r.filter((x) => x < 2.2)).toEqual([]);
      const bajo3 = r.map((x, i) => (x < 3 ? `serie-${i + 1} ${x.toFixed(2)}` : null)).filter((x) => x !== null);
      expect(bajo3).toEqual(nombre === 'claro' ? ['serie-4 2.25', 'serie-6 2.31'] : []);
    });
  }
  it('el bloque oscuro por el sistema operativo es idéntico al de data-theme="oscuro"', () => expect(oscuroDelSistema).toEqual(oscuro));
});

describe('series de datos (A3)', () => {
  it('app.css trae los seis colores de lib/tema.ts en el mismo orden, en cada tema', () => {
    for (const [t, tokens] of [['claro', claro], ['oscuro', oscuro]] as const) {
      expect([1, 2, 3, 4, 5, 6].map((i) => tokens[`serie-${i}`])).toEqual(SERIES[t]);
      expect(tokens['grafico-texto']).toBe(LIENZO[t].texto);
      expect(tokens['grafico-rejilla']).toBe(LIENZO[t].rejilla);
    }
  });
  it('lo que el lienzo pinta además de las series sale de los tokens de cada tema: umbral = texto secundario; histéresis, el mismo translúcido; franjas, el naranja de la serie 2 translúcido (nunca un color de estado)', () => {
    const rgb = (hex: string): string => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16)).join(', ');
    for (const [t, tokens] of [['claro', claro], ['oscuro', oscuro]] as const) {
      expect(LIENZO[t].umbral).toBe(tokens['texto-secundario']);
      expect(LIENZO[t].histeresis).toMatch(new RegExp(`^rgba\\(${rgb(tokens['texto-secundario']!)}, 0\\.\\d+\\)$`));
      expect(LIENZO[t].franja).toMatch(new RegExp(`^rgba\\(${rgb(tokens['serie-2']!)}, 0\\.\\d+\\)$`));
    }
  });
  it('los de A3 exactamente: claro y oscuro', () => {
    expect(SERIES.claro).toEqual(['#0072b2', '#d55e00', '#009e73', '#e69f00', '#cc79a7', '#56b4e9']);
    expect(SERIES.oscuro).toEqual(['#2a86c7', '#d55e00', '#009e73', '#c98500', '#c26a9b', '#1f8fc9']);
  });
  it('«promedio» es el azul y «lectura actual» el naranja; ningún color de estado se reutiliza como serie', () => {
    expect(colorPromedio('claro')).toBe('#0072b2');
    expect(colorLecturaActual('oscuro')).toBe('#d55e00');
    const estados = Object.entries(claro).filter(([k]) => k.startsWith('estado-')).map(([, v]) => v.toLowerCase());
    expect(SERIES.claro.filter((s) => estados.includes(s))).toEqual([]);
  });
});

// Escala de A2 (radios de 6 y 10 px, tipografía en rem) y objetivos táctiles de 24 px (A5, WCAG 2.5.8), sobre el propio app.css.
describe('escala y objetivos táctiles (A2, A5)', () => {
  it('ningún radio de 4 px ni tamaño de letra en px: radios con --radio o --radio-l, letra con la escala en rem', () => {
    expect(css.match(/border-radius:\s*4px/g)).toBeNull();
    expect(css.match(/font-size:\s*\d+(\.\d+)?px/g)).toBeNull();
    expect(claro['radio']).toBe('6px');
    expect(claro['radio-l']).toBe('10px');
  });
  it('la casilla «comparar» mide 24 × 24 px también en la tabla (no 20 px)', () => {
    expect(claro['objetivo']).toBe('24px');
    expect(css).toContain("td.marcar input[type='checkbox'] { width: var(--objetivo); height: var(--objetivo); }");
    expect(css).not.toMatch(/input\[type='checkbox'\][^}]*width:\s*20px/);
  });
});

describe('preferencia de tema', () => {
  afterEach(() => {
    document.documentElement.removeAttribute('data-theme');
    vi.unstubAllGlobals();
  });
  it('«oscuro» y «claro» se escriben en <html data-theme>; «sistema» lo quita y manda prefers-color-scheme', () => {
    aplicarTema('oscuro');
    expect(document.documentElement.getAttribute('data-theme')).toBe('oscuro');
    expect(temaEfectivo()).toBe('oscuro');
    aplicarTema('claro');
    expect(temaEfectivo()).toBe('claro');
    vi.stubGlobal('matchMedia', (q: string) => ({ matches: q.includes('dark'), media: q, addEventListener() {}, removeEventListener() {} }));
    aplicarTema('claro');
    expect(temaEfectivo()).toBe('claro'); // la persona manda sobre el sistema operativo
    aplicarTema('sistema');
    expect(document.documentElement.hasAttribute('data-theme')).toBe(false);
    expect(temaEfectivo()).toBe('oscuro');
  });
  it('un valor desconocido (o ausente, mientras no exista la preferencia) es «sistema»', () => {
    expect(leerPreferenciaTema(undefined)).toBe('sistema');
    expect(leerPreferenciaTema('rosado')).toBe('sistema');
    expect(leerPreferenciaTema('oscuro')).toBe('oscuro');
  });
});
