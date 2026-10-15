import { Pool } from 'pg';
import { AlertasService } from '../alertas/alertas.service';
import { BrokerService } from '../broker/broker.service';
import { SupervisionService } from '../supervision/supervision.service';
import { EventoPanel, EventosService } from '../tiempo-real/eventos.service';
import { ChirpstackAdaptador } from './adaptadores/chirpstack.adaptador';
import { resolverClave } from './adaptadores/mapa-claves';
import { MilesightAdaptador } from './adaptadores/milesight.adaptador';
import { PlanoAdaptador } from './adaptadores/plano.adaptador';
import { SenmlAdaptador } from './adaptadores/senml.adaptador';
import { RecepcionService } from './recepcion.service';

// Prueba el CONTRATO del pipeline con la base y los módulos vecinos simulados (docs/10 §4):
// «vivo» es salud del enlace, no calidad del dato. Un dispositivo autenticado que manda una trama
// que ningún adaptador entiende va a cuarentena Y se marca vivo; uno no registrado, ni lo uno ni lo otro.
describe('RecepcionService: filtro 6 (supervisar) corre siempre tras autenticar', () => {
  // Las cuarentenas que esta prueba provoca a propósito escriben WARN en el registro. Se dejan ver a
  // propósito (decisión del 23/09): el ruido de un rechazo es evidencia de que el filtro actúa; silenciarlo
  // esconde comportamiento.
  const TOPICO = 'sitio/uct/dispositivo/dev-0001/temperatura';
  const T_BASE = new Date('2026-10-09T15:00:00.123456Z'); // la marca que «pone la base» en los RETURNING

  // El dispositivo de prueba declara «plano» salvo que la prueba diga otro formato (despacho por formato: docs/10 §8.4 punto 47).
  type Disp = { id: string; estado: string; sitio_codigo?: string; formato?: string; pasarela_id?: string | null };
  type Pas = { id: string; activo: boolean; sitio_codigo: string };
  function armar(dispositivo: Disp | undefined, duplicada = false, pasarela?: Pas) {
    const canal = { id: 'k1', magnitud: 'temperatura', unidad_canonica: 'Cel', rango_min: -40, rango_max: 85 };
    const query = jest.fn((sql: string, params?: unknown[]) => {
      // El dispositivo de prueba está registrado en el sitio «uct», el mismo del tópico, salvo que la prueba diga otro.
      if (sql.startsWith('SELECT d.id, d.estado, d.formato, d.pasarela_id, s.codigo AS sitio_codigo FROM dispositivo')) {
        return Promise.resolve({ rows: dispositivo ? [{ sitio_codigo: 'uct', formato: 'plano', pasarela_id: null, ...dispositivo }] : [], rowCount: dispositivo ? 1 : 0 });
      }
      if (sql.startsWith('SELECT p.id, p.activo, s.codigo AS sitio_codigo FROM pasarela')) {
        return Promise.resolve({ rows: pasarela ? [pasarela] : [], rowCount: pasarela ? 1 : 0 });
      }
      // Solo el canal «temperatura» está declarado para el dispositivo de prueba; cualquier otro, no.
      if (sql.trimStart().startsWith('SELECT c.id, m.codigo AS magnitud')) return Promise.resolve({ rows: params?.[1] === 'temperatura' ? [canal] : [], rowCount: params?.[1] === 'temperatura' ? 1 : 0 });
      // Una lectura repetida (mismo canal y tiempo) no inserta nada: ON CONFLICT DO NOTHING devuelve 0 filas.
      if (sql.trimStart().startsWith('INSERT INTO medicion')) {
        return Promise.resolve(duplicada ? { rows: [], rowCount: 0 } : { rows: [{ tiempo: T_BASE }], rowCount: 1 });
      }
      if (sql.startsWith('INSERT INTO estado_dispositivo')) return Promise.resolve({ rows: [{ visto_por_ultima_vez: T_BASE }], rowCount: 1 });
      return Promise.resolve({ rows: [], rowCount: 1 });
    });
    const pool = { query } as unknown as Pool;
    const broker = { alRecibir: jest.fn() } as unknown as BrokerService;
    const evaluar = jest.fn();
    const marcarVivo = jest.fn();
    const alertas = { evaluar } as unknown as AlertasService;
    const supervision = { marcarVivo } as unknown as SupervisionService;
    // Lo que el pipeline anuncia al panel en vivo (TT-39), en orden.
    const eventos = new EventosService();
    const publicados: EventoPanel[] = [];
    eventos.flujo().subscribe((e) => publicados.push(e));
    const servicio = new RecepcionService(pool, broker, alertas, supervision, eventos, new SenmlAdaptador(), new PlanoAdaptador(),
      new ChirpstackAdaptador(resolverClave), new MilesightAdaptador(resolverClave));
    return { servicio, query, marcarVivo, evaluar, publicados };
  }

  const cuarentenas = (query: jest.Mock) =>
    query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO cuarentena')).map(([, params]) => (params as unknown[])[2]);
  const marcoVisto = (query: jest.Mock) => query.mock.calls.some(([sql]) => String(sql).startsWith('INSERT INTO estado_dispositivo'));

  it('trama malformada de un dispositivo conocido → cuarentena "malformada" Y marcado vivo', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('hola')); // ni SenML, ni JSON, ni número

    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcoVisto(query)).toBe(true);
    expect(marcarVivo).toHaveBeenCalledWith('d1', 'dev-0001');
    expect(evaluar).not.toHaveBeenCalled(); // sin lecturas no hay umbral que evaluar
  });

  it('dispositivo no registrado → cuarentena "no_registrado" y NO se marca vivo (no pasó el filtro 1)', async () => {
    const { servicio, query, marcarVivo } = armar(undefined);
    await servicio.procesar(TOPICO, Buffer.from('hola'));

    expect(cuarentenas(query)).toEqual(['no_registrado']);
    expect(marcoVisto(query)).toBe(false);
    expect(marcarVivo).not.toHaveBeenCalled();
  });

  it('filtro 1: tópico con el sitio de otra sede → cuarentena "no_registrado" que lo explica, y NO se marca vivo', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo', sitio_codigo: 'otra-sede' });
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    expect(cuarentenas(query)).toEqual(['no_registrado']);
    const detalle = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO cuarentena'))?.[1] as unknown[];
    expect(detalle).toContainEqual(expect.stringContaining('registrado en el sitio «otra-sede», no en «uct»'));
    expect(marcoVisto(query)).toBe(false);
    expect(marcarVivo).not.toHaveBeenCalled();
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('filtro 3: canal no declarado → cuarentena "invalida", pero el dispositivo se marca vivo', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar('sitio/uct/dispositivo/dev-0001/presion', Buffer.from('1013'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('filtro 3: unidad no convertible a la canónica → cuarentena "invalida"', async () => {
    const { servicio, query, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('{"v":300,"u":"furlongs"}'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('filtro 3: valor fuera del rango físico del canal → cuarentena "invalida"', async () => {
    const { servicio, query, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('500'));
    expect(cuarentenas(query)).toEqual(['invalida']);
    expect(evaluar).not.toHaveBeenCalled();
  });

  it('lectura válida → INSERT en medicion, alerta evaluada una vez, vivo una vez', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    expect(cuarentenas(query)).toEqual([]);
    expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(true);
    expect(evaluar).toHaveBeenCalledTimes(1);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
  });

  // Migración 09: una fila de cuarentena por trama, con detalle y dispositivo; trama cruda si guardó algo.
  const filasCuarentena = (query: jest.Mock) =>
    query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO cuarentena')).map(([, p]) => {
      const [, , motivo, , detalle, dispositivoId, recibidoEn] = p as unknown[];
      return { motivo, detalle: detalle as string, dispositivoId, recibidoEn };
    });
  const tramas = (query: jest.Mock) =>
    query.mock.calls.filter(([sql]) => String(sql).startsWith('INSERT INTO trama')).map(([, p]) => p as unknown[]);

  it('dos lecturas inválidas en una trama → UNA fila "invalida" con los dos porqués y el dispositivo', async () => {
    const { servicio, query } = armar({ id: 'd1', estado: 'activo', formato: 'senml' });
    await servicio.procesar(TOPICO, Buffer.from('[{"n":"temperatura","v":500},{"n":"presion","v":1013}]'));
    const filas = filasCuarentena(query);
    expect(filas).toHaveLength(1);
    expect(filas[0].motivo).toBe('invalida');
    expect(filas[0].detalle).toBe('temperatura: 500 Cel fuera del rango físico [-40, 85]; presion: canal no declarado para este dispositivo');
    expect(filas[0].dispositivoId).toBe('d1');
    expect(filas[0].recibidoEn).toBeInstanceOf(Date);
    expect(tramas(query)).toHaveLength(0); // nada se guardó: no hay trama aceptada
  });

  it('no registrado → sin dispositivo_id; dado de baja → identificado y con la pista de revocar la credencial', async () => {
    const noRegistrado = armar(undefined);
    await noRegistrado.servicio.procesar(TOPICO, Buffer.from('21.5'));
    expect(filasCuarentena(noRegistrado.query)[0]).toMatchObject({ motivo: 'no_registrado', dispositivoId: null });

    const deBaja = armar({ id: 'd9', estado: 'baja' });
    await deBaja.servicio.procesar(TOPICO, Buffer.from('21.5'));
    const fila = filasCuarentena(deBaja.query)[0];
    expect(fila).toMatchObject({ motivo: 'dado_de_baja', dispositivoId: 'd9' });
    expect(fila.detalle).toContain('revocar su credencial');
  });

  it('una lectura buena y una mala → se guarda la trama cruda Y la mala va a cuarentena', async () => {
    const { servicio, query } = armar({ id: 'd1', estado: 'activo', formato: 'senml' });
    await servicio.procesar(TOPICO, Buffer.from('[{"n":"temperatura","v":21},{"n":"presion","v":1013}]'));
    expect(filasCuarentena(query).map((f) => f.motivo)).toEqual(['invalida']);
    const t = tramas(query);
    expect(t).toHaveLength(1);
    const [dispositivoId, recibidoEn, topico, , adaptador] = t[0];
    expect({ dispositivoId, topico, adaptador }).toEqual({ dispositivoId: 'd1', topico: TOPICO, adaptador: 'senml' });
    expect(recibidoEn).toBeInstanceOf(Date);
  });

  // Migración 08: cada medición dice cuándo llegó y quién puso su marca de tiempo (docs/10 §8.4 punto 12).
  const insertMedicion = (query: jest.Mock) =>
    query.mock.calls.find(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))?.[1] as unknown[];

  it('sin marca del emisor → origen_tiempo "recepcion", tiempo lo pone la base y recibido_en es la llegada', async () => {
    const { servicio, query } = armar({ id: 'd1', estado: 'activo' });
    const antes = Date.now();
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    const [, tiempo, , , recibidoEn, origen] = insertMedicion(query);
    expect(tiempo).toBeNull();
    expect(origen).toBe('recepcion');
    expect((recibidoEn as Date).getTime()).toBeGreaterThanOrEqual(antes);
  });

  it('marca del emisor plausible → origen_tiempo el que declara el adaptador ("dispositivo")', async () => {
    const { servicio, query } = armar({ id: 'd1', estado: 'activo' });
    const hace1min = Math.floor(Date.now() / 1000) - 60;
    await servicio.procesar(TOPICO, Buffer.from(`{"valor":21.5,"tiempo":${hace1min}}`));
    const [, tiempo, , , recibidoEn, origen] = insertMedicion(query);
    expect((tiempo as Date).getTime()).toBe(hace1min * 1000);
    expect(origen).toBe('dispositivo');
    expect((recibidoEn as Date).getTime()).toBeGreaterThan((tiempo as Date).getTime()); // deriva medible
  });

  it('tópico fuera del patrón → cuarentena "malformada" ANTES del filtro 1: sin identidad no hay a quién marcar vivo', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar('otra/cosa', Buffer.from('22.4'));
    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcoVisto(query)).toBe(false);
    expect(marcarVivo).not.toHaveBeenCalled();
  });

  it('cuerpo vacío → ningún adaptador lo reconoce → cuarentena "malformada", y vivo (el dispositivo sí se autenticó)', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.alloc(0));
    expect(cuarentenas(query)).toEqual(['malformada']);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
  });

  it('RF-22: en mantenimiento la lectura se guarda y se marca vivo; el filtro 5 recibe la señal de no abrir alertas', async () => {
    const { servicio, query, marcarVivo, evaluar } = armar({ id: 'd1', estado: 'mantenimiento' });
    await servicio.procesar(TOPICO, Buffer.from('35'));
    expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(true);
    expect(evaluar).toHaveBeenCalledWith('d1', 'k1', 'dev-0001', 35, 'Cel', true);
    expect(marcarVivo).toHaveBeenCalledTimes(1);
  });

  it('dispositivo dado de baja → cuarentena "dado_de_baja", no se marca vivo', async () => {
    const { servicio, query, marcarVivo } = armar({ id: 'd9', estado: 'baja' });
    await servicio.procesar(TOPICO, Buffer.from('21.5'));

    expect(cuarentenas(query)).toEqual(['dado_de_baja']);
    expect(marcarVivo).not.toHaveBeenCalled();
  });

  // TT-39: el panel se entera solo de lo que ya está guardado, con la marca de tiempo que puso la base.
  it('TT-39: lectura guardada → evento "medicion" con la marca de la base, y después "visto"', async () => {
    const { servicio, publicados } = armar({ id: 'd1', estado: 'activo' });
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    expect(publicados).toEqual([
      { tipo: 'medicion', dispositivo_id: 'd1', canal_id: 'k1', valor: 22.4, unidad: 'Cel', tiempo: T_BASE.toISOString() },
      { tipo: 'visto', dispositivo_id: 'd1', tiempo: T_BASE.toISOString() },
    ]);
  });

  it('TT-39: lectura repetida → sin evento "medicion" (no hay nada nuevo que dibujar), pero sí "visto"', async () => {
    const { servicio, publicados } = armar({ id: 'd1', estado: 'activo' }, true);
    await servicio.procesar(TOPICO, Buffer.from('22.4'));
    expect(publicados.map((e) => e.tipo)).toEqual(['visto']);
  });

  it('TT-39: trama en cuarentena → solo "visto"; no registrado o dado de baja → ningún evento', async () => {
    const malformada = armar({ id: 'd1', estado: 'activo' });
    await malformada.servicio.procesar(TOPICO, Buffer.from('hola'));
    expect(malformada.publicados.map((e) => e.tipo)).toEqual(['visto']);
    for (const dispositivo of [undefined, { id: 'd9', estado: 'baja' }]) {
      const { servicio, publicados } = armar(dispositivo);
      await servicio.procesar(TOPICO, Buffer.from('22.4'));
      expect(publicados).toEqual([]);
    }
  });
  describe('filtro 2: despacho por el formato declarado (docs/10 §8.4 puntos 25 y 47)', () => {
    const detalleCuarentena = (query: jest.Mock) =>
      (query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO cuarentena'))?.[1] as unknown[])?.[4];
    it('SenML a un dispositivo que declaró plano → malformada «la trama no tiene esa forma», sin lecturas, y vivo', async () => {
      const { servicio, query, marcarVivo } = armar({ id: 'd1', estado: 'activo', formato: 'plano' });
      await servicio.procesar(TOPICO, Buffer.from('[{"n":"temperatura","v":21}]'));
      expect(cuarentenas(query)).toEqual(['malformada']);
      expect(detalleCuarentena(query)).toBe('formato declarado plano: la trama no tiene esa forma');
      expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(false);
      expect(marcarVivo).toHaveBeenCalledWith('d1', 'dev-0001');
    });
    it('plano a un dispositivo que declaró senml → malformada, aunque el adaptador plano la habría entendido', async () => {
      const { servicio, query } = armar({ id: 'd1', estado: 'activo', formato: 'senml' });
      await servicio.procesar(TOPICO, Buffer.from('22.4'));
      expect(cuarentenas(query)).toEqual(['malformada']);
      expect(detalleCuarentena(query)).toBe('formato declarado senml: la trama no tiene esa forma');
    });
    it('el mismo SenML a un dispositivo que declaró senml → guardado', async () => {
      const { servicio, query } = armar({ id: 'd1', estado: 'activo', formato: 'senml' });
      await servicio.procesar(TOPICO, Buffer.from('[{"n":"temperatura","v":21}]'));
      expect(cuarentenas(query)).toEqual([]);
      expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(true);
    });
    it('un formato de pasarela por el tópico de un dispositivo directo → malformada «no se recibe por este tópico»', async () => {
      const { servicio, query } = armar({ id: 'd1', estado: 'activo', formato: 'milesight' });
      await servicio.procesar(TOPICO, Buffer.from('{"devEUI":"x","temperature":21}'));
      expect(cuarentenas(query)).toEqual(['malformada']);
      expect(detalleCuarentena(query)).toBe('formato declarado milesight: no se recibe por este tópico');
    });
  });
  describe('tópico de pasarela: rutas B y C (docs/10 §8.4 punto 47 y §4.1)', () => {
    const PAS: Pas = { id: 'p1', activo: true, sitio_codigo: 'uct' };
    const NODO: Disp = { id: 'n1', estado: 'activo', formato: 'chirpstack', pasarela_id: 'p1' };
    const T_UP = 'sitio/uct/pasarela/chirpstack-campus/0101010101010101/up';
    const up = (devEui = '0101010101010101', objeto: object = { temperature: 21.5 }) =>
      Buffer.from(JSON.stringify({ time: '2026-10-15T12:00:00Z', deviceInfo: { devEui }, object: objeto }));
    const escrituras = (query: jest.Mock) => query.mock.calls.filter(([sql]) => /^\s*(INSERT|UPDATE)/.test(String(sql)));
    const detalle = (query: jest.Mock) => (query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO cuarentena'))?.[1] as unknown[])?.[4];

    it('un «up» de un nodo asociado → lectura guardada, trama cruda con su adaptador y nodo vivo', async () => {
      const { servicio, query, marcarVivo } = armar(NODO, false, PAS);
      await servicio.procesar(T_UP, up());
      expect(cuarentenas(query)).toEqual([]);
      expect(query.mock.calls.some(([sql]) => String(sql).trimStart().startsWith('INSERT INTO medicion'))).toBe(true);
      const trama = query.mock.calls.find(([sql]) => String(sql).startsWith('INSERT INTO trama'))?.[1] as unknown[];
      expect(trama[4]).toBe('chirpstack');
      expect(marcarVivo).toHaveBeenCalledWith('n1', '0101010101010101');
    });
    it('un evento distinto de «up» (join) se cuenta y termina: no escribe nada en la base (punto 27)', async () => {
      const { servicio, query, marcarVivo } = armar(NODO, false, PAS);
      await servicio.procesar('sitio/uct/pasarela/chirpstack-campus/0101010101010101/join', Buffer.from('{}'));
      expect(escrituras(query)).toEqual([]);
      expect(marcarVivo).not.toHaveBeenCalled();
    });
    it('pasarela sin alta, inactiva o de otro sitio → no_registrado con cualquier evento, y nadie vivo', async () => {
      for (const [pas, texto] of [[undefined, 'sin alta'], [{ ...PAS, activo: false }, 'inactiva'], [{ ...PAS, sitio_codigo: 'otra' }, 'registrada en el sitio «otra»']] as const) {
        const { servicio, query, marcarVivo } = armar(NODO, false, pas);
        await servicio.procesar('sitio/uct/pasarela/chirpstack-campus/0101010101010101/join', up());
        expect(cuarentenas(query)).toEqual(['no_registrado']);
        expect(detalle(query)).toContain(texto);
        expect(marcarVivo).not.toHaveBeenCalled();
      }
    });
    it('DevEUI no asociado a esa pasarela (o un dispositivo directo con ese id) → no_registrado', async () => {
      const { servicio, query } = armar({ ...NODO, pasarela_id: 'otra' }, false, PAS);
      await servicio.procesar(T_UP, up());
      expect(cuarentenas(query)).toEqual(['no_registrado']);
      expect(detalle(query)).toBe('DevEUI 0101010101010101 no está asociado a la pasarela chirpstack-campus');
    });
    it('el DevEUI del tópico se busca en minúsculas, la forma de id_fisico', async () => {
      const { servicio, query } = armar(NODO, false, PAS);
      // Un DevEUI con letras (sintético): en mayúsculas en el tópico y en minúsculas en el cuerpo, es el mismo nodo.
      await servicio.procesar('sitio/uct/pasarela/chirpstack-campus/A1B2C3D4E5F60708/up', up('a1b2c3d4e5f60708'));
      const busqueda = query.mock.calls.find(([sql]) => String(sql).startsWith('SELECT d.id'))?.[1] as unknown[];
      expect(busqueda[0]).toBe('a1b2c3d4e5f60708');
      expect(cuarentenas(query)).toEqual([]);
    });
    it('DevEUI del cuerpo distinto del tópico → malformada y el nodo NO se marca vivo', async () => {
      const { servicio, query, marcarVivo } = armar(NODO, false, PAS);
      await servicio.procesar(T_UP, up('ffffffffffffffff'));
      expect(cuarentenas(query)).toEqual(['malformada']);
      expect(marcarVivo).not.toHaveBeenCalled();
    });
    it('un «up» sin ninguna clave del mapa → malformada, y el nodo vivo (es un dispositivo autenticado)', async () => {
      const { servicio, query, marcarVivo } = armar(NODO, false, PAS);
      await servicio.procesar(T_UP, up(undefined, { battery_voltage: 3.6 }));
      expect(cuarentenas(query)).toEqual(['malformada']);
      expect(marcarVivo).toHaveBeenCalledWith('n1', '0101010101010101');
    });
    it('un formato directo por el tópico de pasarela → malformada «no se recibe por este tópico»', async () => {
      const { servicio, query } = armar({ ...NODO, formato: 'senml' }, false, PAS);
      await servicio.procesar(T_UP, Buffer.from('[{"n":"temperatura","v":1}]'));
      expect(detalle(query)).toBe('formato declarado senml: no se recibe por este tópico');
    });
  });
});
