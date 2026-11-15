import { Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura.js';
import { limpia } from '../texto.js';
import { Adaptador, TramaMalformada } from './adaptador.js';

// El nombre y la unidad de un registro son texto del emisor y terminan en el detalle de una cuarentena y en el registro: van recortados
// (40 es el largo máximo de un código de magnitud del catálogo) y sin caracteres de control (texto.ts).
const MAX_NOMBRE = 40;
const MAX_UNIDAD = 32;

// Registro SenML (RFC 8428) en su forma JSON: los campos que usa esta plataforma.
//   bn = base name (identificador del emisor)   bt = base time (segundos Unix)
//   n  = name (qué magnitud)                    u  = unit (símbolo de unidad SenML)
//   v  = value (número)                         t  = time (relativo a bt, o absoluto si no hay bt)
interface RegistroSenML {
  bn?: string; bt?: number; bu?: string;
  n?: string; u?: string; v?: number; t?: number;
}

// Contrato NATIVO de la plataforma. Un "pack" SenML es un arreglo JSON de registros; los campos
// base (bn, bt, bu) se heredan a los registros siguientes. Ejemplo de un nodo con dos sensores:
//   [{"bn":"dev-0001","bt":1757300000,"n":"temperatura","u":"Cel","v":21.5},
//    {"n":"humedad","u":"%RH","v":55}]
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

    for (const r of pack as RegistroSenML[]) {
      if (typeof r !== 'object' || r === null) throw new TramaMalformada('registro no es objeto');
      if (typeof r.bt === 'number') baseTiempo = r.bt;
      if (typeof r.bu === 'string') baseUnidad = r.bu;
      if (r.v === undefined) continue; // registro solo de base, sin valor
      if (typeof r.v !== 'number' || !Number.isFinite(r.v)) throw new TramaMalformada('v no numérico');

      // La magnitud viene del nombre del registro; si no lo trae, del tópico. `n` y `u` deben ser cadenas (RFC 8428 §4.3): un `n` numérico
      // lanzaba TypeError, que no es TramaMalformada, así que la trama no iba a cuarentena y el broker la reenviaba (docs/16, matriz del
      // contrato, C-16).
      const n: unknown = r.n;
      const u: unknown = r.u;
      if (n !== undefined && typeof n !== 'string') throw new TramaMalformada('n no es texto');
      if (u !== undefined && typeof u !== 'string') throw new TramaMalformada('u no es texto');
      const magnitud = limpia((n ?? ctx.magnitudTopico).toLowerCase(), MAX_NOMBRE);
      const unidad = u ?? baseUnidad;
      // Tiempo: SenML usa segundos Unix. Si hay bt, t es un desplazamiento relativo.
      let tiempo: Date | undefined;
      if (typeof r.t === 'number' || baseTiempo) {
        const seg = baseTiempo + (typeof r.t === 'number' ? r.t : 0);
        tiempo = seg > 0 ? new Date(seg * 1000) : undefined;
      }
      lecturas.push({ magnitud, valor: r.v, unidad: unidad === undefined ? undefined : limpia(unidad, MAX_UNIDAD), tiempo });
    }
    if (lecturas.length === 0) throw new TramaMalformada('pack sin valores');
    return lecturas;
  }
}
