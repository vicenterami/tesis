import { Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura.js';
import { limpia } from '../texto.js';
import { tiempoSenml } from '../tiempo.js';
import { Adaptador, TramaMalformada } from './adaptador.js';

// El nombre y la unidad de un registro son texto del emisor y terminan en el detalle de una cuarentena y en el registro: van recortados
// (40 es el largo máximo de un código de magnitud del catálogo) y sin caracteres de control (texto.ts).
const MAX_NOMBRE = 40;
const MAX_UNIDAD = 32;

// Registro SenML (RFC 8428) en su forma JSON: los campos que usa esta plataforma.
//   bn = base name (no identifica: ver el perfil)   bt = base time (segundos)   bu = base unit   bv = base value (se suma a v)
//   bver = versión del formato (RFC §4.1)           n  = name (código de magnitud del catálogo)  u = unit
//   v  = value (número)                             t  = time (relativo a bt)
interface RegistroSenML {
  bn?: string; bt?: number; bu?: string; bv?: number; bver?: number;
  n?: string; u?: string; v?: number; t?: number;
  vs?: unknown; vb?: unknown; vd?: unknown;
}

// Versión del formato que se entiende (RFC 8428 §4.1: «defaults to 10 if not present»; §4.4: con una mayor, «MUST NOT use this object»).
const VERSION_ENTENDIDA = 10;
// Etiquetas que define la RFC (Tabla 1, §4.3). Otra etiqueta es una extensión (§4.4): se ignora, salvo que termine en «_».
const ETIQUETAS_RFC = new Set(['bn', 'bt', 'bu', 'bv', 'bs', 'bver', 'n', 'u', 'v', 'vs', 'vb', 'vd', 's', 't', 'ut']);
const CAMPOS_DE_VALOR = ['v', 'vs', 'vb', 'vd'];

// Contrato NATIVO de la plataforma: un PERFIL de SenML (RFC 8428), estricto y declarado en docs/10 §4 (filtro 2). Un «pack» es un arreglo JSON
// de registros; los campos base (bt, bu, bv) se heredan a los registros siguientes. Ejemplo de un nodo con dos sensores:
//   [{"bt":1757300000,"n":"temperatura","u":"Cel","v":21.5},
//    {"n":"humedad","u":"%RH","v":55}]
// Qué toma el perfil de la RFC:
//   · v (número finito) más bv (§4.5.4: «added together»); u o bu; t más bt (§4.5.3), con el tiempo relativo resuelto (tiempo.ts).
//   · n es el CÓDIGO DE MAGNITUD del catálogo, no un nombre global: bn no se antepone (§4.1 y §4.5.1 se implementan a medias a propósito;
//     la concatenación bn + n queda para el catálogo de alias). Sin n, la magnitud sale del tópico.
//   · bn NO IDENTIFICA y se ignora: la identidad sale del tópico y de la credencial del broker (docs/10 §4, filtro 1). Ninguna lectura
//     lleva bn, así que una trama no puede declararse otro dispositivo; rechazarla por su bn exigiría decidir qué nombra un bn (la RFC
//     lo define como prefijo de nombres, no como identidad) y rechazaría packs válidos como los de la RFC (bn con URN).
// Qué rechaza (TramaMalformada, cuarentena «malformada»): bver mayor que 10 o que no sea un entero positivo (§4.4), más de un campo de
// valor en un registro (§4.2), una etiqueta desconocida terminada en «_» (§4.4), bv que no sea un número finito, v + bv fuera de rango.
// Qué no hace: no guarda valores de texto, booleanos ni datos (vs, vb, vd: se omiten, solo hay series numéricas); un registro sin v no
// genera lectura aunque herede bv (la RFC lo leería como bv + 0; el perfil exige v); ignora s, bs y ut; las etiquetas desconocidas sin «_»
// se ignoran (§4.4).
@Injectable()
export class SenmlAdaptador implements Adaptador {
  readonly nombre = 'senml';
  readonly origenTiempo = 'dispositivo';

  reconoce(ctx: ContextoTrama): boolean {
    const texto = ctx.carga.toString('utf8').trimStart();
    return texto.startsWith('['); // un pack SenML es siempre un arreglo JSON
  }

  analizar(ctx: ContextoTrama): Lectura[] {
    let pack: unknown;
    try {
      pack = JSON.parse(ctx.carga.toString('utf8'));
    } catch {
      throw new TramaMalformada('JSON inválido');
    }
    if (!Array.isArray(pack) || pack.length === 0) throw new TramaMalformada('pack SenML vacío');

    const lecturas: Lectura[] = [];
    let baseTiempo = 0;
    let baseUnidad: string | undefined;
    let baseValor = 0;

    for (const r of pack as RegistroSenML[]) {
      if (typeof r !== 'object' || r === null) throw new TramaMalformada('registro no es objeto');
      revisarPerfil(r);
      if (typeof r.bt === 'number') baseTiempo = r.bt;
      if (typeof r.bu === 'string') baseUnidad = r.bu;
      if (r.bv !== undefined) {
        if (typeof r.bv !== 'number' || !Number.isFinite(r.bv)) throw new TramaMalformada('bv no numérico');
        baseValor = r.bv; // RFC 8428 §4.1: una base vale hasta que otro registro trae la suya
      }
      if (r.v === undefined) continue; // registro solo de base, o con un valor que no es número (vs, vb, vd): sin lectura
      if (typeof r.v !== 'number' || !Number.isFinite(r.v)) throw new TramaMalformada('v no numérico');
      const valor = baseValor + r.v; // RFC 8428 §4.5.4: «The Base Value and Value are added together»
      if (!Number.isFinite(valor)) throw new TramaMalformada('bv + v fuera del rango numérico');

      // La magnitud viene del nombre del registro; si no lo trae, del tópico. `n` y `u` deben ser cadenas (RFC 8428 §4.3): un `n` numérico
      // lanzaba TypeError, que no es TramaMalformada, así que la trama no iba a cuarentena y el broker la reenviaba (docs/16, matriz del
      // contrato, C-16).
      const n: unknown = r.n;
      const u: unknown = r.u;
      if (n !== undefined && typeof n !== 'string') throw new TramaMalformada('n no es texto');
      if (u !== undefined && typeof u !== 'string') throw new TramaMalformada('u no es texto');
      const magnitud = limpia((n ?? ctx.magnitudTopico).toLowerCase(), MAX_NOMBRE);
      const unidad = u ?? baseUnidad;
      // Tiempo: segundos Unix si bt + t llega a 2^28; menor, es relativo a «ahora» (RFC 8428 §4.5.3, tiempoSenml).
      let tiempo: Date | undefined;
      if (typeof r.t === 'number' || baseTiempo) {
        tiempo = tiempoSenml(baseTiempo + (typeof r.t === 'number' ? r.t : 0), ctx.recibidoEn ?? new Date());
      }
      lecturas.push({ magnitud, valor, unidad: unidad === undefined ? undefined : limpia(unidad, MAX_UNIDAD), tiempo });
    }
    if (lecturas.length === 0) throw new TramaMalformada('pack sin valores');
    return lecturas;
  }
}

// Las reglas del perfil que miran el registro entero, aunque no traiga valor: versión, etiquetas de extensión obligatorias y un solo valor.
function revisarPerfil(r: object): void {
  const reg = r as Record<string, unknown>;
  if (reg.bver !== undefined) {
    const v = reg.bver;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new TramaMalformada('bver no es un entero positivo');
    if (v > VERSION_ENTENDIDA) throw new TramaMalformada(`bver ${v} no se entiende (se entiende hasta ${VERSION_ENTENDIDA})`);
  }
  for (const etiqueta of Object.keys(reg)) {
    if (!ETIQUETAS_RFC.has(etiqueta) && etiqueta.endsWith('_')) {
      throw new TramaMalformada(`campo «${limpia(etiqueta, MAX_NOMBRE)}» desconocido y de los que no se pueden ignorar (termina en «_»)`);
    }
  }
  if (CAMPOS_DE_VALOR.filter((c) => Object.hasOwn(reg, c)).length > 1) throw new TramaMalformada('más de un campo de valor en un registro (v, vs, vb, vd)');
}
