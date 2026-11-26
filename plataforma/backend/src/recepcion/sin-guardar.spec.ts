import { describe, expect, it, vi } from 'vitest';
import { ForbiddenException, NotFoundException } from '@nestjs/common';
import type { AlcanceService } from '../sesion/alcance.service.js';
import { UsuarioSesion, usuarioSistema } from '../sesion/permisos.js';
import type { RecepcionService } from './recepcion.service.js';
import { SinGuardarController } from './sin-guardar.controller.js';
import type { Adaptador } from './adaptadores/adaptador.js';
import { ALIAS_SEMILLA } from './adaptadores/catalogo-semilla.prueba.js';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador.js';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador.js';
import { PlanoAdaptador } from './adaptadores/plano.adaptador.js';
import { SenmlAdaptador } from './adaptadores/senml.adaptador.js';
import { EquipoSinGuardar, FilaRetenida, MAX_CLAVES_SIN_GUARDAR, clavesSinGuardar } from './sin-guardar.js';

// «Lo que la trama trae y no se guarda» (docs/10 §8.4 punto 72 i): la relectura de las tramas retenidas, sin base.
const ADAPTADORES = new Map<string, Adaptador>([new SenmlAdaptador(), new PlanoAdaptador(), new ChirpstackAdaptador(), new MilesightAdaptador()].map((a) => [a.nombre, a]));
const DEVEUI = '0101010101010101';
const CATALOGO = new Set(['temperatura', 'humedad', 'presion', 'bateria', 'rssi', 'snr']);
const nodo = (extra: Partial<EquipoSinGuardar> = {}): EquipoSinGuardar => ({
  formato: 'chirpstack', idFisico: DEVEUI, declaradas: ['temperatura'], catalogo: CATALOGO, decodificador: null, receta: null, alias: ALIAS_SEMILLA, ...extra,
});
const up = (objeto: object, rxInfo: unknown = [{ gatewayId: 'aaaaaaaaaaaaaaaa', rssi: -87, snr: 7.5 }]): Buffer =>
  Buffer.from(JSON.stringify({ time: '2026-11-25T12:00:00Z', deviceInfo: { devEui: DEVEUI }, object: objeto, rxInfo }));
const fila = (payload: Buffer, minuto: number, topico = `sitio/uct/pasarela/p/${DEVEUI}/up`): FilaRetenida =>
  ({ payload, topico, recibido_en: new Date(Date.UTC(2026, 10, 25, 12, minuto)) });

describe('clavesSinGuardar', () => {
  it('ChirpStack: una magnitud del catálogo sin canal (por su alias), una clave sin magnitud con su número, un texto sin valor y la señal del enlace', () => {
    const r = clavesSinGuardar([fila(up({ temperature: 21.5, humidity: 55, co2: 412, firmware: 'v1.2' }), 1)], nodo(), ADAPTADORES);
    expect(r).toEqual([
      { clave: 'humedad', magnitud: 'humedad', valor: 55, unidad: '%RH', visto: '2026-11-25T12:01:00.000Z', origen: 'carga' },
      { clave: 'co2', magnitud: null, valor: 412, unidad: null, visto: '2026-11-25T12:01:00.000Z', origen: 'carga' },
      { clave: 'firmware', magnitud: null, valor: null, unidad: null, visto: '2026-11-25T12:01:00.000Z', origen: 'carga' }, // un texto no se muestra
      { clave: 'rssi', magnitud: 'rssi', valor: -87, unidad: 'dBm', visto: '2026-11-25T12:01:00.000Z', origen: 'enlace' },
      { clave: 'snr', magnitud: 'snr', valor: 7.5, unidad: 'dB', visto: '2026-11-25T12:01:00.000Z', origen: 'enlace' },
    ]);
  });
  it('lo declarado no se ofrece; de dos tramas, el valor y la hora de la más reciente (aunque lleguen desordenadas)', () => {
    const r = clavesSinGuardar([fila(up({ temperature: 1, co2: 400 }), 1), fila(up({ temperature: 2, co2: 450 }), 9), fila(up({ temperature: 3, co2: 420 }), 5)],
      nodo({ declaradas: ['temperatura', 'rssi', 'snr'] }), ADAPTADORES);
    expect(r).toEqual([{ clave: 'co2', magnitud: null, valor: 450, unidad: null, visto: '2026-11-25T12:09:00.000Z', origen: 'carga' }]);
  });
  it('una trama sin ninguna clave conocida (el adaptador la rechaza) igual nombra sus claves; una ilegible se salta', () => {
    const r = clavesSinGuardar([fila(up({ voc: 3 }, []), 2), fila(Buffer.from('{"roto'), 3)], nodo(), ADAPTADORES);
    expect(r.map((c) => [c.clave, c.valor])).toEqual([['voc', 3]]);
  });
  it('SenML directo: un código del catálogo sin canal se ofrece con su magnitud; uno que no está en el catálogo, sin ella', () => {
    const pack = Buffer.from(JSON.stringify([{ n: 'temperatura', u: 'Cel', v: 20 }, { n: 'presion', u: 'hPa', v: 1013 }, { n: 'radon', u: 'Bq', v: 40 }]));
    const r = clavesSinGuardar([fila(pack, 1, 'sitio/uct/dispositivo/nodo-1/temperatura')], nodo({ formato: 'senml', idFisico: 'nodo-1', alias: null }), ADAPTADORES);
    expect(r.map((c) => [c.clave, c.magnitud, c.valor])).toEqual([['presion', 'presion', 1013], ['radon', null, 40]]);
  });
  it(`como mucho ${MAX_CLAVES_SIN_GUARDAR} claves; un formato sin adaptador, ninguna`, () => {
    const muchas = Object.fromEntries(Array.from({ length: MAX_CLAVES_SIN_GUARDAR + 10 }, (_, i) => [`k${i}`, i]));
    expect(clavesSinGuardar([fila(up({ temperature: 1, ...muchas }, []), 1)], nodo(), ADAPTADORES)).toHaveLength(MAX_CLAVES_SIN_GUARDAR);
    expect(clavesSinGuardar([fila(up({ temperature: 1 }), 1)], nodo({ formato: 'otro' }), ADAPTADORES)).toEqual([]);
  });
  // Tope de trabajo (revisión del 25/11/2026): una carga de 64 KiB con miles de claves desconocidas no se vuelve a leer por cada clave. Con
  // 20 tramas así, leerla otra vez por clave eran decenas de miles de JSON.parse de 64 KiB en el hilo del servidor.
  it('cada trama se interpreta a lo más dos veces (el adaptador y el valor de sus claves), tenga las claves que tenga', () => {
    const muchas = Object.fromEntries(Array.from({ length: 3000 }, (_, i) => [`clave_desconocida_${i}`, i]));
    const filas = Array.from({ length: 20 }, (_, i) => fila(up({ temperature: 1, ...muchas }, []), i));
    const original = JSON.parse;
    let lecturas = 0; // un contador, no un espía: guardar los argumentos de miles de llamadas agota la memoria
    JSON.parse = ((texto: string, revisor?: (k: string, v: unknown) => unknown) => { lecturas++; return original(texto, revisor); }) as typeof JSON.parse;
    try {
      const r = clavesSinGuardar(filas, nodo(), ADAPTADORES);
      expect(r).toHaveLength(MAX_CLAVES_SIN_GUARDAR);
      expect(r[0]).toMatchObject({ clave: 'clave_desconocida_0', valor: 0, visto: '2026-11-25T12:19:00.000Z' });
      expect(lecturas).toBeLessThanOrEqual(2 * filas.length);
    } finally {
      JSON.parse = original;
    }
  });
});

describe('SinGuardarController: lee cargas crudas, así que exige «escribir» (docs/20 §6)', () => {
  const D = '88888888-8888-4888-8888-888888888888';
  const armar = (r: unknown = { revisadas: 1, claves: [] }) => {
    const sinGuardar = vi.fn(() => Promise.resolve(r === 'ninguno' ? undefined : r));
    const exigirDispositivo = vi.fn(() => Promise.resolve('s1'));
    return { ctl: new SinGuardarController({ sinGuardar } as unknown as RecepcionService, { exigirDispositivo } as unknown as AlcanceService), sinGuardar, exigirDispositivo };
  };
  const persona = (rol: string): UsuarioSesion => ({ ...usuarioSistema(), id: 'u1', sistema: false, todos: false, sitios: new Map([['s1', rol as 'consulta']]) });
  it('consulta e investigador: 403 antes de leer nada; operador: el alcance con «escribir» y la respuesta del servicio; sin equipo, 404', async () => {
    for (const rol of ['consulta', 'investigador']) {
      const { ctl, sinGuardar } = armar();
      await expect(ctl.sinGuardar(persona(rol), D)).rejects.toBeInstanceOf(ForbiddenException);
      expect(sinGuardar).not.toHaveBeenCalled();
    }
    const { ctl, exigirDispositivo } = armar();
    await expect(ctl.sinGuardar(persona('operador'), D)).resolves.toEqual({ revisadas: 1, claves: [] });
    expect(exigirDispositivo).toHaveBeenCalledWith(expect.anything(), 'escribir', D);
    await expect(armar('ninguno').ctl.sinGuardar(persona('operador'), D)).rejects.toBeInstanceOf(NotFoundException);
  });
});
