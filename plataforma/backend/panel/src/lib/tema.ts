// Tema claro y oscuro (docs/19 §4, tablero v2, A2 y A3). Los tokens viven en app.css; aquí, lo que el lienzo de uPlot no puede leer de
// CSS en todas partes (las series y el texto del gráfico se pintan con un color, no con una variable) y la preferencia de la persona.
// Manda `data-theme` en <html> (la preferencia, de `GET /sesion → preferencias.tema`; hasta que exista, «sistema»); sin él, el
// sistema operativo (`prefers-color-scheme`). Una prueba (tema.test.ts) comprueba que estos valores son los de app.css.
import { readable, type Readable } from 'svelte/store';

export type PreferenciaTema = 'sistema' | 'claro' | 'oscuro';
export type Tema = 'claro' | 'oscuro';

// Okabe e Ito en este orden fijo (A3): validados sobre fondo claro; sobre oscuro, los mismos matices re-escalonados. Cambiar el orden
// exige volver a validar.
export const SERIES: Readonly<Record<Tema, readonly string[]>> = {
  claro: ['#0072b2', '#d55e00', '#009e73', '#e69f00', '#cc79a7', '#56b4e9'],
  oscuro: ['#2a86c7', '#d55e00', '#009e73', '#c98500', '#c26a9b', '#1f8fc9'],
};
// Lo que el lienzo pinta además de las series: texto y rejilla de los ejes (los tokens --grafico-texto y --grafico-rejilla), las
// líneas de umbral (el texto secundario del tema), la banda de histéresis y las franjas de condiciones (el naranja de la paleta,
// translúcido: nunca un color de estado, A3).
export const LIENZO: Readonly<Record<Tema, { texto: string; rejilla: string; umbral: string; histeresis: string; franja: string }>> = {
  claro: { texto: '#1f2933', rejilla: '#e3e8eb', umbral: '#52606d', histeresis: 'rgba(82, 96, 109, 0.12)', franja: 'rgba(213, 94, 0, 0.12)' },
  oscuro: { texto: '#e6edf3', rejilla: '#2a3846', umbral: '#a9b6c2', histeresis: 'rgba(169, 182, 194, 0.15)', franja: 'rgba(213, 94, 0, 0.2)' },
};

export function leerPreferenciaTema(x: unknown): PreferenciaTema {
  return x === 'claro' || x === 'oscuro' ? x : 'sistema';
}

// Aplica la preferencia: «sistema» quita el atributo y deja mandar a prefers-color-scheme.
export function aplicarTema(p: PreferenciaTema, raiz: HTMLElement = document.documentElement): void {
  if (p === 'sistema') raiz.removeAttribute('data-theme');
  else raiz.setAttribute('data-theme', p);
}

// El tema que se ve ahora: el atributo si está; si no, el del sistema operativo (sin matchMedia, como en jsdom, el claro).
export function temaEfectivo(raiz: HTMLElement | null = typeof document === 'undefined' ? null : document.documentElement): Tema {
  const t = raiz?.getAttribute('data-theme');
  if (t === 'claro' || t === 'oscuro') return t;
  try {
    return typeof matchMedia === 'function' && matchMedia('(prefers-color-scheme: dark)').matches ? 'oscuro' : 'claro';
  } catch {
    return 'claro';
  }
}

// El tema efectivo como estado reactivo, en UN solo lugar (corrección del 11/11/2026): las gráficas no se repintaban al cambiar el
// tema del sistema operativo ni la preferencia. Escucha `prefers-color-scheme` y el atributo `data-theme` de <html> mientras alguien
// lo lea (`$temaVivo` en un componente), y suelta los dos oyentes cuando nadie lo lee.
export const temaVivo: Readable<Tema> = readable<Tema>(temaEfectivo(), (fijar) => {
  if (typeof document === 'undefined') return;
  const actualizar = (): void => fijar(temaEfectivo());
  actualizar();
  let consulta: MediaQueryList | null = null;
  try {
    consulta = typeof matchMedia === 'function' ? matchMedia('(prefers-color-scheme: dark)') : null;
  } catch {
    consulta = null;
  }
  consulta?.addEventListener?.('change', actualizar);
  const observador = typeof MutationObserver === 'undefined' ? null : new MutationObserver(actualizar);
  observador?.observe(document.documentElement, { attributes: true, attributeFilter: ['data-theme'] });
  return () => {
    consulta?.removeEventListener?.('change', actualizar);
    observador?.disconnect();
  };
});

export const coloresSeries = (t: Tema = temaEfectivo()): readonly string[] => SERIES[t];
// «promedio» va en el azul de la paleta y «lectura actual» en el naranja (A3).
export const colorPromedio = (t: Tema = temaEfectivo()): string => SERIES[t][0]!;
export const colorLecturaActual = (t: Tema = temaEfectivo()): string => SERIES[t][1]!;

// Contraste WCAG 2.2 (1.4.3 y 1.4.11): luminancia relativa de sRGB y razón (L1 + 0,05) / (L2 + 0,05).
export function luminancia(hex: string): number {
  const m = /^#([0-9a-f]{6})$/i.exec(hex.trim());
  if (!m) throw new Error(`color no reconocido: ${hex}`);
  const canal = (i: number): number => {
    const c = parseInt(m[1]!.slice(i, i + 2), 16) / 255;
    return c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * canal(0) + 0.7152 * canal(2) + 0.0722 * canal(4);
}
export function contraste(a: string, b: string): number {
  const [x, y] = [luminancia(a), luminancia(b)];
  return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05);
}
