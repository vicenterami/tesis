import { describe, expect, it } from 'vitest';
import { BadRequestException } from '@nestjs/common';
import {
  FilaAhoraPublica, FilaSeriePublica, LimitesPublico, NO_RENOVABLE, SIN_MAGNITUDES, armarDatos, totalPublicable, diaEnZona, direccionDelEnlace, estadoEnlace, generarToken,
  hashToken, kSitio, leerToken, limitesPublico, mismoResumen, nuevoVencimiento, plazosPermitidos, renovable, validarRenovacion, validarVista,
  ventanaPedida, ventanasDe, vivo, validarTope, avisosDePublicacion, avisosDeMinimo, avisosPorMagnitud, validarMinimo, validarCambioDeMinimo, AVISO_TODOS_LOS_ENLACES,
  avisoKOmision,
} from './publico.js';

// Vista pública por enlace (docs/19 §4, O): lo puro. La integración contra una base real está en backend/integracion/publico.ts (docs/16 §79).
const L: LimitesPublico = { kPorOmision: 3, kPiso: 1, vencimientoMaxDias: 180, maxEnlacesPorSitio: 50, maxEnlacesTecho: 200 };
const Z1 = '11111111-1111-4111-8111-111111111111';
const Z2 = '22222222-2222-4222-8222-222222222222';
const Z3 = '33333333-3333-4333-8333-333333333333';
const ZX = '44444444-4444-4444-8444-444444444444'; // una zona del sitio que el enlace no publica
const motivos = (f: () => unknown): string[] => {
  try {
    f();
  } catch (e) {
    if (e instanceof BadRequestException) return (e.getResponse() as { message: string[] }).message;
    throw e;
  }
  return [];
};

describe('parámetros del despliegue (PUBLICO_*)', () => {
  it('sin variables: k 3, piso 1, vencimiento máximo 180 días, 50 enlaces por sitio y techo 200', () => {
    expect(limitesPublico(() => undefined)).toEqual(L);
  });
  it('un valor presente e inválido detiene el arranque (vacío, texto, decimal, fuera de rango, piso mayor que k)', () => {
    for (const [k, v] of [['PUBLICO_MINIMO_DISPOSITIVOS', ''], ['PUBLICO_MINIMO_DISPOSITIVOS', '0'], ['PUBLICO_MINIMO_DISPOSITIVOS', '2.5'], ['PUBLICO_MINIMO_DISPOSITIVOS', 'tres'],
      ['PUBLICO_MINIMO_DISPOSITIVOS', '21'], ['PUBLICO_VENCIMIENTO_MAX_DIAS', '6'], ['PUBLICO_VENCIMIENTO_MAX_DIAS', '181'], ['PUBLICO_MAX_ENLACES_POR_SITIO', '0'], ['PUBLICO_MAX_ENLACES_TECHO', '1001']]) {
      expect(() => limitesPublico((n) => (n === k ? v : undefined)), `${k}=${v}`).toThrow(new RegExp(k));
    }
    expect(() => limitesPublico((n) => ({ PUBLICO_MINIMO_DISPOSITIVOS: '2', PUBLICO_MINIMO_DISPOSITIVOS_PISO: '3' })[n])).toThrow(/PISO/);
    expect(() => limitesPublico((n) => ({ PUBLICO_MAX_ENLACES_POR_SITIO: '300' })[n])).toThrow(/TECHO/);
  });
  it('los plazos que se ofrecen no pasan el máximo; el k que rige nunca baja del piso vigente (falla cerrado)', () => {
    expect(plazosPermitidos({ ...L, vencimientoMaxDias: 60 })).toEqual([7, 30]);
    // k es del sitio: sin fijar, el del despliegue; fijado, ese; nunca bajo el piso vigente.
    expect(kSitio(null, L)).toBe(3);
    expect(kSitio(5, L)).toBe(5);
    expect(kSitio(1, { ...L, kPiso: 2 })).toBe(2);
  });
});

describe('el token', () => {
  it('32 bytes en base64url (43 caracteres), distinto cada vez; la base guarda su SHA-256 en hexadecimal', () => {
    const a = generarToken();
    expect(a).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(generarToken()).not.toBe(a);
    expect(hashToken(a)).toMatch(/^[0-9a-f]{64}$/);
    expect(direccionDelEnlace(a)).toBe(`/panel/#/v/${a}`);
  });
  it('de la cabecera: solo una, con la forma exacta; repetida, ausente o con otra forma es null (no se consulta la base)', () => {
    const t = generarToken();
    expect(leerToken(` ${t} `)).toBe(t);
    for (const malo of [undefined, '', 'corto', `${t}x`, [t, t], `${t.slice(0, 42)}=`, `${t.slice(0, 42)}/`]) expect(leerToken(malo as string)).toBeNull();
  });
  it('comparación del resumen en tiempo constante, también con largos distintos', () => {
    const h = hashToken('x');
    expect(mismoResumen(h, h)).toBe(true);
    expect(mismoResumen(h, hashToken('y'))).toBe(false);
    expect(mismoResumen(h, h.slice(1))).toBe(false);
  });
});

describe('validarVista (crear y vista previa)', () => {
  const base = { titulo: 'Clima del aula', magnitudes: ['temperatura'], ventana_maxima: '7d' };
  it('lo mínimo: k y plazo por omisión, sin desglose', () => {
    expect(validarVista(base, L)).toEqual({ titulo: 'Clima del aula', descripcion: null, magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: [], plazo_dias: 30, retencion_dias: 90, ventana: '24h' });
    expect(validarVista({ ...base, retencion_dias: 31 }, L).retencion_dias).toBe(31);
    for (const r of [30, 366, 90.5]) expect(motivos(() => validarVista({ ...base, retencion_dias: r }, L)).join()).toMatch(/retencion_dias/);
  });
  it('sin magnitudes: el texto del diseño (punto 11)', () => {
    expect(motivos(() => validarVista({ ...base, magnitudes: [] }, L))).toContain(SIN_MAGNITUDES);
    expect(motivos(() => validarVista({ titulo: 'x', ventana_maxima: '24h' }, L))).toContain(SIN_MAGNITUDES);
  });
  it('k es del sitio (tercera revisión): un enlace no lo trae —crear o la vista previa con minimo_dispositivos, 400—; el del sitio va del piso a 20', () => {
    expect(motivos(() => validarVista({ ...base, minimo_dispositivos: 1 }, L))).toContain('campo no admitido: minimo_dispositivos');
    expect(motivos(() => validarVista({ magnitudes: ['temperatura'], minimo_dispositivos: 2 }, L, true))).toContain('campo no admitido: minimo_dispositivos');
    expect(validarMinimo({ minimo_dispositivos: 1 }, L)).toBe(1);
    expect(validarMinimo({ minimo_dispositivos: 20 }, L)).toBe(20);
    for (const malo of [{ minimo_dispositivos: 1 }, { minimo_dispositivos: 21 }, { minimo_dispositivos: 2.5 }, { minimo_dispositivos: 3, otro: 1 }, []]) {
      expect(() => validarMinimo(malo, { ...L, kPiso: 2 })).toThrow(BadRequestException);
    }
  });
  it('`anterior` (el k leído) es opcional, de 1 a 20; sin él, el cambio es como antes (bloqueo optimista del k, revisión del 17/11/2026)', () => {
    expect(validarCambioDeMinimo({ minimo_dispositivos: 2, anterior: 3 }, L)).toEqual({ k: 2, anterior: 3 });
    expect(validarCambioDeMinimo({ minimo_dispositivos: 2 }, L)).toEqual({ k: 2, anterior: null });
    for (const malo of [{ minimo_dispositivos: 2, anterior: 0 }, { minimo_dispositivos: 2, anterior: 21 }, { minimo_dispositivos: 2, anterior: '3' }, { minimo_dispositivos: 2, anterior: 2.5 }]) {
      expect(() => validarCambioDeMinimo(malo, L)).toThrow(BadRequestException);
    }
  });
  it('el plazo, de la lista y sin pasar el máximo del despliegue (el vencimiento nunca pasa el máximo)', () => {
    expect(validarVista({ ...base, plazo_dias: 180 }, L).plazo_dias).toBe(180);
    expect(motivos(() => validarVista({ ...base, plazo_dias: 180 }, { ...L, vencimientoMaxDias: 90 })).join()).toMatch(/plazo_dias debe ser uno de: 7, 30, 90/);
    expect(motivos(() => validarVista({ ...base, plazo_dias: 45 }, L)).join()).toMatch(/plazo_dias/);
    expect(validarVista(base, { ...L, vencimientoMaxDias: 20 }).plazo_dias).toBe(7); // sin 30 en la lista, el mayor permitido
  });
  it('texto público acotado y sin caracteres de control; campos de más, repetidos y zonas sin forma de UUID, 400', () => {
    const m = motivos(() => validarVista({ ...base, titulo: 'a\nb', descripcion: 'x'.repeat(301), magnitudes: ['temperatura', 'temperatura'], zonas: ['no-uuid'], token: 'x' }, L)).join(' | ');
    for (const k of ['titulo no admite', 'descripcion admite hasta 300', 'repetidos', 'zonas: una lista de UUID', 'campo no admitido: token']) expect(m).toContain(k);
    for (const bidi of ['\u202e', '\u2066', '\u202a', '\u200b', '\u2028', '\u2029', '\u00ad', '\u0085']) expect(motivos(() => validarVista({ ...base, titulo: `fin${bidi}txt` }, L)).join()).toMatch(/dirección del texto/);
    // La regla de recepcion/texto.ts (tercera revisión): rellenos que se ven en blanco y separadores raros; al menos una letra o un número;
    // no más de tres marcas combinantes seguidas. El espacio común sí.
    for (const raro of ['\u3164', '\u2800', '\u00a0', '\u3000', '\ufe0f']) expect(motivos(() => validarVista({ ...base, titulo: `a${raro}b` }, L)).join()).toMatch(/dirección del texto/);
    expect(motivos(() => validarVista({ ...base, titulo: '!!! ---' }, L)).join()).toMatch(/al menos una letra o un número/);
    expect(motivos(() => validarVista({ ...base, titulo: 'a\u0301\u0302\u0303\u0304' }, L)).join()).toMatch(/marcas apiladas/);
    expect(validarVista({ ...base, titulo: 'Café del aula 3' }, L).titulo).toBe('Café del aula 3');
    expect(validarVista({ ...base, titulo: 'Cafe\u0301' }, L).titulo).toBe('Cafe\u0301');
    expect(motivos(() => validarVista({ ...base, descripcion: 'a\u2069b' }, L)).join()).toMatch(/dirección del texto/);
    expect(validarVista({ ...base, descripcion: 'dos\nlíneas' }, L).descripcion).toBe('dos\nlíneas');
    expect(motivos(() => validarVista({ ...base, titulo: 'x'.repeat(81) }, L)).join()).toMatch(/entre 1 y 80/);
    expect(motivos(() => validarVista({ ...base, magnitudes: ["temperatura'; DROP"] }, L)).join()).toMatch(/códigos del catálogo/);
    expect(motivos(() => validarVista({ ...base, zonas: [Z1, Z1] }, L)).join()).toMatch(/zonas repetidas/);
    expect(motivos(() => validarVista([], L))).toEqual(['el cuerpo debe ser un objeto JSON']);
  });
  it('la vista previa: título opcional, `ventana` hasta la máxima; crear no acepta `ventana`', () => {
    expect(validarVista({ magnitudes: ['humedad'], zonas: [Z1.toUpperCase()], ventana: '30d' }, L, true)).toMatchObject({ titulo: '', ventana: '30d', ventana_maxima: '30d', zonas: [Z1] });
    expect(motivos(() => validarVista({ ...base, ventana: '30d' }, L, true)).join()).toMatch(/no puede pasar la máxima/);
    expect(motivos(() => validarVista({ ...base, ventana: '24h' }, L)).join()).toMatch(/campo no admitido: ventana/);
  });
  it('la ventana que pide quien visita: de la lista y hasta la máxima del enlace, nunca fechas libres', () => {
    expect(ventanaPedida(undefined, '24h')).toBe('24h');
    expect(ventanaPedida('7d', '7d')).toBe('7d');
    for (const mala of ['30d', '2026-01-01', ['24h', '7d'], '']) expect(() => ventanaPedida(mala, '7d')).toThrow(BadRequestException);
    expect(ventanasDe('7d')).toEqual(['24h', '7d']);
  });
});

describe('renovar y el estado de un enlace', () => {
  const ahora = new Date('2026-11-17T12:00:00Z');
  const dias = (n: number): string => new Date(ahora.getTime() + n * 86_400_000).toISOString();
  it('se renueva vigente o vencido hace 30 días o menos; no si se revocó, venció hace 31 o tiene más de un año', () => {
    expect(renovable({ creado_en: dias(-40), expira_en: dias(-29), revocado_en: null }, ahora)).toBe(true);
    expect(renovable({ creado_en: dias(-40), expira_en: dias(5), revocado_en: null }, ahora)).toBe(true);
    expect(renovable({ creado_en: dias(-40), expira_en: dias(-31), revocado_en: null }, ahora)).toBe(false);
    expect(renovable({ creado_en: dias(-40), expira_en: dias(5), revocado_en: dias(-1) }, ahora)).toBe(false);
    expect(renovable({ creado_en: dias(-366), expira_en: dias(5), revocado_en: null }, ahora)).toBe(false);
    expect(NO_RENOVABLE).toBe('Este enlace ya no se puede renovar. Crea uno nuevo.');
  });
  it('el vencimiento nuevo es hoy + plazo y avisa si acorta el que había', () => {
    const f = { creado_en: dias(-10), expira_en: dias(80), revocado_en: null };
    expect(nuevoVencimiento(f, ahora, 30)).toEqual({ expira_en: new Date(dias(30)), acorta: true });
    expect(nuevoVencimiento(f, ahora, 90).acorta).toBe(false);
    expect(validarRenovacion({ plazo_dias: 7, acortar: true }, L)).toEqual({ plazo_dias: 7, acortar: true });
    expect(motivos(() => validarRenovacion({ plazo_dias: 180 }, { ...L, vencimientoMaxDias: 90 })).join()).toMatch(/plazo_dias/);
    expect(motivos(() => validarRenovacion({ plazo_dias: 7, token: 'x' }, L)).join()).toMatch(/campo no admitido/);
  });
  it('estado: revocado manda; vencido; vence pronto con 7 días o menos; vigente', () => {
    expect(estadoEnlace({ creado_en: dias(-1), expira_en: dias(10), revocado_en: dias(0) }, ahora)).toBe('revocado');
    expect(estadoEnlace({ creado_en: dias(-1), expira_en: dias(0), revocado_en: null }, ahora)).toBe('vencido');
    expect(estadoEnlace({ creado_en: dias(-1), expira_en: dias(7), revocado_en: null }, ahora)).toBe('vence_pronto');
    expect(estadoEnlace({ creado_en: dias(-1), expira_en: dias(8), revocado_en: null }, ahora)).toBe('vigente');
  });
  it('el día del contador es el del sitio, no el UTC', () => {
    expect(diaEnZona(new Date('2026-11-17T02:00:00Z'), 'America/Santiago')).toBe('2026-11-16');
    expect(diaEnZona(new Date('2026-11-17T02:00:00Z'), 'UTC')).toBe('2026-11-17');
  });
});

describe('armarDatos: la regla de k y lo que nunca viaja', () => {
  const magnitudes = [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }, { codigo: 'humedad', nombre: 'Humedad relativa', unidad: '%RH' }];
  const T = magnitudes.slice(0, 1);
  const zonas = [{ id: Z1, nombre: 'Norte' }, { id: Z2, nombre: 'Sur' }];
  const s = (magnitud: string, zona_id: string | null, t: number, v: number, n: number): FilaSeriePublica => ({ magnitud, zona_id, t, v, n });
  const a = (magnitud: string, zona_id: string | null, v: number, n: number, ultimo = '2026-11-17T12:00:00.000Z'): FilaAhoraPublica => ({ magnitud, zona_id, v, n, ultimo });

  it('un valor se publica con n ≥ k; con 0 < n < k, null, igual que un tramo sin datos; un tramo que solo tiene ocultos no entra al eje', () => {
    const d = armarDatos({ magnitudes: T, zonas: [], k: 3, series: [s('temperatura', null, 100, 20, 3), s('temperatura', null, 200, 21, 2), s('temperatura', null, 300, 22, 4)], ahora: [a('temperatura', null, 20.5, 3)] });
    expect(d.tiempos).toEqual([100, 300]); // el 200 (2 equipos) no delata que alguien reportó
    expect(d.magnitudes[0]).toMatchObject({ serie: [20, 22], ahora: 20.5, protegido: true });
    const vacio = armarDatos({ magnitudes: T, zonas: [], k: 3, series: [], ahora: [] });
    expect(vacio.magnitudes[0]).toMatchObject({ ahora: null, serie: [], protegido: true }); // protegido depende solo de k > 1
    expect(armarDatos({ magnitudes: T, zonas: [], k: 1, series: [], ahora: [] }).magnitudes[0].protegido).toBe(false);
  });
  it('lo oculto y lo vacío se ven igual en una zona: null en los dos, y la magnitud dice `protegido` una vez', () => {
    const d = armarDatos({ magnitudes: T, zonas, k: 3,
      series: [s('temperatura', null, 100, 20, 6), s('temperatura', Z1, 100, 19, 4), s('temperatura', Z2, 100, 23, 2), s('temperatura', ZX, 100, 18, 1),
        s('temperatura', null, 200, 20, 4), s('temperatura', Z1, 200, 19, 4)], ahora: [] });
    const m = d.magnitudes[0];
    expect(m.zonas[1].serie).toEqual([null, null]); // tramo 100: oculta (2); tramo 200: sin datos. Indistinguibles.
    expect(m.protegido).toBe(true);
  });
  it('la resta, escenario 1: una zona NO publicada con un equipo deja oculto el total (si no, 7T − 3N − 3S la despejaría)', () => {
    const d = armarDatos({ magnitudes: T, zonas, k: 3,
      series: [s('temperatura', null, 100, 20, 7), s('temperatura', Z1, 100, 19, 3), s('temperatura', Z2, 100, 23, 3), s('temperatura', ZX, 100, 15, 1)],
      ahora: [a('temperatura', null, 20, 7), a('temperatura', Z1, 19, 3), a('temperatura', Z2, 23, 3), a('temperatura', ZX, 15, 1)] });
    const m = d.magnitudes[0];
    expect([m.serie, m.ahora]).toEqual([[null], null]);
    expect(m.zonas.map((z) => z.serie[0])).toEqual([19, 23]);
    expect(m.protegido).toBe(true);
  });
  it('la resta, escenario 2: dos zonas ocultas que juntas suman menos de k dejan oculto el total; si suman k o más, se publica', () => {
    const tramo = (n1: number, n2: number) => [s('temperatura', null, 100, 20, 3 + n1 + n2), s('temperatura', Z1, 100, 19, 3), s('temperatura', Z2, 100, 23, n1), s('temperatura', ZX, 100, 15, n2)];
    const dos = armarDatos({ magnitudes: T, zonas, k: 3, series: tramo(1, 1), ahora: [] }).magnitudes[0];
    expect(dos.serie).toEqual([null]);
    const tres = armarDatos({ magnitudes: T, zonas, k: 3, series: tramo(1, 2), ahora: [] }).magnitudes[0];
    expect(tres.serie).toEqual([20]);
  });
  it('la resta, escenario 3: dos enlaces del mismo sitio, cada uno con una zona, dan el mismo total oculto (la regla mira todas las zonas del sitio)', () => {
    const filas = [s('temperatura', null, 100, 20, 7), s('temperatura', Z1, 100, 19, 3), s('temperatura', Z2, 100, 23, 3), s('temperatura', ZX, 100, 15, 1)];
    for (const z of zonas) expect(armarDatos({ magnitudes: T, zonas: [z], k: 3, series: filas, ahora: [] }).magnitudes[0].serie).toEqual([null]);
    expect(totalPublicable([3, 3, 1], 3)).toBe(false);
    expect(totalPublicable([3, 3], 3)).toBe(true);
    expect(totalPublicable([3, 1, 2], 3)).toBe(true);
  });
  it('k por sitio (tercera revisión): enlaces con magnitudes, ventanas o zonas distintas ocultan lo mismo, y lo publicado son grupos de k o más', () => {
    // Zonas A = 3, B = 1, E = 10, k = 3 del sitio. Un enlace de temperatura con A y E, otro de humedad sin zonas, otro de temperatura en otra
    // ventana: con el mismo k, B (1 < 3) se oculta en todos y el total no sale en ninguno (1 < 3): 14·T − 3·A − 10·E = B no se puede armar.
    const A = Z1, B = Z2, E = Z3;
    const filas = (m: string) => [s(m, null, 100, 20, 14), s(m, A, 100, 19, 3), s(m, B, 100, 30, 1), s(m, E, 100, 18, 10)];
    const temperatura = armarDatos({ magnitudes: T, zonas: [{ id: A, nombre: 'A' }, { id: E, nombre: 'E' }], k: 3, series: filas('temperatura'), ahora: [] });
    const humedad = armarDatos({ magnitudes: [magnitudes[1]], zonas: [], k: 3, series: filas('humedad'), ahora: [] });
    expect(temperatura.magnitudes[0].serie).toEqual([null]);
    expect(temperatura.magnitudes[0].zonas.map((z) => z.serie)).toEqual([[19], [18]]);
    expect(humedad.magnitudes[0].serie).toEqual([]);
    // Si el de humedad tuviera k = 4 (k por enlace, lo de antes): A (3) y B (1) ocultas suman 4 ≥ 4 y el total saldría.
    expect(armarDatos({ magnitudes: [magnitudes[1]], zonas: [], k: 4, series: filas('humedad'), ahora: [] }).magnitudes[0].serie).toEqual([20]);
    expect(totalPublicable([3, 1, 10], 3)).toBe(false);
    expect(totalPublicable([3, 1, 10], 4)).toBe(true);
  });
  it('sin desglose, «último dato» es el más reciente de lo publicado; lo oculto no cuenta', () => {
    const d = armarDatos({ magnitudes, zonas: [], k: 2, series: [], ahora: [a('temperatura', null, 20, 2, '2026-11-17T11:00:00.000Z'), a('humedad', null, 50, 5, '2026-11-17T11:30:00.000Z')] });
    expect(d.ultimo_dato).toBe('2026-11-17T11:30:00.000Z');
    const oculto = armarDatos({ magnitudes: T, zonas: [], k: 3, series: [], ahora: [a('temperatura', null, 20, 2)] });
    expect(oculto.ultimo_dato).toBeNull();
  });
  it('solo lo publicado, en su orden y con su nombre: una zona o una magnitud que no está en la lista no sale aunque la base la traiga', () => {
    const d = armarDatos({
      magnitudes: [magnitudes[1], magnitudes[0]], zonas: [{ id: Z2, nombre: 'Sur (publicado)' }], k: 1,
      series: [s('presion', null, 100, 1000, 9), s('temperatura', Z3, 100, 30, 9), s('humedad', Z2, 100, 60, 3)], ahora: [a('temperatura', Z3, 30, 9)],
    });
    expect(d.magnitudes.map((m) => m.codigo)).toEqual(['humedad', 'temperatura']);
    expect(d.magnitudes[0].zonas).toEqual([{ nombre: 'Sur (publicado)', ahora: null, serie: [60] }]);
    expect(d.magnitudes[1].zonas[0].serie).toEqual([null]); // la zona Z3 no publicada no sale
  });
  it('ninguna columna de más llega a la respuesta: ni n, ni mínimo, máximo, identificadores o nombres de equipos', () => {
    const sucia = { magnitud: 'temperatura', zona_id: Z1, t: 100, v: 20, n: 7, mn: -9.876, mx: 99.123, id_fisico: 'equipo-secreto-01', dispositivo: 'Nodo secreto' };
    const d = armarDatos({ magnitudes: T, zonas, k: 3, series: [sucia, { ...sucia, zona_id: null }, { ...sucia, zona_id: ZX }], ahora: [{ ...sucia, zona_id: null, ultimo: null }] });
    const texto = JSON.stringify(d);
    for (const x of ['"n"', 'mn', 'mx', '99.123', '-9.876', 'equipo-secreto', 'Nodo secreto', Z1, ZX, 'zona_id']) expect(texto).not.toContain(x);
  });
});

describe('lo que decide el administrador del sitio (decidido el 17/11/2026)', () => {
  const ahora = new Date('2026-11-17T12:00:00Z');
  const dias = (n: number): string => new Date(ahora.getTime() + n * 86_400_000).toISOString();
  it('vivo: no revocado y vigente o aún renovable; un vencido hace 31 días o uno revocado está muerto (no cuenta para el tope)', () => {
    expect(vivo({ creado_en: dias(-10), expira_en: dias(5), revocado_en: null }, ahora)).toBe(true);
    expect(vivo({ creado_en: dias(-40), expira_en: dias(-29), revocado_en: null }, ahora)).toBe(true);
    expect(vivo({ creado_en: dias(-40), expira_en: dias(-31), revocado_en: null }, ahora)).toBe(false);
    expect(vivo({ creado_en: dias(-10), expira_en: dias(5), revocado_en: dias(-1) }, ahora)).toBe(false);
    expect(vivo({ creado_en: dias(-366), expira_en: dias(5), revocado_en: null }, ahora)).toBe(true); // vigente aunque ya no se renueve
  });
  it('el tope del sitio: de 1 al techo del despliegue', () => {
    expect(validarTope({ max_enlaces: 200 }, L)).toBe(200);
    for (const malo of [{ max_enlaces: 0 }, { max_enlaces: 201 }, { max_enlaces: 2.5 }, { max_enlaces: 5, otro: 1 }, []]) expect(() => validarTope(malo, L)).toThrow(BadRequestException);
  });
  it('avisos: k bajo, una zona de un equipo con k = 1, lo que saldrá sin valor y lo deducible por resta', () => {
    const zonas = [{ id: Z1, nombre: 'Norte', equipos: 3 }, { id: Z2, nombre: 'Sur', equipos: 1 }, { id: Z3, nombre: 'Patio', equipos: 4 }];
    const uno = avisosDePublicacion({ zonas, publicadas: [Z1, Z2], k: 1, kPorOmision: 3 });
    expect(uno).toContain('La zona «Sur» tiene 1 equipo: con k = 1 su lectura sale tal cual.');
    expect(uno.join(' ')).toMatch(/El mínimo de este sitio es k = 1/);
    expect(uno.join(' ')).toMatch(/deducir el promedio de las no publicadas \(«Patio»\)/);
    const tres = avisosDePublicacion({ zonas, publicadas: [Z1, Z2], k: 3, kPorOmision: 3 });
    expect(tres.join(' ')).toMatch(/«Sur» tiene hoy 1 equipo, menos que k = 3/);
    expect(tres.join(' ')).toMatch(/El total del sitio saldrá sin valor/);
    expect(avisosDePublicacion({ zonas: zonas.slice(0, 1), publicadas: [Z1], k: 3, kPorOmision: 3 })).toEqual([]);
    // Al fijar el k del sitio: afecta a todos sus enlaces, y lo deducible con ese k en todas sus zonas.
    const minimo = avisosDeMinimo({ magnitudes: [{ magnitud: 'Temperatura', zonas }], k: 1, anterior: 3, kPorOmision: 3 });
    expect(minimo[0]).toBe(AVISO_TODOS_LOS_ENLACES);
    expect(minimo.join(' ')).toMatch(/Bajaste el mínimo de 3 a 1/);
    expect(minimo.join(' ')).toMatch(/«Sur» tiene 1 equipo: con k = 1/);
  });
  it('avisos por magnitud, como la regla: una zona con 3 equipos de temperatura y 1 de humedad avisa por la humedad (la unión diría 3)', () => {
    const temperatura = { magnitud: 'Temperatura', zonas: [{ id: Z1, nombre: 'Norte', equipos: 3 }, { id: Z2, nombre: 'Sur', equipos: 3 }] };
    const humedad = { magnitud: 'Humedad relativa', zonas: [{ id: Z1, nombre: 'Norte', equipos: 1 }, { id: Z2, nombre: 'Sur', equipos: 3 }] };
    const vacia = { magnitud: 'Presión', zonas: [{ id: Z1, nombre: 'Norte', equipos: 0 }, { id: Z2, nombre: 'Sur', equipos: 0 }] };
    const a = avisosPorMagnitud({ magnitudes: [temperatura, humedad, vacia], publicadas: [Z1, Z2], k: 3, kPorOmision: 3 });
    expect(a).toContain('Humedad relativa: La zona «Norte» tiene hoy 1 equipo, menos que k = 3: saldrá sin valor mientras sea así.');
    expect(a).toContain('Humedad relativa: El total del sitio saldrá sin valor: hay zonas con menos de 3 equipos que juntas suman menos de 3, y con el total se despejarían por resta.');
    expect(a.some((x) => x.startsWith('Temperatura:') || x.startsWith('Presión:'))).toBe(false);
    // Una sola magnitud con datos: sin prefijo; el aviso de k bajo, una vez.
    const uno = avisosPorMagnitud({ magnitudes: [humedad, vacia], publicadas: [Z1], k: 1, kPorOmision: 3 });
    expect(uno.filter((x) => x.startsWith('El mínimo de este sitio'))).toHaveLength(1);
    expect(uno).toContain('La zona «Norte» tiene 1 equipo: con k = 1 su lectura sale tal cual.');
  });
});

describe('avisoKOmision: el operador que baja el k de omisión queda dicho al arrancar', () => {
  it('avisa bajo 3 y calla desde 3', () => {
    expect(avisoKOmision(2)).toMatch(/PUBLICO_MINIMO_DISPOSITIVOS=2/);
    expect(avisoKOmision(1)).not.toBeNull();
    expect(avisoKOmision(3)).toBeNull();
    expect(avisoKOmision(4)).toBeNull();
  });
});
