import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ESPERA_MAX_MS, RECONECTADO, SIN_LATIDO_MS, abrirCanal, esEventoVivo, esperaReintento, type FuenteDeEventos } from './vivo';

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
    creadas[2]!.fallarCerrado();
    vi.advanceTimersByTime(1000);
    expect(creadas).toHaveLength(4); // tras abrir bien, la espera vuelve a 1 s
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
    creadas[3]!.fallarCerrado();
    expect(preguntas).toHaveLength(2);
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
