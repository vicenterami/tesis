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
