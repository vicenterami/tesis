// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { esRangoVivo, limitador, periodoRefrescoMs, ventanaAlineada } from './refresco';

// Gráficas vivas donde sirve (docs/19 §4, bloque L, punto 4a): el período, la ventana alineada al cubo y el limitador (como mucho uno por
// período, nunca dos en vuelo, nada con la pestaña oculta).
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('período y ventana', () => {
  it('la sexta parte del cubo, entre 5 y 60 s: 1 min → 10 s; 15 min → 60 s; 5 min → 50 s; un cubo de segundos no baja de 5 s', () => {
    expect(periodoRefrescoMs('1 minute')).toBe(10_000);
    expect(periodoRefrescoMs('15 minutes')).toBe(60_000);
    expect(periodoRefrescoMs('5 minutes')).toBe(50_000);
    expect(periodoRefrescoMs('1 hour')).toBe(60_000);
    expect(periodoRefrescoMs('desconocido')).toBe(60_000);
  });
  it('solo «última hora» y «24 horas» son vivos', () => {
    expect(['1h', '24h', '7d', '30d'].map((r) => esRangoVivo(r as never))).toEqual([true, true, false, false]);
    expect(esRangoVivo(null)).toBe(false);
  });
  it('la ventana empieza en el borde de su cubo: los promedios ya dibujados no cambian al avanzar', () => {
    const v = ventanaAlineada('24h', new Date('2026-11-11T15:07:42Z'));
    expect(v.desde.toISOString()).toBe('2026-11-10T15:00:00.000Z');
    expect(v.hasta.toISOString()).toBe('2026-11-11T15:07:42.000Z');
    expect(v.intervalo).toBe('15 minutes');
    expect(ventanaAlineada('1h', new Date('2026-11-11T15:07:42Z')).desde.toISOString()).toBe('2026-11-11T14:07:00.000Z');
    // Diez segundos después, el mismo inicio (no se mueve hasta cruzar el borde del cubo)
    expect(ventanaAlineada('24h', new Date('2026-11-11T15:07:52Z')).desde.toISOString()).toBe('2026-11-10T15:00:00.000Z');
  });
});

describe('limitador', () => {
  it('muchos avisos → uno por período; nunca dos en vuelo; el que llega en vuelo se atiende una vez al terminar y respetando el período', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let enVuelo = 0;
    let maximo = 0;
    let llamadas = 0;
    let soltar: () => void = () => undefined;
    const l = limitador(() => {
      llamadas++;
      enVuelo++;
      maximo = Math.max(maximo, enVuelo);
      return new Promise<void>((r) => (soltar = () => { enVuelo--; r(); }));
    }, () => 10_000, () => true);
    for (let i = 0; i < 50; i++) l.aviso();
    await vi.advanceTimersByTimeAsync(9_999);
    expect(llamadas).toBe(0);
    await vi.advanceTimersByTimeAsync(1);
    expect(llamadas).toBe(1);
    for (let i = 0; i < 50; i++) l.aviso(); // llegan con el pedido en vuelo
    await vi.advanceTimersByTimeAsync(30_000);
    expect(llamadas).toBe(1); // en vuelo: no sale otro
    soltar();
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas).toBe(2); // al terminar, uno solo por todos los que llegaron
    soltar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas).toBe(2); // sin avisos nuevos, nada
    expect(maximo).toBe(1);
    l.cancelar();
  });
  it('con la pestaña oculta no pide; al volver a verse, una vez', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let visible = false;
    let llamadas = 0;
    const l = limitador(async () => void llamadas++, () => 5_000, () => visible);
    l.aviso();
    l.aviso();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas).toBe(0);
    visible = true;
    document.dispatchEvent(new Event('visibilitychange'));
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas).toBe(1);
    l.cancelar();
    l.aviso();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas).toBe(1); // cancelado: nada más
  });
  it('`marcar()` (una carga completa) reinicia el período', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let llamadas = 0;
    const l = limitador(async () => void llamadas++, () => 10_000, () => true);
    await vi.advanceTimersByTimeAsync(8_000);
    l.marcar();
    l.aviso();
    await vi.advanceTimersByTimeAsync(9_000);
    expect(llamadas).toBe(0);
    await vi.advanceTimersByTimeAsync(1_000);
    expect(llamadas).toBe(1);
    l.cancelar();
  });
  it('`marcar()` olvida lo que ya estaba programado (la carga completa lo trae): no corre después y pisa lo que la persona pidió', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let llamadas = 0;
    const l = limitador(async () => void llamadas++, () => 10_000, () => true);
    l.aviso(); // programado para los 10 s
    await vi.advanceTimersByTimeAsync(8_000);
    l.marcar(); // la persona cambió de rango: salió una carga completa
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas).toBe(0);
    l.cancelar();
  });
  it('`soltar()` (al pausar) olvida lo programado sin mover el período', async () => {
    vi.useFakeTimers({ now: new Date('2026-11-11T15:00:00Z'), toFake: ['Date', 'setTimeout', 'clearTimeout'] });
    let llamadas = 0;
    const l = limitador(async () => void llamadas++, () => 10_000, () => true);
    l.aviso();
    await vi.advanceTimersByTimeAsync(5_000);
    l.soltar();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(llamadas).toBe(0); // lo programado no corrió en pausa
    l.aviso(); // al reanudar llega otro: el período ya pasó, sale enseguida
    await vi.advanceTimersByTimeAsync(0);
    expect(llamadas).toBe(1);
    l.cancelar();
  });
});
