import { describe, expect, it, vi } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import type { ExecutionContext } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Reflector } from '@nestjs/core';
import { GuardiaCentral } from '../sesion/guardia.js';
import { usuarioSistema } from '../sesion/permisos.js';
import type { SesionService } from '../sesion/sesion.service.js';
import { CABECERA_ENLACE, generarToken } from './publico.js';

// Aislamiento del token (docs/19 §4, O, puntos 6 y 13; docs/20 §5): con un X-Enlace-Publico válido, ninguna otra ruta cambia su respuesta,
// porque nada fuera de GET /publico lee esa cabecera. Tres comprobaciones que fallan si alguien la lee en otra parte (falla plantada: una
// ruta que la lea).
const SRC = join(import.meta.dirname, '..');
function archivos(dir: string): string[] {
  return readdirSync(dir).flatMap((n) => {
    const p = join(dir, n);
    return statSync(p).isDirectory() ? archivos(p) : p.endsWith('.ts') && !p.endsWith('.spec.ts') ? [p] : [];
  });
}

describe('solo GET /publico lee la cabecera del token', () => {
  it('en el código, el nombre de la cabecera vive en publico.ts y solo publico.controller.ts lo usa', () => {
    const fuentes = archivos(SRC);
    expect(fuentes.length).toBeGreaterThan(50); // revisó el árbol, no una carpeta vacía
    // Sin los comentarios (la guardia la nombra en uno para decir que NO la lee): cuenta solo el código.
    const codigo = (f: string): string => readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|\s)\/\/.*$/gm, '$1');
    const nombran = fuentes.filter((f) => /x-enlace-publico/i.test(codigo(f))).map((f) => relative(SRC, f));
    const usan = fuentes.filter((f) => /\bCABECERA_ENLACE\b/.test(codigo(f))).map((f) => relative(SRC, f)).sort();
    // publico.controller.ts la nombra en la documentación del OpenAPI (ApiHeader); publico.ts la define.
    expect(nombran.sort()).toEqual(['publico/publico.controller.ts', 'publico/publico.ts']);
    expect(usan).toEqual(['publico/publico.controller.ts', 'publico/publico.ts']);
  });
  it('en el contrato servido (openapi.json), la única operación que declara X-Enlace-Publico es GET /publico', () => {
    const doc = JSON.parse(readFileSync(join(SRC, '..', 'openapi.json'), 'utf8')) as { paths: Record<string, Record<string, { parameters?: { in: string; name: string }[] }>> };
    const declaran = Object.entries(doc.paths).flatMap(([ruta, ops]) => Object.entries(ops)
      .filter(([, op]) => (op.parameters ?? []).some((p) => p.in === 'header' && p.name.toLowerCase() === CABECERA_ENLACE))
      .map(([metodo]) => `${metodo.toUpperCase()} ${ruta}`));
    expect(Object.keys(doc.paths).length).toBeGreaterThan(30);
    expect(declaran).toEqual(['GET /publico']);
  });
  it('la guardia central no la lee: sin cookie, la misma 401 con y sin el token; con cookie, la misma sesión', async () => {
    const cargar = vi.fn((_identificador: string) => Promise.resolve(usuarioSistema()));
    const guardia = new GuardiaCentral(new Reflector(), { cargar } as unknown as SesionService, { get: () => undefined } as unknown as ConfigService);
    class Rutas { privada(): void { /* ruta con guardia */ } }
    const pedir = async (headers: Record<string, string>) => {
      const req: Record<string, unknown> = { method: 'GET', path: '/dispositivos', headers };
      const ctx = {
        // eslint-disable-next-line @typescript-eslint/unbound-method
        getType: () => 'http', getHandler: () => Rutas.prototype.privada, getClass: () => Rutas,
        switchToHttp: () => ({ getRequest: () => req, getResponse: () => ({ setHeader: vi.fn() }) }),
      } as unknown as ExecutionContext;
      try {
        await guardia.canActivate(ctx);
        return { ok: true, usuario: req.usuario };
      } catch (e) {
        return { ok: false, error: JSON.stringify((e as { getResponse(): unknown }).getResponse()) };
      }
    };
    const token = generarToken();
    expect(await pedir({ [CABECERA_ENLACE]: token })).toEqual(await pedir({}));
    expect((await pedir({ [CABECERA_ENLACE]: token })).ok).toBe(false);
    expect(cargar).not.toHaveBeenCalled();
    const cookie = `__Host-sesion=${'B'.repeat(43)}`;
    expect(await pedir({ cookie, [CABECERA_ENLACE]: token })).toEqual(await pedir({ cookie }));
    expect(cargar.mock.calls.every((c) => String(c[0]) === 'B'.repeat(43))).toBe(true);
  });
});
