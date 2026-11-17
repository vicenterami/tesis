import { describe, expect, it, vi } from 'vitest';
import { ServiceUnavailableException } from '@nestjs/common';
import { ContadorAccesos, Cupo, RespuestaGuardada } from './memoria.js';

// La memoria de la vista pública (docs/19 §4, O, puntos 7 y 8): respuesta guardada con espera compartida, cupo propio y contador.
describe('RespuestaGuardada', () => {
  const nueva = (o: Partial<{ maxEntradas: number; maxBytes: number }> = {}) => {
    let reloj = 0;
    const g = new RespuestaGuardada<string>({ duracionMs: 60_000, maxEntradas: o.maxEntradas ?? 10, maxBytes: o.maxBytes ?? 1_000, medir: (v) => v.length, ahora: () => reloj });
    return { g, avanzar: (ms: number) => { reloj += ms; } };
  };
  it('cien pedidos simultáneos de la misma clave hacen UN cálculo y reciben lo mismo', async () => {
    const { g } = nueva();
    let calculos = 0;
    let soltar!: (v: string) => void;
    const calcular = () => { calculos++; return new Promise<string>((r) => { soltar = r; }); };
    const todos = Array.from({ length: 100 }, () => g.obtener('e|24h', calcular));
    await new Promise((r) => setTimeout(r, 0));
    soltar('datos');
    expect(await Promise.all(todos)).toEqual(new Array(100).fill('datos'));
    expect(calculos).toBe(1);
  });
  it('guarda 60 s: dentro, no recalcula; vencido, recalcula; otra clave (otra ventana) es otro cálculo', async () => {
    const { g, avanzar } = nueva();
    let n = 0;
    const calcular = () => Promise.resolve(`v${++n}`);
    expect(await g.obtener('e|24h', calcular)).toBe('v1');
    avanzar(59_999);
    expect(await g.obtener('e|24h', calcular)).toBe('v1');
    expect(await g.obtener('e|7d', calcular)).toBe('v2');
    avanzar(1);
    expect(await g.obtener('e|24h', calcular)).toBe('v3');
  });
  it('un cálculo que falla no se guarda, lo reciben todos los que esperaban y el siguiente reintenta; también si lanza de forma síncrona', async () => {
    const { g } = nueva();
    const falla = () => Promise.reject(new ServiceUnavailableException('lento'));
    const [a, b] = await Promise.allSettled([g.obtener('k', falla), g.obtener('k', falla)]);
    expect(a.status).toBe('rejected');
    expect(b.status).toBe('rejected');
    await expect(g.obtener('k', () => { throw new Error('síncrono'); })).rejects.toThrow('síncrono');
    expect(await g.obtener('k', () => Promise.resolve('bien'))).toBe('bien');
  });
  it('un fallo que guardarFallo reconoce se guarda 60 s (sin recalcular); otro fallo no', async () => {
    let reloj = 0;
    const g = new RespuestaGuardada<string>({ duracionMs: 60_000, maxEntradas: 10, maxBytes: 1_000, medir: (v) => v.length, ahora: () => reloj, guardarFallo: (e) => (e as Error).message === 'lento' });
    let n = 0;
    const lento = () => { n++; return Promise.reject(new Error('lento')); };
    for (let i = 0; i < 5; i++) await expect(g.obtener('k', lento)).rejects.toThrow('lento');
    expect(n).toBe(1);
    reloj += 60_000;
    await expect(g.obtener('k', lento)).rejects.toThrow('lento');
    expect(n).toBe(2);
    let m = 0;
    const otro = () => { m++; return Promise.reject(new Error('otro')); };
    for (let i = 0; i < 3; i++) await expect(g.obtener('j', otro)).rejects.toThrow('otro');
    expect(m).toBe(3);
  });
  it('acotada en cantidad y en bytes: descarta las más antiguas; un valor que solo pasa el tope no se guarda; olvidar libera un enlace', async () => {
    const { g } = nueva({ maxEntradas: 2, maxBytes: 10 });
    await g.obtener('a|24h', () => Promise.resolve('aaaa'));
    await g.obtener('b|24h', () => Promise.resolve('bbbb'));
    await g.obtener('c|24h', () => Promise.resolve('cccc'));
    expect(g.tamano).toEqual({ entradas: 2, bytes: 8 });
    let recalculo = false;
    await g.obtener('a|24h', () => { recalculo = true; return Promise.resolve('a'); });
    expect(recalculo).toBe(true);
    expect(await g.obtener('grande', () => Promise.resolve('x'.repeat(11)))).toHaveLength(11);
    expect(g.tamano.entradas).toBe(2);
    g.olvidar('c|');
    expect(g.tamano).toEqual({ entradas: 1, bytes: 1 });
  });
});

describe('Cupo', () => {
  it('como mucho maxEnCurso a la vez; los demás esperan en orden; con la fila llena, 503 sin esperar', async () => {
    const c = new Cupo(1, 2);
    await c.tomar();
    const orden: number[] = [];
    const p1 = c.tomar().then(() => orden.push(1));
    const p2 = c.tomar().then(() => orden.push(2));
    await expect(c.tomar()).rejects.toBeInstanceOf(ServiceUnavailableException);
    expect(c.estado).toEqual({ enCurso: 1, enEspera: 2 });
    c.soltar();
    await p1;
    c.soltar();
    await p2;
    expect(orden).toEqual([1, 2]);
    c.soltar();
    expect(c.estado).toEqual({ enCurso: 0, enEspera: 0 });
  });
});

describe('Cupo con tope de espera (segunda revisión del 17/11/2026)', () => {
  it('quien espera más que el tope sale de la fila con 503 y no ocupa el cupo después', async () => {
    vi.useFakeTimers();
    try {
      const c = new Cupo(1, 5);
      await c.tomar();
      const espera = c.tomar(1_000).then(() => 'entró', (e: unknown) => (e instanceof ServiceUnavailableException ? '503' : 'otro'));
      await vi.advanceTimersByTimeAsync(1_001);
      expect(await espera).toBe('503');
      expect(c.estado).toEqual({ enCurso: 1, enEspera: 0 });
      c.soltar();
      expect(c.estado).toEqual({ enCurso: 0, enEspera: 0 });
    } finally {
      vi.useRealTimers();
    }
  });
});

describe('ContadorAccesos', () => {
  it('suma por enlace y día; tomar vacía; devolver suma de nuevo', () => {
    const c = new ContadorAccesos(10);
    c.sumar('e1', '2026-11-17');
    c.sumar('e1', '2026-11-17');
    c.sumar('e2', '2026-11-17');
    const filas = c.tomar();
    expect(filas).toEqual([{ enlace_id: 'e1', dia: '2026-11-17', cuenta: 2 }, { enlace_id: 'e2', dia: '2026-11-17', cuenta: 1 }]);
    expect(c.claves).toBe(0);
    c.sumar('e1', '2026-11-17');
    c.devolver(filas);
    expect(c.tomar()).toEqual([{ enlace_id: 'e1', dia: '2026-11-17', cuenta: 3 }, { enlace_id: 'e2', dia: '2026-11-17', cuenta: 1 }]);
  });
  it('acotado: con el tope de claves, una clave nueva no se cuenta (una ya presente sí)', () => {
    const c = new ContadorAccesos(1);
    expect(c.sumar('e1', 'd')).toBe(true);
    expect(c.sumar('e2', 'd')).toBe(false);
    expect(c.sumar('e1', 'd')).toBe(true);
    expect(c.tomar()).toEqual([{ enlace_id: 'e1', dia: 'd', cuenta: 2 }]);
  });
});
