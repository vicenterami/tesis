// P11 Legal y acerca de (docs/19 §4, P11; docs/21 §7; docs/20 §12). Los textos legales llegan del servidor en Markdown simple (títulos con
// «##», párrafos, listas con «-» y **negritas**): el panel los muestra como TEXTO, nunca como HTML (nada que venga de la red se interpreta
// como marcado). Esta función los parte en bloques que el componente dibuja con elementos propios.
export type Bloque = { tipo: 'titulo'; texto: string } | { tipo: 'parrafo'; texto: string } | { tipo: 'lista'; items: string[] };

// Las negritas y las comillas de código se quitan (se leen igual sin ellas); el resto del texto queda tal cual.
export const limpio = (s: string): string => s.replace(/\*\*(.+?)\*\*/g, '$1').replace(/`([^`]*)`/g, '$1').trim();

export function bloquesDeTexto(md: string): Bloque[] {
  const bloques: Bloque[] = [];
  let parrafo: string[] = [];
  let lista: string[] | null = null;
  const cerrar = (): void => {
    if (parrafo.length > 0) bloques.push({ tipo: 'parrafo', texto: limpio(parrafo.join(' ')) });
    parrafo = [];
    if (lista !== null) bloques.push({ tipo: 'lista', items: lista });
    lista = null;
  };
  for (const linea of md.replace(/\r\n?/g, '\n').split('\n')) {
    const l = linea.trim();
    if (l === '') cerrar();
    else if (/^#{1,6}\s/.test(l)) {
      cerrar();
      bloques.push({ tipo: 'titulo', texto: limpio(l.replace(/^#{1,6}\s+/, '')) });
    } else if (/^[-*]\s/.test(l)) {
      if (parrafo.length > 0) {
        bloques.push({ tipo: 'parrafo', texto: limpio(parrafo.join(' ')) });
        parrafo = [];
      }
      (lista ??= []).push(limpio(l.replace(/^[-*]\s+/, '')));
    } else if (lista !== null) {
      // una línea que continúa el último punto de la lista
      lista[lista.length - 1] = `${lista[lista.length - 1]} ${limpio(l)}`;
    } else parrafo.push(l);
  }
  cerrar();
  return bloques;
}

export interface TextoLegal {
  version?: number | string;
  fecha?: string;
  texto: string;
}
// Una respuesta legal cualquiera → su texto (el servidor la manda como objeto con `texto`; si viniera solo el texto, también sirve).
export function textoDe(x: unknown): TextoLegal | null {
  if (typeof x === 'string') return { texto: x };
  if (typeof x === 'object' && x !== null && typeof (x as { texto?: unknown }).texto === 'string') return x as TextoLegal;
  return null;
}

export const MAX_SOPORTE = 2000; // el tope del servidor (mensaje_soporte)

// GET /privacidad (legal/privacidad.ts del servidor): el inventario de docs/21 §2 por filas y los apartados de §3 a §8.
export interface Privacidad {
  version: number;
  fecha: string;
  responsable: { nombre: string; contacto: string } | null;
  aviso_responsable: string | null;
  datos: { dato: string; donde: string; para_que: string; cuanto_tiempo: string; quien_accede: string }[];
  secciones: { titulo: string; parrafos: string[] }[];
}
export function esPrivacidad(x: unknown): x is Privacidad {
  return typeof x === 'object' && x !== null && Array.isArray((x as Privacidad).datos) && Array.isArray((x as Privacidad).secciones);
}
