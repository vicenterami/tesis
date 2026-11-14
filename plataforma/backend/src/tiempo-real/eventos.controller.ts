import {
  BeforeApplicationShutdown, Controller, ForbiddenException, HttpException, HttpStatus, Logger, MessageEvent, Optional, Query, Req,
  ServiceUnavailableException, Sse, UnauthorizedException, UseGuards,
} from '@nestjs/common';
import { ApiCookieAuth, ApiOperation, ApiQuery, ApiResponse, ApiTags } from '@nestjs/swagger';
import type { Request } from 'express';
import type { IncomingHttpHeaders } from 'node:http';
import type { Socket } from 'node:net';
import { EMPTY, Observable, Subject, concat, concatMap, defer, filter, finalize, from, ignoreElements, interval, map, merge, of, takeUntil } from 'rxjs';
import { AvisosAcotados } from '../arranque.js';
import { uuid } from '../consulta/validacion.js';
import { EventoConSitio, EventoPanel, EventosService } from './eventos.service.js';
import type { PeticionConUsuario } from '../sesion/guardia.js';
import { UsuarioSesion, puedeEnAlguno } from '../sesion/permisos.js';
import { MENSAJE_SIN_SESION, SesionService } from '../sesion/sesion.service.js';
import { AlcanceDelFlujo, SitiosDeDispositivos } from './sitios-de-dispositivos.js';

// Cuántos flujos abiertos a la vez admite el proceso: una cota de recursos compartida, no una defensa (un cliente de la
// red puede agotarla, docs/11 §3). Cada flujo es una conexión HTTP abierta. Desde el 08/11/2026 (M7, docs/20 §3) el canal exige la
// sesión (o la clave de administrador) y además hay un tope POR USUARIO: 5 (decidido el 12/10/2026: cinco pestañas de una persona).
// El usuario del sistema (X-Clave-Admin) cuenta como uno solo.
export const MAX_FLUJOS = 50;
export const MAX_FLUJOS_POR_USUARIO = 5;
// Latido: un evento «latido» cada 25 s mantiene viva la conexión a través de proxies que cortan las inactivas (nginx, a
// los 60 s por defecto; el de este proyecto, a la hora) y le confirma al panel que el canal sigue arriba aunque no haya
// mediciones. En cada latido, además, se revalida la sesión del flujo (revisión del 08/11/2026): cerrada, vencida, revocada, de un
// usuario desactivado o con clave temporal → el flujo se cierra; si cambiaron sus sitios, rige el alcance nuevo. Así un flujo abierto
// no sobrevive más de un latido a la sesión que lo abrió (antes seguía hasta que el navegador se iba).
export const LATIDO_MS = 25_000;

@ApiTags('tiempo real')
@Controller()
export class EventosController implements BeforeApplicationShutdown {
  private readonly log = new Logger('tiempo-real');
  private abiertos = 0;
  private readonly porUsuario = new Map<string, number>();
  private readonly conexiones = new Set<Socket>();
  private readonly avisos = new AvisosAcotados(); // un WARN por motivo y por minuto (docs/11 §3)

  // Cada cuánto late el flujo. Las pruebas lo acortan asignándolo; nunca sale de una variable de entorno (ni de NODE_ENV).
  latidoMs = LATIDO_MS;

  // `sitios` y `sesiones` son opcionales para las pruebas que arman el controlador suelto con el usuario del sistema (sin filtro por
  // sitio ni sesión que revalidar). En la aplicación, los dos existen siempre (TiempoRealModule y el módulo global de sesión).
  constructor(
    private readonly eventos: EventosService,
    @Optional() private readonly sitios?: SitiosDeDispositivos,
    @Optional() private readonly sesiones?: SesionService,
  ) {}

  @Sse('eventos')
  @UseGuards(AlcanceDelFlujo)
  @ApiCookieAuth('sesion')
  @ApiOperation({
    summary: 'Canal de tiempo real (SSE)',
    description:
      'Server-Sent Events: medicion, visto y condicion, cada uno cuando ya está guardado y con el `sitio_id` de su dispositivo (null solo para quien alcanza ' +
      'a todos los sitios, si el dispositivo es tan nuevo que el servidor aún no lo conoce), y un latido cada 25 s. ' +
      'Filtros opcionales por dispositivo o por canal. Exige sesión (o X-Clave-Admin): solo llegan los eventos de los dispositivos de ' +
      'los sitios del usuario, y los del sistema (cola del broker) solo a quien administra algún sitio. La sesión se revalida en cada ' +
      'latido: si se cerró, venció o fue revocada, el flujo termina; si cambiaron los sitios, rige el alcance nuevo. Rechaza una página de otro sitio ' +
      '(403); con ' + MAX_FLUJOS_POR_USUARIO + ' flujos abiertos del mismo usuario responde 429 y con ' + MAX_FLUJOS + ' en total, 503.',
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
          '"unidad":"Cel","tiempo":"2026-10-09T15:00:00.000Z","porcentaje":null,"sitio_id":"<uuid>"}\n\n' +
          'event: visto\ndata: {"tipo":"visto","dispositivo_id":"<uuid>","tiempo":"2026-10-09T15:00:00.000Z","sitio_id":"<uuid>"}\n\n' +
          'event: condicion\ndata: {"tipo":"condicion","dispositivo_id":"<uuid>","condicion":"umbral","estado":"abierta","sitio_id":"<uuid>"}\n\n' +
          'event: sistema\ndata: {"tipo":"sistema","condicion":"broker_descarte","estado":"abierta","motivos":["descartes"],"mensajes_en_cola":120,"descartes_delta":57}\n\n' +
          'event: latido\ndata: {"tiempo":"2026-10-09T15:00:25.000Z"}\n\n',
      },
    },
  })
  @ApiResponse({ status: 400, description: 'Filtro que no es un UUID' })
  @ApiResponse({ status: 401, description: 'sesión requerida' })
  @ApiResponse({ status: 403, description: 'Página de otro sitio (Origin o Sec-Fetch-Site)' })
  @ApiResponse({ status: 404, description: 'El dispositivo o el canal del filtro no existe o es de otro sitio' })
  @ApiResponse({ status: 429, description: `Ya hay ${MAX_FLUJOS_POR_USUARIO} flujos abiertos de este usuario` })
  @ApiResponse({ status: 503, description: 'Demasiados flujos abiertos en total' })
  flujo(
    @Req() req: Request,
    @Query('dispositivo') dispositivo?: string,
    @Query('canal') canal?: string,
  ): Observable<MessageEvent> {
    const rechazo = rechazoDeOrigen(req.headers);
    if (rechazo !== null) {
      const aviso = this.avisos.registrar(rechazo);
      if (aviso !== null) this.log.warn(`flujo rechazado: ${aviso}`);
      throw new ForbiddenException('origen no permitido');
    }
    const inicial = (req as PeticionConUsuario).usuario;
    if (inicial === undefined) throw new UnauthorizedException(MENSAJE_SIN_SESION);
    let usuario: UsuarioSesion = inicial; // cambia en cada latido si cambiaron sus sitios
    const filtro = {
      dispositivo: dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo'),
      canal: canal === undefined ? undefined : uuid(canal, 'canal'),
    };
    const clave = usuario.id ?? 'sistema';
    if (this.abiertos >= MAX_FLUJOS) throw new ServiceUnavailableException('demasiados flujos abiertos');
    if ((this.porUsuario.get(clave) ?? 0) >= MAX_FLUJOS_POR_USUARIO) {
      throw new HttpException(`ya tienes ${MAX_FLUJOS_POR_USUARIO} flujos abiertos; cierra una pestaña`, HttpStatus.TOO_MANY_REQUESTS);
    }
    // Se cuenta al suscribirse y se descuenta al cerrarse (el navegador se fue, la sesión dejó de valer o el proceso se apaga): un
    // flujo que nunca llegó a abrirse no ocupa cupo. Comprobar y contar no se separan: Nest se suscribe en una microtarea, sin E/S
    // de por medio, así que ninguna otra petición entra entre las dos. El mapa de sitios se refresca recién aquí, pasados el origen y
    // los topes (como mucho cada 5 s, sitios-de-dispositivos.ts), y los eventos empiezan cuando terminó.
    return defer(() => {
      this.abiertos++;
      this.porUsuario.set(clave, (this.porUsuario.get(clave) ?? 0) + 1);
      this.conexiones.add(req.socket);
      const fin = new Subject<void>();
      // Desde el 13/11/2026 también para quien alcanza a todos: el mapa pone el `sitio_id` de cada aviso (no cambia quién recibe qué).
      const refresco = this.sitios === undefined ? EMPTY : from(this.sitios.refrescar()).pipe(ignoreElements());
      return concat(
        refresco,
        merge(
          this.eventos.flujo(filtro).pipe(
            filter((e) => this.visible(usuario, e)),
            map((e): MessageEvent => ({ type: e.tipo, data: this.conSitio(e) })),
          ),
          interval(this.latidoMs).pipe(
            concatMap(() => this.revalidar(usuario)),
            filter((u): u is UsuarioSesion => {
              if (u === null) fin.next();
              return u !== null;
            }),
            map((u): MessageEvent => {
              usuario = u;
              return { type: 'latido', data: { tiempo: new Date().toISOString() } };
            }),
          ),
        ),
      ).pipe(
        takeUntil(fin),
        finalize(() => {
          this.abiertos--;
          const n = (this.porUsuario.get(clave) ?? 1) - 1;
          if (n <= 0) this.porUsuario.delete(clave);
          else this.porUsuario.set(clave, n);
          this.conexiones.delete(req.socket);
        }),
      );
    });
  }

  // La sesión del flujo, releída sin renovar la actividad (sesion.service.ts, cargarPorId), o null si ya no vale (cerrada, vencida,
  // revocada, usuario inactivo, clave temporal) o si la base no responde: ante la duda, se cierra (el navegador reintenta y el guardia
  // decide). El usuario del sistema no tiene sesión: sigue igual, sin consulta.
  private revalidar(u: UsuarioSesion): Observable<UsuarioSesion | null> {
    if (u.sistema || u.sesionId === null || this.sesiones === undefined) return of(u);
    return from(
      this.sesiones.cargarPorId(u.sesionId, { renovar: false }).then(
        (n) => (n === null || n.claveTemporal ? null : n),
        (e: unknown) => {
          const aviso = this.avisos.registrar(`no se pudo revalidar la sesión de un flujo: ${(e as Error).message}`);
          if (aviso !== null) this.log.warn(`flujo cerrado: ${aviso}`);
          return null;
        },
      ),
    );
  }

  // ¿Ve este evento? Con alcance total (usuario del sistema), todo. Una persona: los de dispositivos de sus sitios; los del sistema (la
  // cola del broker afecta a toda la plataforma y no trae datos de ningún sitio), solo si administra alguno (docs/20 §3).
  private visible(u: UsuarioSesion, e: EventoPanel): boolean {
    if (u.todos) return true;
    if (e.tipo === 'sistema') return puedeEnAlguno(u, 'escribir');
    const sitio = this.sitios?.sitioDe(e.dispositivo_id);
    return sitio !== undefined && u.sitios.has(sitio);
  }

  // Los avisos de un dispositivo (`medicion`, `visto`, `condicion`) suman `sitio_id` (docs/19 §4, L3c y L6): así el panel sabe cuáles son
  // del sitio que muestra sin deducirlo de sus listas. Sale del mismo mapa que filtra el canal; null solo si el servidor aún no conoce el
  // dispositivo (recién dado de alta, hasta la próxima recarga del mapa), y eso solo lo recibe quien alcanza a todos los sitios: a una
  // persona con sitios, un aviso de un dispositivo desconocido no se le muestra (visible()). `sistema` no es de ningún sitio: sin cambios.
  private conSitio(e: EventoPanel): EventoPanel | EventoConSitio {
    if (e.tipo === 'sistema') return e;
    return { ...e, sitio_id: this.sitios?.sitioDe(e.dispositivo_id) ?? null };
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
// No cubre el DNS rebinding: para el navegador, esa página es el mismo origen. Lo detiene la lista de nombres de host de
// arranque.ts (421 antes de llegar aquí, docs/11 §3) y, en la Etapa 4, la sesión (docs/11 §4).
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
