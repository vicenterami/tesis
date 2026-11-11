import { describe, expect, it } from 'vitest';
import { HttpException, ServiceUnavailableException } from '@nestjs/common';
import { Turnos } from './turnos.js';

// Turnos del hash de claves de personas: como mucho 2 a la vez (128 MiB cada uno), los demás esperan en orden; con la cola llena, 503.
describe('Turnos', () => {
  it('nunca más de 2 a la vez; los demás esperan y corren en el orden en que llegaron', async () => {
    const t = new Turnos(2, 20);
    let maximo = 0;
    const orden: number[] = [];
    const sueltos: (() => void)[] = [];
    const trabajo = (i: number) => t.con(() => new Promise<void>((r) => {
      maximo = Math.max(maximo, t.ocupados);
      orden.push(i);
      sueltos.push(r);
    }));
    const todas = [0, 1, 2, 3, 4].map(trabajo);
    await Promise.resolve();
    expect(t.ocupados).toBe(2);
    expect(t.esperando).toBe(3);
    while (orden.length < 5 || sueltos.length > 0) {
      sueltos.shift()?.();
      await new Promise((r) => setImmediate(r));
    }
    await Promise.all(todas);
    expect(maximo).toBe(2);
    expect(orden).toEqual([0, 1, 2, 3, 4]);
    expect(t.ocupados).toBe(0);
  });

  it('con la cola llena responde 503 sin encolar; un trabajo que falla libera su turno', async () => {
    const t = new Turnos(1, 1);
    let soltar: () => void = () => undefined;
    const primero = t.con(() => new Promise<void>((r) => { soltar = r; }));
    const segundo = t.con(() => Promise.resolve('segundo'));
    await expect(t.con(() => Promise.resolve())).rejects.toBeInstanceOf(ServiceUnavailableException);
    soltar();
    await primero;
    expect(await segundo).toBe('segundo');
    await expect(t.con(() => Promise.reject(new Error('sin memoria')))).rejects.toThrow('sin memoria');
    expect(t.ocupados).toBe(0);
  });

  it('tope por dirección (revisión del 08/11/2026): la tercera de una misma dirección, en curso o en cola → 429 sin encolarse; las demás siguen', async () => {
    const t = new Turnos(1, 20, 2);
    const sueltos: (() => void)[] = [];
    const trabajo = () => new Promise<void>((r) => sueltos.push(r));
    const a = t.con(trabajo, '192.0.2.1'); // en curso
    const b = t.con(trabajo, '192.0.2.1'); // en cola
    const tercera = await t.con(trabajo, '192.0.2.1').catch((e: unknown) => e);
    expect(tercera).toBeInstanceOf(HttpException);
    expect((tercera as HttpException).getStatus()).toBe(429);
    expect(t.esperando).toBe(1);
    const otra = t.con(trabajo, '203.0.113.9'); // otra dirección: se encola
    expect(t.esperando).toBe(2);
    sueltos.shift()!();
    await a;
    await new Promise((r) => setImmediate(r));
    const cuarta = t.con(trabajo, '192.0.2.1'); // ya hay lugar para esa dirección
    while (sueltos.length > 0 || t.ocupados > 0) { sueltos.shift()?.(); await new Promise((r) => setImmediate(r)); }
    await Promise.all([b, otra, cuarta]);
    expect(t.origenes).toBe(0);
  });
});
