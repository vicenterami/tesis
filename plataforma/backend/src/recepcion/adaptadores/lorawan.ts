import { ContextoTrama, Enlace, Lectura } from '../lectura.js';
import { limpia } from '../texto.js';
import { TramaMalformada } from './adaptador.js';
import { ResolverClave } from './mapa-claves.js';
import { aplicarReceta } from './receta.js';

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

// Contador de trama del uplink (`fCnt`, 32 bits sin signo en el servidor de red; docs/10 §4.1). ChirpStack v4 lo emite siempre, también
// el 0 (su UplinkEvent se serializa con `emit_fields()`, api/rust/build.rs); falta en otros emisores (Milesight con Metadata). Ausente: no
// hay con qué deduplicar y la trama sigue. Presente y con otra forma: la trama no es lo que dice ser.
export function anotarFcnt(v: unknown, ctx: ContextoTrama): void {
  if (v === undefined) return;
  if (typeof v !== 'number' || !Number.isInteger(v) || v < 0 || v > 0xffffffff) throw new TramaMalformada('fCnt no es un entero entre 0 y 4294967295');
  ctx.fcnt = v;
}

// La señal del enlace de la trama (docs/10 §8.4 punto 71): del arreglo `rxInfo`, el MEJOR receptor, el de mayor SNR medido y, en empate (o
// entre receptores sin SNR medido), el de mayor RSSI (el SNR satura con señal fuerte). El SNR se llama `snr` en ChirpStack v4 y `loRaSNR` en
// la pasarela Milesight sin códec. Un valor que no es un número finito se omite; un elemento sin ningún número no compite; un `rxInfo` vacío,
// ausente o que no es un arreglo no deja nada.
// `inferirSnr`: en ChirpStack v4 el elemento es un `gw.UplinkRxInfo` serializado con pbjson SIN `emit_fields()` (api/rust/build.rs), así
// que un SNR de 0 dB llega ausente. Quien llama lo pide solo con modulación LoRa declarada en la trama (con FSK no hay SNR que omitir). Ese 0
// se infiere solo con un RSSI dentro de −150 a 0 dBm y NO compite como medido: para elegir el receptor cuenta como «sin SNR», así que nunca
// le gana a uno con SNR real (corrección del 25/11/2026). En la pasarela Milesight, ausente es ausente.
// Nunca lanza: la señal no es un dato del sensor y no puede mandar la trama a cuarentena.
export function enlaceDe(rxInfo: unknown, inferirSnr = false): Enlace | undefined {
  if (!Array.isArray(rxInfo)) return undefined;
  const numero = (v: unknown): number | undefined => (typeof v === 'number' && Number.isFinite(v) ? v : undefined);
  const peso = (x: number | undefined): number => x ?? -Infinity;
  let mejor: { rssi?: number; snr?: number; medido?: number } | undefined;
  for (const r of rxInfo as unknown[]) {
    if (typeof r !== 'object' || r === null || Array.isArray(r)) continue;
    const e = r as Record<string, unknown>;
    const rssi = numero(e.rssi);
    const medido = numero(e.snr) ?? numero(e.loRaSNR);
    let snr = medido;
    if (snr === undefined && inferirSnr && rssi !== undefined && rssi >= -150 && rssi <= 0 && !('snr' in e) && !('loRaSNR' in e)) snr = 0;
    if (rssi === undefined && snr === undefined) continue;
    if (mejor === undefined || peso(medido) > peso(mejor.medido) || (peso(medido) === peso(mejor.medido) && peso(rssi) > peso(mejor.rssi))) {
      mejor = { rssi, snr, medido };
    }
  }
  if (mejor === undefined) return undefined;
  return { ...(mejor.rssi !== undefined ? { rssi: mejor.rssi } : {}), ...(mejor.snr !== undefined ? { snr: mejor.snr } : {}) };
}

// Traduce las claves conocidas a lecturas; las desconocidas se anotan en ctx.ignoradas para la línea de registro de la trama.
// Una clave conocida con un valor que no es un número finito es un error del decodificador: la trama va a cuarentena entera.
export function lecturasDe(valores: Record<string, unknown>, resolver: ResolverClave, ctx: ContextoTrama, tiempo: Date | undefined,
  excluir: ReadonlySet<string> = new Set()): Lectura[] {
  const lecturas: Lectura[] = [];
  const ignoradas: string[] = [];
  const crudas: string[] = [];
  for (const [clave, valor] of Object.entries(valores)) {
    if (excluir.has(clave)) continue;
    const destino = resolver(clave);
    if (!destino) {
      ignoradas.push(limpiaClave(clave));
      crudas.push(clave);
      continue;
    }
    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new TramaMalformada(`${limpiaClave(clave)}: no es un número`);
    // Dos claves que apuntan a la misma magnitud (un sinónimo, otra mayúscula): vale la primera; la otra se anota como ignorada.
    if (lecturas.some((l) => l.magnitud === destino.magnitud)) {
      ignoradas.push(`${limpiaClave(clave)} (repetida)`);
      crudas.push(clave);
      continue;
    }
    lecturas.push({ magnitud: destino.magnitud, valor, unidad: destino.unidad, tiempo });
  }
  ctx.ignoradas = ignoradas;
  ctx.ignoradasCrudas = crudas;
  if (lecturas.length === 0) {
    const vistas = ignoradas.slice(0, MAX_LISTA).join(', ') + (ignoradas.length > MAX_LISTA ? ', …' : '');
    throw new TramaMalformada(`ninguna clave conocida${vistas ? ` (llegaron: ${vistas})` : ''}`);
  }
  return lecturas;
}

// Base64 estricto (RFC 4648 §4, con relleno): Buffer.from(…, 'base64') ignora en silencio lo que no es base64, y una `data`
// corrupta se decodificaría como otros bytes en vez de rechazarse.
const BASE64 = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

// La `data` sin decodificar, con la receta que la recepción leyó de la base para este nodo (docs/10 §8.4 punto 69 vi). Los textos de
// error son los de antes (C-89, docs/16): sin receta para su código, «perfil de decodificación desconocido»; luego «data no es base64»;
// el largo y lo demás, los de aplicarReceta. La hora la pone el adaptador.
export function decodificarData(ctx: ContextoTrama, data: unknown, tiempo: Date | undefined): Lectura[] {
  if (!ctx.receta) throw new TramaMalformada(`perfil de decodificación desconocido: ${limpia(ctx.decodificador ?? '')}`);
  if (typeof data !== 'string' || data === '' || !BASE64.test(data)) throw new TramaMalformada('data no es base64');
  ctx.ignoradas = [];
  ctx.ignoradasCrudas = [];
  return aplicarReceta(ctx.receta, Buffer.from(data, 'base64')).map((l) => ({ ...l, tiempo }));
}
