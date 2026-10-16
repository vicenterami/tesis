// Texto que llega de afuera (claves de un JSON, un DevEUI del cuerpo, segmentos de un tópico) y va al detalle de una cuarentena o al
// registro: recortado por caracteres, no por unidades UTF-16 (un emoji no queda partido), y sin nada invisible o de control, para
// que no alargue el detalle ni falsifique o disfrace líneas del registro (revisiones del 15/10). Se marca con «?»: controles C0 y C1,
// formato (incluidos los que invierten la dirección del texto), sustitutos sueltos, uso privado y no asignados (\p{C}); todos los
// separadores salvo el espacio común (\p{Z}); y los rellenos que se ven en blanco (U+034F, U+115F, U+1160, U+2800, U+3164, U+FFA0 y
// los selectores de variación U+FE00 a U+FE0F).
const INVISIBLE = /[\p{C}\p{Z}]/u;
// Fuera de la clase porque varios son marcas combinantes, que una clase de caracteres no lista sin ambigüedad.
const RELLENOS = new Set([0x034f, 0x115f, 0x1160, 0x2800, 0x3164, 0xffa0]);
const esRelleno = (cp: number): boolean => RELLENOS.has(cp) || (cp >= 0xfe00 && cp <= 0xfe0f);

export const limpia = (texto: string, max = 32): string =>
  Array.from(texto)
    .slice(0, max)
    .map((c) => (c !== ' ' && (INVISIBLE.test(c) || esRelleno(c.codePointAt(0) ?? 0)) ? '?' : c))
    .join('');
