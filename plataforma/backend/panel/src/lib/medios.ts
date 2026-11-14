// ¿Pantalla angosta? (docs/19 §4, tablero v2, A5: bajo 700 px las tablas se vuelven tarjetas y el menú se pliega). Lo decide el CSS
// donde basta con ocultar; donde cambia lo que se dibuja (tabla o tarjetas), lo decide esta consulta, que sigue al cambio de ancho.
// Sin matchMedia (jsdom), ancho.
export const CONSULTA_ANGOSTA = '(max-width: 700px)';

export function seguirAngosto(alCambiar: (angosto: boolean) => void): () => void {
  if (typeof matchMedia !== 'function') {
    alCambiar(false);
    return () => {};
  }
  const m = matchMedia(CONSULTA_ANGOSTA);
  alCambiar(m.matches);
  const oyente = (e: MediaQueryListEvent): void => alCambiar(e.matches);
  m.addEventListener?.('change', oyente);
  return () => m.removeEventListener?.('change', oyente);
}

// El armazón (docs/19 §4, bloque L, punto 1): bajo 1 000 px el menú es un cajón; desde 1 280 px la barra lateral abre expandida y entre
// 1 000 y 1 279 px, contraída a iconos. Sin matchMedia (jsdom), el ancho de escritorio.
export type AnchoArmazon = 'cajon' | 'contraido' | 'expandido';
export const CONSULTA_CAJON = '(max-width: 999.98px)';
export const CONSULTA_EXPANDIDO = '(min-width: 1280px)';
export function seguirArmazon(alCambiar: (ancho: AnchoArmazon) => void): () => void {
  if (typeof matchMedia !== 'function') {
    alCambiar('expandido');
    return () => {};
  }
  const cajon = matchMedia(CONSULTA_CAJON);
  const expandido = matchMedia(CONSULTA_EXPANDIDO);
  const avisar = (): void => alCambiar(cajon.matches ? 'cajon' : expandido.matches ? 'expandido' : 'contraido');
  avisar();
  cajon.addEventListener?.('change', avisar);
  expandido.addEventListener?.('change', avisar);
  return () => {
    cajon.removeEventListener?.('change', avisar);
    expandido.removeEventListener?.('change', avisar);
  };
}
