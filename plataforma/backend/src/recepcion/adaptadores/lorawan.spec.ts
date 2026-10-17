import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ContextoTrama } from '../lectura';
import { TramaMalformada } from './adaptador';
import { ChirpstackAdaptador } from './chirpstack.adaptador';
import { IdentidadNoVerificada } from './lorawan';
import { CLAVES, resolverClave } from './mapa-claves';
import { MilesightAdaptador } from './milesight.adaptador';
import { PERFILES, decodificar } from './perfiles';

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
  it('un DevEUI del cuerpo con controles o fuera de ASCII → IdentidadNoVerificada, y el motivo no los repite (revisión del 15/10)', () => {
    for (const devEui of ['0101\n\u202E0101010101', '\u212A101010101010101']) {
      let motivo = '';
      try {
        a.analizar(ctx(eventoUp({ deviceInfo: { deviceName: 'banco', devEui } })));
      } catch (e) {
        expect(e).toBeInstanceOf(IdentidadNoVerificada);
        motivo = (e as Error).message;
      }
      expect(motivo).not.toBe('');
      expect(motivo).not.toMatch(/[\n\u202E]/);
    }
  });
  it('los espacios invisibles y los rellenos también se marcan; el espacio común se respeta', () => {
    const c = ctx(eventoUp({ object: { temperature: 20, 'a\u00A0b\u3164c\u2800d\u180Be\u{E0100}f': 1, 'battery voltage': 3.6 } }));
    a.analizar(c);
    expect(c.ignoradas).toEqual(['a?b?c?d?e?f', 'battery voltage']);
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
  it('con códec: si la trama trae fCnt se anota para deduplicar y no cuenta como clave ignorada; si no lo trae, sin contador', () => {
    const c = ctx(conCodec({ fCnt: 77 }));
    expect(a.analizar(c)).toHaveLength(3);
    expect(c.fcnt).toBe(77);
    expect(c.ignoradas).toEqual([]);
    const sin = ctx(conCodec());
    a.analizar(sin);
    expect(sin.fcnt).toBeUndefined();
  });
  it('con códec pero sin Metadata (no hay devEUI) → malformada que dice qué activar', () => {
    expect(() => a.analizar(ctx('{"battery":92,"temperature":30.8}'))).toThrow('sin devEUI: activar Metadata');
  });
  it('DevEUI cruzado o JSON roto → IdentidadNoVerificada', () => {
    expect(() => a.analizar(ctx(conCodec(), 'ffffffffffffffff'))).toThrow(IdentidadNoVerificada);
    expect(() => a.analizar(ctx('{"devEUI":'))).toThrow(IdentidadNoVerificada);
  });
});

// Captura real de la pasarela UG65 del campus (15/10/2026, `mosquitto_sub -v` en su broker; docs/10 §8.4 punto 47), saneada: el
// devEUI, el EUI de la pasarela (rxInfo[].mac, con prefijo de fabricante) y el nombre del nodo se reemplazaron por sintéticos. Se omite
// `cellularIP`: tiene forma de dirección IP y el adaptador no la usa. Todo lo demás es literal, `data` incluida.
const CAPTURA_UG65 = {
  applicationID: '3', applicationName: 'app-de-prueba', data: 'AgAAAI8HGBmYrw==', devEUI: DEVEUI, deviceName: 'nodo-2', fCnt: 142, fPort: 1,
  gatewayTime: '2026-10-15T12:34:56-03:00',
  rxInfo: [{ altitude: 0, gpsEnable: false, latitude: 0, loRaSNR: 10.2, longitude: 0, mac: 'aaaaaaaaaaaaaaaa', name: 'Local Gateway', rssi: -46, time: '2026-10-15T15:34:56.340333Z' }],
  time: '2026-10-15T15:34:56.340333Z',
  txInfo: { adr: true, codeRate: '4/5', dataRate: { bandwidth: 125, modulation: 'LORA', spreadFactor: 7 }, frequency: 917000000 },
};
const PERFIL = 'campus-heltec-v3-v1';
const conPerfil = (cuerpo: object, perfil: string | undefined = PERFIL): ContextoTrama => ({ ...ctx(JSON.stringify(cuerpo)), decodificador: perfil });
// Los 10 bytes del perfil con los valores que se quieran probar (nodo 2, secuencia 143).
const datos = (centesimasC: number, centesimasHR: number, bateria: number): string => {
  const b = Buffer.alloc(10);
  b.writeUInt8(2, 0); b.writeUInt32BE(143, 1); b.writeInt16BE(centesimasC, 5); b.writeUInt16BE(centesimasHR, 7); b.writeUInt8(bateria, 9);
  return b.toString('base64');
};

describe('perfil campus-heltec-v3-v1 con la captura de la UG65 del campus (migración 17; docs/10 §8.4 punto 47 y §4.1)', () => {
  const a = new MilesightAdaptador(resolverClave);
  it('la captura con perfil → 18,16 °C, 65,52 % y 3,75 V con la marca del servidor de red; fCnt anotado; nada ignorado', () => {
    const c = conPerfil(CAPTURA_UG65);
    const t = new Date('2026-10-15T15:34:56.340Z');
    expect(a.analizar(c)).toEqual([
      { magnitud: 'temperatura', valor: 18.16, unidad: 'Cel', tiempo: t },
      { magnitud: 'humedad', valor: 65.52, unidad: '%RH', tiempo: t },
      { magnitud: 'tension', valor: 3.75, unidad: 'V', tiempo: t },
    ]);
    expect(c.fcnt).toBe(142);
    expect(c.ignoradas).toEqual([]);
  });
  it('la misma captura sin perfil → malformada que dice qué activar o declarar, y el DevEUI ya verificado (no es IdentidadNoVerificada)', () => {
    let e: unknown;
    // Sin decodificador a propósito: conPerfil(cuerpo, undefined) activaría el valor por defecto del parámetro.
    try { a.analizar(ctx(JSON.stringify(CAPTURA_UG65))); } catch (x) { e = x; }
    expect(e).toBeInstanceOf(TramaMalformada);
    expect(e).not.toBeInstanceOf(IdentidadNoVerificada);
    expect((e as Error).message).toContain('activar Payload Codec y Metadata en la aplicación de la pasarela, o declarar el perfil de decodificación del nodo');
  });
  it('temperatura bajo cero (entero con signo) y los extremos de la batería', () => {
    const [temp, , tension] = a.analizar(conPerfil({ ...CAPTURA_UG65, data: datos(-525, 0, 0) }));
    expect(temp.valor).toBe(-5.25);
    expect(tension.valor).toBe(2);
    expect(a.analizar(conPerfil({ ...CAPTURA_UG65, data: datos(0, 10000, 255) }))[2].valor).toBe(4.55);
  });
  it('time sin zona → sin marca (rige la recepción); sin time, igual', () => {
    expect(a.analizar(conPerfil({ ...CAPTURA_UG65, time: '2026-10-15T15:34:56' }))[0].tiempo).toBeUndefined();
    const sinTime: Record<string, unknown> = { ...CAPTURA_UG65 };
    delete sinTime.time;
    expect(a.analizar(conPerfil(sinTime))[0].tiempo).toBeUndefined();
  });
  it('data que no es base64 estricto o no mide 10 bytes → malformada (el nodo se marcará vivo: su DevEUI ya se verificó)', () => {
    for (const [data, motivo] of [['AgAAAI8HGBmY', '10 bytes y llegaron 9'], ['AgAAAI8HGBmYrw', 'no es base64'], ['AgAAAI8H GBmYrw==', 'no es base64'], ['', 'no es base64']] as const) {
      let e: unknown;
      try { a.analizar(conPerfil({ ...CAPTURA_UG65, data, fPort: 1 })); } catch (x) { e = x; }
      expect(e).toBeInstanceOf(TramaMalformada);
      expect(e).not.toBeInstanceOf(IdentidadNoVerificada);
      expect((e as Error).message).toContain(motivo);
    }
  });
  it('fCnt fuera de 0..2³²−1, no entero o como texto → malformada; ausente → la trama sigue, sin contador', () => {
    for (const fCnt of [-1, 1.5, '142', 2 ** 32]) {
      expect(() => a.analizar(conPerfil({ ...CAPTURA_UG65, fCnt }))).toThrow('fCnt no es un entero entre 0 y 4294967295');
    }
    const sinFcnt: Record<string, unknown> = { ...CAPTURA_UG65 };
    delete sinFcnt.fCnt;
    const c = conPerfil(sinFcnt);
    expect(a.analizar(c)).toHaveLength(3);
    expect(c.fcnt).toBeUndefined();
    const max = conPerfil({ ...CAPTURA_UG65, fCnt: 2 ** 32 - 1 });
    a.analizar(max);
    expect(max.fcnt).toBe(4294967295);
  });
  it('un perfil que el código no conoce (base sin migrar, perfil retirado) → malformada que lo nombra, limpio', () => {
    expect(() => a.analizar(conPerfil(CAPTURA_UG65, 'otro\nperfil'))).toThrow('perfil de decodificación desconocido: otro?perfil');
  });
  it('el DevEUI se verifica antes de decodificar: con otro DevEUI → IdentidadNoVerificada aunque haya perfil', () => {
    expect(() => a.analizar(conPerfil({ ...CAPTURA_UG65, devEUI: 'ffffffffffffffff' }))).toThrow(IdentidadNoVerificada);
  });
  it('ChirpStack sin object y con perfil → decodifica data con la marca del evento y anota fCnt; con object, el perfil no se usa', () => {
    const cs = new ChirpstackAdaptador(resolverClave);
    const sinObjeto = JSON.parse(eventoUp({ data: CAPTURA_UG65.data, fCnt: 7 })) as Record<string, unknown>;
    delete sinObjeto.object;
    const c = conPerfil(sinObjeto);
    expect(cs.analizar(c).map((l) => [l.magnitud, l.valor, l.tiempo?.toISOString()])).toEqual([
      ['temperatura', 18.16, '2022-07-18T09:34:15.775Z'], ['humedad', 65.52, '2022-07-18T09:34:15.775Z'], ['tension', 3.75, '2022-07-18T09:34:15.775Z'],
    ]);
    expect(c.fcnt).toBe(7);
    expect(cs.analizar(conPerfil(JSON.parse(eventoUp()) as object))).toHaveLength(2); // temperature y humidity del object
    expect(() => cs.analizar(ctx(JSON.stringify(sinObjeto)))).toThrow('ni el nodo un perfil de decodificación');
  });
});

describe('perfiles: la lista del código es la del CHECK y cada lectura existe en el catálogo (migración 17)', () => {
  const sql = readdirSync(join(__dirname, '../../../../db/init')).filter((x) => x.endsWith('.sql')).sort()
    .map((f) => readFileSync(join(__dirname, '../../../../db/init', f), 'utf8')).join('\n');
  it('PERFILES == el dominio de ck_dispositivo_decodificador en la última migración que lo define', () => {
    const definiciones = [...sql.matchAll(/ADD CONSTRAINT ck_dispositivo_decodificador CHECK \(decodificador IN \(([^)]*)\)\)/g)];
    expect(definiciones.length).toBeGreaterThanOrEqual(1);
    const enLaBase = [...definiciones[definiciones.length - 1][1].matchAll(/'([^']+)'/g)].map((m) => m[1]).sort();
    expect([...PERFILES].sort()).toEqual(enLaBase);
  });
  it('cada lectura del perfil → una magnitud del catálogo con su unidad canónica (si no, iría a cuarentena «canal no declarado»)', () => {
    const catalogo = new Map<string, string>();
    for (const bloque of sql.match(/INSERT INTO magnitud[\s\S]*?;/g) ?? []) {
      for (const m of bloque.matchAll(/\(\s*'([a-z0-9_]+)',\s*'[^']*',\s*'([^']+)'/g)) catalogo.set(m[1], m[2]);
    }
    const malas = PERFILES.flatMap((p) => decodificar(p, CAPTURA_UG65.data, undefined))
      .filter((l) => catalogo.get(l.magnitud) !== l.unidad).map((l) => `${l.magnitud} (${l.unidad})`);
    expect(catalogo.get('tension')).toBe('V');
    expect(malas).toEqual([]);
  });
});
