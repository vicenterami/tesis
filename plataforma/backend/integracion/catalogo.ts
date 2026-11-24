// Prueba de integración del catálogo editable de magnitudes (TT-12, bloque 4; docs/10 §8.4 punto 69; docs/19 §4, T; docs/16 §98) contra
// una base REAL: la corre plataforma/pruebas/catalogo-integracion.sh, que levanta una base desechable sin red con todas las migraciones.
// Va aquí y no en sesion-smoke.sh porque crea magnitudes, y una magnitud no se borra (punto 69 ii): contra la base de desarrollo dejaría
// filas para siempre. La aplicación compilada corre en este proceso, en un puerto efímero de 127.0.0.1, con el rol plataforma_app. Cada
// comprobación imprime OK o FALLA; sale 1 si alguna falla. Fuera de src/: no entra a la imagen ni a `pnpm test` (necesita base).
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { Pool } from 'pg';

const socket = process.env.PRUEBA_DB_SOCKET ?? '';
if (socket === '') throw new Error('falta PRUEBA_DB_SOCKET: corre plataforma/pruebas/catalogo-integracion.sh');
const dueno = new Pool({ host: socket, user: 'plataforma', database: 'plataforma', max: 3 });

let fallos = 0;
let n = 0;
function comprobar(ok: boolean, texto: string, detalle = ''): void {
  n++;
  if (ok) console.log(`OK    ${texto}`);
  else { fallos++; console.log(`FALLA ${texto}${detalle ? ` · ${detalle.slice(0, 600)}` : ''}`); }
}
const q = (sql: string, p: unknown[] = []) => dueno.query(sql, p);
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));

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
const magnitud = async (codigo: string) => (await q(
  `SELECT codigo, rango_min, rango_max, umbral_alto_sugerido, histeresis_sugerida,
          coalesce((SELECT array_agg(clave ORDER BY clave) FROM magnitud_alias WHERE magnitud_codigo = m.codigo), '{}') AS alias
     FROM magnitud m WHERE codigo = $1`, [codigo])).rows[0] as { rango_min: number; rango_max: number; umbral_alto_sugerido: number | null; histeresis_sugerida: number; alias: string[] } | undefined;
const marcaDe = (lista: unknown, codigo: string): string => ((lista as { codigo: string; actualizado_en: string }[]).find((m) => m.codigo === codigo)?.actualizado_en ?? '');

async function sembrar(): Promise<{ sitio: string; canalT: string; canalS: string; directo: string; nodo: string; zona: string; pasarela: string }> {
  const sitio = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Catálogo', 'cat', 'America/Santiago') RETURNING id`)).rows[0].id as string;
  const zona = (await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [sitio, 'Zona'])).rows[0].id as string;
  const equipo = (await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) VALUES ($1, 'cat-1', 'Sala 3', 300) RETURNING id`, [zona])).rows[0].id as string;
  const canalT = (await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ($1, 'temperatura') RETURNING id`, [equipo])).rows[0].id as string;
  const canalS = (await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero, escala_cien) VALUES ($1, 'humedad_suelo', 0.5, 3.0) RETURNING id`, [equipo])).rows[0].id as string;
  await q('INSERT INTO regla_umbral (canal_id, umbral_alto, histeresis) VALUES ($1, 80, 1)', [canalT]);
  // 10 mediciones de temperatura en los últimos 7 días: 3 sobre 70 °C. Y una de hace 9 días sobre 70, que el impacto no cuenta.
  for (let i = 0; i < 10; i++) {
    await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo) VALUES ($1, now() - make_interval(hours => $2), $3, 'Cel', now(), 'recepcion')`,
      [canalT, i * 10 + 1, i < 3 ? 75 + i : 20 + i]);
  }
  await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo) VALUES ($1, now() - interval '9 days', 80, 'Cel', now(), 'recepcion')`, [canalT]);
  // Un nodo LoRaWAN de una pasarela Milesight con la receta del campus (para «reemplazar por» y el PATCH del decodificador).
  const pasarela = (await q(`INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ($1, 'cat-pasarela', 'Pasarela', 'milesight') RETURNING id`, [sitio])).rows[0].id as string;
  const nodo = (await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, via, formato, pasarela_id, decodificador)
                         VALUES ($1, 'cat-nodo', 'Nodo', 300, 'lorawan', 'milesight', $2, 'campus-heltec-v3-v1') RETURNING id`, [zona, pasarela])).rows[0].id as string;
  return { sitio, canalT, canalS, directo: equipo, nodo, zona, pasarela };
}

async function principal() {
  const s = await sembrar();
  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: socket, DB_PUERTO: '5432', DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-catalogo', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
    SUPERVISION_INTERVALO_S: '3600',
  });
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  BASE = (await nest.getUrl()).replace('[::1]', '127.0.0.1');

  const persona = async (rol: string | null): Promise<Persona> => {
    const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en, administrador_sistema)
                       VALUES ($1, $2, 'x', 1, now(), $3) RETURNING id`, [`Persona ${rol ?? 'sistema'}`, `${rol ?? 'sistema'}-${randomBytes(4).toString('hex')}@prueba-catalogo.invalid`, rol === null]);
    if (rol !== null) await q('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [u.rows[0].id, s.sitio, rol]);
    const identificador = randomBytes(32).toString('base64url');
    await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), u.rows[0].id]);
    return { cookie: `__Host-sesion=${identificador}`, id: u.rows[0].id as string };
  };
  try {
    const sistema = await persona(null);
    const admin = await persona('administrador');
    const consulta = await persona('consulta');

    // ── Leer ───────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    let r = await pedir(consulta, 'GET', '/magnitudes');
    const lista = r.cuerpo as unknown as Record<string, unknown>[];
    const temp = lista.find((m) => m.codigo === 'temperatura');
    comprobar(r.estado === 200 && temp?.unidad === 'Cel' && temp.rango_max === 85 && Array.isArray(temp.alias) && (temp.alias as string[]).includes('temperature') && !('canales' in temp),
      'GET /magnitudes con consulta: rango, alias y marca, sin el conteo de canales', JSON.stringify(temp));
    r = await pedir(sistema, 'GET', '/magnitudes');
    comprobar((r.cuerpo as unknown as Record<string, unknown>[]).find((m) => m.codigo === 'temperatura')?.canales === 1, 'GET /magnitudes del administrador del sistema: en cuántos canales se usa (1)');
    r = await pedir(admin, 'GET', '/magnitudes');
    comprobar(r.estado === 200 && !(r.cuerpo as unknown as Record<string, unknown>[]).some((m) => 'canales' in m), 'GET /magnitudes del administrador de un sitio: sin el conteo (abarca todos los sitios)');
    r = await pedir(consulta, 'GET', '/magnitudes/unidades');
    comprobar(r.estado === 200 && (r.cuerpo as unknown as string[]).includes('Cel') && !(r.cuerpo as unknown as string[]).includes('%'), 'GET /magnitudes/unidades: la lista cerrada (Cel sí, «%» no)');

    // ── Crear ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const nueva = { codigo: 'radiacion_solar', nombre: 'Radiación solar', unidad: 'W/m2', rango_min: 0, rango_max: 1500, umbral_alto_sugerido: 1200, histeresis_sugerida: 10, alias: ['solar', 'Irradiance'] };
    r = await pedir(admin, 'POST', '/magnitudes', nueva);
    comprobar(r.estado === 403 && (await magnitud('radiacion_solar')) === undefined, 'POST /magnitudes del administrador de un sitio → 403 y nada creado', String(r.estado));
    r = await pedir(sistema, 'POST', '/magnitudes', nueva);
    let m = await magnitud('radiacion_solar');
    comprobar(r.estado === 200 && m?.rango_max === 1500 && m.umbral_alto_sugerido === 1200 && JSON.stringify(m.alias) === '["irradiance","solar"]',
      'POST /magnitudes del administrador del sistema → 200; alias en minúsculas', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
    const ev = (await q(`SELECT usuario_id, dispositivo_id, detalle FROM evento WHERE tipo = 'catalogo_cambio' ORDER BY ocurrido_en DESC LIMIT 1`)).rows[0] as { usuario_id: string; dispositivo_id: string | null; detalle: Record<string, unknown> } | undefined;
    comprobar(ev?.usuario_id === sistema.id && ev.dispositivo_id === null && ev.detalle.objeto === 'magnitud' && ev.detalle.antes === null && (ev.detalle.despues as Record<string, unknown>).unidad === 'W/m2',
      'el alta deja su evento catalogo_cambio: la persona, sin dispositivo, antes nulo y la foto', JSON.stringify(ev));
    r = await pedir(sistema, 'POST', '/magnitudes', { ...nueva, alias: [] });
    comprobar(r.estado === 409 && String(r.cuerpo.message).includes('Ya hay una magnitud con ese código'), 'código repetido → 409 «Ya hay una magnitud con ese código»', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/magnitudes', { ...nueva, codigo: 'otra_cosa', alias: ['temperature'] });
    comprobar(r.estado === 409 && String(r.cuerpo.message).includes('ya es alias de «Temperatura»') && (await magnitud('otra_cosa')) === undefined,
      'un alias de otra magnitud → 409 que la nombra, y la magnitud no queda creada', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/magnitudes', { ...nueva, codigo: 'mala', unidad: 'ppm' });
    comprobar(r.estado === 400, 'una unidad fuera de la lista cerrada → 400', String(r.estado));

    // ── Cambiar: bloqueo optimista y validación con lo guardado ──────────────────────────────────────────────────────────────────
    const marcaT = marcaDe((await pedir(sistema, 'GET', '/magnitudes')).cuerpo, 'temperatura');
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: '2026-01-01T00:00:00.000000Z', nombre: 'Temperatura del aire' });
    comprobar(r.estado === 409 && r.cuerpo.actualizado_en === marcaT, 'PATCH con una marca vieja → 409 con la vigente', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT, nombre: 'x' });
    comprobar(r.estado === 403, 'PATCH del administrador de un sitio → 403', String(r.estado));
    r = await pedir(sistema, 'PATCH', '/magnitudes/no_existe', { actualizado_en: marcaT, nombre: 'x' });
    comprobar(r.estado === 404, 'PATCH de una magnitud que no existe → 404', String(r.estado));
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT, umbral_alto_sugerido: 90 });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('umbral_alto_sugerido'), 'un sugerido fuera del rango guardado (85) → 400', JSON.stringify(r.cuerpo));

    // ── El rango más chico: bloqueo y aviso ─────────────────────────────────────────────────────────────────────────────────────
    r = await pedir(sistema, 'GET', '/magnitudes/temperatura/impacto?rango_min=-40&rango_max=70');
    comprobar(r.estado === 200 && r.cuerpo.mediciones === 3 && r.cuerpo.canales === 1, 'impacto de 70 °C como máximo: 3 mediciones de los últimos 7 días, de 1 canal (la de hace 9 días no cuenta)', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'GET', '/magnitudes/temperatura/impacto?rango_min=-40&rango_max=70');
    comprobar(r.estado === 403, 'impacto del administrador de un sitio → 403 (cuenta en todos los sitios)', String(r.estado));
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT, rango_max: 70 });
    const fuera = r.cuerpo.fuera as { tipo: string; canal_id: string; dispositivo: string; valores: number[] }[] | undefined;
    comprobar(r.estado === 409 && r.cuerpo.total === 1 && fuera?.[0]?.tipo === 'regla' && fuera[0].canal_id === s.canalT && fuera[0].dispositivo === 'Sala 3' && fuera[0].valores.includes(80)
      && (await magnitud('temperatura'))?.rango_max === 85, 'achicar el rango bajo una regla (80 °C) → 409 con la regla, y nada cambia', JSON.stringify(r.cuerpo));
    const marcaS = marcaDe((await pedir(sistema, 'GET', '/magnitudes')).cuerpo, 'humedad_suelo');
    r = await pedir(sistema, 'PATCH', '/magnitudes/humedad_suelo', { actualizado_en: marcaS, rango_max: 2.5 });
    comprobar(r.estado === 409 && (r.cuerpo.fuera as { tipo: string }[] | undefined)?.[0]?.tipo === 'calibracion', 'achicar el rango bajo una calibración (3,0 V) → 409 con la calibración', JSON.stringify(r.cuerpo));

    // ── Ampliar, sugerido y alias, con su evento ───────────────────────────────────────────────────────────────────────────────────
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT, rango_max: 90, umbral_alto_sugerido: 30, histeresis_sugerida: 0.5, alias: ['temperature', 'temp'] });
    m = await magnitud('temperatura');
    comprobar(r.estado === 200 && m?.rango_max === 90 && m.umbral_alto_sugerido === 30 && JSON.stringify(m.alias) === '["temp","temperature"]' && r.cuerpo.actualizado_en !== marcaT,
      'ampliar el rango, fijar el sugerido y cambiar los alias (sale «temperatura», entra «temp») → 200, con marca nueva', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)}`);
    const ev2 = (await q(`SELECT detalle FROM evento WHERE tipo = 'catalogo_cambio' ORDER BY ocurrido_en DESC LIMIT 1`)).rows[0]?.detalle as { antes: Record<string, unknown>; despues: Record<string, unknown> } | undefined;
    comprobar(ev2 !== undefined && Object.keys(ev2.antes).sort().join(',') === 'alias,histeresis_sugerida,rango_max,umbral_alto_sugerido' && ev2.antes.rango_max === 85 && ev2.despues.rango_max === 90,
      'el evento del cambio trae solo lo que cambió, antes y después', JSON.stringify(ev2));
    const marcaT2 = r.cuerpo.actualizado_en;
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT2, rango_max: 25 });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('umbral_alto_sugerido') && (await magnitud('temperatura'))?.rango_max === 90,
      'achicar el rango por debajo del sugerido guardado (30) → 400 en umbral_alto_sugerido, y nada cambia', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marcaT2, rango_max: 90 });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('nada que cambiar'), 'guardar lo mismo → 400 «nada que cambiar»', JSON.stringify(r.cuerpo));
    const marcaR = marcaDe((await pedir(sistema, 'GET', '/magnitudes')).cuerpo, 'radiacion_solar');
    r = await pedir(sistema, 'PATCH', '/magnitudes/radiacion_solar', { actualizado_en: marcaR, alias: ['solar', 'humidity'] });
    comprobar(r.estado === 409 && String(r.cuerpo.message).includes('«humidity» ya es alias de «Humedad relativa»'), 'un alias de otra magnitud en un PATCH → 409', JSON.stringify(r.cuerpo));

    // ── Carreras del catálogo, provocadas de forma determinista (dos peticiones en paralelo no llegaban a cruzarse: se probó plantando) ──
    // (a) La clave primaria del alias: otra transacción insertó «carrera» y aún no confirma; el alta con el mismo alias no la ve en su
    //     consulta, espera en el INSERT y, al confirmarse la otra, recibe 23505: debe salir 409, no 500.
    const otra = await dueno.connect();
    try {
      await otra.query('BEGIN');
      await otra.query(`INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES ('carrera', 'humedad')`);
      const alta = pedir(sistema, 'POST', '/magnitudes', { codigo: 'carrera_a', nombre: 'Carrera A', unidad: 'K', rango_min: 0, rango_max: 1, alias: ['carrera'] });
      await esperar(500);
      await otra.query('COMMIT');
      const fin = await alta;
      comprobar(fin.estado === 409 && (await magnitud('carrera_a')) === undefined, 'un alias que otra transacción confirma mientras el alta espera → 409 (no 500) y nada creado', `${fin.estado} ${JSON.stringify(fin.cuerpo).slice(0, 200)}`);
    } finally {
      otra.release();
    }
    // (b) El candado del catálogo: con él tomado por otra transacción, un alta espera a que se suelte y después entra.
    const otra2 = await dueno.connect();
    try {
      await otra2.query('BEGIN');
      await otra2.query("SELECT pg_advisory_xact_lock(hashtext('catalogo_magnitudes'))");
      const t0 = Date.now();
      const alta = pedir(sistema, 'POST', '/magnitudes', { codigo: 'carrera_b', nombre: 'Carrera B', unidad: 'K', rango_min: 0, rango_max: 1 });
      await esperar(800);
      const antes = await magnitud('carrera_b');
      await otra2.query('COMMIT');
      const fin = await alta;
      comprobar(antes === undefined && fin.estado === 200 && Date.now() - t0 >= 800, 'con el candado del catálogo tomado, un alta espera y después entra (las escrituras del catálogo van de a una)', `${fin.estado} ${Date.now() - t0} ms`);
    } finally {
      otra2.release();
    }

    // ── Concurrencia: guardar reglas toma FOR SHARE de la magnitud; cambiar el rango, FOR NO KEY UPDATE ─────────────────────────────
    const c = await dueno.connect();
    try {
      await c.query('BEGIN');
      await c.query(`SELECT 1 FROM magnitud WHERE codigo = 'temperatura' FOR SHARE`);
      const marca2 = marcaDe((await pedir(sistema, 'GET', '/magnitudes')).cuerpo, 'temperatura');
      const t0 = Date.now();
      const cambio = pedir(sistema, 'PATCH', '/magnitudes/temperatura', { actualizado_en: marca2, nombre: 'Temperatura del aire' });
      await esperar(800);
      const antesDelCommit = (await q(`SELECT nombre FROM magnitud WHERE codigo = 'temperatura'`)).rows[0]?.nombre as string;
      await c.query('COMMIT');
      const fin = await cambio;
      comprobar(antesDelCommit === 'Temperatura' && fin.estado === 200 && Date.now() - t0 >= 800,
        'con un FOR SHARE de la magnitud abierto (el de guardar reglas), el PATCH espera a que termine y después guarda', `${antesDelCommit} ${fin.estado} ${Date.now() - t0} ms`);
    } finally {
      c.release();
    }
    // ── Recetas de decodificación (bloque 5) ────────────────────────────────────────────────────────────────────────────────────────
    r = await pedir(consulta, 'GET', '/recetas-decodificacion');
    const rc = (r.cuerpo as unknown as Record<string, unknown>[]).find((x) => x.codigo === 'campus-heltec-v3-v1');
    comprobar(r.estado === 200 && (rc?.campos as unknown[] | undefined)?.length === 3 && !('equipos' in (rc ?? {})), 'GET /recetas-decodificacion con consulta: la receta del campus con sus 3 campos, sin el conteo de equipos', JSON.stringify(rc).slice(0, 300));
    r = await pedir(sistema, 'GET', '/recetas-decodificacion');
    comprobar((r.cuerpo as unknown as Record<string, unknown>[]).find((x) => x.codigo === 'campus-heltec-v3-v1')?.equipos === 1, 'GET /recetas-decodificacion del administrador del sistema: en cuántos equipos se usa (1)');
    const v2 = { codigo: 'campus-heltec-v3-v2', nombre: 'Heltec V3, versión 2', largo_bytes: 10, campos: [
      { magnitud: 'temperatura', desplazamiento: 5, tipo: 'i16be', dividir_por: 100 }, { magnitud: 'humedad', desplazamiento: 7, tipo: 'u16be', dividir_por: 100 },
      { magnitud: 'tension', desplazamiento: 9, tipo: 'u8', sumar_antes: 200, dividir_por: 100 }] };
    r = await pedir(admin, 'POST', '/recetas-decodificacion', v2);
    comprobar(r.estado === 403, 'POST /recetas-decodificacion del administrador de un sitio → 403', String(r.estado));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion', v2);
    comprobar(r.estado === 200 && (r.cuerpo.campos as unknown[] | undefined)?.length === 3, 'POST /recetas-decodificacion del administrador del sistema → 200 con sus campos', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
    const evR = (await q(`SELECT usuario_id, detalle FROM evento WHERE tipo = 'catalogo_cambio' AND detalle->>'objeto' = 'receta' ORDER BY ocurrido_en DESC LIMIT 1`)).rows[0] as { usuario_id: string; detalle: Record<string, unknown> } | undefined;
    comprobar(evR?.usuario_id === sistema.id && evR.detalle.codigo === 'campus-heltec-v3-v2' && evR.detalle.antes === null, 'crear una receta deja su evento catalogo_cambio con la persona', JSON.stringify(evR));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion', v2);
    comprobar(r.estado === 409 && String(r.cuerpo.message).includes('Ya hay una receta con ese código'), 'una receta con un código que ya existe → 409 (escritura única)', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion', { ...v2, codigo: 'mala-v1', campos: [{ magnitud: 'no_existe', desplazamiento: 0, tipo: 'u8' }] });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no_existe no es una magnitud del catálogo'), 'un campo con una magnitud que no existe → 400 que la nombra', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion', { ...v2, codigo: 'mala-v2', campos: [{ magnitud: 'humedad', desplazamiento: 0, tipo: 'u8', dividir_pro: 100 }] });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('dividir_pro'), 'una clave mal escrita en un campo → 400 (no se ignora)', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion', { ...v2, codigo: 'mala-v3', campos: [{ magnitud: 'humedad', desplazamiento: 9, tipo: 'u16be' }] });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no cabe'), 'un campo que no cabe en el largo → 400', JSON.stringify(r.cuerpo));
    comprobar((await q(`SELECT count(*)::int AS n FROM receta_decodificacion WHERE codigo LIKE 'mala-%'`)).rows[0].n === 0, 'ninguna receta mala quedó guardada');
    // Probar sin guardar
    const recetas0 = (await q('SELECT count(*)::int AS n FROM receta_decodificacion')).rows[0].n as number;
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/probar', { receta: { ...v2, codigo: '' }, bytes: '02 00 00 00 8f 07 18 19 98 af', codificacion: 'hex' });
    comprobar(r.estado === 200 && r.cuerpo.ok === true && JSON.stringify((r.cuerpo.lecturas as { valor: number }[]).map((l) => l.valor)) === '[18.16,65.52,3.75]',
      'probar con la captura en hexadecimal, con espacios y sin código → 18,16; 65,52; 3,75', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/probar', { receta: v2, bytes: 'AgAAAI8HGBmYrw==', codificacion: 'base64' });
    comprobar(r.estado === 200 && r.cuerpo.ok === true, 'probar con la misma captura en base64 → las mismas lecturas', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/probar', { receta: v2, bytes: '020000008f07181998', codificacion: 'hex' });
    comprobar(r.estado === 200 && r.cuerpo.ok === false && r.cuerpo.motivo === 'se esperaban 10 bytes y llegaron 9', 'probar con 9 bytes → 200 con el motivo «se esperaban 10 bytes y llegaron 9»', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/probar', { receta: v2, bytes: '02zz', codificacion: 'hex' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('eso no es hexadecimal: «z» en la posición 3'), 'bytes que no son hexadecimal → 400 con la posición', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'POST', '/recetas-decodificacion/probar', { receta: v2, bytes: '00', codificacion: 'hex' });
    comprobar(r.estado === 403 && (await q('SELECT count(*)::int AS n FROM receta_decodificacion')).rows[0].n === recetas0, 'probar del administrador de un sitio → 403; probar no guardó ninguna receta', String(r.estado));
    // Reemplazar por
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/campus-heltec-v3-v1/reemplazar', { por: 'campus-heltec-v3-v1' });
    comprobar(r.estado === 400, 'reemplazar una receta por sí misma → 400', String(r.estado));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/campus-heltec-v3-v1/reemplazar', { por: 'campus-heltec-v3-v2' });
    const nodoTras = (await q('SELECT decodificador FROM dispositivo WHERE id = $1', [s.nodo])).rows[0]?.decodificador as string;
    const evNodo = (await q(`SELECT count(*)::int AS n FROM evento WHERE dispositivo_id = $1 AND tipo = 'dispositivo_configurado' AND detalle->>'origen' = 'reemplazar_receta'`, [s.nodo])).rows[0].n as number;
    comprobar(r.estado === 200 && r.cuerpo.dispositivos === 1 && nodoTras === 'campus-heltec-v3-v2' && evNodo === 1 && JSON.stringify(r.cuerpo.avisos) === '[]',
      '«reemplazar por» mueve el nodo a la v2 (mismo largo y magnitudes: sin avisos), con su evento en la actividad del equipo', `${r.estado} ${JSON.stringify(r.cuerpo)} ${nodoTras} ${evNodo}`);
    const evRe = (await q(`SELECT usuario_id, detalle FROM evento WHERE tipo = 'catalogo_cambio' AND detalle->>'accion' = 'reemplazar' ORDER BY ocurrido_en DESC LIMIT 1`)).rows[0] as { usuario_id: string; detalle: Record<string, unknown> } | undefined;
    comprobar(evRe?.usuario_id === sistema.id && evRe.detalle.codigo === 'campus-heltec-v3-v1' && evRe.detalle.por === 'campus-heltec-v3-v2' && evRe.detalle.dispositivos === 1,
      '«reemplazar por» deja también su evento catalogo_cambio: de cuál a cuál, cuántos equipos y quién', JSON.stringify(evRe));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/no-existe-v1/reemplazar', { por: 'campus-heltec-v3-v2' });
    comprobar(r.estado === 404, 'reemplazar una receta que no existe → 404', String(r.estado));
    r = await pedir(sistema, 'POST', '/recetas-decodificacion/campus-heltec-v3-v2/reemplazar', { por: 'no-existe-v1' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no es una receta del catálogo'), 'reemplazar por una receta que no existe → 400', JSON.stringify(r.cuerpo));
    // El alta de a uno con la receta recién creada por la API (la razón del bloque 5: ninguna lista del código la limita), y con una que no existe.
    const nodoNuevo = (receta: string, id: string) => ({ id_fisico: id, nombre: id, zona_id: s.zona, via: 'lorawan', pasarela_id: s.pasarela, decodificador: receta,
      intervalo_esperado_s: 300, canales: [{ magnitud: 'temperatura' }] });
    r = await pedir(sistema, 'POST', '/dispositivos', nodoNuevo('campus-heltec-v3-v2', 'cat-nodo-v2'));
    comprobar((r.estado === 200 || r.estado === 201) && (await q(`SELECT decodificador FROM dispositivo WHERE id_fisico = 'cat-nodo-v2'`)).rows[0]?.decodificador === 'campus-heltec-v3-v2',
      'el alta de a uno de un nodo lorawan con la receta v2 recién creada por la API', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)}`);
    r = await pedir(sistema, 'POST', '/dispositivos', nodoNuevo('no-existe-v1', 'cat-nodo-x'));
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no es una receta de decodificación del catálogo') && (await q(`SELECT 1 FROM dispositivo WHERE id_fisico = 'cat-nodo-x'`)).rowCount === 0,
      'el alta de a uno con una receta que no existe → 400 (la clave foránea, en palabras) y nada creado', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)}`);
    // PATCH /dispositivos/{id} con decodificador (configurar, en su sitio)
    const marcaNodo = async (id: string) => (await q(`SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS x FROM dispositivo WHERE id = $1`, [id])).rows[0].x as string;
    r = await pedir(admin, 'PATCH', `/dispositivos/${s.nodo}`, { actualizado_en: await marcaNodo(s.nodo), decodificador: 'campus-heltec-v3-v1' });
    comprobar(r.estado === 200 && (await q('SELECT decodificador FROM dispositivo WHERE id = $1', [s.nodo])).rows[0]?.decodificador === 'campus-heltec-v3-v1',
      'PATCH /dispositivos/{id} del administrador del sitio: cambia la receta de un nodo lorawan', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
    r = await pedir(admin, 'PATCH', `/dispositivos/${s.nodo}`, { actualizado_en: await marcaNodo(s.nodo), decodificador: 'no-existe-v1' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('no es una receta'), 'PATCH con una receta que no existe → 400', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', `/dispositivos/${s.directo}`, { actualizado_en: await marcaNodo(s.directo), decodificador: 'campus-heltec-v3-v1' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo).includes('vía lorawan'), 'PATCH con receta en un equipo que no es lorawan → 400', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', `/dispositivos/${s.nodo}`, { actualizado_en: await marcaNodo(s.nodo), decodificador: null });
    comprobar(r.estado === 200 && r.cuerpo.decodificador === null && (await q('SELECT decodificador FROM dispositivo WHERE id = $1', [s.nodo])).rows[0]?.decodificador === null,
      'PATCH con decodificador null quita la receta, y la ficha que responde lo muestra', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);

    const plan = (await q(`EXPLAIN SELECT 1 FROM canal c JOIN magnitud m ON m.codigo = c.magnitud_codigo WHERE c.id = $1 FOR NO KEY UPDATE OF c FOR SHARE OF m`, [s.canalT])).rows.length;
    comprobar(plan > 0, 'la consulta de guardar reglas con FOR NO KEY UPDATE OF c FOR SHARE OF m es válida en esta versión de PostgreSQL');
    r = await pedir(sistema, 'PUT', `/canales/${s.canalT}/reglas`, {
      actualizado_en: (await q(`SELECT to_char(actualizado_en AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"') AS x FROM canal WHERE id = $1`, [s.canalT])).rows[0].x,
      reglas: [{ umbral_alto: 88 }],
    });
    comprobar(r.estado === 200, 'guardar reglas sigue funcionando con el bloqueo compartido de la magnitud (88 °C, dentro del rango nuevo)', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
  } finally {
    await nest.close();
  }
}

principal()
  .catch((e: unknown) => { fallos++; console.log(`FALLA la prueba se cortó: ${(e as Error).stack ?? String(e)}`); })
  .finally(async () => {
    await dueno.end().catch(() => undefined);
    console.log(fallos === 0 ? `\n${n} de ${n} comprobaciones` : `\n${fallos} de ${n} comprobaciones fallaron`);
    process.exit(fallos === 0 ? 0 : 1);
  });
