import {
  BadRequestException, Controller, Get, Global, HttpException, INestApplication, MessageEvent, Module, ServiceUnavailableException, UnauthorizedException,
} from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import type { Pool } from 'pg';
import { IncomingMessage, Server, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { EventosController, LATIDO_MS, MAX_FLUJOS, MAX_FLUJOS_POR_USUARIO, mismoOrigen, rechazoDeOrigen } from './eventos.controller';
import { EventoPanel, EventosService } from './eventos.service';
import { TiempoRealModule } from './tiempo-real.module';
import { RECARGA_MINIMA_MS, SitiosDeDispositivos } from './sitios-de-dispositivos';
import type { SesionService } from '../sesion/sesion.service';
import { POOL } from '../db/db.module';
import { AlcanceService } from '../sesion/alcance.service';
import { UsuarioSesion, usuarioSistema } from '../sesion/permisos';

// TT-39 · Canal de tiempo real del panel (docs/10 §5). Primero las piezas sueltas; al final, el canal por HTTP real.
// El guardia central deja en la petición quién la hace (docs/20 §5); aquí, el usuario del sistema (alcance total).
const SIN_ORIGEN = { headers: {}, usuario: usuarioSistema() } as unknown as Request; // el propio panel, curl u otro servidor: sin Origin
// Una petición de otro usuario (para el tope global: cada uno cuenta aparte en el tope por usuario).
const de = (u: UsuarioSesion): Request => ({ headers: {}, usuario: u }) as unknown as Request;
const persona = (id: string, sitios: [string, 'administrador' | 'consulta'][]): UsuarioSesion =>
  ({ ...usuarioSistema(), id, sistema: false, todos: false, sitios: new Map(sitios), sesionId: 'a'.repeat(64) });
const M1: EventoPanel = { tipo: 'medicion', dispositivo_id: 'd1', canal_id: 'k1', valor: 21.5, unidad: 'Cel', tiempo: '2026-10-09T15:00:00.000Z', porcentaje: null };

describe('EventosService: qué recibe cada flujo', () => {
  it('sin filtro → todo; por dispositivo → solo los suyos; por canal → solo las mediciones de ese canal', () => {
    const s = new EventosService();
    const todo: EventoPanel[] = [];
    const deD1: EventoPanel[] = [];
    const deK1: EventoPanel[] = [];
    s.flujo().subscribe((e) => todo.push(e));
    s.flujo({ dispositivo: 'd1' }).subscribe((e) => deD1.push(e));
    s.flujo({ canal: 'k1' }).subscribe((e) => deK1.push(e));
    const otroCanal: EventoPanel = { ...M1, canal_id: 'k2' };
    const vistoOtro: EventoPanel = { tipo: 'visto', dispositivo_id: 'd2', tiempo: M1.tiempo };
    const condicion: EventoPanel = { tipo: 'condicion', dispositivo_id: 'd1', condicion: 'umbral', estado: 'abierta' };
    for (const e of [M1, otroCanal, vistoOtro, condicion]) s.publicar(e);
    expect(todo).toEqual([M1, otroCanal, vistoOtro, condicion]);
    expect(deD1).toEqual([M1, otroCanal, condicion]);
    expect(deK1).toEqual([M1]);
  });
});

describe('mismoOrigen: la página que abre el flujo es la que sirvió el panel', () => {
  it('mismo host y puerto → sí', () => expect(mismoOrigen('https://panel.example:8443', 'panel.example:8443')).toBe(true));
  it('puerto por defecto: el navegador no lo escribe ni en Origin ni en Host → sí', () =>
    expect(mismoOrigen('https://panel.example', 'panel.example')).toBe(true));
  it('mismo host sin el puerto (lo que reenvía nginx con $host) → no', () =>
    expect(mismoOrigen('https://panel.example:8443', 'panel.example')).toBe(false));
  it('otro sitio → no', () => expect(mismoOrigen('https://otro.example', 'panel.example')).toBe(false));
  it('«null» (iframe aislado o archivo local) o ilegible → no', () => {
    expect(mismoOrigen('null', 'panel.example')).toBe(false);
    expect(mismoOrigen('%%%', 'panel.example')).toBe(false);
  });
  it('sin Host → no', () => expect(mismoOrigen('https://panel.example', undefined)).toBe(false));
  it('Host en mayúsculas → se compara en minúsculas, como lo normaliza URL', () =>
    expect(mismoOrigen('https://panel.example', 'PANEL.example')).toBe(true));
  it('IPv6 con puerto → se compara igual', () => expect(mismoOrigen('http://[::1]:3000', '[::1]:3000')).toBe(true));
});

describe('rechazoDeOrigen: Sec-Fetch-Site cubre lo que Origin no', () => {
  const PROPIO = { host: 'panel.example' };
  it('una imagen o un fetch «no-cors» desde otro sitio: sin Origin, pero «cross-site» → se rechaza', () =>
    expect(rechazoDeOrigen({ ...PROPIO, 'sec-fetch-site': 'cross-site' })).toContain('cross-site'));
  it('otro origen del mismo sitio («same-site») → se rechaza: no es el panel', () =>
    expect(rechazoDeOrigen({ ...PROPIO, 'sec-fetch-site': 'same-site' })).not.toBeNull());
  it('el propio panel («same-origin») y la dirección escrita a mano («none») → se admiten', () => {
    expect(rechazoDeOrigen({ ...PROPIO, 'sec-fetch-site': 'same-origin' })).toBeNull();
    expect(rechazoDeOrigen({ ...PROPIO, 'sec-fetch-site': 'none' })).toBeNull();
  });
  it('sin ninguna de las dos (curl, otro servidor) → se admite; con Origin ajeno → se rechaza', () => {
    expect(rechazoDeOrigen(PROPIO)).toBeNull();
    expect(rechazoDeOrigen({ ...PROPIO, origin: 'https://otro.example' })).toContain('otro.example');
  });
});

describe('EventosController: cupo, filtros y latido', () => {
  afterEach(() => jest.useRealTimers());

  it(`con ${MAX_FLUJOS} flujos abiertos responde 503; al cerrarse uno, vuelve a admitir`, () => {
    const c = new EventosController(new EventosService());
    const abiertos = Array.from({ length: MAX_FLUJOS }, (_, i) => c.flujo(de({ ...usuarioSistema(), id: `u${i}` })).subscribe());
    expect(c.flujosAbiertos).toBe(MAX_FLUJOS);
    expect(() => c.flujo(de({ ...usuarioSistema(), id: 'otro' }))).toThrow(ServiceUnavailableException);
    abiertos[0].unsubscribe();
    abiertos[0] = c.flujo(de({ ...usuarioSistema(), id: 'otro' })).subscribe();
    expect(c.flujosAbiertos).toBe(MAX_FLUJOS);
    for (const s of abiertos) s.unsubscribe();
    expect(c.flujosAbiertos).toBe(0);
  });

  it('un flujo pedido que nunca se abrió (sin suscripción) no ocupa cupo', () => {
    const c = new EventosController(new EventosService());
    for (let i = 0; i < MAX_FLUJOS + 5; i++) c.flujo(SIN_ORIGEN);
    expect(c.flujosAbiertos).toBe(0);
  });

  it('filtro que no es un UUID → 400, antes de abrir nada', () => {
    const c = new EventosController(new EventosService());
    expect(() => c.flujo(SIN_ORIGEN, 'dev-0001')).toThrow(BadRequestException);
    expect(() => c.flujo(SIN_ORIGEN, undefined, '1; DROP TABLE medicion')).toThrow(BadRequestException);
    expect(c.flujosAbiertos).toBe(0);
  });

  it(`con ${MAX_FLUJOS_POR_USUARIO} flujos de un mismo usuario, el sexto responde 429; otro usuario sigue entrando; al cerrar uno, vuelve a admitir`, () => {
    const c = new EventosController(new EventosService());
    const ana = persona('ana', [['s1', 'consulta']]);
    const abiertos = Array.from({ length: MAX_FLUJOS_POR_USUARIO }, () => c.flujo(de(ana)).subscribe());
    let codigo = 0;
    try { c.flujo(de(ana)); } catch (e) { codigo = (e as HttpException).getStatus(); }
    expect(codigo).toBe(429);
    const otro = c.flujo(de(persona('beto', [['s1', 'consulta']]))).subscribe();
    abiertos[0].unsubscribe();
    abiertos[0] = c.flujo(de(ana)).subscribe();
    expect(c.flujosAbiertos).toBe(MAX_FLUJOS_POR_USUARIO + 1);
    for (const s of [...abiertos, otro]) s.unsubscribe();
    expect(c.flujosAbiertos).toBe(0);
  });

  it('sin usuario en la petición (no pasó por el guardia) → 401; nunca un flujo abierto sin identidad', () => {
    const c = new EventosController(new EventosService());
    expect(() => c.flujo({ headers: {} } as unknown as Request)).toThrow(UnauthorizedException);
    expect(c.flujosAbiertos).toBe(0);
  });

  it('cada persona recibe solo los eventos de los dispositivos de sus sitios; los del sistema, solo quien administra alguno (docs/20 §3)', async () => {
    const bus = new EventosService();
    const sitios = { sitioDe: (d: string) => ({ d1: 's1', d2: 's2' } as Record<string, string>)[d], refrescar: () => Promise.resolve() } as unknown as SitiosDeDispositivos;
    const c = new EventosController(bus, sitios);
    const suscripciones: { unsubscribe: () => void }[] = [];
    const recibido = (u: UsuarioSesion): string[] => {
      const r: string[] = [];
      suscripciones.push(c.flujo(de(u)).subscribe((m) => r.push(`${String(m.type)}:${(m.data as { dispositivo_id?: string }).dispositivo_id ?? '-'}`)));
      return r;
    };
    const consultaS1 = recibido(persona('ana', [['s1', 'consulta']]));
    const adminS2 = recibido(persona('beto', [['s2', 'administrador']]));
    const sistema = recibido(usuarioSistema());
    const d2: EventoPanel = { ...M1, dispositivo_id: 'd2' };
    const desconocido: EventoPanel = { ...M1, dispositivo_id: 'd9' }; // dado de alta recién: aún no está en el mapa
    const cola: EventoPanel = { tipo: 'sistema', condicion: 'broker_descarte', estado: 'abierta', motivos: ['descartes'], mensajes_en_cola: 1, descartes_delta: 1 };
    await new Promise((r) => setImmediate(r)); // el flujo de una persona empieza cuando terminó de refrescar el mapa de sitios
    for (const e of [M1, d2, desconocido, cola]) bus.publicar(e);
    expect(consultaS1).toEqual(['medicion:d1']);
    expect(adminS2).toEqual(['medicion:d2', 'sistema:-']);
    expect(sistema).toEqual(['medicion:d1', 'medicion:d2', 'medicion:d9', 'sistema:-']);
    for (const s of suscripciones) s.unsubscribe(); // cada flujo lleva su latido: sin cerrarlos, el proceso de prueba no termina
  });

  it('en cada latido revalida la sesión SIN renovarla: aplica los sitios nuevos y, si ya no vale, cierra el flujo y libera el cupo (revisión del 08/11/2026)', async () => {
    jest.useFakeTimers();
    const bus = new EventosService();
    const sitios = { sitioDe: (d: string) => ({ d1: 's1', d2: 's2' } as Record<string, string>)[d], refrescar: () => Promise.resolve() } as unknown as SitiosDeDispositivos;
    const ana = persona('ana', [['s1', 'consulta']]);
    const respuestas: (UsuarioSesion | null)[] = [persona('ana', [['s2', 'consulta']]), null];
    const cargarPorId = jest.fn(() => Promise.resolve(respuestas.shift() ?? null));
    const c = new EventosController(bus, sitios, { cargarPorId } as unknown as SesionService);
    const recibidos: string[] = [];
    let terminado = false;
    c.flujo(de(ana)).subscribe({ next: (m) => recibidos.push(`${String(m.type)}:${(m.data as { dispositivo_id?: string }).dispositivo_id ?? '-'}`), complete: () => { terminado = true; } });
    await jest.advanceTimersByTimeAsync(0);
    bus.publicar(M1);
    bus.publicar({ ...M1, dispositivo_id: 'd2' });
    await jest.advanceTimersByTimeAsync(LATIDO_MS); // 1.er latido: la sesión sigue viva, pero ahora su sitio es s2
    bus.publicar(M1);
    bus.publicar({ ...M1, dispositivo_id: 'd2' });
    expect(cargarPorId).toHaveBeenLastCalledWith('a'.repeat(64), { renovar: false });
    expect(recibidos).toEqual(['medicion:d1', 'latido:-', 'medicion:d2']);
    expect(terminado).toBe(false);
    await jest.advanceTimersByTimeAsync(LATIDO_MS); // 2.º latido: la sesión ya no vale (cerrada, vencida o revocada)
    expect(terminado).toBe(true);
    expect(recibidos).toEqual(['medicion:d1', 'latido:-', 'medicion:d2']); // sin latido final
    expect(c.flujosAbiertos).toBe(0);
    expect(cargarPorId).toHaveBeenCalledTimes(2);
  });

  it('una clave temporal o una base que no responde también cierran el flujo; el usuario del sistema no consulta nada', async () => {
    jest.useFakeTimers();
    const sitios = { sitioDe: () => 's1', refrescar: () => Promise.resolve() } as unknown as SitiosDeDispositivos;
    for (const respuesta of [() => Promise.resolve({ ...persona('ana', [['s1', 'consulta']]), claveTemporal: true }), () => Promise.reject(new Error('base caída'))]) {
      const c = new EventosController(new EventosService(), sitios, { cargarPorId: jest.fn(respuesta) } as unknown as SesionService);
      let terminado = false;
      c.flujo(de(persona('ana', [['s1', 'consulta']]))).subscribe({ complete: () => { terminado = true; } });
      await jest.advanceTimersByTimeAsync(LATIDO_MS);
      expect(terminado).toBe(true);
    }
    const cargarPorId = jest.fn();
    const c = new EventosController(new EventosService(), sitios, { cargarPorId } as unknown as SesionService);
    const s = c.flujo(SIN_ORIGEN).subscribe();
    await jest.advanceTimersByTimeAsync(LATIDO_MS * 2);
    expect(cargarPorId).not.toHaveBeenCalled();
    s.unsubscribe();
  });

  it('el mapa de sitios se refresca solo para un flujo que pasó el origen y los topes (revisión del 08/11/2026)', () => {
    const refrescar = jest.fn(() => Promise.resolve());
    const sitios = { sitioDe: () => 's1', refrescar } as unknown as SitiosDeDispositivos;
    const c = new EventosController(new EventosService(), sitios);
    const ana = persona('ana', [['s1', 'consulta']]);
    expect(() => c.flujo({ headers: { 'sec-fetch-site': 'cross-site' }, usuario: ana } as unknown as Request)).toThrow();
    const abiertos = Array.from({ length: MAX_FLUJOS_POR_USUARIO }, () => c.flujo(de(ana)).subscribe());
    expect(refrescar).toHaveBeenCalledTimes(MAX_FLUJOS_POR_USUARIO);
    expect(() => c.flujo(de(ana))).toThrow(HttpException); // el sexto: 429 sin consultar la base
    expect(refrescar).toHaveBeenCalledTimes(MAX_FLUJOS_POR_USUARIO);
    for (const s of abiertos) s.unsubscribe();
  });

  it('un «latido» cada 25 s aunque no haya mediciones', () => {
    jest.useFakeTimers();
    const c = new EventosController(new EventosService());
    const recibidos: MessageEvent[] = [];
    const s = c.flujo(SIN_ORIGEN).subscribe((m) => recibidos.push(m));
    jest.advanceTimersByTime(LATIDO_MS * 2);
    expect(recibidos.map((m) => m.type)).toEqual(['latido', 'latido']);
    s.unsubscribe();
  });
});

describe('SitiosDeDispositivos: el mapa se recarga como mucho cada 5 s, aunque se abran flujos en bucle (revisión del 08/11/2026)', () => {
  it('dentro de los 5 s, ninguna consulta más; pasados, una; dos pedidos a la vez comparten la misma', async () => {
    const query = jest.fn(() => Promise.resolve({ rows: [{ id: 'd1', sitio_id: 's1' }] }));
    const m = new SitiosDeDispositivos({ query } as unknown as Pool);
    let ahora = 1_000_000;
    m.ahora = () => ahora;
    await Promise.all([m.refrescar(), m.refrescar()]);
    expect(query).toHaveBeenCalledTimes(1);
    expect(m.sitioDe('d1')).toBe('s1');
    ahora += RECARGA_MINIMA_MS;
    await m.refrescar();
    m.sitioDe('d9'); // un dispositivo desconocido tampoco salta el umbral
    expect(query).toHaveBeenCalledTimes(1);
    ahora += 1;
    await m.refrescar();
    expect(query).toHaveBeenCalledTimes(2);
  });
});

// Una ruta normal y lenta, para probar el apagado en los dos sentidos: el canal no lo retiene y lo legítimo termina.
@Controller()
class LentoController {
  @Get('lento')
  async lento(): Promise<{ ok: boolean }> {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
}

// La base y el alcance, falsos: el canal los usa solo para el mapa de sitios y para los filtros (que aquí son del usuario del sistema).
@Global()
@Module({
  providers: [
    { provide: POOL, useValue: { query: () => Promise.resolve({ rows: [] }) } },
    { provide: AlcanceService, useValue: { exigirDispositivo: () => Promise.resolve(), exigirCanal: () => Promise.resolve() } },
  ],
  exports: [POOL, AlcanceService],
})
class BaseYAlcanceFalsos {}

// Por HTTP real, en 127.0.0.1 y un puerto libre: cabeceras, nombre y datos del evento, rechazos y apagado ordenado.
// Los WARN de los rechazos se dejan ver a propósito (decisión del 23/09): son la evidencia de que el filtro actúa.
describe('GET /eventos por HTTP (TT-39)', () => {
  let app: INestApplication | undefined;
  let puerto = 0;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({ imports: [BaseYAlcanceFalsos, TiempoRealModule], controllers: [LentoController] }).compile();
    app = modulo.createNestApplication({ logger: ['warn', 'error'] });
    // Lo que deja el guardia central (docs/20 §5): aquí, el usuario del sistema en toda petición.
    app.use((req: Request & { usuario?: UsuarioSesion }, _res: unknown, next: () => void) => { req.usuario = usuarioSistema(); next(); });
    await app.listen(0, '127.0.0.1');
    puerto = ((app.getHttpServer() as Server).address() as AddressInfo).port;
  });
  afterEach(async () => {
    await app?.close();
  });

  // Abre el flujo y entrega la respuesta apenas llegan las cabeceras, sin esperar el cuerpo (que no termina).
  function abrir(cabeceras: Record<string, string> = {}, ruta = '/eventos'): Promise<IncomingMessage> {
    return new Promise((resolve, reject) => {
      const peticion = request({ host: '127.0.0.1', port: puerto, path: ruta, headers: cabeceras }, resolve);
      peticion.on('error', reject);
      peticion.end();
    });
  }
  function leerHasta(res: IncomingMessage, marca: string): Promise<string> {
    return new Promise((resolve) => {
      let texto = '';
      res.on('data', (trozo: Buffer) => {
        texto += trozo.toString();
        if (texto.includes(marca)) resolve(texto);
      });
    });
  }

  it('Origin igual al propio → 200 text/event-stream sin búfer en el proxy, y el evento llega con su nombre y sus datos', async () => {
    const res = await abrir({ origin: `http://127.0.0.1:${puerto}` });
    expect(res.statusCode).toBe(200);
    expect(res.headers['content-type']).toMatch(/^text\/event-stream/);
    expect(res.headers['x-accel-buffering']).toBe('no'); // nginx no retiene los eventos
    const llegada = leerHasta(res, '\n\n');
    app!.get(EventosService).publicar(M1);
    const texto = await llegada;
    expect(texto).toContain('event: medicion\n');
    expect(texto).toContain(`data: ${JSON.stringify(M1)}\n`);
    res.destroy();
  });

  it('desde otra página → 403 y no ocupa cupo: con Origin ajeno, con «Origin: null» y sin Origin pero «cross-site»', async () => {
    const casos: Record<string, string>[] = [{ origin: 'https://otro.example' }, { origin: 'null' }, { 'sec-fetch-site': 'cross-site' }];
    for (const cabeceras of casos) {
      const res = await abrir(cabeceras);
      expect(res.statusCode).toBe(403);
      res.resume();
    }
    expect(app!.get(EventosController).flujosAbiertos).toBe(0);
  });

  it('sin Origin (el propio panel: el navegador no lo manda a su mismo origen; también curl) → 200; filtro inválido → 400', async () => {
    const ok = await abrir();
    expect(ok.statusCode).toBe(200);
    ok.destroy();
    const malo = await abrir({}, '/eventos?dispositivo=dev-0001');
    expect(malo.statusCode).toBe(400);
    malo.resume();
  });

  it('apagado con un flujo abierto: app.close() no espera a que el navegador se vaya, y el flujo se cierra', async () => {
    const res = await abrir();
    const cerrado = new Promise<void>((resolve) => res.on('close', resolve));
    res.resume();
    const inicio = Date.now();
    await app!.close();
    app = undefined;
    await cerrado; // EventSource reintentará solo, contra el proceso que arranque después
    expect(Date.now() - inicio).toBeLessThan(1000);
  });

  // El otro sentido: cortar todo al apagar (forceCloseConnections) también cortaba esto. «Connection: close» aísla lo que se
  // prueba: con keep-alive, Node además espera a que venza la conexión ociosa (≈ 4 s medidos, docs/16 §14).
  it('apagado con una petición normal en curso: termina y responde antes de que el servidor cierre', async () => {
    const respuesta = new Promise<{ codigo?: number; cuerpo: string }>((resolve, reject) => {
      const peticion = request({ host: '127.0.0.1', port: puerto, path: '/lento', headers: { connection: 'close' } }, (res) => {
        let cuerpo = '';
        res.on('data', (trozo: Buffer) => (cuerpo += trozo.toString()));
        res.on('end', () => resolve({ codigo: res.statusCode, cuerpo }));
      });
      peticion.on('error', reject);
      peticion.end();
    });
    await new Promise((r) => setTimeout(r, 50)); // la petición ya está dentro, esperando sus 300 ms
    await app!.close();
    app = undefined;
    expect(await respuesta).toEqual({ codigo: 200, cuerpo: '{"ok":true}' });
  });
});
