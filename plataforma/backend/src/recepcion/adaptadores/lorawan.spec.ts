import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextoTrama } from '../lectura';
import { TramaMalformada } from './adaptador';
import { ChirpstackAdaptador } from './chirpstack.adaptador';
import { IdentidadNoVerificada } from './lorawan';
import { CLAVES, resolverClave } from './mapa-claves';
import { MilesightAdaptador } from './milesight.adaptador';

// Adaptadores LoRaWAN (docs/10 §8.4 punto 47) contra el JSON de las fuentes oficiales.
// Identificadores: el DevEUI 0101010101010101 es el del ejemplo oficial de ChirpStack (sintético). El gatewayId del ejemplo y el
// devEUI del ejemplo de Milesight empiezan con el prefijo de un fabricante real: se reemplazaron por valores sintéticos.
const DEVEUI = '0101010101010101';
const ctx = (cuerpo: string, deveui: string | undefined = DEVEUI): ContextoTrama => ({
  topico: `sitio/uct/pasarela/chirpstack-campus/${deveui ?? 'x'}/up`, idFisico: deveui ?? 'x', magnitudTopico: '', carga: Buffer.from(cuerpo, 'utf8'), deveui,
});

// Evento «up» del ejemplo oficial (chirpstack.io/docs/chirpstack/integrations/events.html, copia del 15/10/2026), más un `object`.
function eventoUp(extra: Record<string, unknown> = {}): string {
  return JSON.stringify({
    deduplicationId: '3ac7e3c4-4401-4b8d-9386-a5c902f9202d',
    time: '2022-07-18T09:34:15.775023242+00:00',
    deviceInfo: { tenantName: 'ChirpStack', applicationName: 'Test application', deviceName: 'Test device', devEui: DEVEUI, tags: { key: 'value' } },
    devAddr: '00189440', dr: 1, fPort: 1, data: 'qg==',
    rxInfo: [{ gatewayId: 'aaaaaaaaaaaaaaaa', uplinkId: 4217106255, rssi: -36, snr: 10.5, context: 'E3OWOQ==' }],
    txInfo: { frequency: 867100000, modulation: { lora: { bandwidth: 125000, spreadingFactor: 11, codeRate: 'CR_4_5' } } },
    object: { temperature: 21.5, humidity: 55 },
    ...extra,
  });
}

describe('mapa de claves (docs/10 §8.4 punto 47)', () => {
  // Cada destino del mapa debe existir en el catálogo que siembran las migraciones, con esa misma unidad canónica: una clave que
  // apunte a una magnitud inexistente haría caer todas sus lecturas en cuarentena «canal no declarado» sin que nadie lo note.
  const catalogo = new Map<string, string>();
  const dir = join(__dirname, '../../../../db/init');
  for (const f of readdirSync(dir).filter((x) => x.endsWith('.sql'))) {
    const sql = readFileSync(join(dir, f), 'utf8');
    for (const bloque of sql.match(/INSERT INTO magnitud[\s\S]*?;/g) ?? []) {
      for (const m of bloque.matchAll(/\(\s*'([a-z0-9_]+)',\s*'[^']*',\s*'([^']+)'/g)) catalogo.set(m[1], m[2]);
    }
  }
  it('el catálogo se leyó de las migraciones (si no, la prueba de abajo no probaría nada)', () => {
    expect(catalogo.size).toBeGreaterThanOrEqual(7);
  });
  // Un solo it que recorre el mapa (no it.each): así la cifra de pruebas que cuenta el guardián es la misma que informa jest.
  it('cada clave del mapa → una magnitud del catálogo con su unidad canónica', () => {
    const malas = Object.entries(CLAVES).filter(([, d]) => catalogo.get(d.magnitud) !== d.unidad).map(([k, d]) => `${k} → ${d.magnitud} (${d.unidad})`);
    expect(malas).toEqual([]);
  });
  it('resuelve sin distinguir mayúsculas y no confunde propiedades heredadas con claves', () => {
    expect(resolverClave('Temperature')?.magnitud).toBe('temperatura');
    expect(resolverClave('toString')).toBeUndefined();
    expect(resolverClave('fCnt')).toBeUndefined();
  });
});

describe('ChirpstackAdaptador (evento up de ChirpStack v4)', () => {
  const a = new ChirpstackAdaptador(resolverClave);
  it('reconoce el evento y no un pack SenML ni el JSON de Milesight', () => {
    expect(a.reconoce(ctx(eventoUp()))).toBe(true);
    expect(a.reconoce(ctx('[{"n":"temperatura","v":1}]'))).toBe(false);
    expect(a.reconoce(ctx('{"devEUI":"x","temperature":1}'))).toBe(false);
  });
  it('lecturas desde object, con la marca del servidor de red (RFC 3339 con zona)', () => {
    const c = ctx(eventoUp());
    const l = a.analizar(c);
    expect(l).toEqual([
      { magnitud: 'temperatura', valor: 21.5, unidad: 'Cel', tiempo: new Date('2022-07-18T09:34:15.775Z') },
      { magnitud: 'humedad', valor: 55, unidad: '%RH', tiempo: new Date('2022-07-18T09:34:15.775Z') },
    ]);
    expect(a.origenTiempo).toBe('pasarela');
    expect(c.ignoradas).toEqual([]);
  });
  it('una clave que no está en el mapa se ignora y se anota; si no queda ninguna conocida, malformada', () => {
    const c = ctx(eventoUp({ object: { temperature: 20, battery_voltage: 3.6 } }));
    expect(a.analizar(c)).toHaveLength(1);
    expect(c.ignoradas).toEqual(['battery_voltage']);
    expect(() => a.analizar(ctx(eventoUp({ object: { battery_voltage: 3.6 } })))).toThrow('ninguna clave conocida (llegaron: battery_voltage)');
  });
  it('sin object (el perfil no tiene decodificador) → malformada que dice qué falta', () => {
    const sinObjeto = JSON.parse(eventoUp()) as Record<string, unknown>;
    delete sinObjeto.object;
    expect(() => a.analizar(ctx(JSON.stringify(sinObjeto)))).toThrow('sin object: el perfil del dispositivo en ChirpStack no tiene decodificador');
  });
  it('DevEUI del cuerpo distinto del tópico → IdentidadNoVerificada (una malformada que no marca vivo); mayúsculas no cuentan', () => {
    expect(() => a.analizar(ctx(eventoUp(), 'ffffffffffffffff'))).toThrow(IdentidadNoVerificada);
    expect(a.analizar(ctx(eventoUp(), DEVEUI.toUpperCase()))).toHaveLength(2);
  });
  it('una clave conocida con un valor que no es número → malformada; una hora sin zona → sin marca (rige la recepción)', () => {
    expect(() => a.analizar(ctx(eventoUp({ object: { temperature: 'n/a' } })))).toThrow('temperature: no es un número');
    expect(a.analizar(ctx(eventoUp({ time: '2022-07-18T09:34:15' }))) [0].tiempo).toBeUndefined();
  });
  it('sin DevEUI en el tópico (un tópico directo) → malformada: cerrado por omisión', () => {
    // Ojo: ctx(cuerpo, undefined) activaría el valor por defecto del parámetro; se arma el contexto sin DevEUI a propósito.
    expect(() => a.analizar({ ...ctx(eventoUp()), deveui: undefined })).toThrow('sin DevEUI en el tópico');
  });
  it('dos claves que apuntan a la misma magnitud → vale la primera; la otra se anota como repetida', () => {
    const c = ctx(eventoUp({ object: { temperature: 20, Temperatura: 99 } }));
    expect(a.analizar(c)).toHaveLength(1);
    expect(c.ignoradas).toEqual(['Temperatura (repetida)']);
  });
  it('una clave larga o con saltos de línea se recorta y se limpia antes de ir al detalle o al registro', () => {
    const c = ctx(eventoUp({ object: { temperature: 20, ['x\n'.repeat(40)]: 1 } }));
    a.analizar(c);
    expect(c.ignoradas?.[0]).toBe('x?'.repeat(16));
  });
  it('también los controles C1, los de dirección del texto y los separadores de línea; el recorte no parte un carácter', () => {
    const c = ctx(eventoUp({ object: { temperature: 20, '\u202Eevil\u0085x\u2028y\u2066': 1, ['a'.repeat(31) + '😀z']: 1 } }));
    a.analizar(c);
    expect(c.ignoradas).toEqual(['?evil?x?y?', 'a'.repeat(31) + '😀']);
  });
  it('JSON inválido o que no es objeto → IdentidadNoVerificada: sin cuerpo legible no hay DevEUI que verificar', () => {
    expect(() => a.analizar(ctx('{"deviceInfo":'))).toThrow(IdentidadNoVerificada);
    expect(() => a.analizar(ctx('[1]'))).toThrow(IdentidadNoVerificada);
    expect(IdentidadNoVerificada.prototype).toBeInstanceOf(TramaMalformada); // sigue siendo una malformada: va a cuarentena
  });
});

describe('MilesightAdaptador (servidor de red embebido, con códec y Metadata)', () => {
  const a = new MilesightAdaptador(resolverClave);
  // Forma de la guía oficial de códec con Metadata (devEUI, deviceName, applicationID más los valores decodificados):
  // https://support.milesight-iot.com/support/solutions/articles/73000600064-how-to-use-payload-codec-on-milesight-gateway (15/10/2026).
  // El de «sin códec» sigue la tabla del uplink: https://www.milesight.com/docs/en/mini-gateway/application-guide/uplink-data.html
  const conCodec = (extra: Record<string, unknown> = {}) =>
    JSON.stringify({ devEUI: DEVEUI, deviceName: 'EM300', applicationID: '1', battery: 92, temperature: 30.8, humidity: 50.5, ...extra });
  it('lecturas de los valores decodificados; los metadatos no cuentan como claves ignoradas; sin marca de tiempo', () => {
    const c = ctx(conCodec());
    expect(a.analizar(c)).toEqual([
      { magnitud: 'bateria', valor: 92, unidad: '%EL', tiempo: undefined },
      { magnitud: 'temperatura', valor: 30.8, unidad: 'Cel', tiempo: undefined },
      { magnitud: 'humedad', valor: 50.5, unidad: '%RH', tiempo: undefined },
    ]);
    expect(c.ignoradas).toEqual([]);
  });
  it('sin códec (data en base64, fPort, rxInfo; tabla oficial del uplink) → malformada que dice qué activar', () => {
    const sinCodec = JSON.stringify({ applicationID: '3', devEUI: DEVEUI, fCnt: 1, fPort: 85, data: '/wv//wEB', time: '2025-04-12T02:56:19', rxInfo: [] });
    expect(() => a.analizar(ctx(sinCodec))).toThrow('llegó sin decodificar: activar Payload Codec y Metadata');
  });
  it('con códec pero sin Metadata (no hay devEUI) → malformada que dice qué activar', () => {
    expect(() => a.analizar(ctx('{"battery":92,"temperature":30.8}'))).toThrow('sin devEUI: activar Metadata');
  });
  it('DevEUI cruzado o JSON roto → IdentidadNoVerificada', () => {
    expect(() => a.analizar(ctx(conCodec(), 'ffffffffffffffff'))).toThrow(IdentidadNoVerificada);
    expect(() => a.analizar(ctx('{"devEUI":'))).toThrow(IdentidadNoVerificada);
  });
});
