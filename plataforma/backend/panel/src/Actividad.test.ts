// @vitest-environment jsdom
import { cleanup, fireEvent, render, waitFor } from '@testing-library/svelte';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Sesion } from './lib/sesion';
import { SIN_FILTROS_ACTIVIDAD } from './lib/vista';
import { ROTULO_TIPO_ACTIVIDAD, rotuloTipoActividad } from './lib/actividad';
import Actividad from './Actividad.svelte';

// P14 Actividad (docs/19 §4, tablero v2, G2) por el DOM: lista por cursor con texto para personas y filtros en la URL; tarjetas en
// teléfono; quien no administra ningún sitio no la ve.
const SITIOS = [
  { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] },
  { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'consulta', zonas: [] },
];
const sesion = (rol: 'administrador' | 'consulta'): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol }, { sitio_id: 's2', codigo: 'mag', nombre: 'Magallanes', rol: 'consulta' }],
  permisos: { administrador: ['leer', 'usuarios', 'auditoria'], consulta: ['leer'] },
});
const FILA = { instante: '2026-11-11T13:00:00Z', clase: 'evento', tipo: 'reglas_cambiadas', texto: 'cambió los umbrales de Temperatura del Invernadero', usuario: { id: 'u2', nombre: 'Bea', correo: 'bea.uno@example.org' }, dispositivo: { id: '00000000-0000-4000-8000-000000000001', nombre: 'Invernadero' } };
const ACCESO = { instante: '2026-11-11T12:00:00Z', clase: 'acceso', tipo: 'ok', texto: 'entró al sistema', usuario: { id: 'u3', nombre: 'Bea', correo: 'bea.dos@example.org' }, dispositivo: null };
let peticiones: string[] = [];
let angosto = false;

beforeEach(() => {
  peticiones = [];
  angosto = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: angosto && q.includes('700px'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta === '/usuarios') return new Response(JSON.stringify([{ id: 'u2', nombre: 'Bea', email: 'bea.uno@example.org', sitios: [{ sitio_id: 's1' }] }, { id: 'u3', nombre: 'Bea', email: 'bea.dos@example.org', sitios: [{ sitio_id: 's1' }] }, { id: 'u9', nombre: 'De otro sitio', email: 'otro@example.org', sitios: [{ sitio_id: 's2' }] }]));
    if (ruta.startsWith('/sitios/s1/actividad')) {
      return ruta.includes('cursor=') ? new Response(JSON.stringify([ACCESO])) : new Response(JSON.stringify([FILA]), { headers: { 'X-Siguiente': 'c2' } });
    }
    return new Response('{}', { status: 404 });
  }));
});
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });

describe('P14 Actividad', () => {
  it('solo los sitios que administra; quién y qué en texto para personas; «Más antiguos» por cursor; un filtro va a la URL', async () => {
    const vistas: string[] = [];
    render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('administrador'), sitios: SITIOS, alCambiarVista: (f: string) => vistas.push(f) });
    await waitFor(() => expect(document.querySelectorAll('[data-fila-actividad]')).toHaveLength(1));
    expect(peticiones[0]).toBe('/sitios/s1/actividad?limite=50');
    expect(document.querySelector('[data-filtro-sitio]')).toBeNull(); // administra uno solo: Magallanes es de consulta
    expect(document.querySelector('[data-fila-actividad]')!.textContent).toContain('Bea');
    expect(document.querySelector('[data-fila-actividad]')!.textContent).toContain('cambió los umbrales de Temperatura del Invernadero');
    expect(document.querySelector('[data-fila-actividad] a')!.getAttribute('href')).toMatch(/^#\/dispositivos\/00000000-0000-4000-8000-000000000001\?/);
    (document.querySelector('[data-actividad-mas]') as HTMLButtonElement).click();
    await waitFor(() => expect(document.querySelectorAll('[data-fila-actividad]')).toHaveLength(2));
    expect(peticiones.at(-1)).toBe('/sitios/s1/actividad?cursor=c2&limite=50');
    expect(document.querySelector('[data-actividad-mas]')).toBeNull(); // sin cursor, no hay más
    expect([...(document.querySelector('[data-filtro-persona]') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['todas', 'Bea — bea.uno@example.org', 'Bea — bea.dos@example.org']); // dos «Bea»: se distinguen por el correo
    const tipo = document.querySelector('[data-filtro-tipo]') as HTMLSelectElement;
    expect([...tipo.options].map((o) => o.textContent)).toEqual(['todos', 'Entradas', 'Cambios de umbrales']);
    tipo.value = 'ok';
    await fireEvent.change(tipo);
    expect(vistas.at(-1)).toBe('#/actividad?sitio=uct&tipo=ok');
  });

  it('los rótulos del filtro son los de los códigos reales del servidor (eventos y resultados de acceso)', () => {
    const reales = ['ok', 'cierre', 'bloqueado', 'clave_incorrecta', 'inactivo', 'alta', 'baja', 'rotacion', 'reglas_cambiadas', 'dispositivo_configurado',
      'canal_calibrado', 'condicion_abierta', 'condicion_cerrada', 'pasarela_alta', 'pasarela_baja', 'pasarela_rotacion', 'usuario_alta', 'usuario_cambio',
      'usuario_baja', 'usuario_clave', 'terminos_aceptados', 'espera_primera_trama', 'sitio_alta', 'sitio_cambio', 'zona_alta', 'zona_cambio'];
    expect(Object.keys(ROTULO_TIPO_ACTIVIDAD).sort()).toEqual([...reales].sort());
    expect(rotuloTipoActividad('ok')).toBe('Entradas');
    expect(rotuloTipoActividad('cierre')).toBe('Salidas');
    expect(rotuloTipoActividad('tipo_futuro')).toBe('tipo futuro');
  });

  it('sitios y zonas (docs/19 §4, U): sus cuatro tipos tienen rótulo en el filtro y su frase, escrita por el servidor, se ve tal cual', async () => {
    const filas = [
      { tipo: 'sitio_alta', texto: 'creó el sitio «Sede Norte»' }, { tipo: 'sitio_cambio', texto: 'cambió el nombre del sitio «Sede Norte» a «Sede Sur»' },
      { tipo: 'zona_alta', texto: 'creó la zona «Patio» al dar de alta por lote' }, { tipo: 'zona_cambio', texto: 'retiró la zona «Patio»' },
    ].map((x, i) => ({ instante: `2026-11-24T1${i}:00:00Z`, clase: 'evento', usuario: null, dispositivo: null, ...x }));
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      if (ruta === '/usuarios') return new Response('[]');
      return new Response(JSON.stringify(filas));
    }));
    render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelectorAll('[data-fila-actividad]')).toHaveLength(4));
    const texto = document.body.textContent ?? '';
    for (const f of filas) expect(texto).toContain(f.texto);
    const tipo = document.querySelector('[data-filtro-tipo]') as HTMLSelectElement;
    expect([...tipo.options].map((o) => o.textContent)).toEqual(['todos', 'Sitios creados', 'Cambios de sitios', 'Zonas creadas', 'Cambios de zonas (nombre, retirada)']);
  });

  it('en teléfono, tarjetas (sin tabla); sin sitios que administre, lo dice y no pide nada', async () => {
    angosto = true;
    render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect(document.querySelector('[data-tarjetas-actividad]')).toBeTruthy());
    expect(document.querySelector('table')).toBeNull();
    cleanup();
    peticiones = [];
    render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('consulta'), sitios: SITIOS });
    expect(document.querySelector('[data-sin-actividad]')).toBeTruthy();
    expect(peticiones.filter((p) => p.includes('/actividad'))).toEqual([]);
  });

  it('dos personas con el mismo nombre se distinguen por el correo, con el nombre y el correo en su propio elemento, en la tabla y en las tarjetas; la cuenta anonimizada, solo su marcador; lo del sistema, sin persona', async () => {
    const ANONIMA = { ...ACCESO, usuario: { id: 'u4', nombre: 'Cuenta dada de baja · 3f2a', correo: null } };
    const SISTEMA = { ...FILA, usuario: null };
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      if (ruta === '/usuarios') return new Response('[]');
      return new Response(JSON.stringify([FILA, ACCESO, ANONIMA, SISTEMA]));
    }));
    for (const estrecho of [false, true]) {
      angosto = estrecho;
      render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('administrador'), sitios: SITIOS });
      await waitFor(() => expect(document.querySelectorAll('[data-fila-actividad]')).toHaveLength(4));
      const filas = [...document.querySelectorAll('[data-fila-actividad]')];
      const personas = filas.map((f) => f.querySelector('[data-persona]'));
      expect(personas.map((p) => p?.querySelector('[data-persona-correo]')?.textContent ?? null), estrecho ? 'tarjetas' : 'tabla').toEqual(['bea.uno@example.org', 'bea.dos@example.org', null, null]);
      expect(personas.slice(0, 2).map((p) => (p!.textContent ?? '').replace(/\s+/g, ' ').trim())).toEqual(['Bea bea.uno@example.org', 'Bea bea.dos@example.org']);
      expect(personas[2]!.textContent).toBe('Cuenta dada de baja · 3f2a'); // sin correo: solo el marcador
      expect(personas[3]).toBeNull(); // el sistema: ninguna persona, el texto de reemplazo
      expect(filas[3]!.textContent).toContain('el sistema');
      cleanup();
    }
  });

  it('el filtro «Persona» no escribe el correo de una cuenta anonimizada (solo su marcador), aunque /usuarios lo traiga', async () => {
    vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
      peticiones.push(ruta);
      if (ruta === '/usuarios') return new Response(JSON.stringify([
        { id: 'u2', nombre: 'Bea', email: 'bea.uno@example.org', anonimizado: false, sitios: [{ sitio_id: 's1' }] },
        { id: 'u4', nombre: 'Cuenta dada de baja · 3f2a', email: 'baja-x@cuenta-anonimizada.invalid', anonimizado: true, sitios: [{ sitio_id: 's1' }] },
      ]));
      return new Response('[]');
    }));
    render(Actividad, { filtros: SIN_FILTROS_ACTIVIDAD, sesion: sesion('administrador'), sitios: SITIOS });
    await waitFor(() => expect((document.querySelector('[data-filtro-persona]') as HTMLSelectElement).options).toHaveLength(3));
    expect([...(document.querySelector('[data-filtro-persona]') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['todas', 'Bea — bea.uno@example.org', 'Cuenta dada de baja · 3f2a']);
  });
});
