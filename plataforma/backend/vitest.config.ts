import { defineConfig } from 'vitest/config';

// Pruebas unitarias del backend (`pnpm test`): los *.spec.ts junto al código, en Node, sin base ni broker. Sin globales:
// cada archivo importa de 'vitest' lo que usa (describe, it, expect, vi…). El panel tiene su propia configuración.
// Vite transforma el TypeScript con oxc, que lee experimentalDecorators y emitDecoratorMetadata de tsconfig.json: la
// metadata de los constructores existe también en las pruebas (tiempo-real/eventos.spec.ts arma un módulo de Nest con ella).
export default defineConfig({
  test: {
    include: ['src/**/*.spec.ts'],
    environment: 'node',
    globals: false,
    // La misma zona que el proceso real (zona-utc.ts; docs/13): el resultado no depende de la zona del equipo donde corren.
    env: { TZ: 'UTC' },
  },
});
