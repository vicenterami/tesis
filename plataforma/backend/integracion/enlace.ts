// Prueba de integración de la señal del enlace LoRaWAN (HU-15; docs/10 §8.4 puntos 71 y 72; docs/19 §4 AA; migraciones 29 y 30) contra una base REAL: la
// corre plataforma/pruebas/enlace-integracion.sh, que levanta una base desechable sin red con todas las migraciones. La aplicación compilada
// corre en este proceso, en un puerto efímero de 127.0.0.1, con el rol plataforma_app (así se prueban también sus permisos). Sin broker: las
// tramas entran por RecepcionService.procesar, el mismo método que llama el broker con cada mensaje. Cada comprobación imprime OK o FALLA;
// sale 1 si alguna falla. Fuera de src/: no entra a la imagen ni a `pnpm test`.
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { Pool } from 'pg';

const socket = process.env.PRUEBA_DB_SOCKET ?? '';
if (socket === '') throw new Error('falta PRUEBA_DB_SOCKET: corre plataforma/pruebas/enlace-integracion.sh');
const dueno = new Pool({ host: socket, user: 'plataforma', database: 'plataforma', max: 3 });

let fallos = 0;
let n = 0;
function comprobar(ok: boolean, texto: string, detalle = ''): void {
  n++;
  if (ok) console.log(`OK    ${texto}`);
  else { fallos++; console.log(`FALLA ${texto}${detalle ? ` · ${detalle.slice(0, 600)}` : ''}`); }
}
const q = (sql: string, p: unknown[] = []) => dueno.query(sql, p);

let BASE = '';
interface Persona { cookie: string; id: string }
interface Respuesta { estado: number; cuerpo: Record<string, unknown> & { [k: string]: unknown } }
async function pedir(quien: Persona, metodo: string, ruta: string, cuerpo?: unknown): Promise<Respuesta> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { cookie: quien.cookie, 'X-Pedido': 'panel', ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }) },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json: unknown;
  try { json = texto === '' ? {} : JSON.parse(texto); } catch { json = { texto }; }
  return { estado: r.status, cuerpo: json as Respuesta['cuerpo'] };
}

async function principal() {
  const m = await q("SELECT nombre, unidad_canonica, rango_min, rango_max FROM magnitud WHERE codigo = 'snr'");
  comprobar(JSON.stringify(m.rows) === JSON.stringify([{ nombre: 'Relación señal/ruido', unidad_canonica: 'dB', rango_min: -32, rango_max: 32 }]),
    'migración 29: snr «Relación señal/ruido», dB, de −32 a 32', JSON.stringify(m.rows));

  const sitio = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Campus de prueba', 'en-campus', 'America/Santiago') RETURNING id`)).rows[0].id as string;
  const otro = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Otro', 'en-otro', 'America/Santiago') RETURNING id`)).rows[0].id as string;
  const zona = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'Laboratorio') RETURNING id`, [sitio])).rows[0].id as string;
  const pas = (await q(`INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ($1, 'en-pasarela', 'Pasarela', 'chirpstack') RETURNING id`, [sitio])).rows[0].id as string;
  const nodo = async (id: string): Promise<string> => (await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato, pasarela_id)
       VALUES ($1, $2, $3, 180, 'lorawan', 'chirpstack', $4) RETURNING id`, [zona, id, `Nodo ${id.slice(-2)}`, pas])).rows[0].id as string;
  const SIN = '0101010101010101';
  const CON = '0202020202020202';
  const sin = await nodo(SIN);
  const con = await nodo(CON);
  for (const d of [sin, con]) await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ($1, 'temperatura')`, [d]);

  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: socket, DB_PUERTO: '5432', DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-enlace', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
    SUPERVISION_INTERVALO_S: '3600',
  });
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const recepcionRuta = '../dist/recepcion/recepcion.service.js';
  const { RecepcionService } = (await import(recepcionRuta)) as { RecepcionService: Type<{ procesar(t: string, c: Buffer): Promise<void> }> };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  BASE = (await nest.getUrl()).replace('[::1]', '127.0.0.1');
  const recepcion = nest.get(RecepcionService);

  const persona = async (rol: string | null, deSitio = sitio): Promise<Persona> => {
    const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en, administrador_sistema)
                       VALUES ($1, $2, 'x', 1, now(), $3) RETURNING id`, [`Persona ${rol ?? 'sistema'}`, `${rol ?? 'sistema'}-${randomBytes(4).toString('hex')}@prueba-en.invalid`, rol === null]);
    if (rol !== null) await q('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [u.rows[0].id, deSitio, rol]);
    const identificador = randomBytes(32).toString('base64url');
    await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), u.rows[0].id]);
    return { cookie: `__Host-sesion=${identificador}`, id: u.rows[0].id as string };
  };
  const up = (deveui: string, rxInfo: unknown, objeto: object = { temperature: 21.5 }, segundos = 0) => Buffer.from(JSON.stringify({
    time: new Date(Date.now() - 30_000 + segundos * 1000).toISOString(), deviceInfo: { devEui: deveui }, object: objeto, rxInfo,
    txInfo: { frequency: 916800000, modulation: { lora: { bandwidth: 125000, spreadingFactor: 7, codeRate: 'CR_4_5' } } }, // como lo manda ChirpStack v4
  }));
  const topico = (deveui: string) => `sitio/en-campus/pasarela/en-pasarela/${deveui}/up`;
  const lecturas = async (id: string): Promise<string> => (await q(`SELECT string_agg(c.magnitud_codigo || '=' || m.valor, ',' ORDER BY m.tiempo, c.magnitud_codigo) AS s
       FROM medicion m JOIN canal c ON c.id = m.canal_id WHERE c.dispositivo_id = $1`, [id])).rows[0].s ?? '';
  const cuarentenas = async (id: string): Promise<number> => Number((await q('SELECT count(*) AS n FROM cuarentena WHERE dispositivo_id = $1', [id])).rows[0].n);
  const ventana = async (id: string): Promise<number> => Number((await q('SELECT ventana_lecturas AS n FROM estado_dispositivo WHERE dispositivo_id = $1', [id])).rows[0]?.n ?? -1);

  try {
    const operador = await persona('operador');
    const consulta = await persona('consulta');
    const adminOtro = await persona('administrador', otro);

    // ── «Agregar una magnitud» (POST /dispositivos/{id}/canales) ──
    let r = await pedir(consulta, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'snr' });
    comprobar(r.estado === 403, 'POST …/canales con perfil de consulta → 403', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(adminOtro, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'snr' });
    comprobar(r.estado === 404, 'POST …/canales a un equipo de otro sitio → 404 (no se revela)', `${r.estado}`);
    r = await pedir(operador, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'radon' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no está en el catálogo'), 'POST …/canales con una magnitud fuera del catálogo → 400 que lo dice', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    const antes = (await q('SELECT count(*) AS n FROM canal WHERE dispositivo_id = $1', [con])).rows[0].n;
    r = await pedir(operador, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'snr' });
    const r2 = await pedir(operador, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'SNR' });
    await pedir(operador, 'POST', `/dispositivos/${con}/canales`, { magnitud: 'rssi' });
    const despues = (await q('SELECT count(*) AS n FROM canal WHERE dispositivo_id = $1', [con])).rows[0].n;
    const ev = await q("SELECT detalle, usuario_id FROM evento WHERE tipo = 'canal_alta' AND dispositivo_id = $1 ORDER BY ocurrido_en", [con]);
    comprobar(r.estado === 200 && r.cuerpo.agregada === true && r2.estado === 200 && r2.cuerpo.agregada === false && Number(despues) - Number(antes) === 2,
      'operador técnico: agrega snr (agregada), repetir es idempotente (agregada false) y rssi suma otro: 2 canales nuevos', `${r.estado}/${r2.estado} ${antes}→${despues}`);
    comprobar(ev.rows.length === 2 && ev.rows.every((e) => e.usuario_id === operador.id) && (ev.rows[0].detalle as { magnitud: string }).magnitud === 'snr',
      'un evento canal_alta por canal nuevo, con quién y la magnitud (la repetición no deja evento)', JSON.stringify(ev.rows));
    const act = (await pedir(await persona('administrador'), 'GET', `/sitios/${sitio}/actividad?limite=50`)).cuerpo as unknown as { tipo: string; texto: string }[];
    comprobar(act.some((a) => a.tipo === 'canal_alta' && a.texto === 'agregó una magnitud a «Nodo 02» (snr)'), 'Actividad: «agregó una magnitud a «Nodo 02» (snr)»',
      JSON.stringify(act.filter((a) => a.tipo === 'canal_alta')));

    // ── El pipeline: canal declarado o no ──
    const RX = [{ gatewayId: 'aaaaaaaaaaaaaaaa', rssi: -87, snr: 7.5 }, { gatewayId: 'ffffffffffffffff', rssi: -60, snr: -3 }];
    await recepcion.procesar(topico(SIN), up(SIN, RX));
    await recepcion.procesar(topico(CON), up(CON, RX));
    comprobar(await lecturas(sin) === 'temperatura=21.5' && await ventana(sin) === 1 && await cuarentenas(sin) === 0,
      'un nodo SIN los canales del enlace: exactamente lo de antes (1 lectura, 1 en la ventana, ninguna cuarentena)', `${await lecturas(sin)} · ${await ventana(sin)}`);
    comprobar(await lecturas(con) === 'rssi=-87,snr=7.5,temperatura=21.5' && await ventana(con) === 3 && await cuarentenas(con) === 0,
      'un nodo CON rssi y snr: la señal del mejor receptor (mayor SNR) junto a la lectura, 3 en la ventana, sin cuarentena', `${await lecturas(con)} · ${await ventana(con)}`);
    await recepcion.procesar(topico(CON), up(CON, [{ rssi: -95, snr: 40 }], { temperature: 22 }, 5));
    comprobar((await lecturas(con)).endsWith('rssi=-95,temperatura=22') && await cuarentenas(con) === 0,
      'snr de 40 dB (fuera de −32 a 32): se omite SIN cuarentena; el rssi y la lectura se guardan', await lecturas(con));
    await recepcion.procesar(topico(CON), up(CON, [{ rssi: -101 }], { temperature: 23 }, 10));
    comprobar((await lecturas(con)).endsWith('rssi=-101,snr=0,temperatura=23'), 'ChirpStack con modulación LoRa: un receptor con rssi y sin snr (0 dB omitido por el JSON) → snr 0', await lecturas(con));
    await recepcion.procesar(topico(CON), up(CON, RX, { temperature: 999 }, 15));
    comprobar(!(await lecturas(con)).includes('999') && (await lecturas(con)).split(',').length === 8 && await cuarentenas(con) === 1,
      'sin una lectura del sensor guardada (999 °C), la señal no se guarda; la cuarentena es la del sensor', await lecturas(con));

    // ── El resumen del sitio: «Red → Calidad del enlace» ──
    r = await pedir(operador, 'GET', `/sitios/${sitio}/resumen`);
    const enlace = r.cuerpo.enlace as { id: string; rssi: { valor: number } | null; snr: { valor: number } | null }[];
    const mags = r.cuerpo.magnitudes as { codigo: string; salud: boolean }[];
    comprobar(r.estado === 200 && enlace.length === 1 && enlace[0]?.id === con && enlace[0]?.rssi?.valor === -101 && enlace[0]?.snr?.valor === 0 && r.cuerpo.total_enlace === 1,
      'GET /sitios/{id}/resumen: enlace[] con el equipo que tiene canal de señal y su última señal (el otro no aparece)', JSON.stringify(r.cuerpo.enlace));
    comprobar(mags.find((x) => x.codigo === 'snr')?.salud === true && mags.find((x) => x.codigo === 'temperatura')?.salud === false,
      'GET /sitios/{id}/resumen: magnitudes[] con `salud` (snr sí, temperatura no)', JSON.stringify(mags));
    r = await pedir(operador, 'GET', `/sitios/${sitio}/historico?magnitud=snr`);
    const valores = (r.cuerpo.valores as (number | null)[] | undefined) ?? [];
    comprobar(r.estado === 200 && valores.some((v) => v !== null), 'GET /sitios/{id}/historico?magnitud=snr: la gráfica del sitio tiene datos', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);

    // ── Ampliación (docs/10 §8.4 punto 72): lo que la trama trae y no se guarda ──
    r = await pedir(consulta, 'GET', `/dispositivos/${sin}/sin-guardar`);
    comprobar(r.estado === 403, 'GET …/sin-guardar con perfil de consulta → 403 (lee cargas crudas)', `${r.estado}`);
    r = await pedir(adminOtro, 'GET', `/dispositivos/${sin}/sin-guardar`);
    comprobar(r.estado === 404, 'GET …/sin-guardar a un equipo de otro sitio → 404', `${r.estado}`);
    await recepcion.procesar(topico(SIN), up(SIN, RX, { temperature: 20, co2: 415 }, 20));
    r = await pedir(operador, 'GET', `/dispositivos/${sin}/sin-guardar`);
    const claves = (r.cuerpo.claves ?? []) as { clave: string; magnitud: string | null; valor: number | null; origen: string }[];
    comprobar(r.estado === 200 && JSON.stringify(claves.map((c) => [c.clave, c.magnitud, c.valor, c.origen])) === JSON.stringify([['rssi', 'rssi', -87, 'enlace'], ['snr', 'snr', 7.5, 'enlace'], ['co2', null, 415, 'carga']]),
      'GET …/sin-guardar: relee las tramas retenidas y ofrece lo que el equipo no guarda (primero la señal, con su magnitud; después co2, sin ella)', JSON.stringify(r.cuerpo));
    r = await pedir(operador, 'GET', `/dispositivos/${sin}/sin-guardar`);
    comprobar(r.estado === 429 && r.cuerpo.codigo === 'sin_guardar_espera' && typeof r.cuerpo.reintentar_en_s === 'number' && r.cuerpo.reintentar_en_s > 0,
      'GET …/sin-guardar otra vez antes de 10 s, la misma persona y el mismo equipo → 429 sin_guardar_espera con reintentar_en_s', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(operador, 'GET', `/dispositivos/${con}/sin-guardar`);
    comprobar(r.estado === 200 && !JSON.stringify(r.cuerpo.claves).includes('"rssi"'), 'GET …/sin-guardar de un equipo con rssi y snr: la señal no se ofrece', JSON.stringify(r.cuerpo));
    comprobar(Number((await q('SELECT count(*) AS n FROM trama WHERE dispositivo_id = $1', [sin])).rows[0].n) >= 1, 'releer no escribe: las tramas siguen ahí y no hay tabla nueva');

    // ── Ampliación: «elegir qué ver» (preferencia, migración 30) ──
    const col = await q("SELECT data_type, column_default FROM information_schema.columns WHERE table_name = 'preferencia' AND column_name = 'magnitudes_ocultas'");
    comprobar(col.rows[0]?.data_type === 'ARRAY' && String(col.rows[0]?.column_default).startsWith("'{}'"), 'migración 30: preferencia.magnitudes_ocultas text[] con valor por omisión vacío', JSON.stringify(col.rows));
    let tope = '';
    try { await q("INSERT INTO preferencia (usuario_id, magnitudes_ocultas) VALUES ($1, $2)", [consulta.id, Array.from({ length: 51 }, (_, i) => `m${i}`)]); } catch (e) { tope = String((e as { constraint?: string }).constraint); }
    comprobar(tope === 'ck_preferencia_magnitudes_ocultas', 'migración 30: 51 magnitudes ocultas → la base lo rechaza (ck_preferencia_magnitudes_ocultas)', tope);
    const prefs = await pedir(operador, 'GET', '/preferencias');
    comprobar(JSON.stringify(prefs.cuerpo.magnitudes_ocultas) === '[]', 'GET /preferencias sin fila: magnitudes_ocultas vacía (nada oculto por omisión)', JSON.stringify(prefs.cuerpo));
    const resto: Record<string, unknown> = { ...prefs.cuerpo };
    delete resto.actualizado_en;
    delete resto.magnitudes_ocultas;
    // Una pestaña con el panel anterior al despliegue no envía el campo: la fila se crea vacía, y después lo guardado se conserva.
    r = await pedir(operador, 'PUT', '/preferencias', { ...resto, actualizado_en: null });
    comprobar(r.estado === 200 && JSON.stringify(r.cuerpo.magnitudes_ocultas) === '[]', 'PUT /preferencias sin magnitudes_ocultas (panel anterior) la primera vez → 200 y vacía', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    const r2a = await pedir(operador, 'PUT', '/preferencias', { ...resto, actualizado_en: r.cuerpo.actualizado_en, magnitudes_ocultas: ['temperatura'] });
    const r2b = await pedir(operador, 'PUT', '/preferencias', { ...resto, actualizado_en: r2a.cuerpo.actualizado_en, magnitudes_ocultas: ['temperatura', 'humedad'] });
    comprobar(r2a.estado === 200 && r2b.estado === 200 && JSON.stringify(r2b.cuerpo.magnitudes_ocultas) === '["temperatura","humedad"]',
      'PUT /preferencias crea la fila y después la cambia con el rol de la aplicación (INSERT de la fila y UPDATE por columna)', `${r2a.estado}/${r2b.estado} ${JSON.stringify(r2b.cuerpo)}`);
    const r2c = await pedir(operador, 'PUT', '/preferencias', { ...resto, tema: 'oscuro', actualizado_en: r2b.cuerpo.actualizado_en });
    comprobar(r2c.estado === 200 && r2c.cuerpo.tema === 'oscuro' && JSON.stringify(r2c.cuerpo.magnitudes_ocultas) === '["temperatura","humedad"]',
      'PUT /preferencias sin magnitudes_ocultas (panel anterior) después → 200, cambia lo demás y conserva las ocultas', `${r2c.estado} ${JSON.stringify(r2c.cuerpo)}`);
    const ahoraOp = await pedir(operador, 'GET', `/sitios/${sitio}/ahora`);
    const tarjeta = (ahoraOp.cuerpo.dispositivos as { id: string; canales: { magnitud: string }[]; canales_total: number }[]).find((x) => x.id === con);
    const porMag = (ahoraOp.cuerpo.por_magnitud as { codigo: string }[]).map((m) => m.codigo);
    comprobar(JSON.stringify(ahoraOp.cuerpo.ocultas) === '["temperatura","humedad"]' && JSON.stringify(tarjeta?.canales.map((k) => k.magnitud)) === '["rssi","snr"]'
      && tarjeta?.canales_total === 2 && !porMag.includes('temperatura'),
      'GET /sitios/{id}/ahora de esa persona: la temperatura no entra al agregado ni a la tarjeta, y la señal sí', JSON.stringify(ahoraOp.cuerpo).slice(0, 500));
    const ahoraOtro = await pedir(await persona('operador'), 'GET', `/sitios/${sitio}/ahora`);
    const tarjeta2 = (ahoraOtro.cuerpo.dispositivos as { id: string; canales: { magnitud: string }[] }[]).find((x) => x.id === con);
    comprobar(JSON.stringify(ahoraOtro.cuerpo.ocultas) === '[]' && (tarjeta2?.canales.map((k) => k.magnitud) ?? []).includes('temperatura'),
      'otra persona sin preferencia ve todo (la elección es de cada una)', JSON.stringify(ahoraOtro.cuerpo.ocultas));
    const exp = await pedir(operador, 'GET', '/cuenta/exportar');
    comprobar(exp.estado === 200 && JSON.stringify(exp.cuerpo).includes('"magnitudes_ocultas":["temperatura","humedad"]'), 'exportar mis datos lleva magnitudes_ocultas tal como la eligió', `${exp.estado}`);

    // Un equipo dado de baja no recibe magnitudes.
    await q("UPDATE dispositivo SET estado = 'baja' WHERE id = $1", [sin]);
    r = await pedir(operador, 'POST', `/dispositivos/${sin}/canales`, { magnitud: 'snr' });
    comprobar(r.estado === 409, 'POST …/canales a un equipo dado de baja → 409', `${r.estado}`);
  } finally {
    await nest.close();
    await dueno.end();
  }
  console.log(`${n - fallos} de ${n} comprobaciones`);
  process.exit(fallos ? 1 : 0);
}
principal().catch((e) => { console.error('FALLA', e); process.exit(1); });
