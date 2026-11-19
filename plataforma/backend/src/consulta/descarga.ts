import type { ServerResponse } from 'node:http';

// Escritura de una descarga en flujo con contrapresión (las dos exportaciones, docs/19 §4, bloque R, punto 3): si el socket está lleno se
// espera `drain` antes de pedir la tanda siguiente, así un cliente lento no hace que Node acumule el archivo en memoria. Si el cliente
// cierra la conexión, la escritura falla con DescargaCortada y quien recorre la consulta deja de pedir tandas: una sola regla para las dos
// rutas, en vez de mirar `res.destroyed` en cada bucle. Se espera `drain` o `close`, lo que llegue primero: con Node 22 el `drain` llega
// igual tras el corte (medido el 19/11/2026), pero así el corte no depende de ese detalle.
// Los primeros RETENIDO bytes se guardan antes de enviar nada (revisión del 19/11/2026): el zip y el libro escriben sus cabeceras antes de
// la primera consulta, y sin esto una base caída se veía como una descarga cortada en vez de un error. Mientras no salió nada, una falla
// responde 503 en JSON (responderFalla); después solo queda cortar la conexión.
export const RETENIDO = 64 * 1024;
export const MENSAJE_FALLA = 'la exportación falló antes de empezar a enviar el archivo; inténtalo en un momento';

export class DescargaCortada extends Error {
  constructor() {
    super('el cliente cerró la conexión');
  }
}

export interface Descarga {
  escribir(trozo: Buffer | string): Promise<void>;
  terminar(): Promise<void>; // envía lo retenido (un archivo chico puede no pasar de RETENIDO) y cierra la respuesta
}

export function escritorDeDescarga(res: ServerResponse, retener = RETENIDO): Descarga {
  let retenido: Buffer[] | null = [];
  let largo = 0;
  const enviar = async (trozo: Buffer | string): Promise<void> => {
    if (res.destroyed || res.writableEnded) throw new DescargaCortada();
    if (res.write(trozo)) return;
    await new Promise<void>((resolver, rechazar) => {
      const listo = (): void => { soltar(); resolver(); };
      const cerrada = (): void => { soltar(); rechazar(new DescargaCortada()); };
      const soltar = (): void => { res.off('drain', listo); res.off('close', cerrada); };
      res.on('drain', listo);
      res.on('close', cerrada);
    });
  };
  const soltarRetenido = async (): Promise<void> => {
    if (retenido === null) return;
    const todo = Buffer.concat(retenido, largo);
    retenido = null;
    if (todo.length > 0) await enviar(todo);
  };
  return {
    async escribir(trozo) {
      if (res.destroyed || res.writableEnded) throw new DescargaCortada();
      if (retenido === null) return enviar(trozo);
      const b = typeof trozo === 'string' ? Buffer.from(trozo, 'utf8') : trozo;
      retenido.push(b);
      largo += b.length;
      if (largo >= retener) await soltarRetenido();
    },
    async terminar() {
      await soltarRetenido();
      res.end();
    },
  };
}

// Una falla durante la descarga: si todavía no salieron las cabeceras, 503 en JSON con el formato de error del proyecto (sin las cabeceras
// del archivo, que quedarían mintiendo); si ya salieron, se corta la conexión para que el cliente vea un archivo incompleto en vez de uno
// que parece entero. Devuelve lo que hizo, para el registro.
export function responderFalla(res: ServerResponse, e: unknown): 'respondida' | 'cortada' {
  if (!res.headersSent && !res.destroyed && !res.writableEnded && !(e instanceof DescargaCortada)) {
    res.removeHeader('Content-Disposition');
    res.removeHeader('Content-Type');
    res.statusCode = 503;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.end(JSON.stringify({ statusCode: 503, error: 'Service Unavailable', message: MENSAJE_FALLA }));
    return 'respondida';
  }
  res.destroy(e instanceof Error ? e : new Error(String(e)));
  return 'cortada';
}
