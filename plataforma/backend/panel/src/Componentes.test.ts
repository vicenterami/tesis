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
    expect(ayuda.hidden).toBe(true);
    await fireEvent.focusIn(boton);
    expect(ayuda.hidden).toBe(false);
    await fireEvent.keyDown(boton, { key: 'Escape' });
    expect(ayuda.hidden).toBe(true);
    // jsdom calcula la descripción accesible desde aria-describedby, también con la ayuda oculta a la vista
    expect(screen.getByRole('button', { description: 'Cierra esta sesión' })).toBe(boton);
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
