// Prueba de integración de «Esperando primera trama» y «en servicio desde» (docs/19 §2 y §4, P; docs/10 §8.4 punto 68; migración 26)
// contra una base REAL. La corre plataforma/pruebas/espera-integracion.sh, que levanta una base desechable sin red, con las migraciones
// hasta la 25, siembra datos, aplica la 26 dos veces (lo comprueba el guion) y le pasa por el entorno la carpeta del socket de esa base.
// Los servicios entran con el rol de la aplicación (plataforma_app), como en la pila; la siembra y lo que se planta lo hace el dueño. Cada
// comprobación imprime una línea OK o FALLA; sale 1 si alguna falla. Fuera de src/: no entra a la imagen ni a `pnpm test` (necesita base).
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import type { Type } from '@nestjs/common';
import type { ConfigService } from '@nestjs/config';
import { Pool, type PoolClient } from 'pg';
import { SupervisionService } from '../src/supervision/supervision.service.js';
import { EventosService } from '../src/tiempo-real/eventos.service.js';
import { ConsultaService } from '../src/consulta/consulta.service.js';
import { TableroService } from '../src/consulta/tablero.service.js';
import { ConfiguracionService } from '../src/alta/configuracion.service.js';
import { EsperaService } from '../src/consulta/espera.service.js';
import { SQL_EN_LINEA, SQL_ESPERA_HASTA, SQL_ESTADO_VISUAL } from '../src/consulta/tablero.js';

const socket = process.env.PRUEBA_DB_SOCKET ?? '';
if (socket === '') throw new Error('falta PRUEBA_DB_SOCKET (la carpeta del socket de la base desechable): corre plataforma/pruebas/espera-integracion.sh');
const dueno = new Pool({ host: socket, user: 'plataforma', database: 'plataforma', max: 3 });
const app = new Pool({ host: socket, user: 'plataforma_app', password: process.env.PRUEBA_CLAVE_APP, database: 'plataforma', max: 5 });

let fallos = 0;
let n = 0;
function comprobar(ok: boolean, texto: string, detalle = ''): void {
  n++;
  if (ok) console.log(`OK    ${texto}`);
  else { fallos++; console.log(`FALLA ${texto}${detalle ? ` · ${detalle}` : ''}`); }
}
const q = (sql: string, p: unknown[] = []) => dueno.query(sql, p);
const config = { get: (_k: string, d?: unknown) => d } as unknown as ConfigService;
const eventosVivo = new EventosService();
const avisos: { tipo: string; dispositivo_id?: string; condicion?: string; estado?: string }[] = [];
eventosVivo.flujo().subscribe((e) => avisos.push(e));
const supervisor = new SupervisionService(app, config, eventosVivo);
const consulta = new ConsultaService(app);
const tablero = new TableroService(app);
const configuracion = new ConfiguracionService(app, eventosVivo);
const espera = new EsperaService(app);

// Un sitio con su zona y su plazo; un equipo con su en_servicio_desde (segundos atrás) y, si ya envió, su última trama.
async function sitio(codigo: string, esperaH = 168): Promise<{ sitio: string; zona: string }> {
  const s = await q(`INSERT INTO sitio (nombre, codigo, zona_horaria, espera_primera_trama_h) VALUES ($1, $1, 'America/Santiago', $2) RETURNING id`, [codigo, esperaH]);
  const z = await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [s.rows[0].id, `Zona ${codigo}`]);
  return { sitio: s.rows[0].id as string, zona: z.rows[0].id as string };
}
async function equipo(c: Pick<PoolClient, 'query'>, zona: string, idFisico: string, o: { enServicioHaceS: number; vistoHaceS?: number | null; estado?: string; intervaloS?: number }): Promise<string> {
  const d = await c.query(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, estado, en_servicio_desde, creado_en)
                           VALUES ($1, $2, $2, $3, $4, now() - $5 * INTERVAL '1 second', now() - $5 * INTERVAL '1 second') RETURNING id`,
  [zona, idFisico, o.intervaloS ?? 300, o.estado ?? 'activo', o.enServicioHaceS]);
  const id = d.rows[0].id as string;
  if (o.vistoHaceS !== undefined && o.vistoHaceS !== null) {
    await c.query(`INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) VALUES ($1, now() - $2 * INTERVAL '1 second')`, [id, o.vistoHaceS]);
  }
  return id;
}
const abiertas = async (id: string): Promise<number> => Number((await q(`SELECT count(*) FROM condicion WHERE dispositivo_id = $1 AND tipo = 'sin_comunicacion' AND cerrada_en IS NULL`, [id])).rows[0].count);
const eventos = async (id: string, tipo: string): Promise<Record<string, unknown>[]> =>
  (await q('SELECT detalle FROM evento WHERE dispositivo_id = $1 AND tipo = $2 ORDER BY ocurrido_en', [id, tipo])).rows.map((r) => r.detalle as Record<string, unknown>);

interface CasoEstado { nombre: string; estado: string; visto_hace_s: number | null; en_servicio_hace_s: number; espera_h: number; intervalo_s: number; abiertas: string[]; esperado: string }

async function principal() {
  // ── 1. La migración ya corrió en la base (el guion la aplicó dos veces sobre datos): lo que queda a la vista de la aplicación ───────
  const fila = (await q(`SELECT count(*) FILTER (WHERE en_servicio_desde = creado_en) AS iguales, count(*) AS total FROM dispositivo WHERE id_fisico LIKE 'mig-%'`)).rows[0];
  comprobar(Number(fila.total) === 5 && Number(fila.iguales) === 4,
    'migración 26 sobre datos: las filas que existían quedaron con en_servicio_desde = creado_en, y la que el backend ya había movido no se pisó al repetirla',
    `${fila.iguales} de ${fila.total}`);
  for (const malo of [0, 2161]) {
    const r = await q('UPDATE sitio SET espera_primera_trama_h = $1 WHERE codigo = $2', [malo, 'mig-d127']).then(() => 'aceptado', (e: { constraint?: string }) => e.constraint ?? 'otro error');
    comprobar(r === 'ck_sitio_espera_primera_trama_h', `el CHECK rechaza un plazo de ${malo} h`, r);
  }
  const permisos = await app.query(`UPDATE sitio SET nombre = nombre WHERE codigo = 'mig-d127'`).then(() => 'aceptado', (e: { code?: string }) => e.code ?? '');
  const propio = await app.query(`UPDATE sitio SET espera_primera_trama_h = espera_primera_trama_h WHERE codigo = 'mig-d127'`).then(() => 'aceptado', (e: { code?: string }) => e.code ?? '');
  comprobar(permisos === '42501' && propio === 'aceptado', 'la aplicación cambia sitio.espera_primera_trama_h y no otras columnas de sitio (42501 en `nombre`)', `${permisos} / ${propio}`);
  const nuevo = await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) SELECT id, 'mig-nuevo', 'Nuevo', 300 FROM zona LIMIT 1 RETURNING en_servicio_desde = now() AS hoy`);
  comprobar(nuevo.rows[0].hoy === true, 'un alta nueva nace con en_servicio_desde = now() (DEFAULT de la migración 26)');

  // ── 2. La regla del estado visual en SQL con LA tabla de casos (la misma del panel y de tablero.ts), en una transacción que se deshace:
  //       now() queda fijo en toda la transacción, así los bordes son exactos ─────────────────────────────────────────────────────────
  const tabla = JSON.parse(readFileSync(new URL('../panel/src/lib/estado-visual-casos.json', import.meta.url), 'utf8')) as { casos: CasoEstado[] };
  const c = await dueno.connect();
  try {
    await c.query('BEGIN');
    const zonas = new Map<number, string>();
    for (const h of new Set(tabla.casos.map((x) => x.espera_h))) {
      const s = await c.query(`INSERT INTO sitio (nombre, codigo, zona_horaria, espera_primera_trama_h) VALUES ($1, $1, 'UTC', $2) RETURNING id`, [`casos-${h}`, h]);
      zonas.set(h, (await c.query('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [s.rows[0].id, 'Casos'])).rows[0].id as string);
    }
    const ids: string[] = [];
    for (const [i, x] of tabla.casos.entries()) {
      const id = await equipo(c, zonas.get(x.espera_h)!, `caso-${String(i).padStart(2, '0')}`, { enServicioHaceS: x.en_servicio_hace_s, vistoHaceS: x.visto_hace_s, estado: x.estado, intervaloS: x.intervalo_s });
      for (const t of x.abiertas) await c.query('INSERT INTO condicion (dispositivo_id, tipo) VALUES ($1, $2)', [id, t]);
      ids.push(id);
    }
    const r = await c.query<{ id: string; estado_visual: string }>(`SELECT d.id, ${SQL_ESTADO_VISUAL} AS estado_visual
       FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id WHERE d.id = ANY($1::uuid[])`, [ids]);
    const por = new Map(r.rows.map((x) => [x.id, x.estado_visual]));
    const distintos = tabla.casos.map((x, i) => [x, por.get(ids[i])] as const).filter(([x, v]) => v !== x.esperado).map(([x, v]) => `${x.nombre}: ${v} (se esperaba ${x.esperado})`);
    comprobar(tabla.casos.length >= 20 && distintos.length === 0, `SQL_ESTADO_VISUAL contra la base: los ${tabla.casos.length} casos de la tabla de docs/19 §2, bordes incluidos`, distintos.join(' | '));
    // en_linea y espera_hasta del inventario, con la misma base: nulo sin tramas; espera_hasta = en_servicio_desde + plazo.
    const l = await c.query<{ en_linea: boolean | null; espera_ok: boolean | null; visto: Date | null }>(`SELECT ${SQL_EN_LINEA} AS en_linea, e.visto_por_ultima_vez AS visto,
             ${SQL_ESPERA_HASTA} = d.en_servicio_desde + (SELECT s.espera_primera_trama_h FROM zona z JOIN sitio s ON s.id = z.sitio_id WHERE z.id = d.zona_id) * INTERVAL '1 hour' AS espera_ok
       FROM dispositivo d LEFT JOIN estado_dispositivo e ON e.dispositivo_id = d.id WHERE d.id = ANY($1::uuid[])`, [ids]);
    comprobar(l.rows.every((x) => (x.visto === null) === (x.en_linea === null)) && l.rows.every((x) => x.espera_ok === true),
      'SQL_EN_LINEA es nulo exactamente para quien nunca envió (GREATEST ignora nulos: la guarda funciona) y SQL_ESPERA_HASTA suma el plazo de SU sitio');
  } finally {
    await c.query('ROLLBACK');
    c.release();
  }

  // ── 3. El supervisor, con el rol de la aplicación ───────────────────────────────────────────────────────────────────────────
  const s = await sitio('espera-a');
  const otro = await sitio('espera-b', 24);
  const H = 3600;
  const vencido = await equipo(dueno, s.zona, 'esp-vencido', { enServicioHaceS: 169 * H });
  const enPlazo = await equipo(dueno, s.zona, 'esp-en-plazo', { enServicioHaceS: 167 * H });
  const enOtroSitio = await equipo(dueno, otro.zona, 'esp-otro-sitio', { enServicioHaceS: 25 * H }); // 25 h con un plazo de 24: vencido
  const volvio = await equipo(dueno, s.zona, 'esp-volvio', { enServicioHaceS: 30 * 24 * H, vistoHaceS: 3 * 24 * H, estado: 'mantenimiento' });
  const conAbierta = await equipo(dueno, s.zona, 'esp-con-abierta', { enServicioHaceS: 30 * 24 * H, vistoHaceS: 3 * 24 * H, estado: 'mantenimiento' });
  // Puesto en mantenimiento por SQL directo, sin pasar por la API: solo la red de seguridad del supervisor puede cerrarla (RF-22).
  await q(`INSERT INTO condicion (dispositivo_id, tipo, abierta_en) VALUES ($1, 'sin_comunicacion', now() - INTERVAL '3 days')`, [conAbierta]);
  // Activo, con la condición abierta de hace días y en servicio hace un minuto (volvió de mantenimiento): la cierra el barrido, por el motivo «de vuelta en servicio».
  const vueltaConAbierta = await equipo(dueno, s.zona, 'esp-vuelta-abierta', { enServicioHaceS: 60, vistoHaceS: 3 * 24 * H });
  await q(`INSERT INTO condicion (dispositivo_id, tipo, abierta_en) VALUES ($1, 'sin_comunicacion', now() - INTERVAL '3 days')`, [vueltaConAbierta]);
  const caido = await equipo(dueno, s.zona, 'esp-caido', { enServicioHaceS: 30 * 24 * H, vistoHaceS: 601 });
  // Dos barridos a la vez y uno más: una sola condición abierta por dispositivo (el índice único parcial) y un solo evento.
  await Promise.all([supervisor.barrer(), supervisor.barrer()]);
  await supervisor.barrer();
  comprobar(await abiertas(vencido) === 1 && (await eventos(vencido, 'condicion_abierta')).length === 1,
    'nunca envió y venció su plazo (169 h de 168): el supervisor abre sin_comunicacion, una sola vez aunque corran dos barridos a la vez y uno más');
  const ev = (await eventos(vencido, 'condicion_abierta'))[0] ?? {};
  comprobar(ev.nunca_reporto === true && ev.espera_primera_trama_h === 168 && typeof ev.en_servicio_desde === 'string', 'su evento dice que nunca reportó, con desde cuándo y el plazo', JSON.stringify(ev));
  comprobar(await abiertas(enPlazo) === 0, 'nunca envió y está dentro del plazo (167 h de 168): no abre');
  comprobar(await abiertas(enOtroSitio) === 1, 'el plazo es el de SU sitio: 25 h con un plazo de 24 abre');
  comprobar(await abiertas(caido) === 1 && (await eventos(caido, 'condicion_abierta'))[0]?.silencio_s !== undefined, 'ya envió y calla más de 2 × intervalo: abre como siempre, con su silencio');
  comprobar(await abiertas(volvio) === 0, 'en mantenimiento no abre (RF-22)');

  const cierreMant = await eventos(conAbierta, 'condicion_cerrada');
  comprobar(await abiertas(conAbierta) === 0 && cierreMant.length === 1 && cierreMant[0]?.por === 'mantenimiento' && cierreMant[0]?.tipo === 'sin_comunicacion',
    'red de seguridad: un equipo puesto en mantenimiento por SQL directo con la condición abierta la ve cerrada por el barrido, con su evento (por: mantenimiento)', JSON.stringify(cierreMant));
  const cierreVuelta = await eventos(vueltaConAbierta, 'condicion_cerrada');
  comprobar(await abiertas(vueltaConAbierta) === 0 && cierreVuelta.length === 1 && cierreVuelta[0]?.por === 'barrido' && cierreVuelta[0]?.motivo === 'de vuelta en servicio (otra vez un intervalo completo)',
    'la condición abierta de quien volvió a servicio la cierra el barrido, y el evento dice por qué (motivo)', JSON.stringify(cierreVuelta));

  // Volver de mantenimiento con la última trama de hace 3 días (PATCH /dispositivos/{id} por el servicio, con su bloqueo optimista).
  {
    const f = await consulta.dispositivo(volvio) as { actualizado_en: string };
    await configuracion.cambiarDispositivo(volvio, { actualizado_en: f.actualizado_en, estado: 'activo' }, null);
  }
  const movido = (await q(`SELECT en_servicio_desde > now() - INTERVAL '1 minute' AS ok FROM dispositivo WHERE id = $1`, [volvio])).rows[0].ok;
  comprobar(movido === true, 'volver de mantenimiento a activo pone en_servicio_desde en ahora (en el mismo UPDATE)');
  await supervisor.barrer();
  comprobar(await abiertas(volvio) === 0 && (await eventos(volvio, 'condicion_abierta')).length === 0,
    'vuelto de mantenimiento con la última trama vieja: el primer barrido NO abre una alarma falsa (ni abre y cierra: ningún evento de apertura)');
  const enMantenimiento = await equipo(dueno, s.zona, 'esp-a-mantenimiento', { enServicioHaceS: 30 * 24 * H, vistoHaceS: 60 });
  const usuarioMant = (await q(`INSERT INTO usuario (nombre, email, hash_password) VALUES ('Persona mantenimiento', 'mant@prueba-espera.invalid', 'x') RETURNING id`)).rows[0].id as string;
  await q(`INSERT INTO condicion (dispositivo_id, tipo) VALUES ($1, 'sin_comunicacion'), ($1, 'tope_superado')`, [enMantenimiento]);
  const antesMant = (await q('SELECT en_servicio_desde FROM dispositivo WHERE id = $1', [enMantenimiento])).rows[0].en_servicio_desde as Date;
  const fm = await consulta.dispositivo(enMantenimiento) as { actualizado_en: string };
  await configuracion.cambiarDispositivo(enMantenimiento, { actualizado_en: fm.actualizado_en, estado: 'mantenimiento' }, usuarioMant);
  const despuesMant = (await q('SELECT en_servicio_desde FROM dispositivo WHERE id = $1', [enMantenimiento])).rows[0].en_servicio_desde as Date;
  comprobar(antesMant.getTime() === despuesMant.getTime(), 'pasar a mantenimiento no toca en_servicio_desde');
  const cierresMant = (await q(`SELECT usuario_id, detalle FROM evento WHERE dispositivo_id = $1 AND tipo = 'condicion_cerrada'`, [enMantenimiento])).rows;
  comprobar(await abiertas(enMantenimiento) === 0 && Number((await q('SELECT count(*) FROM condicion WHERE dispositivo_id = $1 AND cerrada_en IS NULL', [enMantenimiento])).rows[0].count) === 0
    && cierresMant.length === 2 && cierresMant.every((x) => x.usuario_id === usuarioMant && x.detalle.por === 'mantenimiento') && cierresMant.map((x) => x.detalle.tipo).sort().join() === 'sin_comunicacion,tope_superado',
    'pasar a mantenimiento por la API cierra TODAS las condiciones abiertas del equipo (aquí dos, de dos tipos), un evento por cada una con la persona y por: mantenimiento', JSON.stringify(cierresMant));
  await supervisor.barrer();
  comprobar(await abiertas(enMantenimiento) === 0 && (await eventos(enMantenimiento, 'condicion_abierta')).length === 0, 'y el barrido siguiente no la reabre mientras siga en mantenimiento');
  const avisosMant = avisos.filter((a) => a.dispositivo_id === enMantenimiento && a.estado === 'cerrada').map((a) => a.condicion).sort().join();
  comprobar(avisosMant === 'sin_comunicacion,tope_superado', 'cada cierre por el PATCH se avisó al canal en vivo (después del COMMIT)', avisosMant);
  // Un equipo en mantenimiento sigue entregando tramas: el tope por emisor y el reloj desviado (que abre el pipeline) NO abren nada (RF-22),
  // y dos barridos seguidos no producen ningún par abrir/cerrar (la red de seguridad no tiene nada que cerrar).
  await supervisor.abrirTope(enMantenimiento, 'esp-a-mantenimiento', { tope: 600 });
  await supervisor.abrirRelojDesviado(enMantenimiento, 'esp-a-mantenimiento', { pasarela: 'p', desvio_s: 999 });
  await supervisor.barrer();
  await supervisor.barrer();
  const nCond = Number((await q('SELECT count(*) FROM condicion WHERE dispositivo_id = $1', [enMantenimiento])).rows[0].count);
  const nEv = (await q(`SELECT tipo, count(*)::int AS n FROM evento WHERE dispositivo_id = $1 AND tipo IN ('condicion_abierta','condicion_cerrada') GROUP BY tipo ORDER BY tipo`, [enMantenimiento])).rows;
  comprobar(nCond === 2 && JSON.stringify(nEv) === '[{"tipo":"condicion_cerrada","n":2}]',
    'en mantenimiento, una trama sobre el tope o con el reloj desviado no abre condición ni evento, y dos barridos no producen ningún par abrir/cerrar', JSON.stringify({ nCond, nEv }));
  const activoTope = await equipo(dueno, s.zona, 'esp-activo-tope', { enServicioHaceS: 30 * 24 * H, vistoHaceS: 60 });
  await supervisor.abrirTope(activoTope, 'esp-activo-tope', { tope: 600 });
  await supervisor.abrirRelojDesviado(activoTope, 'esp-activo-tope', { pasarela: 'p', desvio_s: 999 });
  await supervisor.abrirTope(activoTope, 'esp-activo-tope', { tope: 600 });
  const abTope = Number((await q(`SELECT count(*) FROM condicion WHERE dispositivo_id = $1 AND cerrada_en IS NULL`, [activoTope])).rows[0].count);
  const evTope = Number((await q(`SELECT count(*) FROM evento WHERE dispositivo_id = $1 AND tipo = 'condicion_abierta'`, [activoTope])).rows[0].count);
  comprobar(abTope === 2 && evTope === 2, 'un equipo activo sí abre el tope y el reloj, una vez cada uno (la condición y su evento, aunque se repita el aviso)', `${abTope} / ${evTope}`);

  // La primera trama: el filtro 6 crea la fila de estado_dispositivo y en seguida marcarVivo cierra la abierta (recepcion.service.ts).
  await app.query(`INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez) VALUES ($1, now())
                   ON CONFLICT (dispositivo_id) DO UPDATE SET visto_por_ultima_vez = EXCLUDED.visto_por_ultima_vez`, [vencido]);
  await supervisor.marcarVivo(vencido, 'esp-vencido');
  comprobar(await abiertas(vencido) === 0 && (await eventos(vencido, 'condicion_cerrada')).length === 1,
    'la primera trama cierra la condición de quien nunca reportó por el camino de siempre (la fila de estado nace con esa trama)');
  await supervisor.barrer();
  comprobar(await abiertas(vencido) === 0, 'y el barrido siguiente no la vuelve a abrir');

  // Alargar el plazo del sitio: quien había vencido vuelve a esperar y el barrido cierra su condición.
  await espera.fijar(otro.sitio, 48, null, 24);
  await supervisor.barrer();
  comprobar(await abiertas(enOtroSitio) === 0, 'alargar el plazo del sitio (24 → 48 h) devuelve a la espera a quien había vencido: el barrido cierra su condición');

  // ── 4. Lo que lee el panel: estado, entrega, en_servicio_desde y espera_hasta; el resumen del sitio ─────────────────────────────
  const inv = (await consulta.inventario([s.sitio], {})).filas;
  const de = (id: string) => inv.find((x) => x.id === id)!;
  comprobar(de(enPlazo).estado_visual === 'esperando' && de(enPlazo).entrega === null && de(enPlazo).en_linea === null && de(enPlazo).espera_hasta instanceof Date,
    'inventario: quien espera sale «esperando», con entrega nula (no 0 %), en_linea nulo y su espera_hasta', JSON.stringify(de(enPlazo)));
  comprobar(de(volvio).estado_visual === 'normal' && de(volvio).en_linea === true && de(volvio).espera_hasta === null && de(volvio).entrega === null,
    'inventario: vuelto de mantenimiento hace instantes, «normal» y en línea por en_servicio_desde, sin espera_hasta (ya envió) y sin entrega calculable aún (ninguna trama esperada completa)', JSON.stringify(de(volvio)));
  comprobar(de(caido).estado_visual === 'sin_senal' && de(caido).entrega === 0, 'inventario: el caído, «sin señal» con 0 % (se esperaban tramas)', JSON.stringify(de(caido)));
  const soloEsperando = (await consulta.inventario([s.sitio], { estado: 'esperando' })).filas.map((x) => x.id);
  comprobar(soloEsperando.length === 1 && soloEsperando[0] === enPlazo, 'el filtro estado=esperando trae solo a quien espera');
  const atencion = (await consulta.inventario([s.sitio], { orden: 'atencion' })).filas.map((x) => x.estado_visual as string);
  const rango = ['sin_senal', 'alerta', 'normal', 'esperando', 'inactivo'];
  comprobar(atencion.every((e, i) => i === 0 || rango.indexOf(e) >= rango.indexOf(atencion[i - 1])), 'orden=atencion: esperando después de normal y antes de inactivo', atencion.join(','));
  const r = await tablero.resumen(s.sitio, new Date(Date.now() - 86_400_000), new Date(), '1 hour') as unknown as {
    dispositivos: Record<string, number>; salud: { supervisados: number }; entrega: { id: string; porcentaje: number | null }[];
  };
  const d = r.dispositivos;
  comprobar(d.esperando === 1 && d.normal + d.alerta + d.sin_senal + d.esperando + d.inactivo === d.total && r.salud.supervisados === d.total - d.inactivo - d.esperando,
    'resumen: cuenta «esperando» aparte, los cinco suman el total y quien espera no es supervisado', JSON.stringify({ d, salud: r.salud }));
  comprobar(r.entrega.find((x) => x.id === enPlazo)?.porcentaje === null, 'resumen: la entrega de quien espera es nula');
  const ficha = await consulta.dispositivo(enPlazo) as Record<string, unknown>;
  comprobar(ficha.en_servicio_desde instanceof Date && ficha.espera_hasta instanceof Date && (ficha.espera_hasta).getTime() - (ficha.en_servicio_desde).getTime() === 168 * H * 1000,
    'ficha: en_servicio_desde y espera_hasta (168 h después)');

  // ── 5. La API con la aplicación compilada: quién lee y quién cambia el plazo, y el aislamiento por sitio ───────────────────────
  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: socket, DB_PUERTO: '5432', DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-espera', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
    SUPERVISION_INTERVALO_S: '3600',
  });
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  const base = (await nest.getUrl()).replace('[::1]', '127.0.0.1');
  const persona = async (rol: string, sitioId: string): Promise<{ cookie: string; id: string }> => {
    const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en) VALUES ($1, $2, 'x', 1, now()) RETURNING id`,
      [`Persona ${rol}`, `${rol}-${randomBytes(4).toString('hex')}@prueba-espera.invalid`]);
    await q('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [u.rows[0].id, sitioId, rol]);
    const identificador = randomBytes(32).toString('base64url');
    await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), u.rows[0].id]);
    return { cookie: `__Host-sesion=${identificador}`, id: u.rows[0].id as string };
  };
  const pedir = async (quien: { cookie: string }, metodo: string, sitioId: string, cuerpo?: object) => {
    const r = await fetch(`${base}/sitios/${sitioId}/espera-primera-trama`, {
      method: metodo, headers: { cookie: quien.cookie, 'Content-Type': 'application/json', ...(metodo === 'GET' ? {} : { 'X-Pedido': 'panel' }) },
      body: cuerpo === undefined ? undefined : JSON.stringify(cuerpo),
    });
    return { estado: r.status, cuerpo: (await r.json().catch(() => ({}))) as Record<string, unknown> };
  };
  try {
    const consultaS = await persona('consulta', s.sitio);
    const operador = await persona('operador', s.sitio);
    const admin = await persona('administrador', s.sitio);
    const adminOtro = await persona('administrador', otro.sitio);
    const leido = await pedir(consultaS, 'GET', s.sitio);
    comprobar(leido.estado === 200 && leido.cuerpo.espera_primera_trama_h === 168 && leido.cuerpo.por_omision === 168 && leido.cuerpo.maximo === 2160,
      'GET con el perfil de consulta: 200 con el plazo del sitio (168), el de omisión y los límites', JSON.stringify(leido));
    comprobar((await pedir(operador, 'PUT', s.sitio, { espera_primera_trama_h: 24 })).estado === 403, 'PUT con el perfil de operación técnica: 403 (la acción «ajustes» es de quien administra el sitio)');
    comprobar((await pedir(admin, 'PUT', s.sitio, { espera_primera_trama_h: 2161 })).estado === 400, 'PUT del administrador fuera de rango (2 161): 400');
    comprobar((await pedir(adminOtro, 'PUT', s.sitio, { espera_primera_trama_h: 24 })).estado === 404 && (await pedir(adminOtro, 'GET', s.sitio)).estado === 404,
      'el administrador de OTRO sitio: 404 al leer y al cambiar (no se revela que el sitio existe)');
    const choque = await pedir(admin, 'PUT', s.sitio, { espera_primera_trama_h: 24, anterior: 72 });
    comprobar(choque.estado === 409 && choque.cuerpo.codigo === 'espera_cambio' && choque.cuerpo.espera_primera_trama_h === 168, 'PUT con un `anterior` que ya no rige: 409 espera_cambio con el vigente', JSON.stringify(choque));
    const bien = await pedir(admin, 'PUT', s.sitio, { espera_primera_trama_h: 24, anterior: 168 });
    const fijo = (await q(`SELECT usuario_id, detalle FROM evento WHERE tipo = 'espera_primera_trama' AND detalle->>'sitio_id' = $1`, [s.sitio])).rows;
    comprobar(bien.estado === 200 && bien.cuerpo.espera_primera_trama_h === 24 && fijo.length === 1 && fijo[0].usuario_id === admin.id && fijo[0].detalle.anterior === 168,
      'PUT del administrador del sitio: 200, el plazo nuevo y el evento espera_primera_trama con quién lo fijó y el anterior', JSON.stringify({ bien, fijo }));
    const sinPedido = await fetch(`${base}/sitios/${s.sitio}/espera-primera-trama`, { method: 'PUT', headers: { cookie: admin.cookie, 'Content-Type': 'application/json' }, body: '{"espera_primera_trama_h":12}' });
    comprobar(sinPedido.status === 403, 'PUT sin la cabecera X-Pedido: 403 de la guardia (CSRF)');
    const act = await fetch(`${base}/sitios/${s.sitio}/actividad`, { headers: { cookie: admin.cookie } });
    const filas = (await act.json()) as { tipo: string; texto: string }[];
    comprobar(filas.some((x) => x.tipo === 'espera_primera_trama' && x.texto === 'fijó en 24 h el plazo de la primera trama de los equipos del sitio'),
      'la actividad del sitio (P14) muestra el cambio en palabras');
    const enOtro = (await fetch(`${base}/sitios/${otro.sitio}/actividad`, { headers: { cookie: adminOtro.cookie } }).then((x) => x.json())) as { tipo: string; texto: string }[];
    comprobar(!enOtro.some((x) => x.tipo === 'espera_primera_trama' && x.texto.includes('24 h')), 'y no aparece en la actividad del otro sitio');
  } finally {
    await nest.close();
  }
}

principal()
  .catch((e: unknown) => { fallos++; console.log(`FALLA la prueba se cortó: ${(e as Error).stack ?? String(e)}`); })
  .finally(async () => {
    await Promise.allSettled([dueno.end(), app.end()]);
    console.log(fallos === 0 ? `\n${n} de ${n} comprobaciones` : `\n${fallos} de ${n} comprobaciones fallaron`);
    process.exit(fallos === 0 ? 0 : 1);
  });
