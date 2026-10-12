import { svelte } from '@sveltejs/vite-plugin-svelte';
import { svelteTesting } from '@testing-library/svelte/vite';
import { defineConfig } from 'vitest/config';

// Panel del sistema (docs/19). En producción lo sirve el backend bajo /panel (docs/10 §8.4): por eso `base`. En
// desarrollo, Vite atiende en 5173 y REENVÍA la API y el canal en vivo al backend (docs/11 §3): el navegador ve un solo
// origen y no hace falta CORS en ningún ambiente. `changeOrigin` queda en falso (su valor por defecto) a propósito: el
// backend recibe `Host: localhost:5173`, que está en su lista de nombres (docs/10 §8.4 punto 40) y es lo que compara con
// `Origin` en el canal en vivo (docs/10 §5). Que el reenvío conserve el Host y no retenga los eventos se comprueba con
// `pruebas/panel-desarrollo.sh` (docs/16 §16).
const BACKEND = process.env.PANEL_BACKEND ?? 'http://127.0.0.1:3000';
// Las rutas reales de la API (openapi.json) y la documentación; todo lo demás lo atiende Vite.
const RUTAS_API = ['/dispositivos', '/canales', '/condiciones', '/cuarentena', '/eventos', '/salud', '/docs'];

export default defineConfig({
  base: '/panel/',
  // svelteTesting: en las pruebas, Vitest debe resolver la versión de NAVEGADOR de Svelte (sin él carga la de servidor y
  // onMount no existe); también limpia el DOM entre pruebas.
  plugins: [svelte(), svelteTesting()],
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: false }, // sin .map publicados (docs/11 §3)
  server: {
    host: '127.0.0.1',
    port: 5173,
    strictPort: true,
    proxy: Object.fromEntries(RUTAS_API.map((ruta) => [ruta, { target: BACKEND, changeOrigin: false }])),
  },
  test: { include: ['src/**/*.test.ts'], environment: 'node' },
});
