import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { antirrebote, porLotes } from './antirrebote';

describe('antirrebote: una consulta como mucho por ventana y nunca dos en vuelo', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());

  it('cien avisos en un segundo → una consulta', async () => {
    let llamadas = 0;
    const a = antirrebote(async () => { llamadas++; }, 1000);
    for (let i = 0; i < 100; i++) a.pedir();
    await vi.advanceTimersByTimeAsync(1000);
    expect(llamadas).toBe(1);
  });

  it('un aviso que llega mientras la consulta está en vuelo produce exactamente una repetición al terminar', async () => {
    let llamadas = 0;
    let terminar: () => void = () => undefined;
    const a = antirrebote(() => { llamadas++; return new Promise<void>((r) => (terminar = r)); }, 1000);
    a.pedir();
    await vi.advanceTimersByTimeAsync(1000);
    expect(llamadas).toBe(1);
    a.pedir(); a.pedir(); // en vuelo: se anotan, no se lanzan
    await vi.advanceTimersByTimeAsync(5000);
    expect(llamadas).toBe(1);
    terminar();
    await vi.advanceTimersByTimeAsync(1000);
    expect(llamadas).toBe(2);
  });

  it('cancelar impide lo pendiente', async () => {
    let llamadas = 0;
    const a = antirrebote(async () => { llamadas++; }, 1000);
    a.pedir();
    a.cancelar();
    await vi.advanceTimersByTimeAsync(5000);
    expect(llamadas).toBe(0);
  });
});

describe('porLotes: muchas lecturas → una entrega por ventana', () => {
  beforeEach(() => vi.useFakeTimers());
  afterEach(() => vi.useRealTimers());
  it('200 lecturas en 100 ms se entregan en un lote de 200 a los 250 ms; después, otra ventana', () => {
    const lotes: number[][] = [];
    const l = porLotes<number>((x) => lotes.push(x), 250);
    for (let i = 0; i < 200; i++) l.agregar(i);
    vi.advanceTimersByTime(249);
    expect(lotes).toHaveLength(0);
    vi.advanceTimersByTime(1);
    expect(lotes).toHaveLength(1);
    expect(lotes[0]).toHaveLength(200);
    l.agregar(999);
    vi.advanceTimersByTime(250);
    expect(lotes[1]).toEqual([999]);
  });
});
