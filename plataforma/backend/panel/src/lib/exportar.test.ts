import { describe, expect, it } from 'vitest';
import { ErrorApi } from './api';
import {
  DESDE_EL_2000, ERROR_DIAS_ANTES_2000, ERROR_DIAS_FUTURO, ERROR_DIAS_ORDEN, ERROR_DIAS_VACIOS, SIN_DATOS, TEXTO_CANCELADA, TEXTO_CORTADA,
  TEXTO_EN_CURSO, TEXTO_ESTIMAR_EN_CURSO, TEXTO_ESTIMAR_LENTA, TEXTO_NO_EMPEZO, avisoDeEstimacion, avisoDeExportacion, claveDeEstimacion, esCupoLleno, diasPorOmision, lineaRetencion, nombrePorOmision, pideConfirmar, puedeExportarEn,
  rutaEstimacion, rutaExportar, sitiosQueExporta, tamano, textoConfirmar, textoDescargado, textoEstimacion, textoSinExportar, ventanaExportacion,
  type Estimacion,
} from './exportar';
import type { Sitio } from './modelo';
import type { Sesion } from './sesion';

// P8, «Exportar datos» de un sitio (docs/19 §4, R, punto 6): lo puro de la pantalla.
const Z = 'America/Santiago'; // UTC−03:00 en noviembre; el 6/9/2026 a las 00:00 pasa a 01:00 (el 00:00 no existe)
const AHORA = new Date('2026-11-19T15:00:00Z'); // 12:00 del 19/11 en el sitio
const SIN_DIAS = { desde: '', hasta: '' };
const est = (x: Partial<Estimacion> = {}): Estimacion => ({
  desde: '2026-10-20T15:00:00.000Z', hasta: '2026-11-19T15:00:00.000Z', tope_conteo: 1_000_000,
  mediciones: { filas: 45_210, supera_tope: false }, tramas: { filas: 9_044, supera_tope: false, desde: '2026-10-20T15:00:01.000Z' },
  eventos: { filas: 37, supera_tope: false }, retencion_tramas_dias: 30, bytes_aproximados: { csv: 1_234_567, xlsx: 2_000_000, json: 12_500_000 }, ...x,
});

describe('el rango: cinco opciones y «Entre fechas» en la zona del sitio', () => {
  it('los relativos terminan ahora; «Todo el historial» empieza el 1 de enero de 2000 (el piso del servidor)', () => {
    expect(ventanaExportacion('24h', AHORA, Z, SIN_DIAS)).toEqual({ desde: new Date('2026-11-18T15:00:00Z'), hasta: AHORA, error: null });
    expect(ventanaExportacion('7d', AHORA, Z, SIN_DIAS)).toEqual({ desde: new Date('2026-11-12T15:00:00Z'), hasta: AHORA, error: null });
    expect(ventanaExportacion('30d', AHORA, Z, SIN_DIAS)).toEqual({ desde: new Date('2026-10-20T15:00:00Z'), hasta: AHORA, error: null });
    expect(ventanaExportacion('todo', AHORA, Z, SIN_DIAS)).toEqual({ desde: new Date('2000-01-01T00:00:00Z'), hasta: AHORA, error: null });
  });
  it('«Entre fechas»: del 00:00 del primer día al 00:00 del día siguiente al último, en la hora del sitio (no en la del navegador)', () => {
    expect(ventanaExportacion('fechas', AHORA, Z, { desde: '2026-11-01', hasta: '2026-11-03' }))
      .toEqual({ desde: new Date('2026-11-01T03:00:00Z'), hasta: new Date('2026-11-04T03:00:00Z'), error: null });
    // Otro sitio, otra zona: los mismos días son otros instantes.
    expect(ventanaExportacion('fechas', AHORA, 'Asia/Tokyo', { desde: '2026-11-01', hasta: '2026-11-01' }))
      .toEqual({ desde: new Date('2026-10-31T15:00:00Z'), hasta: new Date('2026-11-01T15:00:00Z'), error: null });
    // Un solo día y el de hoy: llega hasta el fin de hoy (el servidor admite hasta un día en el futuro).
    expect(ventanaExportacion('fechas', AHORA, Z, { desde: '2026-11-19', hasta: '2026-11-19' }).hasta).toEqual(new Date('2026-11-20T03:00:00Z'));
  });
  it('«Entre fechas» con el cambio de hora: el día del salto dura 23 horas y el 00:00 que no existe cae en la hora siguiente', () => {
    const v = ventanaExportacion('fechas', AHORA, Z, { desde: '2026-09-06', hasta: '2026-09-06' });
    expect(v).toEqual({ desde: new Date('2026-09-06T04:00:00Z'), hasta: new Date('2026-09-07T03:00:00Z'), error: null });
    expect(v.hasta!.getTime() - v.desde!.getTime()).toBe(23 * 3_600_000);
  });
  it('«Entre fechas» que no sirven: vacíos, inexistentes, al revés, después de hoy en el sitio o antes de 2000; nunca un instante', () => {
    const malo = (desde: string, hasta: string) => ventanaExportacion('fechas', AHORA, Z, { desde, hasta });
    expect(malo('', '2026-11-03').error).toBe(ERROR_DIAS_VACIOS);
    expect(malo('2026-02-30', '2026-03-01').error).toBe(ERROR_DIAS_VACIOS);
    expect(malo('2026-11-05', '2026-11-04').error).toBe(ERROR_DIAS_ORDEN);
    expect(malo('2026-11-19', '2026-11-20').error).toBe(ERROR_DIAS_FUTURO);
    expect(malo('1999-12-31', '2000-01-02').error).toBe(ERROR_DIAS_ANTES_2000);
    expect(malo('2026-11-05', '2026-11-04')).toMatchObject({ desde: null, hasta: null });
    // «Hoy» es el del sitio: a las 23:30 del 19/11 en Santiago ya es 20/11 en UTC, y el 20/11 sigue siendo futuro allá.
    expect(ventanaExportacion('fechas', new Date('2026-11-20T02:30:00Z'), Z, { desde: '2026-11-20', hasta: '2026-11-20' }).error).toBe(ERROR_DIAS_FUTURO);
  });
  it('un sitio al este de UTC que pide desde el 1/1/2000 se acota al piso del servidor', () => {
    expect(ventanaExportacion('fechas', AHORA, 'Asia/Tokyo', { desde: '2000-01-01', hasta: '2000-01-01' }).desde).toEqual(DESDE_EL_2000);
  });
  it('los días con que abre «Entre fechas»: la última semana hasta hoy en el sitio', () => {
    expect(diasPorOmision(AHORA, Z)).toEqual({ desde: '2026-11-13', hasta: '2026-11-19' });
    expect(diasPorOmision(new Date('2026-11-20T02:30:00Z'), Z).hasta).toBe('2026-11-19');
  });
  it('rutas y clave: el sitio y el rango; los relativos no cambian de clave al correr el reloj', () => {
    const v = { desde: new Date('2026-11-01T03:00:00Z'), hasta: new Date('2026-11-04T03:00:00Z') };
    expect(rutaEstimacion('s1', v)).toBe('/sitios/s1/exportar/estimacion?desde=2026-11-01T03%3A00%3A00.000Z&hasta=2026-11-04T03%3A00%3A00.000Z');
    expect(rutaExportar('s1', 'xlsx', v)).toBe('/sitios/s1/exportar?formato=xlsx&desde=2026-11-01T03%3A00%3A00.000Z&hasta=2026-11-04T03%3A00%3A00.000Z');
    expect(rutaExportar('a/b', 'csv', v)).toMatch(/^\/sitios\/a%2Fb\/exportar\?/);
    expect(claveDeEstimacion('s1', '7d', { desde: '2026-11-01', hasta: '2026-11-02' })).toBe('s1|7d');
    expect(claveDeEstimacion('s1', 'fechas', { desde: '2026-11-01', hasta: '2026-11-02' })).toBe('s1|fechas|2026-11-01|2026-11-02');
    expect(nombrePorOmision('uct', 'csv')).toBe('sitio_uct.zip');
    expect(nombrePorOmision('uct', 'xlsx')).toBe('sitio_uct.xlsx');
    expect(nombrePorOmision('uct', 'json')).toBe('sitio_uct.json');
  });
});

describe('la estimación, la retención y la confirmación', () => {
  it('el texto: conteos con su singular, el tamaño del formato elegido y «más de» con el tope; sin filas, qué hacer', () => {
    expect(textoEstimacion(est(), 'csv')).toBe('≈ 45.210 mediciones, 9.044 tramas y 37 eventos; unos 1,2 MB en CSV.');
    expect(textoEstimacion(est(), 'json')).toBe('≈ 45.210 mediciones, 9.044 tramas y 37 eventos; unos 12,5 MB en JSON.');
    expect(textoEstimacion(est({ mediciones: { filas: 1, supera_tope: false }, tramas: { filas: 1, supera_tope: false, desde: null }, eventos: { filas: 1, supera_tope: false } }), 'xlsx'))
      .toBe('≈ 1 medición, 1 trama y 1 evento; unos 2 MB en XLSX.');
    expect(textoEstimacion(est({ mediciones: { filas: 1_000_000, supera_tope: true } }), 'csv')).toBe('más de 1.000.000 mediciones, 9.044 tramas y 37 eventos; más de 1,2 MB en CSV.');
    expect(textoEstimacion(est({ mediciones: { filas: 0, supera_tope: false }, tramas: { filas: 0, supera_tope: false, desde: null }, eventos: { filas: 0, supera_tope: false } }), 'csv')).toBe(SIN_DATOS);
  });
  it('el tamaño para personas: kB, MB con un decimal y GB', () => {
    expect(tamano(0)).toBe('0 kB');
    expect(tamano(400)).toBe('1 kB');
    expect(tamano(1_776)).toBe('2 kB');
    expect(tamano(13_700_000)).toBe('13,7 MB');
    expect(tamano(250_000_000)).toBe('250 MB');
    expect(tamano(1_340_000_000)).toBe('1,3 GB');
    expect(textoDescargado('sitio_uct_2026-10-20_2026-11-19.zip', 13_700_000)).toBe('Descargado sitio_uct_2026-10-20_2026-11-19.zip (13,7 MB).');
  });
  it('la retención de las tramas: si el rango empieza antes, desde cuándo las trae (fecha del sitio); si no hay, lo dice', () => {
    expect(lineaRetencion(est(), AHORA, Z)).toBe('Las tramas originales se guardan 30 días: este rango las trae todas.');
    // «Últimos 30 días» leído un instante después de pedirlo (la respuesta tarda): sigue dentro de la retención.
    expect(lineaRetencion(est(), new Date(AHORA.getTime() + 30_000), Z)).toBe('Las tramas originales se guardan 30 días: este rango las trae todas.');
    const antes = est({ desde: '2026-01-01T03:00:00.000Z', tramas: { filas: 9_044, supera_tope: false, desde: '2026-10-21T02:30:00.000Z' } });
    expect(lineaRetencion(antes, AHORA, Z)).toBe('Las tramas originales se guardan 30 días: de este rango, solo desde el 20/10/2026.'); // 23:30 del 20/10 en el sitio
    expect(lineaRetencion(est({ tramas: { filas: 0, supera_tope: false, desde: null } }), AHORA, Z)).toBe('Las tramas originales se guardan 30 días: este rango no trae ninguna.');
    expect(lineaRetencion(est({ retencion_tramas_dias: 1, tramas: { filas: 0, supera_tope: false, desde: null } }), AHORA, Z)).toBe('Las tramas originales se guardan 1 día: este rango no trae ninguna.');
  });
  it('confirmar sobre 250 MB del formato elegido, o con más filas que el tope (el tamaño es solo un mínimo); en el borde, no', () => {
    const grande = est({ bytes_aproximados: { csv: 13_700_000, xlsx: 24_000_000, json: 250_000_001 } });
    expect(pideConfirmar(grande, 'json')).toBe(true);
    expect(pideConfirmar(grande, 'csv')).toBe(false);
    expect(pideConfirmar(est({ bytes_aproximados: { csv: 1, xlsx: 1, json: 250_000_000 } }), 'json')).toBe(false);
    expect(pideConfirmar(est({ tramas: { filas: 1_000_000, supera_tope: true, desde: null } }), 'csv')).toBe(true);
    expect(textoConfirmar(grande, 'json')).toBe('El archivo pesaría unos 250 MB. Tu navegador arma el archivo en memoria: con un rango menor es más seguro. ¿Descargar igual?');
    expect(textoConfirmar(est({ eventos: { filas: 1_000_000, supera_tope: true } }), 'csv')).toContain('más de 1,2 MB, sin saber cuánto más');
  });
});

describe('avisos y quién exporta', () => {
  const error = (codigo: number, cuerpo: Record<string, unknown>): ErrorApi =>
    new ErrorApi(codigo, '', `HTTP ${codigo}`, typeof cuerpo.message === 'string' ? [cuerpo.message] : [], typeof cuerpo.reintentar_en_s === 'number' ? cuerpo.reintentar_en_s : null, cuerpo);
  it('el 429 del cupo se reconoce por su código, no por el texto; otro 429, cuánto esperar; el 503, el corte y la cancelación, lo suyo', () => {
    const cupo = error(429, { codigo: 'exportaciones_en_curso', message: 'un texto que el servidor puede cambiar' });
    expect(esCupoLleno(cupo)).toBe(true);
    expect(avisoDeExportacion(cupo)).toEqual({ tipo: 'espera', texto: TEXTO_EN_CURSO });
    // El texto de antes sin el código (un 429 del proxy, por ejemplo) no es el cupo; ni el código en otro estado.
    const soloTexto = error(429, { message: 'hay 2 exportaciones o estimaciones en curso; inténtalo en un momento' });
    expect(esCupoLleno(soloTexto)).toBe(false);
    expect(avisoDeExportacion(soloTexto)).toEqual({ tipo: 'espera', texto: 'Demasiados intentos: espera un momento y reintenta.' });
    expect(esCupoLleno(error(503, { codigo: 'exportaciones_en_curso' }))).toBe(false);
    expect(avisoDeExportacion(error(429, { message: 'demasiadas', reintentar_en_s: 7 }))).toEqual({ tipo: 'espera', texto: 'Demasiados intentos: espera 7 s y reintenta.' });
    expect(avisoDeExportacion(error(503, { message: 'la exportación falló antes de empezar a enviar el archivo; inténtalo en un momento' }))).toEqual({ tipo: 'espera', texto: TEXTO_NO_EMPEZO });
    expect(avisoDeExportacion(new ErrorApi(0, '', 'sin conexión')).texto).toBe('Sin conexión con el servicio: revisa tu conexión y reintenta.');
    expect(avisoDeExportacion(new TypeError('network error'))).toEqual({ tipo: 'error', texto: TEXTO_CORTADA });
    expect(avisoDeExportacion(new DOMException('cancelada', 'AbortError'))).toEqual({ tipo: 'info', texto: TEXTO_CANCELADA });
    expect(avisoDeExportacion(error(403, { message: 'tu rol en este sitio no permite la acción «exportar»' })).texto).toBe('tu rol en este sitio no permite la acción «exportar»');
  });
  it('la estimación: el cupo y el 503 en llano; lo demás, con el aviso de siempre y qué no se pudo', () => {
    expect(avisoDeEstimacion(error(429, { codigo: 'exportaciones_en_curso', message: 'x' }))).toEqual({ tipo: 'espera', texto: TEXTO_ESTIMAR_EN_CURSO });
    expect(TEXTO_ESTIMAR_EN_CURSO).toBe('No se pudo estimar ahora: hay otras exportaciones en curso. Reinténtalo en un momento.');
    expect(avisoDeEstimacion(error(503, { message: 'la estimación tardó más de 10 s: prueba con un rango más corto o en un momento' }))).toEqual({ tipo: 'espera', texto: TEXTO_ESTIMAR_LENTA });
    expect(TEXTO_ESTIMAR_LENTA).toBe('No se pudo estimar ahora: la base no respondió a tiempo. Reinténtalo en un momento o prueba con un rango más corto.');
    expect(avisoDeEstimacion(error(400, { message: 'desde debe ser anterior a hasta' }))).toEqual({ tipo: 'error', texto: 'No se pudo calcular lo que trae este rango. Revisa los datos: desde debe ser anterior a hasta.' });
    expect(avisoDeEstimacion(new ErrorApi(0, '', 'sin conexión')).texto).toBe('No se pudo calcular lo que trae este rango. Sin conexión con el servicio: revisa tu conexión y reintenta.');
  });
  const SITIOS: Sitio[] = [
    { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: Z, rol: 'administrador', zonas: [] },
    { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'consulta', zonas: [] },
    { id: 's3', codigo: 'sur', nombre: 'Sur', zona_horaria: Z, rol: 'investigador', zonas: [] },
  ];
  const MATRIZ = { administrador: ['leer', 'exportar', 'ajustes'], consulta: ['leer'], investigador: ['leer', 'exportar'], operador: ['leer', 'escribir'] };
  const persona = (administrador_sistema = false): Sesion => ({
    sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
    sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }, { sitio_id: 's2', codigo: 'mag', nombre: 'Magallanes', rol: 'consulta' }, { sitio_id: 's3', codigo: 'sur', nombre: 'Sur', rol: 'investigador' }],
    permisos: MATRIZ, administrador_sistema,
  });
  it('los sitios donde exporta: por la acción en cada uno; el administrador del sistema, todos; sin sesión decide el servidor', () => {
    expect(sitiosQueExporta(persona(), SITIOS).map((x) => x.codigo)).toEqual(['uct', 'sur']);
    expect(sitiosQueExporta(persona(true), SITIOS).map((x) => x.codigo)).toEqual(['uct', 'mag', 'sur']);
    expect(puedeExportarEn(persona(), 'ajeno')).toBe(false);
    expect(puedeExportarEn(null, 'uct')).toBe(true);
  });
  it('sin la acción, quién sí exporta, sacado de la matriz («e» ante «investigación»); con un solo perfil, en singular', () => {
    expect(textoSinExportar(MATRIZ)).toBe('Tu rol no exporta datos en ningún sitio: los exportan los perfiles de administrador e investigación. Si los necesitas, pídeselos a quien administra el tuyo.');
    expect(textoSinExportar({ administrador: ['exportar'], consulta: ['leer'] })).toBe('Tu rol no exporta datos en ningún sitio: los exporta el perfil de administrador. Si los necesitas, pídeselos a quien administra el tuyo.');
    expect(textoSinExportar({ investigador: ['exportar'], administrador: ['exportar'] })).toContain('los perfiles de investigación y administrador.');
    expect(textoSinExportar(undefined)).toBe('Tu rol no exporta datos en ningún sitio: pídeselos a quien administra el tuyo.');
  });
});
