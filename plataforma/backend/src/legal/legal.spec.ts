import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { acerca, commitDeEntorno, urlCodigoFuente, versionDelPaquete } from './acerca.js';
import { INVENTARIO } from './inventario.js';
import { AVISO_SIN_RESPONSABLE, PRIVACIDAD_FECHA, PRIVACIDAD_VERSION, SECCIONES, huellaPrivacidad, plazo, privacidad, responsableDeEntorno, textoDeEntorno } from './privacidad.js';
import { formaCanonica, huella } from './huella.js';
import { INACTIVIDAD_MS, VIDA_ABSOLUTA_MS } from '../sesion/cookie.js';
import { MAX_MENSAJES, TasaSoporte, VENTANA_MS, textoDeSoporte } from './soporte.js';
import { HttpException } from '@nestjs/common';
import { LegalController } from './legal.controller.js';
import { usuarioSistema } from '../sesion/permisos.js';
import { TERMINOS_FECHA, TERMINOS_VERSION, huellaTerminos, terminos, terminosPendientes } from './terminos.js';

// Legal y acerca de (docs/21 §7; docs/19 §4, P11; docs/20 §12).

// Concordancia (regla del 23/09/2026): la página de privacidad sale del inventario de docs/21, no de un texto aparte. Desde el 18/11/2026 lo
// que viaja a la pantalla es §2.1 (texto para personas); §2 es la trazabilidad interna (tablas, funciones, variables) y no viaja. El
// arreglo del código y la tabla §2.1 deben decir lo mismo, fila por fila y celda por celda, y §2 y §2.1 deben tener las mismas filas.
const JERGA = /docs\/\d|§|\bfn_|\b[A-Z]{3,}(_[A-Z]+)+\b|\b[a-z]+_[a-z_]+\b|\b(GET|POST|PUT|DELETE) \/|\bEtapa\b|iteración|migración|\bP\d{1,2}\b|\bB\d\b|\b(RF|RNF|HU)-\d|por construir|\(pendiente\)/i;
describe('privacidad: el inventario del código es la tabla de docs/21 §2.1', () => {
  const doc = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'docs', '21-datos-personales-y-terceros.md'), 'utf8');
  const filasDe = (texto: string): string[][] =>
    // slice(1): solo la cabecera. El separador («|---|») no empieza con «| » y ya quedó fuera (corrección del 11/11/2026: con slice(2) se
    // saltaba también la primera fila, «Nombre», y la página de privacidad no la mostraba sin que la prueba lo notara).
    texto.split('\n').filter((l) => l.startsWith('| ')).slice(1).map((l) => l.trim().replace(/^\|\s*|\s*\|$/g, '').split(' | ').map((c) => c.trim()));
  const tecnica = filasDe(doc.slice(doc.indexOf('## 2. Inventario'), doc.indexOf('**Lo que no se guarda')));
  const filas = filasDe(doc.slice(doc.indexOf('### 2.1'), doc.indexOf('## 3. Terceros')));
  it('mismas filas, mismo orden, mismas celdas', () => {
    expect(filas.length).toBeGreaterThan(10);
    expect(filas[0]?.[0]).toBe('Nombre'); // la primera fila de datos también se compara
    expect(filas.at(-1)![0]).toBe('Todo lo anterior');
    expect(INVENTARIO.map((f) => [f.dato, f.donde, f.para_que, f.cuanto_tiempo, f.quien_accede])).toEqual(filas);
  });
  it('§2 (trazabilidad) y §2.1 (texto para personas) tienen las mismas filas en el mismo orden', () => {
    expect(tecnica.length).toBe(filas.length);
    expect(tecnica[0]?.[0]).toBe(filas[0]?.[0]);
    expect(tecnica.at(-1)![0]).toBe(filas.at(-1)![0]);
  });
  it('lo que viaja a la pantalla no trae jerga interna: documentos, funciones, variables, rutas de la API, fichas ni etapas', () => {
    const textos = [
      ...INVENTARIO.flatMap((f) => [f.dato, f.donde, f.para_que, f.cuanto_tiempo, f.quien_accede]),
      ...SECCIONES.flatMap((s) => [s.titulo, ...s.parrafos]),
      AVISO_SIN_RESPONSABLE,
    ];
    expect(textos.filter((t) => JERGA.test(t.replace(/__Host-sesion/g, '')) || (t.includes('`') && !t.includes('__Host-sesion')))).toEqual([]);
  });
  it('la página lleva la versión y la fecha del código y el inventario incluye la vista pública por enlace', () => {
    expect(privacidad(null)).toMatchObject({ version: PRIVACIDAD_VERSION, fecha: PRIVACIDAD_FECHA });
    expect(INVENTARIO.some((f) => f.dato.includes('vista pública por enlace'))).toBe(true);
  });
  it('sin responsable configurado, la página lo dice en vez de inventar un contacto; con él, lo muestra', () => {
    expect(privacidad(null)).toMatchObject({ responsable: null, aviso_responsable: AVISO_SIN_RESPONSABLE });
    expect(privacidad(responsableDeEntorno('Organización', 'soporte@example.org')).responsable).toEqual({ nombre: 'Organización', contacto: 'soporte@example.org' });
    expect(responsableDeEntorno('Organización', '  ')).toBeNull(); // las dos o ninguna
    expect(textoDeEntorno('linea\nnueva')).toBe('linea nueva'); // sin saltos ni caracteres de control
    expect(textoDeEntorno('x'.repeat(500))?.length).toBe(200);
  });
});

// Historial de versiones (decidido el 18/11/2026, docs/21 §7): toda actualización del texto sube su versión y su fecha. La huella del texto que
// se sirve debe ser la de la última fila de la tabla de su historial; así un cambio de una palabra, también una errata, no pasa sin versión.
// El paso 2w7 del verificador cierra el atajo que esta prueba deja: cambiar la huella de una fila ya publicada.
interface FilaHistorial { version: number; fecha: string; huella: string | null; cambio: string }
const DOC21 = readFileSync(join(import.meta.dirname, '..', '..', '..', '..', 'docs', '21-datos-personales-y-terceros.md'), 'utf8');
function filasDeHistorial(bloque: string, titulo: string): FilaHistorial[] {
  return bloque.split('\n').filter((l) => l.startsWith('| ')).slice(1).map((l) => {
    const celdas = l.trim().replace(/^\|\s*|\s*\|$/g, '').split(' | ').map((x) => x.trim());
    if (celdas.length !== 4) throw new Error(`fila mal formada en «${titulo}» (${celdas.length} celdas en vez de 4; ¿una celda trae « | »?): ${l}`);
    const [v, f, h, c] = celdas as [string, string, string, string];
    const fecha = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(f);
    if (!/^\d+$/.test(v) || !fecha || c === '' || !(h === '—' || /^`[0-9a-f]{64}`$/.test(h))) throw new Error(`fila mal formada en «${titulo}»: ${l}`);
    return { version: Number(v), fecha: `${fecha[3]}-${fecha[2]}-${fecha[1]}`, huella: h === '—' ? null : h.slice(1, -1), cambio: c };
  });
}
function historialDe(titulo: string): FilaHistorial[] {
  const ini = DOC21.indexOf(`#### ${titulo}\n`);
  if (ini < 0) throw new Error(`docs/21 §7 no tiene el apartado «${titulo}»`);
  const resto = DOC21.slice(ini + titulo.length + 6);
  const fin = resto.search(/\n(#|\*\*)/);
  return filasDeHistorial(fin < 0 ? resto : resto.slice(0, fin), titulo);
}
const QUE_HACER = 'el texto cambió: sube la versión y la fecha en el código y agrega la fila al historial de docs/21 §7';
function exigirHistorial(filas: FilaHistorial[], vigente: { version: number; fecha: string; huella: string }): void {
  expect(filas.length, 'el historial no tiene filas').toBeGreaterThan(0);
  const ultima = filas.at(-1)!;
  expect(vigente.huella, `${QUE_HACER} (huella de hoy ${vigente.huella}; la última fila, versión ${ultima.version}, dice ${ultima.huella})`).toBe(ultima.huella);
  expect(vigente.version, `la versión del código no es la de la última fila: ${QUE_HACER}`).toBe(ultima.version);
  expect(vigente.fecha, `la fecha del código no es la de la última fila: ${QUE_HACER}`).toBe(ultima.fecha);
}
function exigirOrden(filas: FilaHistorial[]): void {
  filas.forEach((f, i) => expect(f.version, `la fila ${i + 1} debe ser la versión ${i + 1}: las versiones suben de uno en uno desde 1`).toBe(i + 1));
  filas.slice(1).forEach((f, i) => expect(f.fecha >= filas[i].fecha, `la fecha de la versión ${f.version} retrocede`).toBe(true));
  const huellas = filas.map((f) => f.huella).filter((h): h is string => h !== null);
  expect(new Set(huellas).size, 'una huella se repite: dos versiones no pueden tener el mismo texto').toBe(huellas.length);
}
describe('historial de versiones (docs/21 §7)', () => {
  it('la huella de la privacidad de hoy, su versión y su fecha son los de la última fila de «Historial de la privacidad»', () => {
    exigirHistorial(historialDe('Historial de la privacidad'), { version: PRIVACIDAD_VERSION, fecha: PRIVACIDAD_FECHA, huella: huellaPrivacidad() });
  });
  it('la huella de los términos de hoy, su versión y su fecha son los de la última fila de «Historial de los términos»', () => {
    exigirHistorial(historialDe('Historial de los términos'), { version: TERMINOS_VERSION, fecha: TERMINOS_FECHA, huella: huellaTerminos() });
  });
  it('privacidad: las versiones suben de uno en uno, las fechas no retroceden y ninguna huella se repite', () => {
    exigirOrden(historialDe('Historial de la privacidad'));
  });
  it('términos: las versiones suben de uno en uno, las fechas no retroceden y ninguna huella se repite', () => {
    exigirOrden(historialDe('Historial de los términos'));
  });
  it('una fila con una celda que trae « | » (o con celdas de más o de menos) es una fila mal formada, no columnas corridas', () => {
    const cab = '| Versión | Fecha | Huella | Qué cambió |\n|---|---|---|---|\n';
    const h = `\`${'a'.repeat(64)}\``;
    expect(filasDeHistorial(`${cab}| 1 | 11/11/2026 | ${h} | Primera |\n`, 'x')).toHaveLength(1);
    expect(() => filasDeHistorial(`${cab}| 1 | 11/11/2026 | ${h} | Primera | y segunda |\n`, 'x')).toThrow(/fila mal formada/);
    expect(() => filasDeHistorial(`${cab}| 1 | 11/11/2026 | ${h} |\n`, 'x')).toThrow(/fila mal formada/);
  });
  it('el texto de las cookies sale de las constantes de la sesión: los plazos del código son los que lee la persona', () => {
    expect(plazo(30 * 60_000)).toBe('30 minutos');
    expect(plazo(8 * 3600_000)).toBe('8 horas');
    expect(plazo(60 * 60_000)).toBe('1 hora');
    const cookies = SECCIONES.find((s) => s.titulo.startsWith('Cookies'))!.parrafos.join(' ');
    expect(cookies).toContain(`vence a los ${plazo(INACTIVIDAD_MS)} sin actividad o a las ${plazo(VIDA_ABSOLUTA_MS)} de abierta`);
  });
  it('la huella rechaza lo que JSON volvería null: NaN e Infinity', () => {
    expect(() => huella({ a: Number.NaN })).toThrow(/no finito/);
    expect(() => huella({ a: [Number.POSITIVE_INFINITY] })).toThrow(/no finito/);
    expect(huella({ a: 0 })).toMatch(/^[0-9a-f]{64}$/);
  });
  it('la forma canónica ordena las claves, respeta el orden de los arreglos y la huella cambia con un solo carácter', () => {
    expect(formaCanonica({ b: [2, 1], a: 'x' })).toBe('{"a":"x","b":[2,1]}');
    expect(huella({ a: 1, b: 2 })).toBe(huella({ b: 2, a: 1 }));
    expect(huella({ a: ['x', 'y'] })).not.toBe(huella({ a: ['y', 'x'] }));
    expect(huella({ t: 'Cookies' })).not.toBe(huella({ t: 'Cookie' }));
    expect(huella({ t: 'e\u0301' })).toBe(huella({ t: '\u00e9' })); // Unicode NFC: la misma letra escrita de dos formas
    expect(huellaPrivacidad()).toMatch(/^[0-9a-f]{64}$/);
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
