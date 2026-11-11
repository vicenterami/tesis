import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acerca, commitDeEntorno, urlCodigoFuente, versionDelPaquete } from './acerca.js';
import { INVENTARIO } from './inventario.js';
import { AVISO_SIN_RESPONSABLE, privacidad, responsableDeEntorno, textoDeEntorno } from './privacidad.js';
import { MAX_MENSAJES, TasaSoporte, VENTANA_MS, textoDeSoporte } from './soporte.js';
import { HttpException } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { usuarioSistema } from '../sesion/permisos.js';
import { TERMINOS_VERSION, terminos, terminosPendientes } from './terminos.js';

// Legal y acerca de (docs/21 §7; docs/19 §4, P11; docs/20 §12).

// Concordancia (regla del 23/09/2026): la página de privacidad sale del inventario de docs/21 §2, no de un texto aparte. La tabla del
// documento y el arreglo del código deben decir lo mismo, fila por fila y celda por celda.
describe('privacidad: el inventario del código es la tabla de docs/21 §2', () => {
  const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'docs', '21-datos-personales-y-terceros.md'), 'utf8');
  const seccion = doc.slice(doc.indexOf('## 2. Inventario'), doc.indexOf('**Lo que no se guarda'));
  // slice(1): solo la cabecera. El separador («|---|») no empieza con «| » y ya quedó fuera (corrección del 11/11/2026: con slice(2) se
  // saltaba también la primera fila, «Nombre», y la página de privacidad no la mostraba sin que la prueba lo notara).
  const filas = seccion.split('\n').filter((l) => l.startsWith('| ')).slice(1).map((l) => l.trim().replace(/^\|\s*|\s*\|$/g, '').split(' | ').map((c) => c.trim()));
  it('mismas filas, mismo orden, mismas celdas', () => {
    expect(filas.length).toBeGreaterThan(10);
    expect(filas[0]?.[0]).toBe('Nombre'); // la primera fila de datos también se compara
    expect(filas.at(-1)![0]).toBe('Todo lo anterior');
    expect(INVENTARIO.map((f) => [f.dato, f.donde, f.para_que, f.cuanto_tiempo, f.quien_accede])).toEqual(filas);
  });
  it('sin responsable configurado, la página lo dice en vez de inventar un contacto; con él, lo muestra', () => {
    expect(privacidad(null)).toMatchObject({ responsable: null, aviso_responsable: AVISO_SIN_RESPONSABLE });
    expect(privacidad(responsableDeEntorno('Organización', 'soporte@example.org')).responsable).toEqual({ nombre: 'Organización', contacto: 'soporte@example.org' });
    expect(responsableDeEntorno('Organización', '  ')).toBeNull(); // las dos o ninguna
    expect(textoDeEntorno('linea\nnueva')).toBe('linea nueva'); // sin saltos ni caracteres de control
    expect(textoDeEntorno('x'.repeat(500))?.length).toBe(200);
  });
});

describe('términos de uso', () => {
  it('la versión vigente es un entero ≥ 1 con fecha y texto; pendiente si no aceptó ninguna o una menor', () => {
    expect(terminos()).toMatchObject({ version: TERMINOS_VERSION });
    expect(TERMINOS_VERSION).toBeGreaterThanOrEqual(1);
    expect(terminosPendientes(null)).toBe(true);
    expect(terminosPendientes(TERMINOS_VERSION - 1)).toBe(true);
    expect(terminosPendientes(TERMINOS_VERSION)).toBe(false);
    expect(terminosPendientes(1, 2)).toBe(true); // subir la versión vuelve a restringir
  });
  it('sin datos personales ni correos en el texto', () => {
    expect(terminos().texto).not.toMatch(/@|\b\d{1,3}(\.\d{1,3}){3}\b/);
  });
});

describe('acerca de', () => {
  it('la versión sale del package.json del backend', () => {
    const pkg = JSON.parse(readFileSync(join(import.meta.dirname, '..', '..', 'package.json'), 'utf8')) as { version: string };
    expect(versionDelPaquete()).toBe(pkg.version);
    expect(acerca(null, null)).toMatchObject({ version: pkg.version, commit: null, licencia: 'AGPL-3.0-only', avisos_terceros: '/panel/avisos-de-terceros.txt' });
  });
  it('GET /acerca sin sesión: licencia, aviso y código fuente sí; versión y commit, null; con sesión, los dos (revisión del 11/11/2026)', async () => {
    const config = { get: (k: string) => ({ COMPILACION_COMMIT: 'abcdef1234567', CODIGO_FUENTE_URL: 'https://example.org/codigo' } as Record<string, string>)[k] };
    const BUENA = 'b'.repeat(43), MALA = 'm'.repeat(43); // la forma de un identificador (cookie.ts)
    const sesiones = { cargar: (id: string) => Promise.resolve(id === BUENA ? { id: 'ana' } : null) };
    const c = new LegalController({} as never, config as never, sesiones as never);
    const sin = await c.leerAcerca({ headers: {} } as never);
    expect(sin).toMatchObject({ version: null, commit: null, licencia: 'AGPL-3.0-only', codigo_fuente: 'https://example.org/codigo' });
    expect(sin.aviso_licencia).toContain('https://example.org/codigo');
    expect(await c.leerAcerca({ headers: { cookie: `__Host-sesion=${MALA}` } } as never)).toMatchObject({ version: null, commit: null });
    expect(await c.leerAcerca({ headers: { cookie: `__Host-sesion=${BUENA}` } } as never)).toMatchObject({ version: versionDelPaquete(), commit: 'abcdef123456' });
  });
  it('commit: solo un hash hexadecimal (7–40), acortado a 12; cualquier otro texto se ignora', () => {
    expect(commitDeEntorno('ABCDEF1234567890')).toBe('abcdef123456');
    expect(commitDeEntorno('<script>')).toBeNull();
    expect(commitDeEntorno(undefined)).toBeNull();
  });
  it('código fuente: solo https sin credenciales; sin él, el aviso dice que se pida al responsable', () => {
    expect(urlCodigoFuente('https://example.org/codigo')).toBe('https://example.org/codigo');
    expect(urlCodigoFuente('http://example.org/codigo')).toBeNull();
    expect(urlCodigoFuente('https://u:p@example.org/')).toBeNull();
    expect(acerca(null, null).aviso_licencia).toMatch(/pídelo al responsable/);
  });
});

describe('soporte: texto y límite de tasa por persona', () => {
  it('texto de 1 a 2 000 caracteres, sin campos de más', () => {
    expect(textoDeSoporte({ texto: '  hola  ' })).toEqual({ texto: 'hola' });
    expect(textoDeSoporte({ texto: ' ' })).toEqual({ motivos: ['texto debe tener entre 1 y 2000 caracteres'] });
    expect(textoDeSoporte({ texto: 'x'.repeat(2001) })).toEqual({ motivos: ['texto debe tener entre 1 y 2000 caracteres'] });
    expect(textoDeSoporte({ texto: 'hola', adjunto: 'x' })).toEqual({ motivos: ['campo no admitido: adjunto'] });
  });
  it(`${MAX_MENSAJES} por hora; el siguiente espera hasta que el primero salga de la ventana; otra persona no se ve afectada`, () => {
    let t = 0;
    const tasa = new TasaSoporte(() => t);
    for (let i = 0; i < MAX_MENSAJES; i++) { expect(tasa.espera('ana')).toBe(0); expect(tasa.intentar('ana')).toBe(0); t += 1000; }
    expect(tasa.espera('ana')).toBe(VENTANA_MS - MAX_MENSAJES * 1000);
    expect(tasa.espera('beto')).toBe(0);
    t = VENTANA_MS;
    expect(tasa.espera('ana')).toBe(0);
  });
  it('ráfaga concurrente (revisión del 11/11/2026): 20 envíos simultáneos con un INSERT lento → solo 5 llegan a la base; los demás, 429', async () => {
    const inserts: string[] = [];
    const pool = { query: async (sql: string) => { await new Promise((r) => setTimeout(r, 20)); inserts.push(sql); return { rows: [{ id: 'm', creado_en: 'x' }] }; } };
    const config = { get: () => undefined };
    const c = new LegalController(pool as never, config as never, {} as never);
    const ana = { ...usuarioSistema(), id: 'ana', sistema: false, todos: false };
    const r = await Promise.allSettled(Array.from({ length: 20 }, () => c.enviar(ana, { texto: 'hola' })));
    expect(r.filter((x) => x.status === 'fulfilled')).toHaveLength(MAX_MENSAJES);
    expect(r.filter((x) => x.status === 'rejected' && (x.reason as HttpException).getStatus() === 429)).toHaveLength(20 - MAX_MENSAJES);
    expect(inserts).toHaveLength(MAX_MENSAJES);
  });
  it('si el INSERT falla, el cupo vuelve (no se envió nada)', async () => {
    let falla = true;
    const pool = { query: () => (falla ? Promise.reject(new Error('base caída')) : Promise.resolve({ rows: [{ id: 'm', creado_en: 'x' }] })) };
    const c = new LegalController(pool as never, { get: () => undefined } as never, {} as never);
    const ana = { ...usuarioSistema(), id: 'ana', sistema: false, todos: false };
    for (let i = 0; i < MAX_MENSAJES; i++) await expect(c.enviar(ana, { texto: 'hola' })).rejects.toThrow('base caída');
    falla = false;
    await expect(c.enviar(ana, { texto: 'hola' })).resolves.toMatchObject({ id: 'm' });
  });
});
