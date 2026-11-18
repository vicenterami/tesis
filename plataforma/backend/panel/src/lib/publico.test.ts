import { describe, expect, it, vi } from 'vitest';
import {
  AVISO_PROTEGIDO, SIN_DATO, TEXTO_MUCHAS_VISITAS, TEXTO_NO_DISPONIBLE, TEXTO_TARDANDO, armarVista, consultaPublica, esRutaPublica, explicacionProtegido,
  leerTokenPublico, pedirVistaPublica, sinToken, textoDeResultado, type VistaPublica,
} from './publico';

// P9, quien visita (docs/19 §4, O, puntos 5, 6, 9 y 11): lo puro de la pantalla pública.
const TOKEN = 'A'.repeat(20) + '_-' + 'b9'.repeat(10) + 'z'; // 43 caracteres base64url, sintético
const VISTA: VistaPublica = {
  titulo: 'Clima del invernadero', descripcion: 'Promedios para el curso', sitio: 'Campus', zona_horaria: 'America/Santiago', minimo_dispositivos: 3,
  ventana: '24h', ventanas: ['24h', '7d'], intervalo: '5 minutes', desde: '2026-11-16T15:00:00Z', hasta: '2026-11-17T15:00:00Z',
  ultimo_dato: '2026-11-17T14:55:00Z', tiempos: [1_763_391_000, 1_763_391_300],
  magnitudes: [
    { codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', ahora: 21.43, serie: [21.2, null], protegido: true,
      zonas: [{ nombre: 'Norte', ahora: 20.96, serie: [20.9, 21] }, { nombre: 'Sur', ahora: null, serie: [null, null] }] },
    { codigo: 'humedad', nombre: 'Humedad', unidad: '%RH', ahora: null, serie: [null, null], protegido: true, zonas: [{ nombre: 'Norte', ahora: null, serie: [null, null] }, { nombre: 'Sur', ahora: null, serie: [null, null] }] },
  ],
};

describe('la ruta y el token, antes de montar la aplicación (punto 5)', () => {
  it('«#/v/<token>» es la ruta pública y trae su token; lo que sigue al token no es parte de él', () => {
    expect(esRutaPublica(`#/v/${TOKEN}`)).toBe(true);
    expect(esRutaPublica('#/v')).toBe(true);
    expect(esRutaPublica('#/vista')).toBe(false);
    expect(esRutaPublica('#/')).toBe(false);
    expect(leerTokenPublico(`#/v/${TOKEN}`)).toBe(TOKEN);
    expect(leerTokenPublico(`#/v/${TOKEN}?ventana=7d`)).toBe(TOKEN);
    expect(leerTokenPublico(`#/v/${TOKEN}/`)).toBe(TOKEN);
  });
  it('un token con otra forma (corto, largo, con caracteres fuera de base64url) no se lee: la pantalla dirá «no disponible» sin pedir nada', () => {
    for (const malo of ['#/v/', '#/v/abc', `#/v/${TOKEN}x`, `#/v/${TOKEN.slice(0, 42)}+`, `#/v/${TOKEN.slice(0, 42)}%`, `#/inventario?x=${TOKEN}`]) expect(leerTokenPublico(malo)).toBeNull();
  });
  it('toda dirección que vaya a un registro se escribe sin el token', () => {
    expect(sinToken(`https://ejemplo.invalid/panel/#/v/${TOKEN} falló`)).toBe('https://ejemplo.invalid/panel/#/v/… falló');
    expect(sinToken('#/inventario?q=x')).toBe('#/inventario?q=x');
  });
});

describe('la petición a GET /publico (puntos 5, 6 y 8)', () => {
  it('la consulta lleva la ventana y `carga=si` solo en la primera; nunca el token', () => {
    expect(consultaPublica('24h', true)).toBe('/publico?ventana=24h&carga=si');
    expect(consultaPublica('7d', false)).toBe('/publico?ventana=7d');
  });
  it('el token viaja solo en la cabecera X-Enlace-Publico, sin cookies, sin caché y sin procedencia', async () => {
    const f = vi.fn(async () => new Response(JSON.stringify(VISTA)));
    const r = await pedirVistaPublica(TOKEN, '24h', true, undefined, f as unknown as typeof fetch);
    expect(r).toEqual({ tipo: 'ok', vista: VISTA });
    const [url, init] = f.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).not.toContain(TOKEN);
    expect((init.headers as Record<string, string>)['X-Enlace-Publico']).toBe(TOKEN);
    expect(init.credentials).toBe('omit');
    expect(init.cache).toBe('no-store');
    expect(init.referrerPolicy).toBe('no-referrer');
    expect(init.redirect).toBe('error');
  });
  it('404 → no disponible; 429 → muchas visitas; 503, otro error o un cuerpo que no es la vista → tardando; sin red → sin conexión', async () => {
    const con = (status: number, cuerpo = '{}') => vi.fn(async () => new Response(cuerpo, { status })) as unknown as typeof fetch;
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, con(404))).toEqual({ tipo: 'no_disponible' });
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, con(429))).toEqual({ tipo: 'muchas_visitas' });
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, con(503))).toEqual({ tipo: 'tardando' });
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, con(500))).toEqual({ tipo: 'tardando' });
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, con(200, '{"titulo":1}'))).toEqual({ tipo: 'tardando' });
    const sinRed = vi.fn(async () => { throw new TypeError('sin red'); }) as unknown as typeof fetch;
    expect(await pedirVistaPublica(TOKEN, '24h', false, undefined, sinRed)).toEqual({ tipo: 'sin_conexion' });
  });
  it('los textos de la tabla del punto 11, uno por resultado', () => {
    expect(textoDeResultado({ tipo: 'no_disponible' })).toBe('Este enlace ya no está disponible. Pídele uno nuevo a quien te lo compartió.');
    expect(textoDeResultado({ tipo: 'muchas_visitas' })).toBe('Hay muchas visitas en este momento. La página se actualizará sola en un minuto.');
    expect(textoDeResultado({ tipo: 'tardando' })).toBe('Los datos están tardando. La página volverá a intentarlo en un minuto.');
    expect([TEXTO_NO_DISPONIBLE, TEXTO_MUCHAS_VISITAS, TEXTO_TARDANDO].every((t) => t.endsWith('.'))).toBe(true);
  });
});

describe('lo que se dibuja (punto 9)', () => {
  const AHORA = new Date('2026-11-17T15:00:00Z');
  it('por magnitud, el promedio de ahora con su unidad; null es «Sin dato», igual sea oculto o vacío; una fila por zona', () => {
    const d = armarVista(VISTA, AHORA);
    expect(d.tarjetas.map((t) => t.ahora)).toEqual(['21,4 °C', SIN_DATO]);
    expect(d.tarjetas[0]!.zonas).toEqual([{ nombre: 'Norte', ahora: '21 °C' }, { nombre: 'Sur', ahora: SIN_DATO }]);
    expect(d.textoK).toBe('Promedio de 3 o más dispositivos');
    expect(d.cada).toBe('cada 5 minutos');
  });
  it('las series para la gráfica: los tiempos, el sitio y cada zona, con sus huecos; sin ningún valor en la ventana, no hay gráfica', () => {
    const [t, h] = armarVista(VISTA, AHORA).tarjetas;
    expect(t!.series).toEqual([VISTA.tiempos, [21.2, null], [20.9, 21], [null, null]]);
    expect(t!.nombresSeries).toEqual(['Promedio del sitio', 'Norte', 'Sur']);
    expect(t!.conDatos).toBe(true);
    expect(h!.conDatos).toBe(false);
  });
  it('«actualizado hace…» desde el último dato, la zona horaria del sitio con su desfase y las ventanas que permite el enlace', () => {
    const d = armarVista(VISTA, AHORA);
    expect(d.actualizado).toBe('Actualizado hace 5 min');
    expect(d.zonaHoraria).toBe('Horas del sitio (America/Santiago, UTC−03:00)');
    expect(d.ventanas).toEqual([{ clave: '24h', rotulo: 'Últimas 24 horas' }, { clave: '7d', rotulo: 'Últimos 7 días' }]);
    expect(armarVista({ ...VISTA, ultimo_dato: null }, AHORA).actualizado).toBe('Sin datos todavía');
  });
  it('`protegido` pasa tal cual (depende solo de k > 1), con su aviso y la explicación en palabras de quien visita', () => {
    expect(armarVista(VISTA, AHORA).tarjetas.every((t) => t.protegido)).toBe(true);
    expect(armarVista({ ...VISTA, minimo_dispositivos: 1, magnitudes: VISTA.magnitudes.map((m) => ({ ...m, protegido: false })) }, AHORA).tarjetas.some((t) => t.protegido)).toBe(false);
    expect(AVISO_PROTEGIDO).toBe('Algunos tramos se ocultan para proteger a equipos individuales.');
    expect(explicacionProtegido(3)).toContain('menos de 3 equipos');
  });
});
