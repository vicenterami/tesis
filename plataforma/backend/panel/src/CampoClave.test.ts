// @vitest-environment jsdom
import { cleanup, fireEvent, render } from '@testing-library/svelte';
import { afterEach, describe, expect, it, vi } from 'vitest';
import Entrar from './Entrar.svelte';

// «Ver lo que se escribe» (docs/19 §4, P10): el campo de clave nace oculto, «Mostrar» lo deja ver sin perder lo escrito ni el
// autocompletado, y enviar el formulario lo vuelve a ocultar.
afterEach(() => { cleanup(); vi.unstubAllGlobals(); });
const campo = (): HTMLInputElement => document.querySelector('#entrar-clave')!;
const boton = (): HTMLButtonElement => document.querySelector('[data-ver-clave]')!;

describe('campo de clave con «Mostrar»', () => {
  it('nace oculto; «Mostrar» lo deja ver y «Ocultar» lo esconde, sin perder lo escrito ni el autocompletado', async () => {
    render(Entrar, { alEntrar: () => {} });
    expect(campo().type).toBe('password');
    expect(campo().getAttribute('spellcheck')).toBe('false');
    expect(campo().getAttribute('autocapitalize')).toBe('off');
    expect(boton().textContent).toContain('Mostrar');
    expect(boton().type).toBe('button'); // no envía el formulario
    expect(boton().getAttribute('aria-pressed')).toBe('false');
    await fireEvent.input(campo(), { target: { value: 'una frase larga' } });
    await fireEvent.click(boton());
    expect(campo().type).toBe('text');
    expect(campo().value).toBe('una frase larga');
    expect(campo().getAttribute('autocomplete')).toBe('current-password');
    expect(boton().textContent).toContain('Ocultar');
    expect(boton().getAttribute('aria-pressed')).toBe('true');
    await fireEvent.click(boton());
    expect(campo().type).toBe('password');
    expect(campo().value).toBe('una frase larga');
  });

  it('al enviar el formulario la clave vuelve a quedar oculta, aunque el servidor la rechace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({ statusCode: 401, message: 'credenciales no válidas' }), { status: 401 })));
    render(Entrar, { alEntrar: () => {} });
    await fireEvent.input(document.querySelector('#entrar-email')!, { target: { value: 'ana@ejemplo.invalid' } });
    await fireEvent.input(campo(), { target: { value: 'no-es-la-clave' } });
    await fireEvent.click(boton());
    expect(campo().type).toBe('text');
    await fireEvent.submit(document.querySelector('[data-entrar]')!);
    expect(campo().type).toBe('password');
  });
});
