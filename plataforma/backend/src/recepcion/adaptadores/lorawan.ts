import { ContextoTrama, Lectura } from '../lectura';
import { TramaMalformada } from './adaptador';
import { ResolverClave } from './mapa-claves';

// Lo común a los dos adaptadores LoRaWAN (docs/10 §8.4 punto 47): el DevEUI del cuerpo debe ser el del tópico, y las claves
// decodificadas se traducen con el mapa único.

// El cuerpo no deja verificar que la trama sea del nodo del tópico: su DevEUI es otro (configuración cruzada en el servidor de red,
// o una pasarela que publica por otro), no lo trae, o ni siquiera es un objeto JSON legible. Es una trama malformada, pero el nodo
// del tópico NO se marca vivo: sin identidad verificada no hay señal de vida (docs/10 §4.1; revisiones del 15/10).
export class IdentidadNoVerificada extends TramaMalformada {}

const MAX_LISTA = 10; // claves que se nombran en un motivo: una trama con mil claves no vuelve entera en el detalle
const MAX_CLAVE = 32; // y cada una recortada y sin caracteres de control: no alarga el detalle ni falsifica líneas del registro
// Recorte por caracteres, no por unidades UTF-16 (un emoji no queda partido), y fuera todo lo invisible o de control: C0 y C1,
// formato (incluidos los que invierten la dirección del texto), sustitutos sueltos y los separadores de línea y de párrafo.
const INVISIBLE = /[\p{C}\u2028\u2029]/u;
const limpia = (k: string): string =>
  Array.from(k).slice(0, MAX_CLAVE).map((c) => (INVISIBLE.test(c) ? '?' : c)).join('');

// Solo la usan los adaptadores de pasarela: un cuerpo ilegible no trae DevEUI, así que tampoco identifica al nodo del tópico.
export function objetoJson(texto: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    throw new IdentidadNoVerificada('JSON inválido');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new IdentidadNoVerificada('se esperaba un objeto JSON');
  return v as Record<string, unknown>;
}

// El DevEUI se compara en minúsculas, la forma que exige `id_fisico` (la base y el alta solo admiten [a-z0-9-]).
export function exigirDevEui(cuerpo: unknown, ctx: ContextoTrama, campo: string): void {
  if (typeof cuerpo !== 'string' || cuerpo.trim() === '') throw new IdentidadNoVerificada(`sin ${campo}`);
  // Sin DevEUI en el tópico no hay con qué comparar: se rechaza (cerrado por omisión), aunque hoy el despacho no lo permita.
  if (ctx.deveui === undefined) throw new TramaMalformada('sin DevEUI en el tópico: solo se recibe por el tópico de su pasarela');
  const delCuerpo = cuerpo.trim().toLowerCase();
  if (delCuerpo !== ctx.deveui.toLowerCase()) {
    throw new IdentidadNoVerificada(`DevEUI del cuerpo ${delCuerpo.slice(0, 32)} ≠ tópico ${ctx.deveui.toLowerCase().slice(0, 32)}`);
  }
}

// Traduce las claves conocidas a lecturas; las desconocidas se anotan en ctx.ignoradas para la línea de registro de la trama.
// Una clave conocida con un valor que no es un número finito es un error del decodificador: la trama va a cuarentena entera.
export function lecturasDe(valores: Record<string, unknown>, resolver: ResolverClave, ctx: ContextoTrama, tiempo: Date | undefined,
  excluir: ReadonlySet<string> = new Set()): Lectura[] {
  const lecturas: Lectura[] = [];
  const ignoradas: string[] = [];
  for (const [clave, valor] of Object.entries(valores)) {
    if (excluir.has(clave)) continue;
    const destino = resolver(clave);
    if (!destino) {
      ignoradas.push(limpia(clave));
      continue;
    }
    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new TramaMalformada(`${limpia(clave)}: no es un número`);
    // Dos claves que apuntan a la misma magnitud (un sinónimo, otra mayúscula): vale la primera; la otra se anota como ignorada.
    if (lecturas.some((l) => l.magnitud === destino.magnitud)) {
      ignoradas.push(`${limpia(clave)} (repetida)`);
      continue;
    }
    lecturas.push({ magnitud: destino.magnitud, valor, unidad: destino.unidad, tiempo });
  }
  ctx.ignoradas = ignoradas;
  if (lecturas.length === 0) {
    const vistas = ignoradas.slice(0, MAX_LISTA).join(', ') + (ignoradas.length > MAX_LISTA ? ', …' : '');
    throw new TramaMalformada(`ninguna clave conocida${vistas ? ` (llegaron: ${vistas})` : ''}`);
  }
  return lecturas;
}
