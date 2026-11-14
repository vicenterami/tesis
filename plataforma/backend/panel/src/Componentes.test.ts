// @vitest-environment jsdom
import { cleanup, fireEvent, render, screen } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Aviso from './Aviso.svelte';
import Boton from './Boton.svelte';

// Regla de componentes (docs/19 §6, 08/11/2026): botón con etiqueta obligatoria, ayuda al pasar el ratón Y al enfocar con el teclado,
// enlazada con aria-describedby; cargando; motivo de desactivado visible. Aviso con su rol según el tipo.
afterEach(() => cleanup());

describe('Boton', () => {
  it('sin etiqueta de texto no se dibuja: falla en voz alta (ningún botón solo con icono)', () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(Boton, { etiqueta: '   ' })).toThrow(/etiqueta de texto es obligatoria/);
    error.mockRestore();
  });
  it('la ayuda aparece al pasar el ratón y al enfocar con el teclado, se va con Escape, y el botón la enlaza con aria-describedby', async () => {
    render(Boton, { etiqueta: 'Salir', ayuda: 'Cierra esta sesión' });
    const boton = screen.getByRole('button', { name: 'Salir' });
    const ayuda = document.getElementById(boton.getAttribute('aria-describedby')!)!;
    expect(ayuda.getAttribute('role')).toBe('tooltip');
    expect(ayuda.textContent).toBe('Cierra esta sesión');
    expect(ayuda.hidden).toBe(true);
    await fireEvent.mouseEnter(boton.parentElement!);
    expect(ayuda.hidden).toBe(false);
    await fireEvent.mouseLeave(boton.parentElement!);
    await new Promise((r) => setTimeout(r, 200)); // se va un instante después de salir (el puntero puede cruzar hasta la ayuda)
    expect(ayuda.hidden).toBe(true);
    await fireEvent.focusIn(boton);
    expect(ayuda.hidden).toBe(false);
    await fireEvent.keyDown(boton, { key: 'Escape' });
    expect(ayuda.hidden).toBe(true);
    // jsdom calcula la descripción accesible desde aria-describedby, también con la ayuda oculta a la vista
    expect(screen.getByRole('button', { description: 'Cierra esta sesión' })).toBe(boton);
  });
  it('WCAG 1.4.13 (L1e): Escape la quita aunque el foco esté en otra parte; el puntero puede pasar a la ayuda sin que se vaya; dura mientras hay foco', async () => {
    render(Boton, { etiqueta: 'Salir', ayuda: 'Cierra esta sesión' });
    const boton = screen.getByRole('button', { name: 'Salir' });
    const ayuda = document.getElementById(boton.getAttribute('aria-describedby')!)!;
    const envoltura = boton.parentElement!;
    await fireEvent.mouseEnter(envoltura);
    await fireEvent.keyDown(document.body, { key: 'Escape' }); // abierta por el puntero, con el foco en el cuerpo de la página
    expect(ayuda.hidden).toBe(true);
    await fireEvent.mouseLeave(envoltura);
    await new Promise((r) => setTimeout(r, 200));
    await fireEvent.mouseEnter(envoltura); // otra vez: el descarte valía hasta que el puntero se fue
    expect(ayuda.hidden).toBe(false);
    await fireEvent.mouseLeave(envoltura);
    // Cruza a la ayuda antes de que se vaya: la ayuda está dentro de la envoltura, así que el navegador le da `mouseenter` de nuevo.
    await fireEvent.mouseEnter(envoltura, { relatedTarget: ayuda });
    await new Promise((r) => setTimeout(r, 200));
    expect(ayuda.hidden).toBe(false);
    await fireEvent.mouseLeave(envoltura);
    await fireEvent.focusIn(boton); // con foco dura aunque el puntero se vaya
    await new Promise((r) => setTimeout(r, 200));
    expect(ayuda.hidden).toBe(false);
  });
  it('un icono va ANTES del texto, oculto al lector de pantalla; el nombre del botón sigue siendo su texto', () => {
    render(Boton, { etiqueta: 'Menú', icono: 'menu' });
    const boton = screen.getByRole('button', { name: 'Menú' });
    const svg = boton.querySelector('svg')!;
    expect(svg.getAttribute('aria-hidden')).toBe('true');
    expect(boton.firstElementChild).toBe(svg);
    expect(boton.textContent).toBe('Menú');
  });
  it('cargando: desactivado, aria-busy y la etiqueta en gerundio; el clic no llega', async () => {
    const clic = vi.fn();
    render(Boton, { etiqueta: 'Entrar', etiquetaCargando: 'Entrando…', cargando: true, onclick: clic });
    const boton = screen.getByRole('button', { name: 'Entrando…' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(boton.getAttribute('aria-busy')).toBe('true');
    boton.click(); // como un navegador: un botón desactivado no recibe el clic
    expect(clic).not.toHaveBeenCalled();
  });
  it('motivoDesactivado: desactivado y el motivo ESCRITO al lado, enlazado; sin motivo, activo y sin texto extra', () => {
    render(Boton, { etiqueta: 'Comparar (1)', motivoDesactivado: 'marca al menos 2 dispositivos' });
    const boton = screen.getByRole('button', { name: 'Comparar (1)' }) as HTMLButtonElement;
    expect(boton.disabled).toBe(true);
    expect(screen.getByText('marca al menos 2 dispositivos').id).toBe(boton.getAttribute('aria-describedby'));
    cleanup();
    render(Boton, { etiqueta: 'Comparar (2)', motivoDesactivado: null });
    expect((screen.getByRole('button', { name: 'Comparar (2)' }) as HTMLButtonElement).disabled).toBe(false);
    expect(document.querySelector('[data-motivo-desactivado]')).toBeNull();
  });
  it('los atributos de datos y el tipo llegan al botón', () => {
    render(Boton, { etiqueta: 'Entrar', tipo: 'submit', 'data-boton-entrar': '' } as never);
    const b = screen.getByRole('button', { name: 'Entrar' });
    expect(b.getAttribute('type')).toBe('submit');
    expect(b.hasAttribute('data-boton-entrar')).toBe(true);
  });
});

describe('Aviso', () => {
  it('error y conflicto se anuncian como alerta; éxito, espera e información, como estado; con acción y cierre', async () => {
    const recargar = vi.fn();
    render(Aviso, { tipo: 'conflicto', texto: 'Alguien lo cambió entretanto: recarga para ver el valor nuevo.', accion: { etiqueta: 'Recargar', alHacer: recargar } });
    expect(screen.getByRole('alert').textContent).toContain('recarga');
    await fireEvent.click(screen.getByRole('button', { name: 'Recargar' }));
    expect(recargar).toHaveBeenCalledOnce();
    cleanup();
    const cerrar = vi.fn();
    render(Aviso, { tipo: 'espera', texto: 'Demasiados intentos: espera 60 s y reintenta.', alCerrar: cerrar });
    expect(screen.getByRole('status').getAttribute('data-aviso')).toBe('espera');
    await fireEvent.click(screen.getByRole('button', { name: 'Cerrar aviso' }));
    expect(cerrar).toHaveBeenCalledOnce();
  });
});

// Piezas del tablero (docs/19 §4, tablero v2, B2), por el DOM y en los dos sentidos (correcciones del 11/11/2026).
describe('BarrasOrdenadas, Medidor y Tarjeta', () => {
  it('dos barras con el mismo nombre (el nombre no es único) se dibujan las dos, con la clave del id', async () => {
    const { default: BarrasOrdenadas } = await import('./BarrasOrdenadas.svelte');
    render(BarrasOrdenadas, { titulo: 'Entrega por dispositivo', orden: 'asc', maximo: 100, barras: [
      { id: 'd1', etiqueta: 'Nodo', valor: 40, texto: '40 %' },
      { id: 'd2', etiqueta: 'Nodo', valor: 90, texto: '90 %' },
    ] });
    expect(document.querySelectorAll('[data-barra="Nodo"]')).toHaveLength(2);
  });
  it('cada barra expone su etiqueta y su valor a un lector de pantalla, en una lista con el título; la barra queda oculta (L2c: HTML, con el texto del cuerpo)', async () => {
    const { default: BarrasOrdenadas } = await import('./BarrasOrdenadas.svelte');
    render(BarrasOrdenadas, { titulo: 'Condiciones abiertas por tipo', barras: [
      { etiqueta: 'Sin comunicación', valor: 1, texto: '1' },
      { etiqueta: 'Umbral', valor: 3, texto: '3' },
    ] });
    const lista = screen.getByRole('list', { name: 'Condiciones abiertas por tipo' });
    expect([...lista.querySelectorAll('li')].map((li) => li.textContent)).toEqual(['Umbral: 3', 'Sin comunicación: 1']);
    expect([...document.querySelectorAll('.barras .pista')].every((b) => b.getAttribute('aria-hidden') === 'true')).toBe(true);
    expect(document.querySelector('svg')).toBeNull(); // HTML: la letra no crece con el ancho de la pantalla
    expect([...document.querySelectorAll('.barras .relleno')].map((b) => (b as HTMLElement).style.width)).toEqual(['100%', '33.33333333333333%']);
    expect(screen.queryByRole('img')).toBeNull(); // ya no es una imagen con un solo nombre
  });
  it('el medidor con valor es un «meter» con aria-valuenow; sin dato, una imagen que dice «sin datos»', async () => {
    const { default: Medidor } = await import('./Medidor.svelte');
    const { unmount } = render(Medidor, { porcentaje: 92.9, etiqueta: 'Salud del sitio' });
    expect(screen.getByRole('meter', { name: 'Salud del sitio' }).getAttribute('aria-valuenow')).toBe('93');
    unmount();
    render(Medidor, { porcentaje: null, etiqueta: 'Salud del sitio' });
    expect(screen.queryByRole('meter')).toBeNull();
    expect(screen.getByRole('img', { name: 'Salud del sitio: sin datos' })).toBeTruthy();
  });
  it('la tarjeta asocia título y valor en una lista de descripción (dt/dd), no con aria-describedby sobre un span', async () => {
    const { default: Tarjeta } = await import('./Tarjeta.svelte');
    render(Tarjeta, { titulo: 'Dispositivos', valor: 1234 });
    const dl = document.querySelector('.tarjeta dl')!;
    expect(dl.querySelector('dt')!.textContent).toBe('Dispositivos');
    expect(dl.querySelector('dd')!.textContent).toBe('1.234');
    expect(document.querySelector('.tarjeta [aria-describedby]')).toBeNull();
  });
});
