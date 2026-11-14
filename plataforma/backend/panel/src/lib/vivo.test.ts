import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERA_MAX_MS, RECONECTADO, SIN_LATIDO_MS, abrirCanal, abrirCanalCompartido, esEventoVivo, esperaReintento, type FuenteDeEventos } from './vivo';

// EventSource falso: registra oyentes y deja disparar eventos y errores a mano.
class FuenteFalsa implements FuenteDeEventos {
  readyState = 0;
  onopen: ((ev: Event) => void) | null = null;
  onerror: ((ev: Event) => void) | null = null;
  cerrada = false;
  private oyentes = new Map<string, (ev: MessageEvent) => void>();
  addEventListener(tipo: string, oyente: (ev: MessageEvent) => void): void {
    this.oyentes.set(tipo, oyente);
  }
  close(): void {
    this.cerrada = true;
    this.readyState = 2;
  }
  abrir(): void {
    this.readyState = 1;
    this.onopen?.(new Event('open'));
  }
  emitir(tipo: string, data: object): void {
    this.oyenteCrudo(tipo, JSON.stringify(data));
  }
  oyenteCrudo(tipo: string, data: string): void {
    this.oyentes.get(tipo)?.({ data } as MessageEvent);
  }
  fallarCerrado(): void {
    this.readyState = 2;
    this.onerror?.(new Event('error'));
  }
}

describe('esperaReintento: 1, 2, 4, 8, 16, 30, 30… segundos', () => {
  it('crece al doble y se detiene en 30 s', () =>
    expect([0, 1, 2, 3, 4, 5, 9].map(esperaReintento)).toEqual([1000, 2000, 4000, 8000, 16_000, ESPERA_MAX_MS, ESPERA_MAX_MS]));
});

describe('esEventoVivo: un evento sin la forma esperada se descarta, no rompe la pantalla', () => {
  it('acepta `sitio_id` (L6): el id del sitio, null o ausente (un backend anterior); otro tipo no es un aviso nuestro', () => {
    const m = { dispositivo_id: 'd', canal_id: 'c', valor: 1, unidad: 'Cel', tiempo: '2026-11-13T00:00:00Z' };
    expect(esEventoVivo('medicion', { ...m, sitio_id: 's1' })).toBe(true);
    expect(esEventoVivo('medicion', { ...m, sitio_id: null })).toBe(true);
    expect(esEventoVivo('medicion', m)).toBe(true);
    expect(esEventoVivo('medicion', { ...m, sitio_id: 7 })).toBe(false);
    expect(esEventoVivo('visto', { dispositivo_id: 'd', tiempo: 'x', sitio_id: 's1' })).toBe(true);
    expect(esEventoVivo('visto', { dispositivo_id: 'd', tiempo: 'x', sitio_id: { id: 's1' } })).toBe(false);
    expect(esEventoVivo('condicion', { dispositivo_id: 'd', condicion: 'umbral', estado: 'abierta', sitio_id: 's1' })).toBe(true);
    expect(esEventoVivo('condicion', { dispositivo_id: 'd', condicion: 'umbral', estado: 'abierta', sitio_id: ['s1'] })).toBe(false);
  });
  it('acepta los cuatro tipos con sus campos (el latido solo trae tiempo); rechaza sin tiempo, tipo desconocido, valor que no es número, o no objeto', () => {
    expect(esEventoVivo('visto', { tipo: 'visto', dispositivo_id: 'd', tiempo: 't' })).toBe(true);
    expect(esEventoVivo('medicion', { dispositivo_id: 'd', canal_id: 'c', valor: 1.5, unidad: 'Cel', tiempo: 't' })).toBe(true);
    expect(esEventoVivo('condicion', { dispositivo_id: 'd', condicion: 'umbral', estado: 'abierta' })).toBe(true);
    expect(esEventoVivo('latido', { tiempo: 't' })).toBe(true); // como lo manda el backend, sin «tipo» en los datos
    expect(esEventoVivo('visto', { dispositivo_id: 'd' })).toBe(false);
    expect(esEventoVivo('otro', { dispositivo_id: 'd', tiempo: 't' })).toBe(false);
    expect(esEventoVivo('medicion', { dispositivo_id: 'd', canal_id: 'c', valor: '1.5', tiempo: 't' })).toBe(false);
    expect(esEventoVivo('medicion', { dispositivo_id: 'd', canal_id: 'c', valor: Infinity, tiempo: 't' })).toBe(false); // 1e999 en JSON
    expect(esEventoVivo('visto', 'texto')).toBe(false);
    expect(esEventoVivo('latido', null)).toBe(false);
  });
  it('un latido llega al panel con su tipo puesto por el nombre del evento', () => {
    const eventos: unknown[] = [];
    const creadas: FuenteFalsa[] = [];
    const c = abrirCanal('/eventos', (e) => eventos.push(e), () => undefined, () => { const f = new FuenteFalsa(); creadas.push(f); return f; });
    creadas[0]!.emitir('latido', { tiempo: 't' });
    expect(eventos).toEqual([{ tipo: 'latido', tiempo: 't' }]);
    c.cerrar();
  });
});

describe('abrirCanal (docs/19 F4)', () => {
  const creadas: FuenteFalsa[] = [];
  const crear = (): FuenteDeEventos => {
    const f = new FuenteFalsa();
    creadas.push(f);
    return f;
  };
  beforeEach(() => {
    vi.useFakeTimers();
    creadas.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  it('entrega los eventos ya decodificados y marca «en vivo» al abrir', () => {
    const eventos: unknown[] = [];
    const estados: string[] = [];
    const c = abrirCanal('/eventos', (e) => eventos.push(e), (s) => estados.push(s), crear);
    creadas[0]!.abrir();
    creadas[0]!.emitir('visto', { tipo: 'visto', dispositivo_id: 'd1', tiempo: 't' });
    creadas[0]!.emitir('visto', { tipo: 'visto', dispositivo_id: 'd1' }); // sin tiempo: se descarta
    creadas[0]!.oyenteCrudo('visto', 'esto no es JSON'); // ilegible: se descarta, sin excepción
    expect(eventos).toEqual([{ tipo: 'visto', dispositivo_id: 'd1', tiempo: 't' }]);
    expect(estados).toEqual(['conectando', 'en_vivo']);
    c.cerrar();
    expect(creadas[0]!.cerrada).toBe(true);
  });

  it('cerrado por el servidor (403 o 503: el navegador no reintenta) → reconecta a 1 s, 2 s, 4 s…', () => {
    const estados: string[] = [];
    const c = abrirCanal('/eventos', () => undefined, (s) => estados.push(s), crear);
    creadas[0]!.fallarCerrado();
    expect(estados.at(-1)).toBe('reconectando');
    vi.advanceTimersByTime(999);
    expect(creadas).toHaveLength(1);
    vi.advanceTimersByTime(1);
    expect(creadas).toHaveLength(2); // segundo intento, al segundo
    creadas[1]!.fallarCerrado();
    vi.advanceTimersByTime(2000);
    expect(creadas).toHaveLength(3); // tercero, a los 2 s
    creadas[2]!.abrir();
    creadas[2]!.emitir('latido', { tiempo: 't' });
    creadas[2]!.fallarCerrado();
    vi.advanceTimersByTime(1000);
    expect(creadas).toHaveLength(4); // tras abrir bien y recibir algo, la espera vuelve a 1 s
    c.cerrar();
  });

  it('la secuencia real es reconectando → conectando → en_vivo; al volver, el motivo es «reconectado» (F4: la pantalla vuelve a pedir)', () => {
    const estados: string[] = [];
    const c = abrirCanal('/eventos', () => undefined, (s, m) => estados.push(m === undefined ? s : `${s}:${m}`), crear);
    creadas[0]!.abrir();
    creadas[0]!.fallarCerrado();
    vi.advanceTimersByTime(1000);
    creadas[1]!.abrir();
    expect(estados).toEqual(['conectando', 'en_vivo', 'reconectando:el servidor rechazó o cerró el canal', 'conectando', `en_vivo:${RECONECTADO}`]);
    creadas[1]!.emitir('latido', { tiempo: 't' });
    expect(estados.at(-1)).toBe(`en_vivo:${RECONECTADO}`); // un latido no vuelve a avisar
    c.cerrar();
  });

  it('60 s sin ningún evento (ni latido) → se da por muerto y reconecta; un latido reinicia el plazo', () => {
    const c = abrirCanal('/eventos', () => undefined, () => undefined, crear);
    creadas[0]!.abrir();
    vi.advanceTimersByTime(SIN_LATIDO_MS - 1000);
    creadas[0]!.emitir('latido', { tipo: 'latido', tiempo: 't' });
    vi.advanceTimersByTime(SIN_LATIDO_MS - 1000);
    expect(creadas).toHaveLength(1); // el latido corrió el plazo
    vi.advanceTimersByTime(1000 + 1000);
    expect(creadas[0]!.cerrada).toBe(true);
    expect(creadas).toHaveLength(2);
    c.cerrar();
  });

  // Con sesión (docs/20 §10, R2), el servidor cierra el canal cuando la sesión vence; EventSource no da el código. Al PRIMER rechazo
  // tras estar en vivo se pregunta por la sesión (un 401 lleva al inicio de sesión); los reintentos siguientes no preguntan, así un
  // canal rechazado en bucle no mantiene viva la sesión de una pantalla sin nadie delante.
  it('al primer rechazo del servidor pregunta por la sesión, no en cada reintento; tras volver a estar en vivo, de nuevo al primero', () => {
    const preguntas: number[] = [];
    const c = abrirCanal('/eventos', () => undefined, () => undefined, crear, () => preguntas.push(Date.now()));
    creadas[0]!.abrir();
    creadas[0]!.fallarCerrado();
    expect(preguntas).toHaveLength(1);
    vi.advanceTimersByTime(1000);
    creadas[1]!.fallarCerrado();
    vi.advanceTimersByTime(2000);
    creadas[2]!.fallarCerrado();
    expect(preguntas).toHaveLength(1);
    vi.advanceTimersByTime(4000);
    creadas[3]!.abrir();
    creadas[3]!.emitir('latido', { tiempo: 't' });
    creadas[3]!.fallarCerrado();
    expect(preguntas).toHaveLength(2);
    c.cerrar();
  });

  it('un servidor que acepta el flujo y lo cierra enseguida, sin mandar nada: la espera sigue creciendo (1, 2, 4… s), no una recarga por segundo', () => {
    const estados: string[] = [];
    const preguntas: number[] = [];
    const c = abrirCanal('/eventos', () => undefined, (s, m) => estados.push(m === undefined ? s : `${s}:${m}`), crear, () => preguntas.push(1));
    const esperas: number[] = [];
    let t = 0;
    for (let i = 0; i < 5; i++) {
      creadas[i]!.abrir();
      creadas[i]!.fallarCerrado(); // abre y cierra sin un latido
      let n = 0;
      while (creadas.length === i + 1) { vi.advanceTimersByTime(1000); n += 1000; }
      esperas.push(n);
      t += n;
    }
    expect(esperas).toEqual([1000, 2000, 4000, 8000, 16_000]);
    expect(estados.filter((s) => s === `en_vivo:${RECONECTADO}`)).toHaveLength(4); // cuatro recargas en 31 s, no 31
    expect(t).toBe(31_000);
    expect(preguntas).toHaveLength(1); // y la sesión se pregunta una sola vez
    c.cerrar();
  });

  it('cerrar() no deja reintentos ni vigilantes pendientes', () => {
    const c = abrirCanal('/eventos', () => undefined, () => undefined, crear);
    creadas[0]!.fallarCerrado();
    c.cerrar();
    vi.advanceTimersByTime(ESPERA_MAX_MS * 3);
    expect(creadas).toHaveLength(1);
  });
});

// Un solo canal sin filtro por pestaña (11/11/2026): el tablero, el inventario, la comparación y los avisos lo comparten.
describe('abrirCanalCompartido', () => {
  it('dos suscriptores, una conexión; los dos reciben eventos y estados; quien llega tarde recibe el estado actual; se cierra con el último', () => {
    const creadas: { url: string; cerrada: boolean; f: FuenteDeEventos & { emitir: (t: string, d: unknown) => void } }[] = [];
    vi.stubGlobal('EventSource', class {
      readyState = 1; onopen: ((e: Event) => void) | null = null; onerror: ((e: Event) => void) | null = null;
      private oyentes = new Map<string, (e: MessageEvent) => void>();
      constructor(url: string) { creadas.push({ url, cerrada: false, f: this as never }); }
      addEventListener(t: string, o: (e: MessageEvent) => void): void { this.oyentes.set(t, o); }
      emitir(t: string, d: unknown): void { this.oyentes.get(t)?.(new MessageEvent(t, { data: JSON.stringify(d) })); }
      close(): void { creadas.find((c) => c.f === (this as never))!.cerrada = true; }
    });
    const a: string[] = [];
    const b: string[] = [];
    const ca = abrirCanalCompartido('/eventos', (e) => a.push(e.tipo), (s) => a.push(s));
    creadas[0]!.f.onopen?.(new Event('open'));
    const cb = abrirCanalCompartido('/eventos', (e) => b.push(e.tipo), (s) => b.push(s));
    expect(creadas).toHaveLength(1);
    creadas[0]!.f.emitir('visto', { dispositivo_id: 'd1', tiempo: '2026-11-11T12:00:00Z' });
    expect(a).toEqual(['conectando', 'en_vivo', 'visto']);
    expect(b).toEqual(['en_vivo', 'visto']);
    ca.cerrar();
    ca.cerrar(); // dos veces no descuenta dos
    expect(creadas[0]!.cerrada).toBe(false);
    cb.cerrar();
    expect(creadas[0]!.cerrada).toBe(true);
    abrirCanalCompartido('/eventos', () => {}, () => {}).cerrar();
    expect(creadas).toHaveLength(2); // después del último, uno nuevo abre otra conexión
    vi.unstubAllGlobals();
  });
});
