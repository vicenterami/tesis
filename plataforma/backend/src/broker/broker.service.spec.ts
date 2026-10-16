import { ConfigService } from '@nestjs/config';
import mqtt from 'mqtt';
import type { IPublishPacket } from 'mqtt';
import { BrokerService, REINTENTOS_MS } from './broker.service';

// Decisión 4 (docs/10 §8.4): el pipeline corre dentro de handleMessage de mqtt.js, un mensaje a la vez, y el PUBACK
// (el callback) sale solo cuando el manejador terminó. Se prueba con un cliente mockCliente: nada de red.
const clienteFalso = () => ({
  on: jest.fn(),
  subscribe: jest.fn(),
  end: jest.fn(),
  reconnect: jest.fn(),
  handleMessage: undefined as unknown,
});
let mockCliente = clienteFalso();
jest.mock('mqtt', () => ({ __esModule: true, default: { connect: jest.fn(() => mockCliente) } }));

const publish = (topico: string, carga: string): IPublishPacket =>
  ({ cmd: 'publish', qos: 1, dup: false, retain: false, messageId: 1, topic: topico, payload: Buffer.from(carga) });

function armar() {
  mockCliente = clienteFalso();
  const servicio = new BrokerService({ get: (_k: string, d?: unknown) => d, getOrThrow: () => 'clave-de-prueba' } as unknown as ConfigService);
  servicio.onModuleInit();
  const handle = mockCliente.handleMessage as (p: IPublishPacket, cb: (e?: Error) => void) => void;
  return { servicio, handle };
}

describe('BrokerService: un mensaje a la vez y PUBACK después de guardar (decisión 4)', () => {
  it('instala handleMessage y NO procesa por el evento message (que no espera a nadie)', () => {
    const { handle } = armar();
    expect(typeof handle).toBe('function');
    expect(mockCliente.on.mock.calls.map(([ev]) => ev)).not.toContain('message');
  });

  it('un mensaje retenido reentregado al suscribirse (retain = 1) se confirma sin procesar: ya se procesó al llegar', async () => {
    const { servicio, handle } = armar();
    const vistos: string[] = [];
    servicio.alRecibir(async (_t, c) => { vistos.push(c.toString()); await Promise.resolve(); });
    const cb = jest.fn();
    handle({ ...publish('sitio/x/pasarela/p/d/up', 'R'), retain: true }, cb);
    await new Promise((r) => setTimeout(r, 0));
    expect(cb).toHaveBeenCalledWith();
    expect(vistos).toEqual([]);
  });

  it('el descarte vale porque la conexión es MQTT 3.1.1 y la suscripción no pide «Retain As Published» (docs/10 §8.4 punto 50)', () => {
    armar();
    const opciones = (mqtt.connect as jest.Mock).mock.calls.at(-1)?.[1] as { protocolVersion?: number };
    expect(opciones.protocolVersion).toBe(4); // explícito: con 5 y rap, el envío en vivo llegaría con retain = 1 y se perdería
    const conectar = mockCliente.on.mock.calls.find(([ev]) => ev === 'connect')?.[1] as () => void;
    conectar();
    expect(mockCliente.subscribe).toHaveBeenCalledWith('sitio/#', { qos: 1 }, expect.any(Function));
  });

  it('el callback (PUBACK) se llama solo cuando el manejador terminó; los mensajes van en orden', async () => {
    const { servicio, handle } = armar();
    const orden: string[] = [];
    let soltar!: () => void;
    const primero = new Promise<void>((r) => (soltar = r));
    servicio.alRecibir(async (t, c) => {
      orden.push(`inicio ${c.toString()}`);
      if (c.toString() === 'A') await primero;
      orden.push(`fin ${c.toString()}`);
    });
    const cbA = jest.fn();
    handle(publish('sitio/x/dispositivo/d/temperatura', 'A'), cbA);
    await Promise.resolve();
    expect(cbA).not.toHaveBeenCalled(); // A sigue en el manejador: sin PUBACK todavía
    soltar();
    await new Promise((r) => setTimeout(r, 0));
    expect(cbA).toHaveBeenCalledWith();
    expect(orden).toEqual(['inicio A', 'fin A']);
  });

  it('paquetes que no son publish se confirman de inmediato sin tocar el pipeline', () => {
    const { servicio, handle } = armar();
    const manejador = jest.fn();
    servicio.alRecibir(manejador);
    const cb = jest.fn();
    handle({ cmd: 'pingresp' } as unknown as IPublishPacket, cb);
    expect(cb).toHaveBeenCalledWith();
    expect(manejador).not.toHaveBeenCalled();
  });

  it('si el manejador falla, reintenta el MISMO mensaje con las esperas fijadas y confirma al lograrlo', async () => {
    jest.useFakeTimers();
    try {
      const { servicio, handle } = armar();
      let intentos = 0;
      servicio.alRecibir(() => {
        intentos++;
        if (intentos < 3) throw new Error('getaddrinfo EAI_AGAIN timescaledb');
      });
      const cb = jest.fn();
      handle(publish('sitio/x/dispositivo/d/temperatura', '21'), cb);
      await jest.advanceTimersByTimeAsync(REINTENTOS_MS[0] + REINTENTOS_MS[1]);
      expect(intentos).toBe(3);
      expect(cb).toHaveBeenCalledWith();
      expect(mockCliente.reconnect).not.toHaveBeenCalled();
    } finally {
      jest.useRealTimers();
    }
  });

  it('agotados los reintentos: NO confirma (el broker lo reenviará) y reconecta', async () => {
    jest.useFakeTimers();
    try {
      const { servicio, handle } = armar();
      let intentos = 0;
      servicio.alRecibir(() => {
        intentos++;
        throw new Error('la base no responde');
      });
      const cb = jest.fn();
      handle(publish('sitio/x/dispositivo/d/temperatura', '21'), cb);
      await jest.advanceTimersByTimeAsync(REINTENTOS_MS.reduce((a, b) => a + b, 0) + 1);
      expect(intentos).toBe(REINTENTOS_MS.length + 1);
      expect(cb).toHaveBeenCalledTimes(1);
      expect(cb.mock.calls[0][0]).toBeInstanceOf(Error); // con error = sin PUBACK
      expect(mockCliente.reconnect).toHaveBeenCalledTimes(1);
    } finally {
      jest.useRealTimers();
    }
  });
});
