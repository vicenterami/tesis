import { ContextoTrama, Lectura } from '../lectura';
import { TramaMalformada } from './adaptador';
import { ResolverClave } from './mapa-claves';

// Lo común a los dos adaptadores LoRaWAN (docs/10 §8.4 punto 47): el DevEUI del cuerpo debe ser el del tópico, y las claves
// decodificadas se traducen con el mapa único.

// El DevEUI del cuerpo no es el del tópico: configuración cruzada en el servidor de red (o una pasarela que publica por otro).
// Es una trama malformada, pero el nodo del tópico NO se marca vivo: no hay certeza de que la trama sea suya (docs/10 §4.1). Lo mismo
// cuando el cuerpo no trae con qué identificarlo (sin DevEUI): sin identidad verificada no hay señal de vida (revisión del 15/10).
export class IdentidadCruzada extends TramaMalformada {}

const MAX_LISTA = 10; // claves que se nombran en un motivo: una trama con mil claves no vuelve entera en el detalle
const MAX_CLAVE = 32; // y cada una recortada y sin caracteres de control: no alarga el detalle ni falsifica líneas del registro
const limpia = (k: string): string =>
  Array.from(k.slice(0, MAX_CLAVE), (c) => (c.charCodeAt(0) < 32 || c.charCodeAt(0) === 127 ? '?' : c)).join('');

export function objetoJson(texto: string): Record<string, unknown> {
  let v: unknown;
  try {
    v = JSON.parse(texto);
  } catch {
    throw new TramaMalformada('JSON inválido');
  }
  if (typeof v !== 'object' || v === null || Array.isArray(v)) throw new TramaMalformada('se esperaba un objeto JSON');
  return v as Record<string, unknown>;
}

// El DevEUI se compara en minúsculas, la forma que exige `id_fisico` (la base y el alta solo admiten [a-z0-9-]).
export function exigirDevEui(cuerpo: unknown, ctx: ContextoTrama, campo: string): void {
  if (typeof cuerpo !== 'string' || cuerpo.trim() === '') throw new IdentidadCruzada(`sin ${campo}`);
  // Sin DevEUI en el tópico no hay con qué comparar: se rechaza (cerrado por omisión), aunque hoy el despacho no lo permita.
  if (ctx.deveui === undefined) throw new TramaMalformada('sin DevEUI en el tópico: solo se recibe por el tópico de su pasarela');
  const delCuerpo = cuerpo.trim().toLowerCase();
  if (delCuerpo !== ctx.deveui.toLowerCase()) {
    throw new IdentidadCruzada(`DevEUI del cuerpo ${delCuerpo.slice(0, 32)} ≠ tópico ${ctx.deveui.toLowerCase().slice(0, 32)}`);
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
