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
//   bver = versión del formato (RFC §4.1 y §4.4)    n  = name (código de magnitud del catálogo)  u = unit
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
// Qué rechaza (TramaMalformada, cuarentena «malformada»): bver mayor que 10 o que no sea un entero positivo (§4.4), bver distinto entre
// registros del mismo pack (§4.4: «MUST have the same version number»), más de un campo de valor en un registro (§4.2), una etiqueta
// desconocida terminada en «_» (§4.4), bt o t que no sean un número finito, bu, n o u que no sean texto (§4.3), bv que no sea un número finito,
// v + bv fuera de rango. Un campo de tipo equivocado no se ignora en silencio: un perfil estricto lo dice (docs/10 §4).
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
    // «Ahora» de los tiempos relativos: uno solo por trama (todos los registros comparten el mismo instante), el de recepción.
    const ahora = ctx.recibidoEn ?? new Date();
    let versionDelPack: number | undefined;
    let baseTiempo = 0;
    let baseUnidad: string | undefined;
    let baseValor = 0;

    for (const [indice, r] of (pack as RegistroSenML[]).entries()) {
      if (typeof r !== 'object' || r === null) throw new TramaMalformada('registro no es objeto');
      versionDelPack = revisarPerfil(r, indice, versionDelPack);
      if (typeof r.bt === 'number') baseTiempo = r.bt;
      if (typeof r.bu === 'string') baseUnidad = r.bu;
      if (r.bv !== undefined) {
        if (typeof r.bv !== 'number' || !Number.isFinite(r.bv)) throw new TramaMalformada('bv no numérico');
        baseValor = r.bv; // RFC 8428 §4: una base vale hasta que otro registro trae la suya
      }
      if (r.v === undefined) continue; // registro solo de base, o con un valor que no es número (vs, vb, vd): sin lectura
      if (typeof r.v !== 'number' || !Number.isFinite(r.v)) throw new TramaMalformada('v no numérico');
      const valor = baseValor + r.v; // RFC 8428 §4.5.4: «The Base Value and Value are added together»
      if (!Number.isFinite(valor)) throw new TramaMalformada('bv + v fuera del rango numérico');

      // La magnitud viene del nombre del registro; si no lo trae, del tópico. `n` y `u` son cadenas (RFC 8428 §4.3): lo exige revisarPerfil
      // en todo registro, traiga o no valor. Un `n` numérico
      // lanzaba TypeError, que no es TramaMalformada, así que la trama no iba a cuarentena y el broker la reenviaba (docs/16, matriz del
      // contrato, C-16).
      const magnitud = limpia((r.n ?? ctx.magnitudTopico).toLowerCase(), MAX_NOMBRE);
      const unidad = r.u ?? baseUnidad;
      // Tiempo: segundos Unix si bt + t llega a 2^28; menor, es relativo a «ahora» (RFC 8428 §4.5.3, tiempoSenml).
      let tiempo: Date | undefined;
      if (typeof r.t === 'number' || baseTiempo) {
        tiempo = tiempoSenml(baseTiempo + (typeof r.t === 'number' ? r.t : 0), ahora);
      }
      lecturas.push({ magnitud, valor, unidad: unidad === undefined ? undefined : limpia(unidad, MAX_UNIDAD), tiempo });
    }
    if (lecturas.length === 0) throw new TramaMalformada('pack sin valores');
    return lecturas;
  }
}

// Las reglas del perfil que miran el registro entero, aunque no traiga valor: versión (y que sea la misma en todo el pack), tipo de bt, t, bu, n y u,
// etiquetas de extensión obligatorias y un solo valor. Devuelve la versión vigente del pack (la del primer bver explícito).
// RFC 8428 §4.4: «All SenML Records in a Pack MUST have the same version number». Un registro sin bver vale la versión por defecto (10) mientras
// ningún bver la haya fijado: un bver distinto de 10 que llega después de registros sin bver los habría tenido en otra versión.
function revisarPerfil(r: object, indice: number, versionDelPack: number | undefined): number | undefined {
  const reg = r as Record<string, unknown>;
  let version = versionDelPack;
  if (reg.bver !== undefined) {
    const v = reg.bver;
    if (typeof v !== 'number' || !Number.isInteger(v) || v < 1) throw new TramaMalformada('bver no es un entero positivo');
    if (v > VERSION_ENTENDIDA) throw new TramaMalformada(`bver ${v} no se entiende (se entiende hasta ${VERSION_ENTENDIDA})`);
    const vigente = version ?? (indice === 0 ? v : VERSION_ENTENDIDA);
    if (v !== vigente) throw new TramaMalformada(`bver ${v} distinto del ${vigente} del resto del pack (todos los registros tienen la misma versión)`);
    version = v;
  }
  // Tipos (RFC 8428 §4.3, Tabla 1: bt y t son números; bu, n y u, cadenas): un campo de tipo equivocado no se ignora, se rechaza.
  for (const campo of ['bt', 't']) {
    const x = reg[campo];
    if (x !== undefined && (typeof x !== 'number' || !Number.isFinite(x))) throw new TramaMalformada(`${campo} no numérico`);
  }
  for (const campo of ['bu', 'n', 'u']) {
    const x = reg[campo];
    if (x !== undefined && typeof x !== 'string') throw new TramaMalformada(`${campo} no es texto`);
  }
  for (const etiqueta of Object.keys(reg)) {
    if (!ETIQUETAS_RFC.has(etiqueta) && etiqueta.endsWith('_')) {
      throw new TramaMalformada(`campo «${limpia(etiqueta, MAX_NOMBRE)}» desconocido y de los que no se pueden ignorar (termina en «_»)`);
    }
  }
  if (CAMPOS_DE_VALOR.filter((c) => Object.hasOwn(reg, c)).length > 1) throw new TramaMalformada('más de un campo de valor en un registro (v, vs, vb, vd)');
  return version;
}
