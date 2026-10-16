// Texto que llega de afuera (claves de un JSON, un DevEUI del cuerpo, segmentos de un tópico) y va al detalle de una cuarentena o al
// registro: recortado por caracteres, no por unidades UTF-16 (un emoji no queda partido), y sin nada invisible o de control, para
// que no alargue el detalle ni falsifique o disfrace líneas del registro (revisiones del 15/10). Se marca con «?»: controles C0 y C1,
// formato (incluidos los que invierten la dirección del texto), sustitutos sueltos, uso privado y no asignados (\p{C}); todos los
// separadores salvo el espacio común (\p{Z}); y los rellenos que se ven en blanco, listados uno por uno.
const INVISIBLE = /[\p{C}\p{Z}]/u;
// Los rellenos van por punto de código y no en la clase: varios son marcas combinantes (Mn), que una clase no lista sin ambigüedad
// (la regla no-misleading-character-class lo rechaza), y marcar toda la categoría Mn borraría los acentos combinantes legítimos.
// U+034F, U+115F, U+1160, U+2800, U+3164 y U+FFA0; selectores de variación U+180B–U+180D, U+180F, U+FE00–U+FE0F y U+E0100–U+E01EF.
const RELLENOS = new Set([0x034f, 0x115f, 0x1160, 0x180f, 0x2800, 0x3164, 0xffa0]);
const esRelleno = (cp: number): boolean =>
  RELLENOS.has(cp) || (cp >= 0x180b && cp <= 0x180d) || (cp >= 0xfe00 && cp <= 0xfe0f) || (cp >= 0xe0100 && cp <= 0xe01ef);

export const limpia = (texto: string, max = 32): string =>
  Array.from(texto)
    .slice(0, max)
    .map((c) => (c !== ' ' && (INVISIBLE.test(c) || esRelleno(c.codePointAt(0) ?? 0)) ? '?' : c))
    .join('');
