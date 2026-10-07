import { Injectable } from '@nestjs/common';
import { ContextoTrama, Lectura } from '../lectura';
import { Adaptador, TramaMalformada } from './adaptador';

// Formato "plano": el más simple que puede emitir un nodo con poca memoria, y también la forma
// esperada del JSON del compañero (identificador, marca temporal, valor). Acepta dos variantes:
//   1) un número a secas en el cuerpo:        21.5        → la magnitud sale del tópico
//   2) un objeto JSON con nombres tolerantes: {"valor":21.5,"unidad":"Cel","tiempo":1757300000}
//      (también reconoce v/value, u/unit, t/ts/time; los nombres exactos del compañero se fijarán
//       cuando entregue su primera trama real — ver bitácora del acuerdo de frontera).
@Injectable()
export class PlanoAdaptador implements Adaptador {
  readonly nombre = 'plano';
  readonly origenTiempo = 'dispositivo';

  reconoce(ctx: ContextoTrama): boolean {
    const texto = ctx.carga.toString('utf8').trim();
    return texto.startsWith('{') || /^-?\d+(\.\d+)?$/.test(texto);
  }

  analizar(ctx: ContextoTrama): Lectura[] {
    const texto = ctx.carga.toString('utf8').trim();

    if (/^-?\d+(\.\d+)?$/.test(texto)) {
      return [{ magnitud: ctx.magnitudTopico, valor: Number(texto) }];
    }

    let obj: Record<string, unknown>;
    try {
      obj = JSON.parse(texto) as Record<string, unknown>;
    } catch {
      throw new TramaMalformada('JSON inválido');
    }
    const valor = primero(obj, ['valor', 'v', 'value']);
    if (typeof valor !== 'number' || !Number.isFinite(valor)) throw new TramaMalformada('sin valor numérico');
    const unidad = primero(obj, ['unidad', 'u', 'unit']);
    const t = primero(obj, ['tiempo', 't', 'ts', 'time']);
    const tiempo = typeof t === 'number' ? new Date(t > 1e12 ? t : t * 1000) : undefined; // ms o s

    return [{ magnitud: ctx.magnitudTopico, valor, unidad: typeof unidad === 'string' ? unidad : undefined, tiempo }];
  }
}

function primero(obj: Record<string, unknown>, claves: string[]): unknown {
  for (const k of claves) if (obj[k] !== undefined) return obj[k];
  return undefined;
}
