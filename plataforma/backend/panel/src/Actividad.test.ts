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
const FILA = { instante: '2026-11-11T13:00:00Z', clase: 'evento', tipo: 'reglas_cambiadas', texto: 'cambió los umbrales de Temperatura del Invernadero', usuario: { id: 'u2', nombre: 'Bea' }, dispositivo: { id: '00000000-0000-4000-8000-000000000001', nombre: 'Invernadero' } };
const ACCESO = { instante: '2026-11-11T12:00:00Z', clase: 'acceso', tipo: 'ok', texto: 'entró al sistema', usuario: { id: 'u2', nombre: 'Bea' }, dispositivo: null };
let peticiones: string[] = [];
let angosto = false;

beforeEach(() => {
  peticiones = [];
  angosto = false;
  vi.stubGlobal('matchMedia', (q: string) => ({ matches: angosto && q.includes('700px'), addEventListener() {}, removeEventListener() {} }));
  vi.stubGlobal('fetch', vi.fn(async (ruta: string) => {
    peticiones.push(ruta);
    if (ruta === '/usuarios') return new Response(JSON.stringify([{ id: 'u2', nombre: 'Bea', sitios: [{ sitio_id: 's1' }] }, { id: 'u9', nombre: 'De otro sitio', sitios: [{ sitio_id: 's2' }] }]));
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
    expect([...(document.querySelector('[data-filtro-persona]') as HTMLSelectElement).options].map((o) => o.textContent)).toEqual(['todas', 'Bea']);
    const tipo = document.querySelector('[data-filtro-tipo]') as HTMLSelectElement;
    expect([...tipo.options].map((o) => o.textContent)).toEqual(['todos', 'Entradas', 'Cambios de umbrales']);
    tipo.value = 'ok';
    await fireEvent.change(tipo);
    expect(vistas.at(-1)).toBe('#/actividad?sitio=uct&tipo=ok');
  });

  it('los rótulos del filtro son los de los códigos reales del servidor (eventos y resultados de acceso)', () => {
    const reales = ['ok', 'cierre', 'bloqueado', 'clave_incorrecta', 'inactivo', 'alta', 'baja', 'rotacion', 'reglas_cambiadas', 'dispositivo_configurado',
      'canal_calibrado', 'condicion_abierta', 'condicion_cerrada', 'pasarela_alta', 'pasarela_baja', 'pasarela_rotacion', 'usuario_alta', 'usuario_cambio',
      'usuario_baja', 'usuario_clave', 'terminos_aceptados'];
    expect(Object.keys(ROTULO_TIPO_ACTIVIDAD).sort()).toEqual([...reales].sort());
    expect(rotuloTipoActividad('ok')).toBe('Entradas');
    expect(rotuloTipoActividad('cierre')).toBe('Salidas');
    expect(rotuloTipoActividad('tipo_futuro')).toBe('tipo futuro');
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
});
