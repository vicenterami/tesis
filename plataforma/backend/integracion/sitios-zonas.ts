// Prueba de integración de sitios y zonas desde el panel (docs/19 §4 U y U2; docs/20 §6; migración 28) contra una base REAL: la corre
// plataforma/pruebas/sitios-zonas-integracion.sh, que levanta una base desechable sin red con todas las migraciones. Va contra una base
// desechable porque crea sitios y zonas, y nada de eso se borra. La aplicación compilada corre en este proceso, en un puerto efímero de
// 127.0.0.1, con el rol plataforma_app (así se prueban también sus permisos por columna). Sin broker: el lote usa nodos LoRaWAN, que no
// llevan credencial propia. Cada comprobación imprime OK o FALLA; sale 1 si alguna falla. Fuera de src/: no entra a la imagen ni a `pnpm test`.
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes, randomUUID } from 'node:crypto';
import type { Type } from '@nestjs/common';
import { Pool } from 'pg';

const socket = process.env.PRUEBA_DB_SOCKET ?? '';
if (socket === '') throw new Error('falta PRUEBA_DB_SOCKET: corre plataforma/pruebas/sitios-zonas-integracion.sh');
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
async function pedir(quien: Persona, metodo: string, ruta: string, cuerpo?: unknown, cabeceras: Record<string, string> = {}): Promise<Respuesta> {
  const r = await fetch(`${BASE}${ruta}`, {
    method: metodo,
    headers: { cookie: quien.cookie, 'X-Pedido': 'panel', ...(cuerpo === undefined ? {} : { 'content-type': 'application/json' }), ...cabeceras },
    body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
  });
  const texto = await r.text();
  let json: unknown;
  try { json = texto === '' ? {} : JSON.parse(texto); } catch { json = { texto }; }
  return { estado: r.status, cuerpo: json as Respuesta['cuerpo'] };
}
const eventos = async (tipo: string): Promise<number> => Number((await q('SELECT count(*) AS n FROM evento WHERE tipo = $1', [tipo])).rows[0].n);

async function principal() {
  const sitio = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Campus de prueba', 'sz-campus', 'America/Santiago') RETURNING id`)).rows[0].id as string;
  const otro = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Otro', 'sz-otro', 'America/Santiago') RETURNING id`)).rows[0].id as string;
  const zona = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'Laboratorio') RETURNING id`, [sitio])).rows[0].id as string;
  await q(`INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES ($1, 'sz-pasarela', 'Pasarela', 'milesight')`, [sitio]);
  const equipo = (await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) VALUES ($1, 'sz-1', 'Uno', 300) RETURNING id`, [zona])).rows[0].id as string;
  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: socket, DB_PUERTO: '5432', DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-sitios-zonas', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
    SUPERVISION_INTERVALO_S: '3600',
  });
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  BASE = (await nest.getUrl()).replace('[::1]', '127.0.0.1');

  const persona = async (rol: string | null, deSitio = sitio): Promise<Persona> => {
    const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en, administrador_sistema)
                       VALUES ($1, $2, 'x', 1, now(), $3) RETURNING id`, [`Persona ${rol ?? 'sistema'}`, `${rol ?? 'sistema'}-${randomBytes(4).toString('hex')}@prueba-sz.invalid`, rol === null]);
    if (rol !== null) await q('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [u.rows[0].id, deSitio, rol]);
    const identificador = randomBytes(32).toString('base64url');
    await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), u.rows[0].id]);
    return { cookie: `__Host-sesion=${identificador}`, id: u.rows[0].id as string };
  };
  try {
    const sistema = await persona(null);
    const admin = await persona('administrador');
    const operador = await persona('operador');
    const consulta = await persona('consulta');
    const investigador = await persona('investigador');
    const adminOtro = await persona('administrador', otro);
    // Un 403 por el perfil, no por otra causa (la cabecera X-Pedido, los términos): el mensaje lo dice.
    const porPerfil = (r: Respuesta): boolean => r.estado === 403 && /rol|administrador del sistema/.test(String(r.cuerpo.message)) && !/X-Pedido/.test(String(r.cuerpo.message));
    const actividad = async (quien: Persona, sitioId: string): Promise<{ tipo: string; texto: string; usuario: { id: string } | null }[]> =>
      (await pedir(quien, 'GET', `/sitios/${sitioId}/actividad?limite=500`)).cuerpo as unknown as { tipo: string; texto: string; usuario: { id: string } | null }[];
    const zonasDe = async (sitioId: string): Promise<number> => Number((await q('SELECT count(*) AS n FROM zona WHERE sitio_id = $1', [sitioId])).rows[0].n);
    const fila = (n: number, zona: string, id = `sz-n-${String(n).padStart(3, '0')}`) =>
      ({ n, id_fisico: id, nombre: `Nodo ${n}`, zona, via: 'http', intervalo_esperado_s: '300', canales: 'temperatura' });
    const llave = () => ({ 'Idempotency-Key': randomUUID() });

    // ── Sitios ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    let r = await pedir(admin, 'POST', '/sitios', { nombre: 'Sede', codigo: 'sz-sede', zona_horaria: 'America/Santiago' });
    comprobar(porPerfil(r), 'POST /sitios con administrador de sitio: 403 por el perfil (solo el administrador del sistema)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(sistema, 'POST', '/sitios', { nombre: 'Sede', codigo: 'sz-marte', zona_horaria: 'Marte/Olympus' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo.message).includes('la base no conoce «Marte/Olympus»'), 'POST /sitios con una zona horaria que la base no conoce: 400 con el nombre (pg_timezone_names)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    comprobar((await q(`SELECT count(*) AS n FROM sitio WHERE codigo = 'sz-marte'`)).rows[0].n === '0', 'la zona horaria rechazada no dejó sitio');
    r = await pedir(sistema, 'POST', '/sitios', { nombre: 'Sede Norte', codigo: 'sz-sede', zona_horaria: 'America/Santiago', descripcion: '  Sede de pruebas  ' });
    const sede = r.cuerpo as { id: string; descripcion: string | null; zonas: { nombre: string; activo: boolean; dispositivos: number }[] };
    comprobar(r.estado === 201 && sede.zonas?.length === 1 && sede.zonas[0].nombre === 'General' && sede.descripcion === 'Sede de pruebas',
      'POST /sitios: el sitio nace con su primera zona «General» y la descripción recortada (rol de la aplicación: INSERT por columna)', JSON.stringify(r.cuerpo));
    r = await pedir(sistema, 'POST', '/sitios', { nombre: 'Repetido', codigo: 'sz-sede', zona_horaria: 'America/Santiago' });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'codigo_repetido', 'POST /sitios con un código que ya existe: 409 codigo_repetido', JSON.stringify(r.cuerpo));
    comprobar(await eventos('sitio_alta') === 1 && await eventos('zona_alta') === 1, 'eventos sitio_alta y zona_alta, uno cada uno (el 409 y el 400 no dejaron nada)');
    r = await pedir(sistema, 'PATCH', `/sitios/${sede.id}`, { nombre: 'Sede Norte Sur' });
    comprobar(r.estado === 200 && r.cuerpo.nombre === 'Sede Norte Sur' && await eventos('sitio_cambio') === 1, 'PATCH /sitios: renombra con su evento');
    r = await pedir(sistema, 'POST', '/sitios', { nombre: 'Nulo', codigo: 'sz-nulo', zona_horaria: 'UTC', descripcion: 'a\u0000b' });
    const rPatchNul = await pedir(sistema, 'PATCH', `/sitios/${sede.id}`, { descripcion: 'a\u0000b' });
    comprobar(r.estado === 400 && rPatchNul.estado === 400 && JSON.stringify(r.cuerpo.message).includes('descripción: trae un carácter de control')
      && JSON.stringify(rPatchNul.cuerpo.message).includes('descripción: trae un carácter de control'),
      'una descripción con NUL: 400 con su motivo al crear y al cambiar (no un error del servidor)', `${r.estado} ${rPatchNul.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(sistema, 'PATCH', `/sitios/${sede.id}`, { codigo: 'otro' });
    comprobar(r.estado === 400 && JSON.stringify(r.cuerpo.message).includes('campo no admitido: codigo'), 'PATCH /sitios: el código no cambia (400, campo no admitido)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(sistema, 'GET', '/sitios');
    const enLista = (r.cuerpo as unknown as { id: string; descripcion: string | null }[]);
    comprobar(enLista.find((x) => x.id === sede.id)?.descripcion === 'Sede de pruebas' && enLista.find((x) => x.id === sitio)?.descripcion === null,
      'GET /sitios: cada sitio con su descripción (texto o null)', JSON.stringify(enLista.map((x) => x.descripcion)));
    const inactivo = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria, activo) VALUES ('Inactivo', 'sz-inactivo', 'America/Santiago', false) RETURNING id`)).rows[0].id as string;
    const zonaInactiva = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'Vieja') RETURNING id`, [inactivo])).rows[0].id as string;
    r = await pedir(sistema, 'PATCH', `/sitios/${inactivo}`, { nombre: 'Otro nombre' });
    const r2 = await pedir(sistema, 'PATCH', `/zonas/${zonaInactiva}`, { nombre: 'Otra' });
    comprobar(r.estado === 404 && r2.estado === 404, 'PATCH /sitios/{id} y PATCH /zonas/{id} de un sitio inactivo: 404', `${r.estado} ${r2.estado}`);

    // ── Perfiles sin permiso: 403 en cada ruta nueva (docs/20 §6) ──────────────────────────────────────────────────────────────────
    for (const [quien, rol] of [[consulta, 'consulta'], [investigador, 'investigador']] as const) {
      const intentos = [
        await pedir(quien, 'POST', '/sitios', { nombre: 'X', codigo: 'sz-x', zona_horaria: 'UTC' }),
        await pedir(quien, 'PATCH', `/sitios/${sitio}`, { nombre: 'X' }),
        await pedir(quien, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'X' }),
        await pedir(quien, 'PATCH', `/zonas/${zona}`, { nombre: 'X' }),
        await pedir(quien, 'POST', '/dispositivos/lote?modo=validar', { filas: [fila(2, 'X')], zonas_nuevas_en: sitio }),
      ];
      comprobar(intentos.every(porPerfil), `perfil ${rol}: 403 por el perfil en POST /sitios, PATCH /sitios/{id}, POST /sitios/{id}/zonas, PATCH /zonas/{id} y el lote con zonas_nuevas_en`,
        intentos.map((x) => `${x.estado} ${String(x.cuerpo.message)}`).join(' | '));
    }

    // Operador técnico en cada ruta nueva (no tiene `sistema` ni `ajustes`) y administrador de sitio en las de sitios (solo `sistema`).
    {
      const intentos = [
        await pedir(operador, 'POST', '/sitios', { nombre: 'X', codigo: 'sz-x', zona_horaria: 'UTC' }),
        await pedir(operador, 'PATCH', `/sitios/${sitio}`, { nombre: 'X' }),
        await pedir(operador, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'X' }),
        await pedir(operador, 'PATCH', `/zonas/${zona}`, { nombre: 'X' }),
      ];
      comprobar(intentos.every(porPerfil), 'perfil operador: 403 por el perfil en POST /sitios, PATCH /sitios/{id}, POST /sitios/{id}/zonas y PATCH /zonas/{id}',
        intentos.map((x) => `${x.estado} ${String(x.cuerpo.message)}`).join(' | '));
      r = await pedir(admin, 'PATCH', `/sitios/${sitio}`, { nombre: 'X' });
      comprobar(porPerfil(r), 'PATCH /sitios/{id} con administrador de ese sitio: 403 por el perfil (solo el administrador del sistema)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    }

    // ── Zonas ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
    r = await pedir(operador, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Norte' });
    comprobar(porPerfil(r), 'POST /sitios/{id}/zonas con operador técnico: 403 por el perfil', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(adminOtro, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Norte' });
    comprobar(r.estado === 404 && r.cuerpo.message === 'sitio no encontrado', 'POST /sitios/{id}/zonas en un sitio ajeno: 404 (RF-41)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(admin, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Patio' });
    const patio = r.cuerpo as { id: string; activo: boolean; dispositivos: number };
    comprobar(r.estado === 201 && patio.activo === true && patio.dispositivos === 0, 'POST /sitios/{id}/zonas con administrador: 201, activa y sin dispositivos', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'POST', `/sitios/${sitio}/zonas`, { nombre: '  patio ' });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'zona_repetida', 'el mismo nombre con otras mayúsculas y espacios: 409 zona_repetida (índice de la migración 28)', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Sur' });
    const sur = r.cuerpo as { id: string };
    r = await pedir(admin, 'PATCH', `/zonas/${sur.id}`, { nombre: 'PATIO' });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'zona_repetida', 'renombrar una zona a un nombre que ya existe (activa): 409 zona_repetida', JSON.stringify(r.cuerpo));
    r = await pedir(adminOtro, 'PATCH', `/zonas/${sur.id}`, { nombre: 'Sur 2' });
    comprobar(r.estado === 404 && r.cuerpo.message === 'zona no encontrada', 'PATCH /zonas/{id} de otro sitio: 404 (RF-41)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(admin, 'PATCH', `/zonas/${zona}`, { activo: false });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'zona_con_dispositivos' && r.cuerpo.dispositivos === 1, 'retirar una zona con un dispositivo activo: 409 con cuántos', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', `/zonas/${patio.id}`, { activo: false });
    comprobar(r.estado === 200 && r.cuerpo.activo === false && await eventos('zona_cambio') === 1, 'retirar una zona vacía: 200 con su evento zona_cambio');
    r = await pedir(admin, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'patio' });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'zona_retirada' && String(r.cuerpo.message).includes('«Patio» retirada'), 'crear una zona con el nombre de una retirada: 409 zona_retirada (se vuelve a ofrecer, no se crea otra)', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', `/zonas/${sur.id}`, { nombre: ' Patio' });
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'zona_retirada', 'renombrar una zona al nombre de una retirada: 409 zona_retirada', JSON.stringify(r.cuerpo));
    r = await pedir(admin, 'PATCH', `/zonas/${sur.id}`, { nombre: 'Sur poniente' });
    comprobar(r.estado === 200 && r.cuerpo.nombre === 'Sur poniente', 'renombrar una zona a un nombre libre: 200', JSON.stringify(r.cuerpo));
    const ficha = await pedir(admin, 'GET', `/dispositivos/${equipo}`);
    r = await pedir(admin, 'PATCH', `/dispositivos/${equipo}`, { zona_id: patio.id, actualizado_en: ficha.cuerpo.actualizado_en });
    comprobar((r.estado === 400 || r.estado === 422) && JSON.stringify(r.cuerpo).includes('retirada'), 'mover un dispositivo a una zona retirada: rechazado por estar retirada', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(admin, 'GET', '/sitios');
    const zs = ((r.cuerpo as unknown as { id: string; zonas: { nombre: string; activo: boolean; dispositivos: number }[] }[]).find((x) => x.id === sitio)?.zonas ?? []);
    comprobar(zs.some((z) => z.nombre === 'Patio' && z.activo === false) && zs.some((z) => z.nombre === 'Laboratorio' && z.dispositivos === 1), 'GET /sitios: cada zona con activo y dispositivos', JSON.stringify(zs));
    // El rol de la aplicación no puede borrar zonas ni cambiar el código de un sitio (migración 28: permisos por columna, ningún DELETE).
    const comoApp = async (sql: string, p: unknown[]): Promise<string> => {
      const c = await dueno.connect();
      try { await c.query('BEGIN'); await c.query('SET LOCAL ROLE plataforma_app'); await c.query(sql, p); return 'permitido'; }
      catch (e) { return (e as { code?: string }).code ?? 'error'; } finally { await c.query('ROLLBACK').catch(() => undefined); c.release(); }
    };
    comprobar(await comoApp('DELETE FROM zona WHERE id = $1', [patio.id]) === '42501', 'el rol de la aplicación no puede borrar una zona (42501)');
    comprobar(await comoApp("UPDATE sitio SET codigo = 'x' WHERE id = $1", [sitio]) === '42501', 'el rol de la aplicación no puede cambiar el código de un sitio (42501)');
    comprobar(await comoApp('UPDATE zona SET sitio_id = $2 WHERE id = $1', [patio.id, otro]) === '42501', 'el rol de la aplicación no puede mover una zona a otro sitio (42501)');

    // ── Actividad (docs/19 §4 U punto 4) ───────────────────────────────────────────────────────────────────────────────────────────
    const act = await actividad(admin, sitio);
    const de = (tipo: string, texto: string) => act.find((x) => x.tipo === tipo && x.texto.includes(texto) && x.usuario?.id === admin.id);
    comprobar(de('zona_alta', 'creó la zona «Patio»') !== undefined && de('zona_cambio', 'retiró la zona «Patio»') !== undefined
      && de('zona_cambio', 'cambió el nombre de la zona «Sur» a «Sur poniente»') !== undefined,
      'GET /sitios/{id}/actividad: crear, retirar y renombrar una zona, con la persona', JSON.stringify(act.map((x) => [x.tipo, x.texto])).slice(0, 600));
    const actSede = await actividad(sistema, sede.id);
    comprobar(actSede.some((x) => x.tipo === 'sitio_alta' && x.texto === 'creó el sitio «Sede Norte»' && x.usuario?.id === sistema.id)
      && actSede.some((x) => x.tipo === 'sitio_cambio' && x.texto === 'cambió el nombre del sitio «Sede Norte» a «Sede Norte Sur»'),
      'GET /sitios/{id}/actividad: crear y renombrar el sitio, con la persona', JSON.stringify(actSede.map((x) => [x.tipo, x.texto])));
    const filtro = (await pedir(admin, 'GET', `/sitios/${sitio}/actividad?tipo=zona_cambio`)).cuerpo as unknown as { tipo: string }[];
    comprobar(filtro.length === 2 && filtro.every((x) => x.tipo === 'zona_cambio'), 'el filtro por tipo acepta zona_cambio', JSON.stringify(filtro));
    const actOtro = await actividad(adminOtro, otro);
    comprobar(Array.isArray(actOtro) && !actOtro.some((x) => ['sitio_alta', 'sitio_cambio', 'zona_alta', 'zona_cambio'].includes(x.tipo)), 'la actividad de OTRO sitio no trae esos eventos', JSON.stringify(actOtro).slice(0, 300));

    // ── El bloqueo de la zona, con dos conexiones ──────────────────────────────────────────────────────────────────────────────────
    // Una conexión propia sostiene FOR SHARE sobre una zona vacía (lo que toma un alta en curso en esa zona); retirarla espera su
    // FOR NO KEY UPDATE hasta el lock_timeout del servicio (5 s) y responde 503; soltado el bloqueo, el mismo retiro pasa.
    r = await pedir(admin, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Bloqueo' });
    const bloqueo = r.cuerpo as { id: string };
    const sostiene = await dueno.connect();
    let conBloqueo: Respuesta;
    try {
      await sostiene.query('BEGIN');
      await sostiene.query('SELECT id FROM zona WHERE id = $1 FOR SHARE', [bloqueo.id]);
      conBloqueo = await pedir(admin, 'PATCH', `/zonas/${bloqueo.id}`, { activo: false });
    } finally {
      await sostiene.query('COMMIT').catch(() => undefined);
      sostiene.release();
    }
    comprobar(conBloqueo.estado === 503 && String(conBloqueo.cuerpo.message).includes('está en curso'), 'retirar una zona mientras otra conexión sostiene FOR SHARE sobre ella: 503 «otro cambio … en curso»',
      `${conBloqueo.estado} ${JSON.stringify(conBloqueo.cuerpo)}`);
    r = await pedir(admin, 'PATCH', `/zonas/${bloqueo.id}`, { activo: false });
    comprobar(r.estado === 200 && r.cuerpo.activo === false, 'soltado el bloqueo, el mismo retiro pasa (200)', `${r.estado} ${JSON.stringify(r.cuerpo)}`);

    // ── Alta masiva con zonas nuevas (U2) ──────────────────────────────────────────────────────────────────────────────────────────
    const filas = [
      { n: 2, id_fisico: '0202020202020202', nombre: 'Nodo A', zona: 'Invernadero', via: 'lorawan', pasarela: 'sz-pasarela', intervalo_esperado_s: '180', canales: 'temperatura' },
      { n: 3, id_fisico: 'aaaaaaaaaaaaaaaa', nombre: 'Nodo B', zona: ' invernadero ', via: 'lorawan', pasarela: 'sz-pasarela', intervalo_esperado_s: '180', canales: 'temperatura' },
    ];
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas });
    comprobar(r.estado === 200 && r.cuerpo.validas === 0 && JSON.stringify(r.cuerpo.filas).includes('pídele a quien administra el sitio que la cree'),
      'lote sin zonas_nuevas_en: la zona inexistente no entra, con el remedio', JSON.stringify(r.cuerpo).slice(0, 300));
    r = await pedir(operador, 'POST', '/dispositivos/lote?modo=validar', { filas, zonas_nuevas_en: sitio });
    comprobar(porPerfil(r), 'lote con zonas_nuevas_en y operador técnico (sin «ajustes»): 403 por el perfil', `${r.estado} ${JSON.stringify(r.cuerpo)}`);
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas, zonas_nuevas_en: otro });
    const r404 = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas, zonas_nuevas_en: randomUUID() });
    comprobar(r.estado === 404 && r.cuerpo.message === 'sitio no encontrado' && r404.estado === 404, 'lote con zonas_nuevas_en de un sitio ajeno o inexistente: 404 (RF-41)', `${r.estado} ${r404.estado}`);
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas: [fila(2, 'patio')], zonas_nuevas_en: sitio });
    comprobar(r.estado === 200 && r.cuerpo.validas === 0 && JSON.stringify(r.cuerpo.filas).includes('la zona «patio» está retirada') && (r.cuerpo.zonas_por_nombre as unknown[]).length === 0,
      'el lote no mete filas en una zona retirada ni la recrea (motivo «está retirada»)', JSON.stringify(r.cuerpo).slice(0, 400));
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas, zonas_nuevas_en: sitio });
    const zonasLote = r.cuerpo.zonas_por_nombre as { zona: string; filas: number; nueva?: boolean }[];
    comprobar(r.estado === 200 && r.cuerpo.validas === 2 && zonasLote?.length === 1 && zonasLote[0].nueva === true && zonasLote[0].filas === 2,
      'lote con zonas_nuevas_en: entran las dos y la zona se anuncia una vez como nueva', JSON.stringify(r.cuerpo).slice(0, 400));
    const huella = r.cuerpo.huella as string;
    const zonaAltasAntes = await eventos('zona_alta');
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=crear', { filas, huella, zonas_nuevas_en: sitio }, llave());
    const creadas = (await q(`SELECT count(*) AS n FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE z.sitio_id = $1 AND z.nombre = 'Invernadero'`, [sitio])).rows[0].n;
    const zonasInv = (await q(`SELECT count(*) AS n FROM zona WHERE sitio_id = $1 AND lower(btrim(nombre)) = 'invernadero'`, [sitio])).rows[0].n;
    comprobar(r.estado === 200 && Number(creadas) === 2 && Number(zonasInv) === 1, 'crear: una sola zona «Invernadero» con los dos nodos, en la misma transacción', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)}`);
    comprobar(await eventos('zona_alta') === zonaAltasAntes + 1, 'un evento zona_alta por la zona creada por el lote');

    // 120 filas con la misma zona nueva escrita de tres maneras: una sola zona.
    const cientoVeinte = Array.from({ length: 120 }, (_, i) => fila(i + 2, ['Galpón Norte', 'GALPÓN NORTE', ' galpón norte '][i % 3]));
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas: cientoVeinte, zonas_nuevas_en: sitio });
    const z120 = r.cuerpo.zonas_por_nombre as { zona: string; filas: number; nueva?: boolean }[];
    comprobar(r.estado === 200 && r.cuerpo.validas === 120 && z120?.length === 1 && z120[0].filas === 120 && z120[0].zona === 'Galpón Norte',
      '120 filas con la misma zona nueva con mayúsculas distintas: entran y se anuncia una sola zona nueva', JSON.stringify(r.cuerpo).slice(0, 300));
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=crear', { filas: cientoVeinte, huella: r.cuerpo.huella, zonas_nuevas_en: sitio }, llave());
    const galpon = (await q(`SELECT count(*) AS n, min(nombre) AS nombre FROM zona WHERE sitio_id = $1 AND lower(btrim(nombre)) = 'galpón norte'`, [sitio])).rows[0];
    const en120 = (await q(`SELECT count(*) AS n FROM dispositivo d JOIN zona z ON z.id = d.zona_id WHERE z.sitio_id = $1 AND z.nombre = 'Galpón Norte'`, [sitio])).rows[0].n;
    comprobar(r.estado === 200 && galpon.n === '1' && galpon.nombre === 'Galpón Norte' && Number(en120) === 120, 'crear las 120: una sola zona «Galpón Norte» con los 120 equipos', `${r.estado} ${JSON.stringify(galpon)} ${en120}`);

    // El tope de 20 zonas nuevas: con 21 distintas, ninguna, y la respuesta lo dice (también el 409 de crear).
    const antesTope = await zonasDe(sitio);
    const veintiuna = Array.from({ length: 21 }, (_, i) => fila(200 + i, `Tope ${i}`));
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=validar', { filas: veintiuna, zonas_nuevas_en: sitio });
    const exc = r.cuerpo.zonas_nuevas_excedidas as { pedidas: number; maximo: number } | undefined;
    comprobar(r.estado === 200 && r.cuerpo.validas === 0 && exc?.pedidas === 21 && exc.maximo === 20 && (r.cuerpo.zonas_por_nombre as unknown[]).length === 0,
      '21 zonas nuevas distintas: zonas_nuevas_excedidas {pedidas: 21, maximo: 20} y ninguna se ofrece', JSON.stringify({ ...r.cuerpo, filas: undefined }));
    r = await pedir(admin, 'POST', '/dispositivos/lote?modo=crear', { filas: veintiuna, huella: r.cuerpo.huella, zonas_nuevas_en: sitio }, llave());
    const planTope = r.cuerpo.plan as { zonas_nuevas_excedidas?: { pedidas: number } } | undefined;
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'plan_cambio' && planTope?.zonas_nuevas_excedidas?.pedidas === 21 && await zonasDe(sitio) === antesTope,
      'crear con las 21: 409 plan_cambio con zonas_nuevas_excedidas en el plan, y ninguna zona creada', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)}`);

    // Desde aquí, otra persona con el mismo perfil: el cupo de 10 lotes por minuto es por persona (docs/19 §4, N).
    const admin2 = await persona('administrador');
    // Una falla a mitad del lote no deja la zona nueva: (a) un id_fisico creado por otra vía entre validar y crear.
    const conNueva = [fila(300, 'Bodega Este'), fila(301, 'Bodega Este')];
    r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=validar', { filas: conNueva, zonas_nuevas_en: sitio });
    const huellaNueva = r.cuerpo.huella as string;
    await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) VALUES ($1, 'sz-n-301', 'Por otra vía', 300)`, [zona]);
    r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=crear', { filas: conNueva, huella: huellaNueva, zonas_nuevas_en: sitio }, llave());
    const bodega = async () => Number((await q(`SELECT count(*) AS n FROM zona WHERE sitio_id = $1 AND lower(btrim(nombre)) = 'bodega este'`, [sitio])).rows[0].n);
    const en300 = Number((await q(`SELECT count(*) AS n FROM dispositivo WHERE id_fisico = 'sz-n-300'`)).rows[0].n);
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'plan_cambio' && await bodega() === 0 && en300 === 0,
      'un id_fisico creado por otra vía entre validar y crear: 409 plan_cambio, 0 zonas nuevas y 0 equipos', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 200)}`);
    // (b) la base rechaza un equipo DESPUÉS de insertar la zona, dentro de la transacción (un disparador de prueba que imita un 23505 que
    // el plan no ve): todo se deshace, la zona tampoco queda, y como el plan recalculado es el mismo, 409 choque_sin_cambio.
    const otraNueva = [fila(310, 'Bodega Oeste'), fila(311, 'Bodega Oeste')];
    r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=validar', { filas: otraNueva, zonas_nuevas_en: sitio });
    await q(`CREATE FUNCTION sz_prueba_rechazo() RETURNS trigger LANGUAGE plpgsql AS $f$ BEGIN
               IF NEW.id_fisico = 'sz-n-311' THEN RAISE EXCEPTION 'prueba' USING ERRCODE = 'unique_violation'; END IF; RETURN NEW; END $f$`);
    await q('CREATE TRIGGER sz_prueba_rechazo BEFORE INSERT ON dispositivo FOR EACH ROW EXECUTE FUNCTION sz_prueba_rechazo()');
    try {
      r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=crear', { filas: otraNueva, huella: r.cuerpo.huella, zonas_nuevas_en: sitio }, llave());
    } finally {
      await q('DROP TRIGGER sz_prueba_rechazo ON dispositivo');
      await q('DROP FUNCTION sz_prueba_rechazo()');
    }
    const oeste = Number((await q(`SELECT count(*) AS n FROM zona WHERE sitio_id = $1 AND lower(btrim(nombre)) = 'bodega oeste'`, [sitio])).rows[0].n);
    const en310 = Number((await q(`SELECT count(*) AS n FROM dispositivo WHERE id_fisico IN ('sz-n-310', 'sz-n-311')`)).rows[0].n);
    comprobar(r.estado === 409 && r.cuerpo.codigo === 'choque_sin_cambio' && String(r.cuerpo.message).includes('solo cambia en mayúsculas o espacios') && oeste === 0 && en310 === 0,
      'la base rechaza un equipo después de insertar la zona: 409 choque_sin_cambio (mismo plan), 0 zonas nuevas y 0 equipos', `${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 300)} zonas=${oeste} equipos=${en310}`);

    // El plan se recalcula al crear: validar, retirar la zona (vacía) y crear con la huella vieja. Prueba el recálculo en secuencia, no la
    // carrera (dos peticiones a la vez la cubre el bloqueo FOR SHARE de crearLote, con su prueba unitaria en lote-servicio.spec.ts).
    r = await pedir(admin2, 'POST', `/sitios/${sitio}/zonas`, { nombre: 'Vivero' });
    const vivero = r.cuerpo as { id: string };
    const aVivero = [fila(400, 'Vivero'), fila(401, vivero.id)];
    r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=validar', { filas: aVivero });
    const huellaVivero = r.cuerpo.huella as string;
    const entraban = r.cuerpo.validas;
    r = await pedir(admin2, 'PATCH', `/zonas/${vivero.id}`, { activo: false });
    const retiro = r.estado;
    r = await pedir(admin2, 'POST', '/dispositivos/lote?modo=crear', { filas: aVivero, huella: huellaVivero }, llave());
    const planVivero = r.cuerpo.plan as { filas: { resultado: string; motivo: string | null }[] } | undefined;
    const enVivero = Number((await q('SELECT count(*) AS n FROM dispositivo WHERE zona_id = $1', [vivero.id])).rows[0].n);
    comprobar(entraban === 2 && retiro === 200 && r.estado === 409 && r.cuerpo.codigo === 'plan_cambio' && enVivero === 0
      && planVivero?.filas.every((f) => f.resultado === 'rechazada' && (f.motivo ?? '').includes('está retirada')) === true,
      'el recálculo al crear ve la zona retirada después de validar: 409 plan_cambio, 0 equipos y el plan nuevo con las filas rechazadas por zona retirada', `${String(entraban)} ${retiro} ${r.estado} ${JSON.stringify(r.cuerpo).slice(0, 400)}`);
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
