// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sitio } from './lib/modelo';
import type { Sesion } from './lib/sesion';
import AjustesSitio from './AjustesSitio.svelte';

// P15, «Ajustes del sitio» (docs/19 §4, Q), por el DOM: el plazo de la primera trama (con el aviso de a cuántos equipos afecta acortarlo) y
// el k y el tope de la vista pública, mudados desde «Publicar una vista» (P9) sin cambiar su comportamiento (docs/16 §86).
const SITIOS: Sitio[] = [{ id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] }];
const DOS: Sitio[] = [...SITIOS, { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'administrador', zonas: [] }];
const persona = (sitios: Sitio[], permisos: Record<string, string[]>): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: sitios.map((s) => ({ sitio_id: s.id, codigo: s.codigo, nombre: s.nombre, rol: 'administrador' })), permisos,
});
const COMPLETA = { administrador: ['leer', 'ajustes', 'enlaces'] };
const SESION = persona(SITIOS, COMPLETA);
const SESION_DOS = persona(DOS, COMPLETA);

let pedidas: { metodo: string; ruta: string; cuerpo: unknown }[] = [];
let kServidor = 3; // el k que rige en el servidor (otra persona puede cambiarlo)
let esperaServidor = 168; // el plazo que rige en el servidor
let afectadosServidor = 0; // lo que responde `?propuesto=`
let preguntaFalla = false;
// Una petición que se queda en vuelo hasta que la prueba la suelta (para cambiar de sitio mientras tanto).
let retener: (metodo: string, ruta: string) => Promise<void> | null = () => null;

const json = (x: unknown, status = 200): Response => new Response(JSON.stringify(x), { status });
const espera = (h: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({ espera_primera_trama_h: h, por_omision: 168, minimo: 1, maximo: 2160, ...extra });
beforeEach(() => {
  pedidas = [];
  kServidor = 3;
  esperaServidor = 168;
  afectadosServidor = 0;
  preguntaFalla = false;
  retener = () => null;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: false, media: q, addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string, init: RequestInit = {}) => {
    // Como fetch: una petición cancelada antes de responder rechaza con AbortError (así una cancelación de más se nota).
    await Promise.resolve();
    if (init.signal?.aborted) throw new DOMException('cancelada', 'AbortError');
    const metodo = init.method ?? 'GET';
    const cuerpo = typeof init.body === 'string' ? JSON.parse(init.body) : undefined;
    pedidas.push({ metodo, ruta, cuerpo });
    await retener(metodo, ruta);
    if (init.signal?.aborted) throw new DOMException('cancelada', 'AbortError'); // también si se canceló mientras esperaba
    // El segundo sitio (Magallanes): k = 7, tope 9 y plazo de 48 h.
    if (ruta === '/sitios/s2/enlaces/minimo' && metodo === 'GET') return json({ minimo_dispositivos: 7, fijado: true, por_omision: 3, piso: 1, maximo: 20 });
    if (ruta === '/sitios/s2/enlaces/tope' && metodo === 'GET') return json({ max_enlaces: 9, fijado: true, por_omision: 50, techo: 200, vivos: 0 });
    if (ruta === '/sitios/s2/espera-primera-trama' && metodo === 'GET') return json(espera(48));
    if (ruta === '/sitios/s1/enlaces/minimo' && metodo === 'GET') return json({ minimo_dispositivos: kServidor, fijado: false, por_omision: 3, piso: 1, maximo: 20 });
    if (ruta === '/sitios/s1/enlaces/minimo' && metodo === 'PUT') {
      if (cuerpo.anterior !== undefined && cuerpo.anterior !== kServidor) {
        return json({ statusCode: 409, codigo: 'minimo_cambio', minimo_dispositivos: kServidor, message: `Alguien cambió el mínimo de este sitio entretanto: ahora es k = ${kServidor}. Revísalo antes de cambiarlo.` }, 409);
      }
      kServidor = cuerpo.minimo_dispositivos;
      return json({ minimo_dispositivos: cuerpo.minimo_dispositivos, fijado: true, por_omision: 3, piso: 1, maximo: 20, avisos: ['Este mínimo afecta a todos los enlaces públicos de este sitio.', 'La zona «Sur» tiene 1 equipo: con k = 1 su lectura sale tal cual.'] });
    }
    if (ruta === '/sitios/s1/enlaces/tope' && metodo === 'GET') return json({ max_enlaces: 50, fijado: false, por_omision: 50, techo: 200, vivos: 1 });
    if (ruta === '/sitios/s1/enlaces/tope' && metodo === 'PUT') return json({ max_enlaces: cuerpo.max_enlaces, fijado: true, por_omision: 50, techo: 200, vivos: 1 });
    if (ruta.startsWith('/sitios/s1/espera-primera-trama?propuesto=')) {
      if (preguntaFalla) return json({ statusCode: 500, message: 'falla' }, 500);
      return json(espera(esperaServidor, { afectados: afectadosServidor }));
    }
    if (ruta === '/sitios/s1/espera-primera-trama' && metodo === 'GET') return json(espera(esperaServidor));
    if (ruta === '/sitios/s1/espera-primera-trama' && metodo === 'PUT') {
      if (cuerpo.anterior !== undefined && cuerpo.anterior !== esperaServidor) {
        return json({ statusCode: 409, codigo: 'espera_cambio', espera_primera_trama_h: esperaServidor, message: `Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de ${esperaServidor} h. Revísalo antes de cambiarlo.` }, 409);
      }
      esperaServidor = cuerpo.espera_primera_trama_h;
      return json(espera(esperaServidor));
    }
    return json({}, 404);
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

const $ = <T extends Element = HTMLElement>(sel: string): T => document.querySelector<T>(sel)!;
const texto = (sel: string): string => (document.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const puts = (): { ruta: string; cuerpo: unknown }[] => pedidas.filter((p) => p.metodo === 'PUT');
const preguntas = (): string[] => pedidas.filter((p) => p.ruta.includes('?propuesto=')).map((p) => p.ruta);
const montar = async (sesion: Sesion = SESION, sitios: Sitio[] = SITIOS) => {
  const r = render(AjustesSitio, { sitio: 'uct', sesion, sitios, alCambiarVista: () => undefined });
  await waitFor(() => expect(document.querySelector('[data-espera-actual], [data-minimo-actual]')).toBeTruthy());
  return r;
};
const escribir = (sel: string, valor: string): Promise<unknown> => fireEvent.input($(sel), { target: { value: valor } });
const soltable = (): { promesa: Promise<void>; soltar: () => void } => { let soltar = (): void => undefined; const promesa = new Promise<void>((ok) => (soltar = ok)); return { promesa, soltar }; };

describe('P15, el plazo de la primera trama', () => {
  it('muestra el plazo que rige con su equivalencia en días, lo que pasa al vencer y por qué existe', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    expect(texto('[data-ajuste-espera]')).toContain('Rige 168 h (7 días)');
    expect(texto('[data-espera-dias]')).toBe('168 horas son 7 días');
    expect(texto('[data-espera-al-vencer]')).toContain('pasa a «Sin señal» y se abre la alarma de falta de comunicación');
    expect(texto('[data-espera-por-que]')).toContain('Un alta masiva suele hacerse días antes de instalar los equipos');
    expect($<HTMLInputElement>('[data-espera-campo]').value).toBe('168');
    await escribir('[data-espera-campo]', '36');
    expect(texto('[data-espera-dias]')).toBe('36 horas son 1,5 días');
    expect(document.querySelector('label [data-espera-campo]') ?? $('[data-espera-campo]').closest('label')).toBeTruthy(); // con su etiqueta
  });

  it('alargar el plazo se guarda directo con `anterior`, sin preguntar a cuántos afecta', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '720');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('720'));
    expect(puts().map((p) => p.cuerpo)).toEqual([{ espera_primera_trama_h: 720, anterior: 168 }]);
    expect(preguntas()).toEqual([]); // alargar nunca pregunta
    expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull();
    expect(document.body.textContent).toContain('El plazo de la primera trama de este sitio es ahora de 720 h (30 días).');
  });

  it('acortar con equipos afectados: pregunta con `?propuesto=`, pide confirmar y sin confirmar no hay PUT; al confirmar se guarda con `anterior`', async () => {
    afectadosServidor = 4;
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '24');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeTruthy());
    expect(preguntas()).toEqual(['/sitios/s1/espera-primera-trama?propuesto=24']);
    expect(texto('[data-confirmar-espera-aviso] p')).toBe('Con este plazo, 4 equipos que esperan su primera trama pasarán a «Sin señal» y abrirán su alarma de falta de comunicación en la revisión siguiente del sistema. ¿Guardar igual?');
    expect(puts()).toEqual([]); // sin confirmar no se manda nada
    ($('[data-confirmar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('24'));
    expect(puts().map((p) => p.cuerpo)).toEqual([{ espera_primera_trama_h: 24, anterior: 168 }]);
    expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull();
  });

  it('acortar y cancelar la confirmación: no se guarda, y el campo vuelve al plazo que rige', async () => {
    afectadosServidor = 2;
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '24');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeTruthy());
    const cancelar = [...document.querySelectorAll<HTMLButtonElement>('[data-confirmar-espera-aviso] button')].find((b) => b.textContent!.trim() === 'Cancelar')!;
    cancelar.click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull());
    expect($<HTMLInputElement>('[data-espera-campo]').value).toBe('168');
    expect(puts()).toEqual([]);
  });

  it('acortar sin equipos afectados: pregunta, no pide confirmar y se guarda directo', async () => {
    afectadosServidor = 0;
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '24');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('24'));
    expect(preguntas()).toEqual(['/sitios/s1/espera-primera-trama?propuesto=24']);
    expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull();
    expect(puts().map((p) => p.cuerpo)).toEqual([{ espera_primera_trama_h: 24, anterior: 168 }]);
  });

  it('si la pregunta de a cuántos afecta falla, se dice y no se guarda (la pregunta no se salta)', async () => {
    preguntaFalla = true;
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '24');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-ajuste-espera] [data-aviso]')).toBeTruthy());
    expect(puts()).toEqual([]);
    expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull();
  });

  // Revisión del 18/11/2026: lo que se guarda es exactamente lo que se consultó y, si hay confirmación, la que corresponde a esa consulta.
  it('mientras se consulta a cuántos afecta, el campo se bloquea; si cambia igual, la respuesta se descarta: ni confirmación ni PUT, con o sin afectados', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    for (const n of [4, 0]) {
      afectadosServidor = n;
      const pausa = soltable();
      retener = (metodo, ruta) => (metodo === 'GET' && ruta.includes('?propuesto=') ? pausa.promesa : null);
      await escribir('[data-espera-campo]', '24');
      ($('[data-guardar-espera]') as HTMLButtonElement).click();
      await waitFor(() => expect(preguntas().length).toBeGreaterThan(0));
      expect($<HTMLInputElement>('[data-espera-campo]').disabled).toBe(true); // bloqueado mientras se consulta
      await escribir('[data-espera-campo]', '2'); // aun así cambia (otro dispositivo de entrada)
      pausa.soltar();
      await new Promise((x) => setTimeout(x, 50));
      expect(document.querySelector('[data-confirmar-espera-aviso]'), `con ${n} afectados`).toBeNull(); // la pregunta fue por 24, no por 2
      expect(puts(), `con ${n} afectados`).toEqual([]);
      expect($<HTMLInputElement>('[data-espera-campo]').disabled).toBe(false);
      retener = () => null;
      pedidas = [];
    }
  });

  it('con una confirmación abierta, volver a pulsar «Guardar» la cierra antes de preguntar otra vez: no queda una confirmación vieja activa', async () => {
    afectadosServidor = 4;
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    await escribir('[data-espera-campo]', '24');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeTruthy());
    const pausa = soltable();
    retener = (metodo, ruta) => (metodo === 'GET' && ruta.includes('?propuesto=') ? pausa.promesa : null);
    ($('[data-guardar-espera]') as HTMLButtonElement).click(); // otra vez, con la confirmación abierta
    await waitFor(() => expect(preguntas()).toHaveLength(2));
    expect(document.querySelector('[data-confirmar-espera-aviso]')).toBeNull(); // la vieja se cerró al preguntar
    pausa.soltar();
    await waitFor(() => expect(document.querySelectorAll('[data-confirmar-espera-aviso]')).toHaveLength(1)); // una sola, la de esta consulta
    expect(puts()).toEqual([]);
  });

  it('fuera de rango, vacío o decimal no se manda, con el motivo escrito; el mismo valor que rige tampoco (sin petición)', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    const boton = (): HTMLButtonElement => $<HTMLButtonElement>('[data-guardar-espera]');
    expect(boton().disabled).toBe(true);
    expect(texto('[data-ajuste-espera] [data-motivo-desactivado]')).toBe('es el que ya rige');
    for (const malo of ['0', '2161', '', '1.5']) {
      await escribir('[data-espera-campo]', malo);
      expect(boton().disabled, malo).toBe(true);
      expect(texto('[data-ajuste-espera] [data-motivo-desactivado]'), malo).toBe('elige un número entero entre 1 y 2160');
    }
    await fireEvent.click(boton());
    expect(puts()).toEqual([]);
    expect(preguntas()).toEqual([]);
    await escribir('[data-espera-campo]', '2160');
    expect(boton().disabled).toBe(false);
  });

  it('el 409 `espera_cambio` relee el plazo que rige, dice el valor nuevo y deja lo pedido en el campo, sin guardar', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    esperaServidor = 72; // otra persona lo cambió entretanto
    await escribir('[data-espera-campo]', '720'); // alargar con el plazo leído (168): no se pregunta
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('72'));
    expect(puts().map((p) => p.cuerpo)).toEqual([{ espera_primera_trama_h: 720, anterior: 168 }]);
    expect(document.body.textContent).toContain('Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de 72 h.');
    expect($<HTMLInputElement>('[data-espera-campo]').value).toBe('720');
    ($('[data-guardar-espera]') as HTMLButtonElement).click(); // con el plazo de ahora (72), 720 vuelve a alargar: va con anterior 72
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('720'));
    expect(puts().at(-1)!.cuerpo).toEqual({ espera_primera_trama_h: 720, anterior: 72 });
  });

  it('guardar el plazo con el PUT en vuelo y cambiar de sitio: la respuesta del sitio anterior no se escribe en el nuevo', async () => {
    const r = render(AjustesSitio, { sitio: 'uct', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('168'));
    const pausa = soltable();
    retener = (metodo, ruta) => (metodo === 'PUT' && ruta === '/sitios/s1/espera-primera-trama' ? pausa.promesa : null);
    await escribir('[data-espera-campo]', '720');
    ($('[data-guardar-espera]') as HTMLButtonElement).click();
    await waitFor(() => expect(puts()).toHaveLength(1));
    await r.rerender({ sitio: 'mag', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-espera-actual]')).toBe('48'));
    pausa.soltar();
    await new Promise((x) => setTimeout(x, 50));
    expect(texto('[data-espera-actual]')).toBe('48'); // no el 720 que respondió el sitio anterior
    expect($<HTMLInputElement>('[data-espera-campo]').value).toBe('48');
    expect(document.body.textContent).not.toContain('es ahora de 720 h');
    expect($('[data-guardar-espera]').getAttribute('aria-busy')).toBeNull();
  });

  it('cada sección se ve con su acción: sin `ajustes` no hay plazo; sin `enlaces` no hay k ni tope; sin ninguna, el mensaje de quien no ajusta nada', async () => {
    await montar(persona(SITIOS, { administrador: ['leer', 'enlaces'] }));
    expect(document.querySelector('[data-seccion-primera-trama]')).toBeNull();
    expect(document.querySelector('[data-ajuste-espera]')).toBeNull();
    expect(document.querySelector('[data-seccion-vista-publica]')).toBeTruthy();
    cleanup();
    pedidas = [];
    await montar(persona(SITIOS, { administrador: ['leer', 'ajustes'] }));
    expect(document.querySelector('[data-seccion-vista-publica]')).toBeNull();
    expect(document.querySelector('[data-ajuste-minimo]')).toBeNull();
    expect(document.querySelector('[data-ajuste-espera]')).toBeTruthy();
    expect(pedidas.some((p) => p.ruta.includes('/enlaces/'))).toBe(false); // sin la acción, ni siquiera se pide
    cleanup();
    render(AjustesSitio, { sitio: 'uct', sesion: persona(SITIOS, { administrador: ['leer'] }), sitios: SITIOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(document.querySelector('[data-sin-ajustes]')).toBeTruthy());
    expect(document.querySelector('[data-ajuste-espera], [data-ajuste-minimo], [data-ajuste-tope]')).toBeNull();
  });
});

// Las pruebas del k y del tope se mudaron desde Publicar.test.ts con el mismo cuerpo (docs/16 §86: la lista de cada una).
describe('P15, el k y el tope de la vista pública (mudados desde «Publicar una vista»)', () => {
  it('bajar el k del sitio pide confirmar, dice que afecta a todos los enlaces y lo deducible; después muestra los avisos del servidor', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 3'));
    expect(texto('[data-aviso-todos]')).toBe('Este mínimo afecta a todos los enlaces públicos de este sitio.');
    await fireEvent.input($('[data-minimo-campo]'), { target: { value: '1' } });
    ($('[data-guardar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelector('[data-confirmar-minimo-aviso]')).toBeTruthy());
    expect(texto('[data-confirmar-minimo-aviso] p')).toContain('afecta a todos los enlaces públicos de este sitio');
    expect(texto('[data-confirmar-minimo-aviso] p')).toContain('es la lectura de ese equipo');
    expect(pedidas.some((p) => p.metodo === 'PUT')).toBe(false);
    ($('[data-confirmar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelectorAll('[data-aviso-minimo]')).toHaveLength(2));
    expect(pedidas.find((p) => p.metodo === 'PUT')!.cuerpo).toEqual({ minimo_dispositivos: 1, anterior: 3 });
    expect(texto('[data-minimo-actual]')).toBe('k = 1');
  });

  it('subir el k no pide confirmar; el tope se fija con su número', async () => {
    await montar();
    await waitFor(() => expect(document.querySelector('[data-tope-campo]')).toBeTruthy());
    await fireEvent.input($('[data-minimo-campo]'), { target: { value: '5' } });
    ($('[data-guardar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 5'));
    expect(document.querySelector('[data-confirmar-minimo-aviso]')).toBeNull();
    await fireEvent.input($('[data-tope-campo]'), { target: { value: '10' } });
    ($('[data-guardar-tope]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-tope-actual]')).toBe('10'));
  });

  it('bajar k con un k leído viejo: el 409 relee el que rige y pide confirmar otra vez', async () => {
    await montar();
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 3'));
    kServidor = 5; // otra persona lo subió entretanto
    await fireEvent.input($('[data-minimo-campo]'), { target: { value: '4' } });
    ($('[data-guardar-minimo]') as HTMLButtonElement).click(); // con el k leído (3), 4 no lo baja: no se pregunta
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 5'));
    expect(pedidas.filter((p) => p.metodo === 'PUT' && p.ruta.endsWith('/minimo')).map((p) => p.cuerpo)).toEqual([{ minimo_dispositivos: 4, anterior: 3 }]);
    expect(document.body.textContent).toContain('Alguien cambió el mínimo de este sitio entretanto: ahora es k = 5.');
    await waitFor(() => expect(document.querySelector('[data-confirmar-minimo-aviso]')).toBeTruthy());
    expect(texto('[data-confirmar-minimo-aviso] p')).toContain('Vas a bajar k de 5 a 4');
    ($('[data-confirmar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 4'));
    expect(pedidas.filter((p) => p.metodo === 'PUT' && p.ruta.endsWith('/minimo')).at(-1)!.cuerpo).toEqual({ minimo_dispositivos: 4, anterior: 5 });
  });

  it('el 409 `minimo_cambio` y, mientras se relee, se cambia de sitio: la relectura del sitio anterior no pisa el k, el aviso ni la confirmación del nuevo', async () => {
    const r = render(AjustesSitio, { sitio: 'uct', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 3'));
    kServidor = 5; // otra persona lo subió entretanto
    const pausa = soltable();
    retener = (metodo, ruta) => (metodo === 'GET' && ruta === '/sitios/s1/enlaces/minimo' ? pausa.promesa : null); // la relectura tras el 409
    await fireEvent.input($('[data-minimo-campo]'), { target: { value: '2' } });
    ($('[data-guardar-minimo]') as HTMLButtonElement).click(); // 2 baja el k leído (3): se confirma antes del PUT
    await waitFor(() => expect(document.querySelector('[data-confirmar-minimo]')).toBeTruthy());
    ($('[data-confirmar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect(pedidas.filter((p) => p.metodo === 'GET' && p.ruta === '/sitios/s1/enlaces/minimo')).toHaveLength(2)); // 409 y relectura en vuelo
    await r.rerender({ sitio: 'mag', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 7'));
    pausa.soltar();
    await new Promise((x) => setTimeout(x, 50));
    expect(texto('[data-minimo-actual]')).toBe('k = 7');
    expect($<HTMLInputElement>('[data-minimo-campo]').value).toBe('7'); // no el 2 pedido en el sitio anterior
    expect(document.body.textContent).not.toContain('Alguien cambió el mínimo');
    expect(document.querySelector('[data-confirmar-minimo-aviso]')).toBeNull();
  });

  it('guardar el k con el PUT en vuelo y cambiar de sitio: la respuesta del sitio anterior no se escribe en el nuevo', async () => {
    const r = render(AjustesSitio, { sitio: 'uct', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 3'));
    const pausa = soltable();
    retener = (metodo, ruta) => (metodo === 'PUT' && ruta === '/sitios/s1/enlaces/minimo' ? pausa.promesa : null);
    await fireEvent.input($('[data-minimo-campo]'), { target: { value: '5' } });
    ($('[data-guardar-minimo]') as HTMLButtonElement).click();
    await waitFor(() => expect($('[data-guardar-minimo]').getAttribute('aria-busy')).toBe('true'));
    await r.rerender({ sitio: 'mag', sesion: SESION_DOS, sitios: DOS, alCambiarVista: () => undefined });
    await waitFor(() => expect(texto('[data-minimo-actual]')).toBe('k = 7'));
    pausa.soltar();
    await new Promise((x) => setTimeout(x, 50));
    expect(texto('[data-minimo-actual]')).toBe('k = 7'); // no el 5 que respondió el sitio anterior
    expect(document.querySelector('[data-avisos-minimo]')).toBeNull();
    expect($('[data-guardar-minimo]').getAttribute('aria-busy')).toBeNull();
  });
});
