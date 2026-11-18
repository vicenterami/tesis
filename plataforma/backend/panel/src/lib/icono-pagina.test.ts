import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// Icono de la pestaña (18/11/2026): el navegador pide `/favicon.ico` a la raíz si la página no declara otro; el panel lo sirve el backend
// solo bajo /panel/, así que esa petición daba 404. index.html enlaza un SVG propio de `public/`, que Vite copia con la base /panel/.
// Esta prueba falla si el enlace falta o si apunta a un archivo que no existe (y el navegador volvería a pedir /favicon.ico).
const RAIZ = join(import.meta.dirname, '..', '..');
const html = readFileSync(join(RAIZ, 'index.html'), 'utf8');

describe('icono de la página', () => {
  it('index.html enlaza un icono y el archivo existe en public/ y es un SVG', () => {
    const enlace = /<link\s[^>]*rel="icon"[^>]*>/.exec(html)?.[0];
    expect(enlace).toBeDefined();
    const href = /href="([^"]+)"/.exec(enlace ?? '')?.[1];
    expect(href).toMatch(/^\/[\w.-]+\.svg$/); // ruta de public/ (Vite la publica bajo la base); nada de otro origen
    const archivo = join(RAIZ, 'public', (href ?? '').slice(1));
    expect(existsSync(archivo)).toBe(true);
    expect(readFileSync(archivo, 'utf8')).toMatch(/^<svg\s[^>]*xmlns="http:\/\/www\.w3\.org\/2000\/svg"/);
  });
});
