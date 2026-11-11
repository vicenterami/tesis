import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import { SQL_ESTADO_VISUAL, TIPOS_ALERTA, alinear, codificarCursor, entrega, estadoVisual, filtroInventario, intervaloParaRango, leerCursor, patronBusqueda, siguiente } from './tablero.js';
import { INTERVALOS, SEGUNDOS_INTERVALO } from './validacion.js';
import { MAX_ENTREGA_RESUMEN, diasRetencionTrama, entregasDelResumen } from './tablero.service.js';
import { MAX_DIAS_SITIO, ventana } from './sitios.controller.js';

// Estado visual en el servidor (docs/19 §2; docs/10 §8.4 punto 65 ii): los mismos cuatro casos y el orden entre filas que prueba
// estadoVisual() del panel (panel/src/lib/estado-visual.test.ts). Dos implementaciones de una sola regla, probadas con los mismos casos.
describe('estadoVisual (servidor): la primera regla que aplica manda', () => {
  it('mantenimiento o baja → inactivo, aunque tenga condiciones abiertas o esté fuera de línea', () => {
    expect(estadoVisual('mantenimiento', false, ['umbral'])).toBe('inactivo');
    expect(estadoVisual('baja', true, [])).toBe('inactivo');
  });
  it('sin_comunicacion abierta, o fuera de línea → sin_senal, antes que alerta', () => {
    expect(estadoVisual('activo', true, ['sin_comunicacion', 'umbral'])).toBe('sin_senal');
    expect(estadoVisual('activo', false, [])).toBe('sin_senal');
  });
  it('umbral, bateria, manipulacion, tope_superado o reloj_desviado abiertas, en línea → alerta', () => {
    for (const t of ['umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado']) expect(estadoVisual('activo', true, [t])).toBe('alerta');
  });
  it('activo, en línea y sin condiciones → normal; sin tramas aún (null) también', () => {
    expect(estadoVisual('activo', true, [])).toBe('normal');
    expect(estadoVisual('activo', null, [])).toBe('normal');
  });
  it('la versión SQL tiene las mismas ramas en el mismo orden, y `en_linea` nulo no cuenta como fuera de línea (IS FALSE)', () => {
    const sql = SQL_ESTADO_VISUAL.replace(/\s+/g, ' ');
    const orden = ["THEN 'inactivo'", "THEN 'sin_senal'", "THEN 'alerta'", "ELSE 'normal'"].map((x) => sql.indexOf(x));
    expect(orden.every((p, i) => p > 0 && (i === 0 || p > orden[i - 1]))).toBe(true);
    expect(sql).toContain("WHEN d.estado <> 'activo' THEN 'inactivo'");
    expect(sql).toContain("cv.tipo = 'sin_comunicacion'");
    expect(sql).toContain(') IS FALSE THEN');
    // «alerta» enumera los cinco tipos, como el panel (TIPOS_DE_ALERTA en panel/src/lib/estado-visual.ts), no «cualquier otra condición».
    expect(sql).toContain("cv.tipo IN ('umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado')) THEN 'alerta'");
  });
  it('un tipo que no es de la lista no pone en alerta (en ninguna de las dos versiones)', () => {
    expect([...TIPOS_ALERTA]).toEqual(['umbral', 'bateria', 'manipulacion', 'tope_superado', 'reloj_desviado']);
    expect(estadoVisual('activo', true, ['tipo_futuro'])).toBe('normal');
  });
});

describe('entrega (HU-15; punto 65 vii): recibidas ÷ esperadas, acotada a 100 %, nula sin una trama esperada completa', () => {
  const hasta = new Date('2026-11-11T12:00:00Z');
  const hace = (h: number): Date => new Date(hasta.getTime() - h * 3600_000);
  const muyAtras = hace(24 * 400);
  it('24 h con intervalo de 5 min: 288 esperadas; 144 recibidas → 50 %', () => {
    expect(entrega(144, hace(24), hasta, muyAtras, 300, muyAtras)).toEqual({ recibidas: 144, esperadas: 288, porcentaje: 50 });
  });
  it('más recibidas que esperadas (reenvíos, intervalo corto) → 100 %, nunca más', () => {
    expect(entrega(400, hace(24), hasta, muyAtras, 300, muyAtras).porcentaje).toBe(100);
  });
  it('la ventana empieza en el alta del dispositivo: creado hace 1 h, 12 esperadas', () => {
    expect(entrega(6, hace(24), hasta, hace(1), 300, muyAtras)).toEqual({ recibidas: 6, esperadas: 12, porcentaje: 50 });
  });
  it('y en el horizonte de retención de tramas: 30 días pedidos con 7 retenidos cuentan 7', () => {
    expect(entrega(0, hace(24 * 30), hasta, muyAtras, 3600, hace(24 * 7)).esperadas).toBe(168);
  });
  it('sin una trama esperada completa (recién creado) → porcentaje nulo, no 0 ni 100', () => {
    expect(entrega(0, hace(24), hasta, new Date(hasta.getTime() - 60_000), 300, muyAtras)).toEqual({ recibidas: 0, esperadas: 0, porcentaje: null });
  });
});

describe('cursor opaco (punto 58)', () => {
  const T = '2026-11-11T12:00:00.123456Z';
  const ID = '11111111-1111-4111-8111-111111111111';
  it('ida y vuelta: lo que se codifica se lee igual (microsegundos incluidos)', () => {
    expect(leerCursor(codificarCursor(T, ID))).toEqual({ t: T, id: ID });
  });
  it('ausente → undefined; manipulado, otro tipo o con forma ajena → 400', () => {
    expect(leerCursor(undefined)).toBeUndefined();
    for (const malo of ['x', ['a'], codificarCursor('ayer', ID), codificarCursor(T, 'no-uuid'), Buffer.from('{"t":1}').toString('base64url'), 'a'.repeat(300)]) {
      expect(() => leerCursor(malo)).toThrow(BadRequestException);
    }
  });
  it('día inexistente o año 0000 → 400 (antes la base respondía 22008 y salía 500); 29 de febrero bisiesto pasa', () => {
    for (const t of ['2026-02-30T00:00:00.000001Z', '0000-01-01T00:00:00Z', '1899-12-31T23:59:59Z', '2026-04-31T12:00:00Z']) {
      expect(() => leerCursor(codificarCursor(t, ID))).toThrow(BadRequestException);
    }
    expect(leerCursor(codificarCursor('2028-02-29T00:00:00Z', ID))?.t).toBe('2028-02-29T00:00:00Z');
  });
  it('una página llena trae el cursor de su última fila; una incompleta, ninguno', () => {
    const filas = [{ t: T, id: ID }, { t: '2026-11-11T11:00:00.000001Z', id: ID }];
    expect(leerCursor(siguiente(filas, 2, (f) => f))).toEqual(filas[1]);
    expect(siguiente(filas, 3, (f) => f)).toBeNull();
  });
});

describe('filtros del inventario (docs/19 §4, C)', () => {
  it('sin parámetros: sin filtro ni página (la lista completa, como antes)', () => expect(filtroInventario({})).toEqual({}));
  it('filtros válidos; desplazamiento sin limite pagina de a 50', () => {
    expect(filtroInventario({ via: 'lorawan', estado: 'sin_senal', q: ' nodo ', desplazamiento: '50' })).toEqual({ via: 'lorawan', estado: 'sin_senal', q: 'nodo', desplazamiento: 50, limite: 50 });
  });
  it('lo inválido es 400: estado fuera de los cuatro, via desconocida, UUID malo, limite fuera de 1–500, parámetro repetido', () => {
    for (const p of [{ estado: 'rojo' }, { via: 'zigbee' }, { sitio: 'x' }, { limite: '0' }, { limite: '501' }, { zona: ['a', 'b'] }]) {
      expect(() => filtroInventario(p)).toThrow(BadRequestException);
    }
  });
  it('orden: nombre, entrega o atencion; otro, 400', () => {
    expect(filtroInventario({ orden: 'entrega' })).toEqual({ orden: 'entrega' });
    expect(filtroInventario({ orden: 'atencion' })).toEqual({ orden: 'atencion' });
    expect(() => filtroInventario({ orden: 'estado' })).toThrow(BadRequestException);
  });
  it('q escapa los comodines de ILIKE: «50%» busca un «%» literal', () => {
    expect(patronBusqueda('50%_\\')).toBe('%50\\%\\_\\\\%');
  });
});

describe('alinear e intervaloParaRango (históricos del tablero)', () => {
  it('une los cubos de todos los canales y deja null donde un canal no tiene dato', () => {
    const r = alinear([{ canal_id: 'a', t: 20, v: 2, mn: 1, mx: 3, muestras: 4 }, { canal_id: 'b', t: 10, v: 5, mn: 5, mx: 5, muestras: 1 }, { canal_id: 'a', t: 10, v: 1, mn: 1, mx: 1, muestras: 2 }], ['a', 'b', 'c']);
    expect(r.tiempos).toEqual([10, 20]);
    expect(r.series.get('a')).toEqual({ valores: [1, 2], minimos: [1, 1], maximos: [1, 3], muestras: [2, 4] });
    expect(r.series.get('b')?.muestras).toEqual([1, 0]); // sin dato en el cubo: 0 lecturas
    expect(r.series.get('b')?.valores).toEqual([5, null]);
    expect(r.series.get('c')?.valores).toEqual([null, null]); // canal sin datos: presente, todo nulo
  });
  it('la resolución del rango: 1 h → 1 minuto (60 cubos); 24 h → 5 minutos (288); 7 días → 1 hora (168); 30 días → 6 horas (120)', () => {
    const h = new Date('2026-11-11T12:00:00Z');
    const d = (horas: number): Date => new Date(h.getTime() - horas * 3600_000);
    expect(intervaloParaRango(d(1), h, INTERVALOS, SEGUNDOS_INTERVALO)).toBe('1 minute');
    expect(intervaloParaRango(d(24), h, INTERVALOS, SEGUNDOS_INTERVALO)).toBe('5 minutes');
    expect(intervaloParaRango(d(24 * 7), h, INTERVALOS, SEGUNDOS_INTERVALO)).toBe('1 hour');
    expect(intervaloParaRango(d(24 * 30), h, INTERVALOS, SEGUNDOS_INTERVALO)).toBe('6 hours');
  });
});

// Resumen del sitio: la entrega (punto 65 vii) con el horizonte de retención medido desde AHORA y solo los 50 peores (revisión del 11/11).
describe('entregasDelResumen', () => {
  const ahora = new Date('2026-11-11T12:00:00Z');
  const dias = (n: number): Date => new Date(ahora.getTime() - n * 86_400_000);
  const base = (i: number, recibidas: number) => ({ id: `d${i}`, nombre: `nodo ${String(i).padStart(3, '0')}`, recibidas, creado_en: dias(400).toISOString(), intervalo_esperado_s: 3600 });
  it('ventana de hace 60 a hace 45 días, con 30 de retención: fuera de la retención → porcentaje nulo, no 0 %', () => {
    const r = entregasDelResumen([base(1, 0)], dias(60), dias(45), ahora, 30);
    expect(r.entrega[0]?.porcentaje).toBeNull();
    // Plantada: con el horizonte medido desde `hasta` (lo de antes), la misma ventana daba 0 % (360 esperadas, 0 recibidas).
    const comoAntes = entrega(0, dias(60), dias(45), dias(400), 3600, new Date(dias(45).getTime() - 30 * 86_400_000));
    expect(comoAntes.porcentaje).toBe(0);
  });
  it('dentro de la retención y sin tramas → 0 % (se esperaban y no llegó ninguna)', () => {
    expect(entregasDelResumen([base(1, 0)], dias(1), ahora, ahora, 30).entrega[0]?.porcentaje).toBe(0);
  });
  it(`120 activos → los ${MAX_ENTREGA_RESUMEN} peores, de peor a mejor, y total_activos 120`, () => {
    const r = entregasDelResumen(Array.from({ length: 120 }, (_, i) => base(i, i % 25)), dias(1), ahora, ahora, 30);
    expect(r.total_activos).toBe(120);
    expect(r.entrega).toHaveLength(MAX_ENTREGA_RESUMEN);
    const p = r.entrega.map((x) => x.porcentaje ?? 101);
    expect(p.every((x, i) => i === 0 || x >= p[i - 1])).toBe(true);
    expect(p[0]).toBe(0);
  });
});

describe('diasRetencionTrama: la misma fila de límites que RetencionService', () => {
  it('ausente → 30; un entero ≥ 7 → ese; vacío, menor que 7 o no entero → error (antes, 30 en silencio)', () => {
    expect(diasRetencionTrama(undefined)).toBe(30);
    expect(diasRetencionTrama('45')).toBe(45);
    for (const malo of ['', '3', 'treinta', '7.5']) expect(() => diasRetencionTrama(malo)).toThrow(/RETENCION_TRAMA_DIAS/);
  });
});

describe('ventana del histórico del sitio (MAX_DIAS_SITIO)', () => {
  it(`hasta ${MAX_DIAS_SITIO} días pasa; uno más es 400; el tope general (366) sigue para las demás rutas`, () => {
    const h = '2026-11-11T00:00:00Z';
    expect(ventana(new Date(Date.parse(h) - MAX_DIAS_SITIO * 86_400_000).toISOString(), h, '1 hour', false, MAX_DIAS_SITIO).i).toBe('1 hour');
    expect(() => ventana(new Date(Date.parse(h) - (MAX_DIAS_SITIO + 1) * 86_400_000).toISOString(), h, '1 hour', false, MAX_DIAS_SITIO)).toThrow(BadRequestException);
    expect(ventana(new Date(Date.parse(h) - 90 * 86_400_000).toISOString(), h, '1 day', false).i).toBe('1 day');
  });
});
