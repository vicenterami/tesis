// Prueba de integración de la vista pública por enlace (docs/19 §4, O, punto 13; docs/16 §79) contra una base REAL con las migraciones
// aplicadas. La corre plataforma/pruebas/publico-integracion.sh, que levanta una base desechable y le pasa por el entorno el puerto y las
// claves de esa base (generadas al vuelo, nunca escritas). Los servicios entran con el rol de la aplicación (plataforma_app), como en la
// pila; la siembra y las fallas que se plantan (dar de baja, vencer, borrar lecturas) las hace el dueño. Cada comprobación imprime una
// línea OK o FALLA; sale 1 si alguna falla. Fuera de src/: no entra a la imagen ni a `pnpm test` (necesita base).
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { HttpException, type Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import { VistaPublicaService } from '../src/publico/vista-publica.service.js';
import { EnlacesService } from '../src/publico/enlaces.service.js';
import { TableroService } from '../src/consulta/tablero.service.js';
import { SQL_HISTORICO_SITIO, SQL_PUBLICO_SERIES } from '../src/consulta/tablero.js';
import { ActividadService } from '../src/consulta/actividad.service.js';
import { validarRenovacion, validarVista, type VistaPublica } from '../src/publico/publico.js';

const puerto = Number(process.env.PRUEBA_DB_PUERTO);
const dueno = new Pool({ host: '127.0.0.1', port: puerto, user: 'plataforma', password: process.env.PRUEBA_CLAVE_DUENO, database: 'plataforma', max: 3 });
const app = new Pool({ host: '127.0.0.1', port: puerto, user: 'plataforma_app', password: process.env.PRUEBA_CLAVE_APP, database: 'plataforma', max: 5 });

let fallos = 0;
let n = 0;
function comprobar(ok: boolean, texto: string, detalle = ''): void {
  n++;
  if (ok) console.log(`OK    ${texto}`);
  else { fallos++; console.log(`FALLA ${texto}${detalle ? ` · ${detalle}` : ''}`); }
}
const config = (extra: Record<string, string> = {}): ConfigService => ({ get: (k: string) => extra[k] }) as unknown as ConfigService;
const servicios = (extra: Record<string, string> = {}) => {
  const vista = new VistaPublicaService(app, config(extra));
  return { vista, enlaces: new EnlacesService(app, vista) };
};
async function respuestaDe(p: Promise<unknown>): Promise<{ estado: number; cuerpo: string }> {
  try {
    await p;
    return { estado: 200, cuerpo: '' };
  } catch (e) {
    if (e instanceof HttpException) return { estado: e.getStatus(), cuerpo: JSON.stringify(e.getResponse()) };
    throw e;
  }
}
const q = (sql: string, p: unknown[] = []) => dueno.query(sql, p);

// Todo lo que el registro del proceso escriba durante la prueba, para buscar el token después.
const registro: string[] = [];
for (const flujo of [process.stdout, process.stderr]) {
  const escribir = flujo.write.bind(flujo);
  const original = escribir as (...a: unknown[]) => boolean;
  const copia = (trozo: string | Uint8Array, ...resto: unknown[]): boolean => {
    registro.push(String(trozo));
    return original(trozo, ...resto);
  };
  flujo.write = copia;
}

// Un equipo con su canal de temperatura y 26 h de lecturas cada 300 s (valor base distinto por equipo).
let numero = 0;
type Equipo = { id: string; id_fisico: string; nombre: string; zona: string; base: number };
async function agregarEquipo(zonaId: string, zona: string): Promise<Equipo> {
  numero++;
  const id_fisico = `pub-equipo-${String(numero).padStart(2, '0')}`;
  const nombre = `Equipo secreto ${numero}`;
  const d = await q('INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) VALUES ($1, $2, $3, 300) RETURNING id', [zonaId, id_fisico, nombre]);
  const e = { id: d.rows[0].id as string, id_fisico, nombre, zona, base: 10 + numero };
  const c = await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ($1, 'temperatura') RETURNING id`, [e.id]);
  await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT $1, t, $2 + 0.5 * sin(extract(epoch FROM t) / 3600.0), 'Cel', t, 'dispositivo'
             FROM generate_series(now() - INTERVAL '26 hours', now() - INTERVAL '10 seconds', INTERVAL '300 seconds') t`, [c.rows[0].id, e.base]);
  await q('INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) VALUES ($1, now())', [e.id]);
  return e;
}

async function sembrar() {
  // Un sitio con tres zonas: Norte y Sur con tres equipos, Oeste con uno. Un equipo de Norte trae dos lecturas extremas (99.123 y -9.876)
  // que nunca deben verse en la respuesta.
  const s = await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Sitio de prueba pública', 'pub-prueba', 'America/Santiago') RETURNING id`);
  const sitio = s.rows[0].id as string;
  const zonas: Record<string, string> = {};
  for (const z of ['Norte', 'Sur', 'Oeste']) zonas[z] = (await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [sitio, z])).rows[0].id;
  const equipos: Equipo[] = [];
  for (const [z, cuantos] of [['Norte', 3], ['Sur', 3], ['Oeste', 1]] as const) for (let k = 0; k < cuantos; k++) equipos.push(await agregarEquipo(zonas[z], z));
  const extremo = equipos[0];
  await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT c.id, now() - INTERVAL '5 hours' + x * INTERVAL '7 seconds', v, 'Cel', now(), 'dispositivo'
             FROM canal c, unnest(ARRAY[99.123, -9.876]) WITH ORDINALITY AS u(v, x) WHERE c.dispositivo_id = $1`, [extremo.id]);
  const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en) VALUES ('Admin de prueba', 'admin-pub@prueba-publico.invalid', 'x', 1, now()) RETURNING id`);
  await q(`INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, 'administrador')`, [u.rows[0].id, sitio]);
  return { sitio, zonas, equipos, usuario: u.rows[0].id as string };
}

async function principal() {
  const s = await sembrar();
  const { vista, enlaces } = servicios();
  const limites = vista.limites;

  // ── Crear: el token una vez, la base solo con su resumen ─────────────────────────────────────────────────────────────────────────
  const creado = await enlaces.crear(s.sitio, validarVista({ titulo: 'Clima del campus', magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: [s.zonas.Norte, s.zonas.Sur, s.zonas.Oeste] }, limites), s.usuario);
  const fila = (await q('SELECT token_hash, row_to_json(e)::text AS todo FROM enlace_publico e WHERE id = $1', [creado.id])).rows[0] as { token_hash: string; todo: string };
  comprobar(fila.token_hash === createHash('sha256').update(creado.token).digest('hex') && !fila.todo.includes(creado.token),
    'crear: la base guarda el SHA-256 del token y en ninguna columna el token');
  comprobar(creado.direccion === `/panel/#/v/${creado.token}` && creado.estado === 'vigente' && !('minimo_dispositivos' in creado),
    'crear: la dirección lleva el token en el fragmento; vigente; el enlace no trae k (es del sitio)');
  const crearEn = (titulo: string, zonas: string[], ventana_maxima = '7d') =>
    enlaces.crear(s.sitio, validarVista({ titulo, magnitudes: ['temperatura'], ventana_maxima, zonas }, limites), s.usuario);
  const sinDesglose = await crearEn('Total del sitio', [], '24h');
  const soloNorteSur = await crearEn('Norte y Sur', [s.zonas.Norte, s.zonas.Sur]);
  const soloNorte = await crearEn('Solo Norte', [s.zonas.Norte]);
  const soloSur = await crearEn('Solo Sur', [s.zonas.Sur]);
  const zona = (v: VistaPublica, nombre: string) => v.magnitudes[0].zonas.find((z) => z.nombre === nombre);
  const todoNulo = (xs: (number | null)[]) => xs.every((x) => x === null);

  // ── La regla de k y la de la resta, al servir (docs/19 §4, O, punto 2) ──────────────────────────────────────────────────────────
  const v1 = await vista.servir(creado.token, undefined, false);
  comprobar(zona(v1, 'Oeste')?.ahora === null && todoNulo(zona(v1, 'Oeste')?.serie ?? [0]) && zona(v1, 'Norte')?.ahora !== null && zona(v1, 'Sur')?.ahora !== null,
    'k: Oeste (1 equipo) sale sin valor en «ahora» y en cada tramo; Norte y Sur (3 equipos) se publican');
  comprobar(v1.magnitudes[0].ahora === null && todoNulo(v1.magnitudes[0].serie) && v1.magnitudes[0].protegido && v1.ultimo_dato === null,
    'con un equipo oculto en el sitio, el total no se publica (ni «ahora» ni la serie), la magnitud dice `protegido` y «último dato» es null');
  const v1b = await vista.servir(soloNorteSur.token, undefined, false);
  comprobar(todoNulo(v1b.magnitudes[0].serie) && v1b.magnitudes[0].ahora === null && v1b.tiempos.length > 200,
    'resta, escenario 1: con Oeste SIN publicar, el total sigue oculto (si no, 7T − 3N − 3S despejaría a Oeste)');
  const [n1, n2] = await Promise.all([vista.servir(soloNorte.token, undefined, false), vista.servir(soloSur.token, undefined, false)]);
  comprobar(todoNulo(n1.magnitudes[0].serie) && todoNulo(n2.magnitudes[0].serie),
    'resta, escenario 3: dos enlaces del mismo sitio, uno con Norte y otro con Sur, tampoco publican el total');
  const indistinguible = JSON.stringify(zona(v1, 'Oeste')) + JSON.stringify(v1.magnitudes[0].serie);
  comprobar(!/oculto|"n"/.test(JSON.stringify(v1).replace(/"protegido":(true|false)/g, '')) && !indistinguible.includes('true'),
    'lo oculto y lo que no tiene datos se ven igual (null): ningún «oculto» por tramo, solo `protegido` por magnitud');

  // Una zona nueva, Este, con un equipo: dos zonas ocultas que juntas son 2 < k.
  const este = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'Este') RETURNING id`, [s.sitio])).rows[0].id as string;
  s.equipos.push(await agregarEquipo(este, 'Este'));
  const conEste = await crearEn('Con Este', [s.zonas.Norte, s.zonas.Sur, s.zonas.Oeste, este]);
  const v2a = await servicios().vista.servir(conEste.token, undefined, false);
  comprobar(todoNulo(v2a.magnitudes[0].serie) && zona(v2a, 'Este')?.ahora === null && zona(v2a, 'Oeste')?.ahora === null,
    'resta, escenario 2: dos zonas ocultas (1 + 1 equipos, menos que k) dejan oculto el total');
  // Un segundo equipo en Este: los equipos ocultos del sitio suman 1 + 2 = 3 = k, y el total se publica.
  s.equipos.push(await agregarEquipo(este, 'Este'));
  const total = await servicios().vista.servir(sinDesglose.token, undefined, false);
  const tablero = new TableroService(app);
  const h = await tablero.historicoSitio(s.sitio, 'temperatura', new Date(total.desde), new Date(total.hasta), total.intervalo as '5 minutes');
  const porT = new Map(h.tiempos.map((t, k) => [t, h.valores[k]]));
  const serie = total.magnitudes[0].serie;
  comprobar(total.tiempos.length > 200 && total.tiempos.every((t, k) => serie[k] !== null && serie[k] === porT.get(t)) && total.magnitudes[0].ahora !== null,
    `con los ocultos del sitio sumando k (Oeste 1 + Este 2), el total se publica: ${total.tiempos.length} tramos, cada uno el de GET /sitios/{id}/historico`);
  const cuerpo = JSON.stringify(await vista.servir(creado.token, '7d', false)) + JSON.stringify(total);
  const prohibidos = [...s.equipos.flatMap((e) => [e.id, e.id_fisico, e.nombre]), ...Object.values(s.zonas), este, s.sitio, '99.123', '-9.876', '"n"', 'minimo"', 'maximo', creado.token];
  const fugas = prohibidos.filter((x) => cuerpo.includes(x));
  comprobar(fugas.length === 0, 'la respuesta pública no trae identificadores, nombres de equipos, zonas por id, extremos, n, mínimo ni máximo, ni el token', fugas.join(', '));

  // La misma población en «ahora» y en la serie: un equipo de Sur en mantenimiento que sigue reportando sigue contando en «ahora».
  const sur1 = s.equipos.find((e) => e.zona === 'Sur') as Equipo;
  await q(`UPDATE dispositivo SET estado = 'mantenimiento' WHERE id = $1`, [sur1.id]);
  const vm = await servicios().vista.servir(creado.token, undefined, false);
  comprobar(zona(vm, 'Sur')?.ahora !== null && zona(vm, 'Sur')?.serie.at(-1) !== null,
    'un equipo en mantenimiento que reporta cuenta igual en «ahora» y en la serie (Sur sigue con 3: no hay diferencia que lo despeje)');
  await q(`UPDATE dispositivo SET estado = 'activo' WHERE id = $1`, [sur1.id]);

  // Baja de un equipo de Norte (3 → 2) sin tocar el enlace; además deja de reportar hace 2 h. Una instancia nueva (lo guardado vence a los
  // 60 s; aquí no se espera): Norte deja de publicarse en «ahora» y en los tramos recientes; en los viejos (3 equipos) sigue. El total: los
  // ocultos del sitio suman 1 + 2 + 2 = 5 ≥ k en los tramos recientes y 1 + 2 = 3 en los viejos: se publica en los dos.
  const nn = s.equipos.find((e) => e.zona === 'Norte' && e !== s.equipos[0]) as Equipo;
  await q(`UPDATE dispositivo SET estado = 'baja' WHERE id = $1`, [nn.id]);
  await q(`DELETE FROM medicion WHERE canal_id IN (SELECT id FROM canal WHERE dispositivo_id = $1) AND tiempo > now() - INTERVAL '2 hours'`, [nn.id]);
  const v2 = await servicios().vista.servir(creado.token, undefined, false);
  const norte2 = zona(v2, 'Norte');
  comprobar(norte2?.ahora === null && norte2.serie.at(-1) === null && norte2.serie[0] !== null,
    'k − 1 después de publicar: Norte deja de publicarse en «ahora» y en los tramos recientes; en los viejos (3 equipos) sigue');
  comprobar(v2.magnitudes[0].serie.at(-1) !== null && v2.magnitudes[0].serie[0] !== null && v2.magnitudes[0].protegido,
    'con los ocultos del sitio sumando k o más, el total se publica en los tramos viejos y en los recientes');

  // Zona creada después (Este, en el enlace del principio) y zona renombrada.
  await q(`UPDATE zona SET nombre = 'Norte renombrada' WHERE id = $1`, [s.zonas.Norte]);
  const v3 = await servicios().vista.servir(creado.token, undefined, false);
  comprobar(JSON.stringify(v3.magnitudes[0].zonas.map((z) => z.nombre)) === '["Norte","Sur","Oeste"]',
    'una zona creada después no aparece y una renombrada conserva el nombre publicado');

  // ── La vista previa da los mismos números ─────────────────────────────────────────────────────────────────────────────────────
  const previa = await enlaces.previa(s.sitio, validarVista({ magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: [s.zonas.Sur, s.zonas.Oeste] }, limites, true));
  const conSurOeste = await enlaces.crear(s.sitio, validarVista({ titulo: 'Sur y Oeste', magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: [s.zonas.Sur, s.zonas.Oeste] }, limites), s.usuario);
  const publica = await servicios().vista.servir(conSurOeste.token, undefined, false);
  // Sin el primer tramo común (su valor depende del instante exacto de `desde`) ni el último (el de la hora en curso).
  const comunes = previa.tiempos.filter((t) => publica.tiempos.includes(t)).slice(1, -1);
  const mismo = (v: VistaPublica, t: number) => { const k = v.tiempos.indexOf(t); const m = v.magnitudes[0]; return JSON.stringify([m.serie[k], m.zonas.map((z) => z.serie[k])]); };
  comprobar(comunes.length > 200 && comunes.every((t) => mismo(previa, t) === mismo(publica, t)) && previa.magnitudes[0].ahora === publica.magnitudes[0].ahora && previa.magnitudes[0].protegido === publica.magnitudes[0].protegido,
    `la vista previa y la vista del visitante dan los mismos números (${comunes.length} tramos comunes y «ahora»)`);

  // ── Respuestas idénticas para inexistente, mal formado, vencido y revocado ─────────────────────────────────────────────────────
  const vencido = await enlaces.crear(s.sitio, validarVista({ titulo: 'Vencido', magnitudes: ['temperatura'], ventana_maxima: '24h', plazo_dias: 7 }, limites), s.usuario);
  await q(`UPDATE enlace_publico SET creado_en = now() - INTERVAL '40 days', expira_en = now() - INTERVAL '29 days' WHERE id = $1`, [vencido.id]);
  const revocado = await enlaces.crear(s.sitio, validarVista({ titulo: 'Revocado', magnitudes: ['temperatura'], ventana_maxima: '24h' }, limites), s.usuario);
  const vistaR = servicios().vista;
  await vistaR.servir(revocado.token, undefined, false); // queda guardado
  await enlaces.revocar(s.sitio, revocado.id, s.usuario);
  const casos = await Promise.all([
    respuestaDe(vistaR.servir('A'.repeat(43), undefined, false)),
    respuestaDe(vistaR.servir('corto', undefined, false)),
    respuestaDe(vistaR.servir(undefined, undefined, false)),
    respuestaDe(vistaR.servir(vencido.token, undefined, false)),
    respuestaDe(vistaR.servir(revocado.token, undefined, false)),
  ]);
  comprobar(casos.every((c) => c.estado === 404 && c.cuerpo === casos[0].cuerpo), 'inexistente, mal formado, ausente, vencido y revocado: la misma 404, byte a byte', JSON.stringify(casos));
  comprobar(casos[4].estado === 404, 'revocar corta en la petición siguiente aunque la respuesta siga guardada en ese proceso');

  // ── Renovar ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const ren = await enlaces.renovar(s.sitio, vencido.id, validarRenovacion({ plazo_dias: 30 }, limites), s.usuario);
  const vuelve = await respuestaDe(servicios().vista.servir(vencido.token, undefined, false));
  comprobar(ren.estado === 'vigente' && vuelve.estado === 200, 'renovar un vencido hace 29 días: vuelve a servir con el mismo token');
  await q(`UPDATE enlace_publico SET renovado_en = NULL, creado_en = now() - INTERVAL '40 days', expira_en = now() - INTERVAL '31 days' WHERE id = $1`, [vencido.id]);
  const r31 = await respuestaDe(enlaces.renovar(s.sitio, vencido.id, validarRenovacion({ plazo_dias: 30 }, limites), s.usuario));
  const rRev = await respuestaDe(enlaces.renovar(s.sitio, revocado.id, validarRenovacion({ plazo_dias: 30 }, limites), s.usuario));
  await q(`UPDATE enlace_publico SET expira_en = now() + INTERVAL '1 day', creado_en = now() - INTERVAL '366 days', renovado_en = now() - INTERVAL '10 days' WHERE id = $1`, [vencido.id]);
  const rAnio = await respuestaDe(enlaces.renovar(s.sitio, vencido.id, validarRenovacion({ plazo_dias: 30 }, limites), s.usuario));
  comprobar([r31, rRev, rAnio].every((r) => r.estado === 409 && r.cuerpo.includes('no_renovable')), 'renovar uno vencido hace 31 días, uno revocado o uno de más de un año: 409', JSON.stringify([r31, rRev, rAnio]));
  const acorta = await respuestaDe(enlaces.renovar(s.sitio, creado.id, validarRenovacion({ plazo_dias: 7 }, limites), s.usuario));
  comprobar(acorta.estado === 409 && acorta.cuerpo.includes('"codigo":"acorta"'), 'renovar con un plazo que acorta sin confirmarlo: 409 con las dos fechas');
  let rechazo = '';
  try { await q(`UPDATE enlace_publico SET expira_en = creado_en + INTERVAL '181 days' WHERE id = $1`, [creado.id]); } catch (e) { rechazo = (e as Error).message; }
  comprobar(rechazo.includes('ck_enlace_publico_vencimiento'), 'la base rechaza un vencimiento de más de 180 días (ck_enlace_publico_vencimiento)');

  // ── Cien visitas simultáneas con la respuesta vencida: una consulta de datos, cien lecturas por índice ───────────────────────────
  const { vista: vista4 } = servicios();
  let conexiones = 0;
  let validaciones = 0;
  const conectar = app.connect.bind(app);
  const consultar = app.query.bind(app);
  // pool.query también llama a connect, con una función: el cálculo de datos es el que pide una conexión propia, sin argumentos.
  (app as unknown as { connect: unknown }).connect = (...a: unknown[]) => { if (a.length === 0) conexiones++; return (conectar as (...x: unknown[]) => unknown)(...a); };
  (app as unknown as { query: unknown }).query = (...a: unknown[]) => { if (String(a[0]).includes('FROM enlace_publico e JOIN sitio')) validaciones++; return (consultar as (...x: unknown[]) => unknown)(...a); };
  const cien = await Promise.all(Array.from({ length: 100 }, () => respuestaDe(vista4.servir(sinDesglose.token, undefined, true))));
  (app as unknown as { connect: unknown }).connect = conectar;
  (app as unknown as { query: unknown }).query = consultar;
  comprobar(cien.every((r) => r.estado === 200) && conexiones === 1 && validaciones === 100, `100 visitas simultáneas: ${conexiones} cálculo de datos y ${validaciones} validaciones por índice`);
  const indice = String((await q(`SELECT indexdef FROM pg_indexes WHERE indexname = 'uq_enlace_publico_token_hash'`)).rows[0]?.indexdef ?? '');
  comprobar(indice.startsWith('CREATE UNIQUE INDEX') && indice.includes('(token_hash)'), 'la validación busca por el índice único del resumen (uq_enlace_publico_token_hash)');

  // ── Contador: cargas, no refrescos; sin direcciones; volcado sumando ────────────────────────────────────────────────────────────
  await vista4.volcar();
  const otra = servicios().vista;
  await otra.servir(sinDesglose.token, undefined, true);
  await otra.servir(sinDesglose.token, undefined, false);
  await otra.volcar();
  const cuenta = (await q('SELECT dia::text, cuenta FROM enlace_publico_acceso WHERE enlace_id = $1', [sinDesglose.id])).rows;
  const hoy = (await q(`SELECT (now() AT TIME ZONE 'America/Santiago')::date::text AS d`)).rows[0].d;
  comprobar(cuenta.length === 1 && cuenta[0].cuenta === 101 && cuenta[0].dia === hoy, `contador: 101 cargas (100 + 1; el refresco no cuenta) en el día del sitio, sumadas por dos procesos`, JSON.stringify(cuenta));
  const columnas = (await q(`SELECT string_agg(column_name, ',' ORDER BY ordinal_position) AS c FROM information_schema.columns WHERE table_name = 'enlace_publico_acceso'`)).rows[0].c;
  comprobar(columnas === 'enlace_id,dia,cuenta', 'el contador no guarda direcciones ni nada de quien visita', columnas);
  const lista = await enlaces.listar(s.sitio);
  comprobar(lista.find((e) => e.id === sinDesglose.id)?.accesos_7d === 101 && lista.every((e) => !JSON.stringify(e).includes('token')), 'la lista muestra los accesos de 7 días y nunca el token ni su resumen');

  // ── Limpieza del contador y permisos de la aplicación ──────────────────────────────────────────────────────────────────────────
  await q(`INSERT INTO enlace_publico_acceso (enlace_id, dia, cuenta) VALUES ($1, current_date - 100, 5)`, [sinDesglose.id]);
  const borradas = (await app.query('SELECT fn_limpiar_accesos_publicos(90) AS n')).rows[0].n;
  const quedan = (await q('SELECT count(*)::int AS n FROM enlace_publico_acceso WHERE enlace_id = $1', [sinDesglose.id])).rows[0].n;
  comprobar(borradas === 1 && quedan === 1, 'fn_limpiar_accesos_publicos(90) borra la fila de hace 100 días y deja la de hoy');
  const prohibido = await Promise.all([
    app.query('DELETE FROM enlace_publico_acceso').then(() => 'pasó', (e: Error) => e.message),
    app.query(`UPDATE enlace_publico SET token_hash = repeat('0', 64)`).then(() => 'pasó', (e: Error) => e.message),
    app.query('SELECT fn_limpiar_accesos_publicos(3)').then(() => 'pasó', (e: Error) => e.message),
  ]);
  comprobar(prohibido.every((m) => m !== 'pasó'), 'la aplicación no borra, no cambia el resumen del token y no limpia con menos de 7 días', prohibido.join(' | '));

  // ── El tope de enlaces con altas simultáneas ─────────────────────────────────────────────────────────────────────────────────
  const s2 = (await q(`INSERT INTO sitio (nombre, codigo) VALUES ('Sitio del tope', 'pub-tope') RETURNING id`)).rows[0].id;
  const tope = servicios({ PUBLICO_MAX_ENLACES_POR_SITIO: '3' });
  const altas = await Promise.all(Array.from({ length: 6 }, (_, k) =>
    respuestaDe(tope.enlaces.crear(s2, validarVista({ titulo: `Alta ${k}`, magnitudes: ['temperatura'], ventana_maxima: '24h' }, tope.vista.limites), null))));
  comprobar(altas.filter((a) => a.estado === 200).length === 3 && altas.filter((a) => a.estado === 409 && a.cuerpo.includes('tope_enlaces')).length === 3,
    'seis altas simultáneas con tope 3: tres creadas y tres 409 (el candado por sitio ordena la cuenta)', JSON.stringify(altas.map((a) => a.estado)));

  // ── Actividad del sitio ──────────────────────────────────────────────────────────────────────────────────────────────────────
  const act = await new ActividadService(app).actividad(s.sitio, { desde: new Date(Date.now() - 3_600_000), hasta: new Date(Date.now() + 60_000), limite: 100 });
  const textos = act.map((a) => a.texto);
  comprobar(textos.includes('publicó el enlace público «Clima del campus»') && textos.includes('renovó el enlace público «Vencido»') && textos.includes('revocó el enlace público «Revocado»')
    && act.every((a) => a.usuario === null || a.usuario.nombre === 'Admin de prueba'),
    'la actividad del sitio muestra crear, renovar y revocar con quién');
  const ajena = await new ActividadService(app).actividad(s2, { desde: new Date(Date.now() - 3_600_000), hasta: new Date(Date.now() + 60_000), limite: 100 });
  comprobar(ajena.every((a) => !a.texto.includes('Clima del campus')), 'la actividad de otro sitio no muestra los enlaces de este');

  // ── Lo que decide el administrador del sitio (decidido el 17/11/2026): el tope de enlaces vivos, la lista y la retención del texto ──────
  const s3 = (await q(`INSERT INTO sitio (nombre, codigo) VALUES ('Sitio del tope fijado', 'pub-tope-fijado') RETURNING id`)).rows[0].id as string;
  await enlaces.fijarTope(s3, 2, s.usuario);
  const alta3 = (titulo: string) => respuestaDe(enlaces.crear(s3, validarVista({ titulo, magnitudes: ['temperatura'], ventana_maxima: '24h' }, limites), s.usuario));
  const [e1, e2, e3] = [await alta3('Uno'), await alta3('Dos'), await alta3('Tres')];
  const lista3 = await enlaces.listar(s3);
  await enlaces.revocar(s3, lista3[0].id, s.usuario);
  const e4 = await alta3('Cuatro');
  comprobar(e1.estado === 200 && e2.estado === 200 && e3.estado === 409 && e3.cuerpo.includes('ya tiene 2 enlaces') && e4.estado === 200,
    'el tope que fija el administrador rige (2), con su número en el 409, y un enlace revocado deja de contar', JSON.stringify([e1.estado, e2.estado, e3, e4.estado]));
  const dosVivos = await enlaces.listar(s3);
  await q(`UPDATE enlace_publico SET renovado_en = NULL, creado_en = now() - INTERVAL '40 days', expira_en = now() - INTERVAL '31 days' WHERE id = $1`, [dosVivos[0].id]);
  const e5 = await alta3('Cinco');
  comprobar(dosVivos.length === 2 && e5.estado === 200, 'un enlace vencido hace 31 días (ya no renovable) tampoco cuenta para el tope', JSON.stringify([dosVivos.length, e5]));
  const actTope = await new ActividadService(app).actividad(s3, { desde: new Date(Date.now() - 3_600_000), hasta: new Date(Date.now() + 60_000), limite: 100 });
  comprobar(actTope.some((x) => x.texto === 'fijó en 2 el tope de enlaces públicos del sitio' && x.usuario?.nombre === 'Admin de prueba'), 'fijar el tope queda en la actividad del sitio, con quién');
  await q(`UPDATE enlace_publico SET renovado_en = NULL, creado_en = now() - INTERVAL '400 days', expira_en = now() - INTERVAL '230 days' WHERE id = $1`, [soloSur.id]);
  const anonimizados = Number((await app.query('SELECT fn_anonimizar_enlaces_publicos() AS n')).rows[0].n);
  const muerto = (await q('SELECT titulo, descripcion, zonas::text AS zonas, anonimizado_en FROM enlace_publico WHERE id = $1', [soloSur.id])).rows[0] as { titulo: string; descripcion: string | null; zonas: string; anonimizado_en: Date | null };
  const otraVez = Number((await app.query('SELECT fn_anonimizar_enlaces_publicos() AS n')).rows[0].n);
  comprobar(anonimizados >= 1 && otraVez === 0 && muerto.titulo === 'Enlace retirado' && muerto.descripcion === null && !muerto.zonas.includes('Sur') && muerto.zonas.includes('Zona 1') && muerto.anonimizado_en !== null,
    'retención: un enlace muerto hace más de su plazo queda con título fijo, sin descripción ni nombres de zona; una segunda corrida no toca nada', JSON.stringify(muerto));
  const vivos = await enlaces.listar(s.sitio);
  const todosLista = await enlaces.listar(s.sitio, true);
  comprobar(!vivos.some((x) => x.id === soloSur.id) && todosLista.some((x) => x.id === soloSur.id && x.anonimizado_en !== null),
    'la lista muestra por omisión solo los vivos; con incluir=todos, también los muertos, con su texto ya anonimizado');
  const actMuerto = await new ActividadService(app).actividad(s.sitio, { desde: new Date(Date.now() - 3_600_000), hasta: new Date(Date.now() + 60_000), limite: 200 });
  comprobar(actMuerto.some((x) => x.texto === 'publicó el enlace público «Enlace retirado»') && !actMuerto.some((x) => x.texto.includes('«Solo Sur»')),
    'la actividad conserva el rastro del enlace muerto, ya con el texto anonimizado');
  // El k es del sitio (tercera revisión): bajarlo responde que afecta a todos sus enlaces, y la vista previa avisa lo que se podría deducir.
  const bajado = await enlaces.fijarMinimo(s.sitio, 1, s.usuario);
  const previaAvisos = await enlaces.previa(s.sitio, validarVista({ magnitudes: ['temperatura'], zonas: [s.zonas.Norte, s.zonas.Oeste] }, limites, true));
  const conUno = await servicios().vista.servir(creado.token, undefined, false);
  await enlaces.fijarMinimo(s.sitio, 3, s.usuario);
  const conTres = await servicios().vista.servir(creado.token, undefined, false);
  comprobar(bajado.minimo_dispositivos === 1 && bajado.avisos[0] === 'Este mínimo afecta a todos los enlaces públicos de este sitio.' && bajado.avisos.some((x) => x.includes('«Oeste» tiene 1 equipo: con k = 1'))
    && previaAvisos.avisos.some((x) => x.includes('«Oeste» tiene 1 equipo: con k = 1')) && previaAvisos.avisos.some((x) => x.includes('deducir el promedio de las no publicadas')),
    'bajar el k del sitio avisa que afecta a todos sus enlaces y lo que se podría deducir; la vista previa también', JSON.stringify([bajado.avisos, previaAvisos.avisos]));
  comprobar(zona(conUno, 'Oeste')?.ahora !== null && conUno.minimo_dispositivos === 1 && zona(conTres, 'Oeste')?.ahora === null && conTres.minimo_dispositivos === 3,
    'el k del sitio rige en la petición siguiente de un enlace ya creado: con 1, Oeste sale; de vuelta en 3, se oculta');
  const actMinimo = await new ActividadService(app).actividad(s.sitio, { desde: new Date(Date.now() - 3_600_000), hasta: new Date(Date.now() + 60_000), limite: 300 });
  comprobar(actMinimo.some((x) => x.texto === 'fijó en 1 el mínimo de dispositivos de la vista pública del sitio' && x.usuario?.nombre === 'Admin de prueba'), 'fijar el k del sitio queda en la actividad, con quién');
  // Los avisos cuentan por magnitud, como la regla (revisión final): un equipo de Sur con humedad (Sur tiene 3 con temperatura).
  const sur = s.equipos.find((e) => e.zona === 'Sur') as Equipo;
  const ch = (await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ($1, 'humedad') RETURNING id`, [sur.id])).rows[0].id as string;
  await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo) VALUES ($1, now() - INTERVAL '1 minute', 55, '%RH', now(), 'dispositivo')`, [ch]);
  const previaDos = await enlaces.previa(s.sitio, validarVista({ magnitudes: ['temperatura', 'humedad'], zonas: [s.zonas.Sur] }, limites, true));
  comprobar(previaDos.avisos.includes('Humedad relativa: La zona «Sur» tiene hoy 1 equipo, menos que k = 3: saldrá sin valor mientras sea así.')
    && !previaDos.avisos.some((x) => x.startsWith('Temperatura: La zona «Sur»')),
    'los avisos cuentan los equipos de cada magnitud: Sur tiene 1 con humedad (aviso) y 3 con temperatura (sin aviso)', JSON.stringify(previaDos.avisos));

  // ── El registro del enlace no se reescribe (disparador trg_enlace_publico_tiempos), ni siquiera por el dueño ─────────────────────
  const intentos = await Promise.all([
    q('UPDATE enlace_publico SET revocado_en = NULL, revocado_por = NULL WHERE id = $1', [revocado.id]).then(() => 'pasó', (e: Error) => e.message),
    q(`UPDATE enlace_publico SET revocado_en = now() - INTERVAL '1 day' WHERE id = $1`, [revocado.id]).then(() => 'pasó', (e: Error) => e.message),
    q(`UPDATE enlace_publico SET renovado_en = now() + INTERVAL '1 day' WHERE id = $1`, [sinDesglose.id]).then(() => 'pasó', (e: Error) => e.message),
    q(`UPDATE enlace_publico SET creado_en = now() + INTERVAL '1 hour', expira_en = now() + INTERVAL '2 days' WHERE id = $1`, [sinDesglose.id]).then(() => 'pasó', (e: Error) => e.message),
  ]);
  comprobar(intentos.every((m) => m.includes('enlace_publico:')), 'una revocación no se deshace ni se cambia, y nada queda fechado en el futuro (también para el dueño)', intentos.join(' | '));
  // Segunda revisión: un enlace nace ahora y una revocación nueva se fecha al hacerla; la aplicación inserta solo en sus columnas.
  const sitioInsert = s.sitio;
  const masIntentos = await Promise.all([
    q(`INSERT INTO enlace_publico (sitio_id, token_hash, magnitudes, ventana_maxima, titulo, creado_en, expira_en)
       VALUES ($1, repeat('a', 64), '{temperatura}', '24h', 'Fechado atrás', now() - INTERVAL '2 days', now() + INTERVAL '1 day')`, [sitioInsert]).then(() => 'pasó', (e: Error) => e.message),
    q(`UPDATE enlace_publico SET expira_en = now() + INTERVAL '5 days' WHERE id = $1`, [revocado.id]).then(() => 'pasó', (e: Error) => e.message),
    q(`UPDATE enlace_publico SET revocado_en = now() - INTERVAL '1 day' WHERE id = $1`, [sinDesglose.id]).then(() => 'pasó', (e: Error) => e.message),
  ]);
  const insertApp = await app.query(`INSERT INTO enlace_publico (sitio_id, token_hash, magnitudes, ventana_maxima, titulo, creado_en, expira_en)
       VALUES ($1, repeat('b', 64), '{temperatura}', '24h', 'Con creado_en', now(), now() + INTERVAL '1 day')`, [sitioInsert]).then(() => 'pasó', (e: Error) => e.message);
  comprobar(masIntentos.every((m) => m.includes('enlace_publico:')) && /permission denied|permiso denegado/.test(insertApp),
    'creado_en es la hora de la creación, una revocación se fecha al hacerla, un revocado no cambia su vencimiento, y la aplicación no inserta creado_en', [...masIntentos, insertApp].join(' | '));
  // Renovar y revocar a la vez: ninguno choca con el disparador (la hora «del futuro» se mide con el reloj, no con el inicio de la transacción).
  const carrera = await crearEn('Carrera', [], '24h');
  const cualquiera = (p: Promise<unknown>) => p.then(() => ({ estado: 200, cuerpo: '' }), (e: Error) => (e instanceof HttpException ? { estado: e.getStatus(), cuerpo: '' } : { estado: 500, cuerpo: e.message }));
  const dos = await Promise.all([
    cualquiera(enlaces.renovar(s.sitio, carrera.id, validarRenovacion({ plazo_dias: 90 }, limites), s.usuario)),
    cualquiera(enlaces.revocar(s.sitio, carrera.id, s.usuario)),
  ]);
  comprobar(dos.every((x) => x.estado === 200 || x.estado === 409) && dos.some((x) => x.estado === 200), 'renovar y revocar a la vez no chocan con el disparador', JSON.stringify(dos));
  // Un enlace anonimizado no se sirve aunque no haya vencido.
  const paraAnonimizar = await crearEn('Para anonimizar', [], '24h');
  await q('UPDATE enlace_publico SET anonimizado_en = now() WHERE id = $1', [paraAnonimizar.id]);
  comprobar((await respuestaDe(servicios().vista.servir(paraAnonimizar.token, undefined, false))).estado === 404, 'un enlace anonimizado no se sirve aunque no haya vencido');

  // ── k por sitio (tercera revisión): enlaces con ventanas o zonas distintas ocultan lo mismo. Zonas A = 3, B = 1, E = 10 ──────────────
  const s4 = (await q(`INSERT INTO sitio (nombre, codigo) VALUES ('Sitio de enlaces combinados', 'pub-combinados') RETURNING id`)).rows[0].id as string;
  const z4: Record<string, string> = {};
  for (const [z, cuantos] of [['A', 3], ['B', 1], ['E', 10]] as const) {
    z4[z] = (await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [s4, z])).rows[0].id;
    for (let k = 0; k < cuantos; k++) await agregarEquipo(z4[z], z);
  }
  const en4 = (titulo: string, ventana_maxima: string, zonas: string[]) => enlaces.crear(s4, validarVista({ titulo, magnitudes: ['temperatura'], ventana_maxima, zonas }, limites), s.usuario);
  const conZonas = await en4('A y E, 24 horas', '24h', [z4.A, z4.E]);
  const sinZonas = await en4('Total, 7 días', '7d', []);
  const [w1, w2, w3] = await Promise.all([servicios().vista.servir(conZonas.token, undefined, false), servicios().vista.servir(sinZonas.token, undefined, false),
    servicios().vista.servir(sinZonas.token, '7d', false)]);
  comprobar(todoNulo(w1.magnitudes[0].serie) && todoNulo(w2.magnitudes[0].serie) && todoNulo(w3.magnitudes[0].serie) && zona(w1, 'A')?.ahora !== null && zona(w1, 'E')?.ahora !== null,
    'k del sitio (3): ni el enlace con A y E ni el de solo el total, en 24 h o en 7 días, publican el total (14·T − 3·A − 10·E = B no se arma)');
  const conCuatro = await enlaces.fijarMinimo(s4, 4, s.usuario);
  const [x1, x2] = await Promise.all([servicios().vista.servir(conZonas.token, undefined, false), servicios().vista.servir(sinZonas.token, undefined, false)]);
  comprobar(conCuatro.minimo_dispositivos === 4 && zona(x1, 'A')?.ahora === null && zona(x1, 'E')?.ahora !== null && x1.magnitudes[0].ahora !== null && x2.magnitudes[0].ahora !== null,
    'con k = 4 en el sitio, A (3) se oculta en todos sus enlaces y el total sale: lo único que se despeja es el promedio de A y B juntas, 4 equipos');
  await enlaces.fijarMinimo(s4, 3, s.usuario);

  // ── Mover un equipo no cambia el pasado de ninguna zona ni del total (dispositivo_zona, tercera revisión) ──────────────────────────
  // Con k = 4: A (3) y B (1) ocultas suman 4 y el total se publica. Si la lectura se atribuyera a la zona de HOY, A tendría 4 en todo el
  // pasado, saldría publicada, B (1) quedaría sola y el total del pasado desaparecería; y E bajaría de 10 a 9 en todos sus tramos.
  await enlaces.fijarMinimo(s4, 4, s.usuario);
  const ver = () => Promise.all([servicios().vista.servir(conZonas.token, undefined, false), servicios().vista.servir(sinZonas.token, undefined, false),
    servicios().vista.servir(sinZonas.token, '7d', false)]);
  const movido = (await q(`SELECT id FROM dispositivo WHERE zona_id = $1 ORDER BY id LIMIT 1`, [z4.E])).rows[0].id as string;
  // Una lectura del equipo en E en el tramo en curso, ya servida antes del cambio; después del cambio, otra suya (en A) en el mismo tramo.
  // La de E, con un segundo de margen: la vista corta en su `hasta` (la hora del proceso), y una lectura fechada en ese mismo milisegundo
  // quedaría fuera de la vista de antes.
  const lectura = (valor: number, atras: string) => q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
           SELECT id, clock_timestamp() - $3::interval, $2, 'Cel', clock_timestamp(), 'dispositivo' FROM canal WHERE dispositivo_id = $1
           RETURNING (floor(extract(epoch FROM tiempo) / 300) * 300)::bigint AS tramo`, [movido, valor, atras]);
  const tramoE = Number((await lectura(40, '1 second')).rows[0].tramo);
  const [antesZ, antesT, antesT7] = await ver();
  await app.query('UPDATE dispositivo SET zona_id = $2 WHERE id = $1', [movido, z4.A]);
  const tramoA = Number((await lectura(50, '0 seconds')).rows[0].tramo);
  const historia = (await q(`SELECT zona_id, desde > '-infinity' AS fechada, hasta IS NULL AS abierta FROM dispositivo_zona WHERE dispositivo_id = $1 ORDER BY desde`, [movido])).rows as { zona_id: string; fechada: boolean; abierta: boolean }[];
  const escribir = await Promise.all([
    app.query('INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde) VALUES ($1, $2, now())', [movido, z4.B]).then(() => 'pasó', (e: Error) => e.message),
    app.query('UPDATE dispositivo_zona SET zona_id = $2 WHERE dispositivo_id = $1', [movido, z4.B]).then(() => 'pasó', (e: Error) => e.message),
    app.query('DELETE FROM dispositivo_zona WHERE dispositivo_id = $1', [movido]).then(() => 'pasó', (e: Error) => e.message),
  ]);
  await new Promise((r) => setTimeout(r, 50)); // la lectura de A, antes del `hasta` de la vista de después
  const [despuesZ, despuesT, despuesT7] = await ver();
  type Serie = (v: VistaPublica) => (number | null)[];
  // Tramo a tramo, sin el primero (depende del instante exacto de `desde`) ni los dos últimos (el del cambio y el de la hora en curso).
  const iguales = (a: VistaPublica, b: VistaPublica, f: Serie, minimo: number) => {
    const ma = new Map(a.tiempos.map((x, i) => [x, f(a)[i]]));
    const mb = new Map(b.tiempos.map((x, i) => [x, f(b)[i]]));
    const comunes = [...ma.keys()].filter((x) => mb.has(x)).slice(1, -2);
    return comunes.length >= minimo && comunes.every((x) => ma.get(x) === mb.get(x)) && comunes.some((x) => ma.get(x) !== null);
  };
  const delTotal: Serie = (v) => v.magnitudes[0].serie;
  const deZona = (nombre: string): Serie => (v) => zona(v, nombre)?.serie ?? [];
  comprobar(historia.length === 2 && historia[0].zona_id === z4.E && !historia[0].abierta && historia[1].zona_id === z4.A && historia[1].fechada && historia[1].abierta,
    'mover un equipo cierra su estadía en E y abre otra en A, por disparador', JSON.stringify(historia));
  comprobar(escribir.every((m) => /permission denied|permiso denegado/.test(m)), 'la aplicación no escribe ni borra la historia de zonas', escribir.join(' | '));
  comprobar(iguales(antesT, despuesT, delTotal, 200) && iguales(antesT7, despuesT7, delTotal, 20),
    'enlace sin desglose, k = 4: el total antes y después de mover un equipo de E a A es idéntico tramo a tramo, en 24 h y en 7 días (10·T_antes − 9·T_después no despeja al equipo)');
  comprobar(iguales(antesZ, despuesZ, deZona('E'), 200) && zona(antesZ, 'A')?.serie.slice(1, -2).every((x) => x === null) === true && zona(despuesZ, 'A')?.serie.slice(1, -2).every((x) => x === null) === true,
    'tampoco cambia el pasado de la zona de origen (E, 10 equipos) ni el de la de destino (A, 3 equipos: sigue oculta)');
  // El tramo en curso, ya servido: con la lectura del equipo en A en ese mismo tramo, la zona de origen y el total no cambian (el equipo
  // entra a A desde el tramo siguiente; revisión final del 17/11/2026: si no, 4·E_antes − 3·E_después lo despejaría).
  const enTramo = (v: VistaPublica, f: Serie) => f(v)[v.tiempos.indexOf(tramoE)];
  comprobar(tramoE === tramoA && antesZ.tiempos.includes(tramoE) && enTramo(antesZ, deZona('E')) != null && enTramo(antesZ, deZona('E')) === enTramo(despuesZ, deZona('E'))
    && enTramo(antesT, delTotal) != null && enTramo(antesT, delTotal) === enTramo(despuesT, delTotal),
    'el tramo en curso de la zona de origen y del total es idéntico antes y después del cambio (el equipo entra a la de destino en el tramo siguiente)',
    JSON.stringify({ mismoTramo: tramoE === tramoA, E: [enTramo(antesZ, deZona('E')), enTramo(despuesZ, deZona('E'))], T: [enTramo(antesT, delTotal), enTramo(despuesT, delTotal)] }));
  // En el tramo del cambio el equipo movido aporta una vez, no una por zona: con su lectura antes del cambio (en E) y la de después (en A)
  // en el mismo tramo, ningún tramo del total cuenta más que los 14 canales del sitio.
  const fin = new Date(Date.now() + 60_000);
  const filasN = (await q(SQL_PUBLICO_SERIES, [s4, new Date(fin.getTime() - 86_400_000), fin, '5 minutes', 'UTC', ['temperatura'], new Date(fin.getTime() - 90_000_000)])).rows as { zona_id: string | null; n: number }[];
  const nTotal = filasN.filter((f) => f.zona_id === null).map((f) => f.n);
  comprobar(nTotal.length > 200 && Math.max(...nTotal) === 14, 'en el tramo del cambio el equipo movido cuenta una vez: ningún total pasa de los 14 equipos del sitio', `máximo ${Math.max(...nTotal)}`);
  await enlaces.fijarMinimo(s4, 3, s.usuario);

  // ── El disparador de la historia (revisión final): dos transacciones que mueven el mismo equipo a la vez, dos cambios en una sola, y lo
  // que la base no deja: estadías solapadas y borrar en cascada un dispositivo o una zona con historia ───────────────────────────────
  const otro = (await q(`SELECT id FROM dispositivo WHERE zona_id = $1 ORDER BY id LIMIT 1`, [z4.E])).rows[0].id as string;
  const zF = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'F') RETURNING id`, [s4])).rows[0].id as string;
  const mover = async (destinos: string[]): Promise<string> => {
    const c = await app.connect();
    try {
      await c.query('BEGIN');
      for (const z of destinos) await c.query('UPDATE dispositivo SET zona_id = $2 WHERE id = $1', [otro, z]);
      await c.query('COMMIT');
      return 'ok';
    } catch (e) {
      await c.query('ROLLBACK');
      return (e as Error).message;
    } finally {
      c.release();
    }
  };
  // Dos transacciones a la vez, en el orden que rompía la hora de la transacción: la segunda empieza (y fija su now()) antes de que la
  // primera mueva el equipo y confirme; recién después lo mueve ella. Con now() cerraría la estadía antes de que empezara (CHECK).
  const segunda = await app.connect();
  let aLaVez: string[];
  try {
    await segunda.query('BEGIN');
    await segunda.query('SELECT now()');
    await new Promise((r) => setTimeout(r, 50));
    const primera = await mover([zF]);
    const suya = await segunda.query('UPDATE dispositivo SET zona_id = $2 WHERE id = $1', [otro, z4.B]).then(() => 'ok', (e: Error) => e.message);
    await segunda.query(suya === 'ok' ? 'COMMIT' : 'ROLLBACK');
    aLaVez = [primera, suya];
  } finally {
    segunda.release();
  }
  const filasAntes = Number((await q('SELECT count(*)::int AS n FROM dispositivo_zona WHERE dispositivo_id = $1', [otro])).rows[0].n);
  const unaTx = await mover([z4.B, z4.A]);
  const tramos = (await q(`SELECT zona_id, hasta IS NULL AS abierta, hasta = lead(desde) OVER (ORDER BY desde) AS contigua
                             FROM dispositivo_zona WHERE dispositivo_id = $1 ORDER BY desde`, [otro])).rows as { zona_id: string; abierta: boolean; contigua: boolean | null }[];
  comprobar(aLaVez.every((x) => x === 'ok') && unaTx === 'ok' && filasAntes === 3 && tramos.length === 4 && tramos.at(-1)?.zona_id === z4.A && tramos.at(-1)?.abierta === true
    && tramos.slice(0, -1).every((x) => x.contigua === true && !x.abierta),
    'dos transacciones que mueven el mismo equipo a la vez dejan dos estadías nuevas, contiguas; dos cambios en una transacción, una sola (con la zona final)',
    JSON.stringify({ aLaVez, unaTx, filasAntes, tramos }));
  const prohibidoDueno = async (sql: string, p: unknown[]): Promise<string> => {
    const c = await dueno.connect();
    try {
      await c.query('BEGIN');
      await c.query(sql, p);
      return 'pasó';
    } catch (e) {
      return (e as Error).message;
    } finally {
      await c.query('ROLLBACK');
      c.release();
    }
  };
  const base3 = await Promise.all([
    prohibidoDueno(`INSERT INTO dispositivo_zona (dispositivo_id, zona_id, desde, hasta) VALUES ($1, $2, now() - INTERVAL '1 hour', now() - INTERVAL '30 minutes')`, [otro, z4.B]),
    prohibidoDueno('DELETE FROM dispositivo WHERE id = $1', [otro]),
    prohibidoDueno('DELETE FROM zona WHERE id = $1', [zF]),
  ]);
  comprobar(base3[0].includes('uq_dispositivo_zona_sin_solape') && base3[1].includes('fk_dispositivo_zona_dispositivo') && base3[2].includes('fk_dispositivo_zona_zona'),
    'la base no deja estadías solapadas ni borra en cascada la historia de un dispositivo o de una zona (tampoco el dueño)', base3.join(' | '));

  // ── Costo de la consulta con la historia de zonas (EXPLAIN ANALYZE, con la siembra de esta prueba; docs/16 §79) ───────────────────
  for (const horas of [24, 168]) {
    const hasta = new Date();
    const desde = new Date(hasta.getTime() - horas * 3_600_000);
    const intervalo = horas === 24 ? '5 minutes' : '1 hour';
    const cota = new Date(desde.getTime() - 3_600_000);
    // La mediana de cinco corridas (la primera paga la planificación y la caché fría).
    const tiempo = async (sql: string, p: unknown[]): Promise<number> => {
      const xs: number[] = [];
      for (let i = 0; i < 5; i++) {
        const r = await q(`EXPLAIN (ANALYZE, FORMAT JSON) ${sql}`, p);
        xs.push(Number((r.rows[0]['QUERY PLAN'] as { 'Execution Time': number }[])[0]['Execution Time']));
      }
      return xs.sort((x, y) => x - y)[2];
    };
    const pub = await tiempo(SQL_PUBLICO_SERIES, [s4, desde, hasta, intervalo, 'UTC', ['temperatura'], cota]);
    const hist = await tiempo(SQL_HISTORICO_SITIO, [s4, desde, hasta, intervalo, 'UTC', 'temperatura', cota]);
    console.log(`INFO  costo (mediana de 5), ${horas} h, 14 equipos con una lectura cada 300 s: SQL_PUBLICO_SERIES ${pub.toFixed(1)} ms, SQL_HISTORICO_SITIO ${hist.toFixed(1)} ms`);
  }

  // ── Aislamiento con el backend real: cada ruta del OpenAPI responde lo mismo con y sin un X-Enlace-Publico válido ────────────────
  // La aplicación entera (AppModule) contra esta base, en un puerto efímero de 127.0.0.1, con el broker apuntando a un puerto cerrado: las
  // rutas que no lo necesitan responden igual. Con la sesión de un administrador del sitio, cada GET; cada ruta que escribe, sin la cabecera
  // X-Pedido (403 de la guardia) y sin sesión (401). Se compara el código y el cuerpo con los dígitos enmascarados (la hora cambia entre dos
  // peticiones). /eventos (un flujo que no termina) y /publico (la que sí lee la cabecera) quedan fuera.
  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: '127.0.0.1', DB_PUERTO: String(puerto), DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-publico', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
  });
  // La aplicación COMPILADA (dist/, la que corre en la imagen; el guion la construye antes): tsx no emite los metadatos de decoradores con
  // que Nest resuelve las dependencias de cada constructor.
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  const base = (await nest.getUrl()).replace('[::1]', '127.0.0.1');
  const identificador = randomBytes(32).toString('base64url');
  await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), s.usuario]);
  const doc = JSON.parse(readFileSync(new URL('../openapi.json', import.meta.url), 'utf8')) as { paths: Record<string, Record<string, unknown>> };
  const relleno = (ruta: string): string => ruta.replace('{enlace}', creado.id).replace('{idFisico}', 'no-existe').replace(/\{id\}/, ruta.startsWith('/sitios') ? s.sitio : '00000000-0000-4000-8000-000000000000').replace(/\{[^}]+\}/g, '00000000-0000-4000-8000-000000000000');
  const pedir = async (metodo: string, ruta: string, cabeceras: Record<string, string>) => {
    const r = await fetch(base + ruta, { method: metodo, headers: { 'Content-Type': 'application/json', ...cabeceras }, body: metodo === 'GET' ? undefined : '{}' });
    return `${r.status} ${(await r.text()).replace(/\d/g, '#')}`;
  };
  const distintas: string[] = [];
  let pares = 0;
  for (const [ruta, ops] of Object.entries(doc.paths)) {
    if (ruta === '/eventos' || ruta === '/publico') continue;
    for (const metodo of Object.keys(ops).filter((m) => ['get', 'post', 'put', 'patch', 'delete'].includes(m)).map((m) => m.toUpperCase())) {
      const r = relleno(ruta);
      const quien: Record<string, string>[] = [{ cookie: `__Host-sesion=${identificador}` }, {}]; // con sesión (un GET da datos; lo que escribe, 403 sin X-Pedido) y sin ella (401)
      for (const c of quien) {
        const sin = await pedir(metodo, r, c);
        const con = await pedir(metodo, r, { ...c, 'X-Enlace-Publico': creado.token });
        pares++;
        if (sin !== con) distintas.push(`${metodo} ${ruta}: ${sin.slice(0, 60)} ≠ ${con.slice(0, 60)}`);
      }
    }
  }
  await nest.close();
  comprobar(pares > 80 && distintas.length === 0, `aislamiento: ${pares} pares de peticiones a las rutas del OpenAPI, con y sin un X-Enlace-Publico válido, responden igual`, distintas.join(' | '));

  // ── El token no queda en la base ni en el registro del proceso ──────────────────────────────────────────────────────────────
  const tokens = [creado.token, sinDesglose.token, vencido.token, revocado.token, conSurOeste.token];
  const volcado = String((await q(`SELECT coalesce(string_agg(row_to_json(e)::text, ''), '') AS t FROM evento e`)).rows[0].t) + String((await q(`SELECT string_agg(row_to_json(e)::text, '') AS t FROM enlace_publico e`)).rows[0].t);
  comprobar(tokens.every((t) => !volcado.includes(t)) && tokens.every((t) => !registro.join('').includes(t)), 'ningún token en `evento`, en `enlace_publico` ni en el registro del proceso');
}

principal()
  .catch((e: unknown) => { fallos++; console.log(`FALLA la prueba se cortó: ${(e as Error).stack ?? String(e)}`); })
  .finally(async () => {
    await Promise.allSettled([dueno.end(), app.end()]);
    console.log(fallos === 0 ? `\n${n} de ${n} comprobaciones` : `\n${fallos} de ${n} comprobaciones fallaron`);
    process.exit(fallos === 0 ? 0 : 1);
  });
