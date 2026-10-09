import {
  BeforeApplicationShutdown, Controller, ForbiddenException, Logger, MessageEvent, Query, Req, ServiceUnavailableException, Sse,
} from '@nestjs/common';
import { ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import { Observable, defer, finalize, interval, map, merge } from 'rxjs';
import { uuid } from '../consulta/validacion';
import { EventosService } from './eventos.service';

// Cuántos flujos abiertos a la vez admite el proceso: una cota de recursos compartida, no una defensa (un cliente de la
// red puede agotarla, docs/11 §3). En la Etapa 3 el canal corre solo en la red local y sin sesión, como la API (docs/10
// §5); el límite por usuario llega con la sesión (M7). Cada flujo es una conexión HTTP abierta.
export const MAX_FLUJOS = 50;
// Latido: un evento «latido» cada 25 s mantiene viva la conexión a través de proxies que cortan las inactivas (nginx, a
// los 60 s por defecto; el de este proyecto, a la hora) y le confirma al panel que el canal sigue arriba aunque no haya
// mediciones.
export const LATIDO_MS = 25_000;

@ApiTags('tiempo real')
@Controller()
export class EventosController implements BeforeApplicationShutdown {
  private readonly log = new Logger('tiempo-real');
  private abiertos = 0;
  private readonly conexiones = new Set<Socket>();

  constructor(private readonly eventos: EventosService) {}

  @Sse('eventos')
  @ApiOperation({
    summary: 'Canal de tiempo real (SSE)',
    description:
      'Server-Sent Events: medicion, visto y condicion, cada uno cuando ya está guardado, y un latido cada 25 s. ' +
      'Filtros opcionales por dispositivo o por canal. Rechaza una página de otro sitio (403) y, con ' + MAX_FLUJOS +
      ' flujos abiertos, responde 503.',
  })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo sus eventos' })
  @ApiQuery({ name: 'canal', required: false, description: 'UUID del canal: solo sus mediciones' })
  @ApiResponse({
    status: 200,
    description: 'Flujo de eventos: «event:» dice el tipo y «data:» trae el JSON',
    content: {
      'text/event-stream': {
        schema: { type: 'string' },
        example:
          'event: medicion\ndata: {"tipo":"medicion","dispositivo_id":"<uuid>","canal_id":"<uuid>","valor":21.5,' +
          '"unidad":"Cel","tiempo":"2026-10-09T15:00:00.000Z"}\n\n' +
          'event: visto\ndata: {"tipo":"visto","dispositivo_id":"<uuid>","tiempo":"2026-10-09T15:00:00.000Z"}\n\n' +
          'event: condicion\ndata: {"tipo":"condicion","dispositivo_id":"<uuid>","condicion":"umbral","estado":"abierta"}\n\n' +
          'event: latido\ndata: {"tiempo":"2026-10-09T15:00:25.000Z"}\n\n',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro que no es un UUID' })
  @ApiResponse({ status: 403, description: 'Página de otro sitio (Origin o Sec-Fetch-Site)' })
  @ApiResponse({ status: 503, description: 'Demasiados flujos abiertos' })
  flujo(
    @Req() req: Request,
    @Query('dispositivo') dispositivo?: string,
    @Query('canal') canal?: string,
  ): Observable<MessageEvent> {
    const rechazo = rechazoDeOrigen(req.headers);
    if (rechazo !== null) {
      this.log.warn(`flujo rechazado: ${rechazo}`);
      throw new ForbiddenException('origen no permitido');
    }
    const filtro = {
      dispositivo: dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo'),
      canal: canal === undefined ? undefined : uuid(canal, 'canal'),
    };
    if (this.abiertos >= MAX_FLUJOS) throw new ServiceUnavailableException('demasiados flujos abiertos');
    // Se cuenta al suscribirse y se descuenta al cerrarse (el navegador se fue o el proceso se apaga): un flujo que
    // nunca llegó a abrirse no ocupa cupo. Comprobar y contar no se separan: Nest se suscribe en una microtarea, sin E/S
    // de por medio, así que ninguna otra petición entra entre las dos.
    return defer(() => {
      this.abiertos++;
      this.conexiones.add(req.socket);
      return merge(
        this.eventos.flujo(filtro).pipe(map((e): MessageEvent => ({ type: e.tipo, data: e }))),
        interval(LATIDO_MS).pipe(map((): MessageEvent => ({ type: 'latido', data: { tiempo: new Date().toISOString() } }))),
      ).pipe(
        finalize(() => {
          this.abiertos--;
          this.conexiones.delete(req.socket);
        }),
      );
    });
  }

  // Apagado ordenado (docs/10 §6): un flujo SSE no termina solo y retendría el cierre del servidor HTTP hasta que Docker
  // mata el proceso. Se cortan SOLO sus conexiones (el navegador reintenta contra el proceso que arranque después); una
  // petición normal en curso termina y responde, porque server.close() la espera (docs/16 §14).
  beforeApplicationShutdown(): void {
    for (const conexion of this.conexiones) conexion.destroy();
  }

  // Abiertos ahora: lo usan las pruebas y, a futuro, /salud.
  get flujosAbiertos(): number {
    return this.abiertos;
  }
}

// Qué peticiones abren el canal (docs/11 §3). Devuelve por qué se rechaza una, o null si se admite. CORS ya impide que una
// página de otro sitio LEA el flujo (el backend no emite Access-Control-Allow-Origin); esto evita además que lo ABRA y
// ocupe cupo. Dos cabeceras que pone el navegador, no la página:
//  · Sec-Fetch-Site (W3C, Fetch Metadata): de qué sitio sale la petición. Se admite «same-origin» (el propio panel) y
//    «none» (alguien escribe la dirección). Cubre lo que Origin no: una imagen o un fetch «no-cors» desde otro sitio no
//    mandan Origin (Fetch Standard, «append a request `Origin` header»), pero sí esta cabecera. curl no la manda.
//  · Origin: si viene, debe ser el mismo host y puerto de la petición. Sin lista de orígenes: el panel lo sirve este
//    backend; en desarrollo, Vite le reenvía las peticiones sin cambiar el Host, y el proxy reenvía el Host con su puerto.
// No cubre el DNS rebinding: para el navegador, esa página es el mismo origen. Lo detiene una lista de nombres de host
// permitidos o la sesión (docs/11 §4).
export function rechazoDeOrigen(cabeceras: IncomingHttpHeaders): string | null {
  const sitio = cabeceras['sec-fetch-site'];
  if (sitio !== undefined && sitio !== 'same-origin' && sitio !== 'none') return `Sec-Fetch-Site ${String(sitio).slice(0, 20)}`;
  const origen = cabeceras.origin;
  if (origen !== undefined && !mismoOrigen(origen, cabeceras.host)) {
    return `origen ${origen.slice(0, 80)} ≠ host ${String(cabeceras.host).slice(0, 80)}`;
  }
  return null;
}

// «Origin: null» (iframe aislado, archivo local) o un valor ilegible no son el propio origen.
export function mismoOrigen(origen: string, host: string | undefined): boolean {
  if (host === undefined) return false;
  try {
    return new URL(origen).host === host.toLowerCase();
  } catch {
    return false;
  }
}
