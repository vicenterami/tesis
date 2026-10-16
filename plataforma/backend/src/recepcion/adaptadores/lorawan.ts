import { ContextoTrama, Lectura } from '../lectura';
import { limpia } from '../texto';
import { TramaMalformada } from './adaptador';
import { ResolverClave } from './mapa-claves';

// Lo común a los dos adaptadores LoRaWAN (docs/10 §8.4 punto 47): el DevEUI del cuerpo debe ser el del tópico, y las claves
// decodificadas se traducen con el mapa único.

// El cuerpo no deja verificar que la trama sea del nodo del tópico: su DevEUI es otro (configuración cruzada en el servidor de red,
// o una pasarela que publica por otro), no lo trae, o ni siquiera es un objeto JSON legible. Es una trama malformada, pero el nodo
// del tópico NO se marca vivo: sin identidad verificada no hay señal de vida (docs/10 §4.1; revisiones del 15/10).
export class IdentidadNoVerificada extends TramaMalformada {}

const MAX_LISTA = 10; // claves que se nombran en un motivo: una trama con mil claves no vuelve entera en el detalle
const MAX_CLAVE = 32; // y cada una recortada y sin nada invisible (../texto): no alarga el detalle ni falsifica líneas del registro
const limpiaClave = (k: string): string => limpia(k, MAX_CLAVE);

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

// El DevEUI se compara en minúsculas, la forma que exige `id_fisico` (la base y el alta solo admiten [a-z0-9-]). Solo se compara si
// es ASCII con esa forma: así ningún carácter de control llega al motivo, y una letra Unicode que al pasar a minúsculas se vuelve
// ASCII (el signo Kelvin pasa a «k») no calza con otro nodo (revisión del 15/10).
const FORMA_DEVEUI = /^[0-9A-Za-z-]{1,64}$/;
export function exigirDevEui(cuerpo: unknown, ctx: ContextoTrama, campo: string): void {
  if (typeof cuerpo !== 'string' || cuerpo.trim() === '') throw new IdentidadNoVerificada(`sin ${campo}`);
  // Sin DevEUI en el tópico no hay con qué comparar: se rechaza (cerrado por omisión), aunque hoy el despacho no lo permita.
  if (ctx.deveui === undefined) throw new TramaMalformada('sin DevEUI en el tópico: solo se recibe por el tópico de su pasarela');
  const delCuerpo = cuerpo.trim();
  if (!FORMA_DEVEUI.test(delCuerpo)) throw new IdentidadNoVerificada(`${campo} con caracteres que no son letras ASCII, dígitos ni guion: ${limpia(delCuerpo)}`);
  if (delCuerpo.toLowerCase() !== ctx.deveui.toLowerCase()) {
    throw new IdentidadNoVerificada(`DevEUI del cuerpo ${delCuerpo.toLowerCase().slice(0, 32)} ≠ tópico ${limpia(ctx.deveui.toLowerCase())}`);
  }
}

// Hora del servidor de red (regla 17 de docs/13): RFC 3339 con zona. Una hora sin zona no se adivina: sin marca, rige la recepción.
const ZONA_RFC3339 = /(Z|[+-]\d{2}:\d{2})$/;
export function tiempoDe(v: unknown): Date | undefined {
  if (typeof v !== 'string' || !ZONA_RFC3339.test(v)) return undefined;
  const d = new Date(v);
  return Number.isNaN(d.getTime()) ? undefined : d;
}

// Contador de trama del uplink (`fCnt`, 32 bits sin signo en el servidor de red; docs/10 §4.1). Ausente: no hay con qué deduplicar
// y la trama sigue (el JSON de Protocol Buffers omite el valor 0). Presente y con otra forma: la trama no es lo que dice ser.
export function anotarFcnt(v: unknown, ctx: ContextoTrama): void {
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new TramaMalformada('fCnt no es un entero entre 0 y 4294967295');
  ctx.fcnt = v;
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
      ignoradas.push(limpiaClave(clave));
      continue;
    }
    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new TramaMalformada(`${limpiaClave(clave)}: no es un número`);
    // Dos claves que apuntan a la misma magnitud (un sinónimo, otra mayúscula): vale la primera; la otra se anota como ignorada.
    if (lecturas.some((l) => l.magnitud === destino.magnitud)) {
      ignoradas.push(`${limpiaClave(clave)} (repetida)`);
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
