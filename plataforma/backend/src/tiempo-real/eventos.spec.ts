import { BadRequestException, Controller, Get, INestApplication, MessageEvent, ServiceUnavailableException } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import type { Request } from 'express';
import { IncomingMessage, Server, request } from 'node:http';
import { AddressInfo } from 'node:net';
import { EventosController, LATIDO_MS, MAX_FLUJOS, mismoOrigen, rechazoDeOrigen } from './eventos.controller';
import { EventoPanel, EventosService } from './eventos.service';
import { TiempoRealModule } from './tiempo-real.module';

// TT-39 · Canal de tiempo real del panel (docs/10 §5). Primero las piezas sueltas; al final, el canal por HTTP real.
const SIN_ORIGEN = { headers: {} } as unknown as Request; // el propio panel, curl u otro servidor: sin Origin
const M1: EventoPanel = { tipo: 'medicion', dispositivo_id: 'd1', canal_id: 'k1', valor: 21.5, unidad: 'Cel', tiempo: '2026-10-09T15:00:00.000Z' };

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
    const abiertos = Array.from({ length: MAX_FLUJOS }, () => c.flujo(SIN_ORIGEN).subscribe());
    expect(c.flujosAbiertos).toBe(MAX_FLUJOS);
    expect(() => c.flujo(SIN_ORIGEN)).toThrow(ServiceUnavailableException);
    abiertos[0].unsubscribe();
    abiertos[0] = c.flujo(SIN_ORIGEN).subscribe();
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

// Una ruta normal y lenta, para probar el apagado en los dos sentidos: el canal no lo retiene y lo legítimo termina.
@Controller()
class LentoController {
  @Get('lento')
  async lento(): Promise<{ ok: boolean }> {
    await new Promise((r) => setTimeout(r, 300));
    return { ok: true };
  }
}

// Por HTTP real, en 127.0.0.1 y un puerto libre: cabeceras, nombre y datos del evento, rechazos y apagado ordenado.
// Los WARN de los rechazos se dejan ver a propósito (decisión del 23/09): son la evidencia de que el filtro actúa.
describe('GET /eventos por HTTP (TT-39)', () => {
  let app: INestApplication | undefined;
  let puerto = 0;

  beforeEach(async () => {
    const modulo = await Test.createTestingModule({ imports: [TiempoRealModule], controllers: [LentoController] }).compile();
    app = modulo.createNestApplication({ logger: ['warn', 'error'] });
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
