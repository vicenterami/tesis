import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { Catalogos, FilaEntrada, respuestaLote, validarLote } from './lote.js';

// El catálogo fijo de escenarios del alta masiva (docs/19 §4, bloque S, punto 11; panel/e2e/datos/lote-escenarios.*): las 60 filas que
// recorre el e2e en navegador real, aquí contra validarLote con catálogos falsos (sin base). Las dos filas mal formadas las deja fuera el
// panel al leer (bloque S, punto 1; lo prueba panel/src/lib/lote.test.ts): al servidor llegan 58. Lo esperado vive en el JSON, una sola vez.
const DATOS = new URL('../../panel/e2e/datos/', import.meta.url);
const ESCENARIOS = JSON.parse(readFileSync(new URL('lote-escenarios.json', DATOS), 'utf8')) as {
  prefijo: string; totales: Record<string, number>; zonas_por_nombre: { zona: string; filas: number }[];
  casos: { caso: string; n: number; resultado: string; donde: 'panel' | 'servidor'; contiene: string }[];
};

// Un lector mínimo del CSV del catálogo («;», comillas dobles con "" dentro, BOM y CRLF): el `n` de cada fila es la línea, contando las vacías.
function leer(texto: string): { n: number; celdas: string[] }[] {
  const filas: { n: number; celdas: string[] }[] = [];
  texto.replace(/^\uFEFF/, '').split(/\r?\n/).forEach((linea, i) => {
    if (linea.trim() === '') return;
    const celdas: string[] = [];
    let celda = '';
    let comillas = false;
    for (let j = 0; j < linea.length; j++) {
      const c = linea[j];
      if (comillas && c === '"' && linea[j + 1] === '"') { celda += '"'; j++; } else if (c === '"') comillas = !comillas;
      else if (c === ';' && !comillas) { celdas.push(celda); celda = ''; } else celda += c;
    }
    celdas.push(celda);
    filas.push({ n: i + 1, celdas });
  });
  return filas;
}

const S1 = '00000000-0000-4000-8000-000000000001';
const cat: Catalogos = {
  zonas: [
    { id: '00000000-0000-4000-8000-0000000000a1', nombre: 'Norte', sitio_id: S1, sitio_codigo: 'xprefijo', sitio_nombre: 'Sitio de prueba' },
    { id: '00000000-0000-4000-8000-0000000000a2', nombre: 'Galpón Sur', sitio_id: S1, sitio_codigo: 'xprefijo', sitio_nombre: 'Sitio de prueba' },
  ],
  magnitudes: new Map([
    ['temperatura', { nombre: 'Temperatura', unidad: 'Cel' }], ['humedad', { nombre: 'Humedad relativa', unidad: '%RH' }], ['presion', { nombre: 'Presión atmosférica', unidad: 'hPa' }],
    ['bateria', { nombre: 'Nivel de batería', unidad: '%EL' }], ['rssi', { nombre: 'Intensidad de señal', unidad: 'dBm' }], ['temperatura_suelo', { nombre: 'Temperatura del suelo', unidad: 'Cel' }],
  ]),
  pasarelas: [],
  existentes: new Map([['xprefijo-existe', { id: '00000000-0000-4000-8000-0000000000d1', estado: 'activo' }]]),
  idsDePasarela: new Set(),
  ajenos: new Set(['xprefijo-ajeno']),
};

describe('el catálogo fijo de escenarios contra validarLote (docs/19 §4, S11)', () => {
  const [cabecera, ...datos] = leer(readFileSync(new URL('lote-escenarios.csv', DATOS), 'utf8'));
  const delPanel = new Set(ESCENARIOS.casos.filter((c) => c.donde === 'panel').map((c) => c.n));
  const filas: FilaEntrada[] = datos.filter((d) => !delPanel.has(d.n)).map((d) => ({ n: d.n, ...Object.fromEntries((cabecera?.celdas ?? []).map((c, i) => [c, d.celdas[i] ?? ''])) }));
  const r = validarLote(filas, cat);
  const t = respuestaLote(r.informe, r.zonas);
  it('llegan 58 filas y el plan, sumado a las 2 que el panel deja fuera, da los totales del catálogo', () => {
    expect(datos).toHaveLength(ESCENARIOS.totales.leidas);
    expect(filas).toHaveLength(ESCENARIOS.totales.enviadas);
    expect([t.leidas + delPanel.size, t.validas, t.existentes, t.rechazadas + delPanel.size, t.con_aviso]).toEqual([
      ESCENARIOS.totales.leidas, ESCENARIOS.totales.valida, ESCENARIOS.totales.existe, ESCENARIOS.totales.rechazada, ESCENARIOS.totales.aviso,
    ]);
  });
  it('S3: la zona por su nombre se dice una vez por zona, con el nombre del sitio, y ninguna fila la trae como aviso', () => {
    expect(t.zonas_por_nombre).toEqual(ESCENARIOS.zonas_por_nombre.map((z) => ({ ...z, sitio: 'Sitio de prueba' })));
    expect(r.informe.filter((f) => f.avisos.some((a) => a.campo === 'zona'))).toEqual([]);
    expect(r.informe.filter((f) => f.resultado !== 'valida' && f.avisos.length > 0)).toEqual([]);
  });
  it('cada escenario decidido por el servidor da su resultado y su texto', () => {
    for (const c of ESCENARIOS.casos.filter((x) => x.donde === 'servidor')) {
      const f = r.informe.find((x) => x.n === c.n);
      const textos = [...(f?.motivos ?? []), ...(f?.avisos ?? [])].map((x) => x.texto).join(' | ');
      expect([c.caso, f?.resultado, textos.includes(c.contiene)]).toEqual([c.caso, c.resultado, true]);
    }
  });
});
