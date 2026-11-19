// Prueba de integración de la exportación por sitio (HU-08; docs/19 §4, bloque R, puntos 7 y 8; docs/16 §89) contra una base REAL. La corre
// plataforma/pruebas/exportar-integracion.sh, que levanta una base desechable sin red con todas las migraciones y le pasa por el entorno la
// carpeta del socket. La siembra la hace el dueño; la aplicación compilada corre en este proceso, en un puerto efímero de 127.0.0.1, con el
// rol de la aplicación (plataforma_app), como en la pila. Cada comprobación imprime una línea OK o FALLA; sale 1 si alguna falla. Fuera de
// src/: no entra a la imagen ni a `pnpm test` (necesita base).
import 'reflect-metadata';
import '../src/zona-utc.js';
import { createHash, randomBytes } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import { request, type IncomingMessage } from 'node:http';
import { join } from 'node:path';
import type { Type } from '@nestjs/common';
import { Pool, type PoolClient } from 'pg';
import { ConsultaService } from '../src/consulta/consulta.service.js';
import { leerCsv, leerLibro, leerZip, desproteger, type CeldaLeida, type EntradaZip } from './lectores.js';

const socket = process.env.PRUEBA_DB_SOCKET ?? '';
if (socket === '') throw new Error('falta PRUEBA_DB_SOCKET (la carpeta del socket de la base desechable): corre plataforma/pruebas/exportar-integracion.sh');
const ARCHIVOS = process.env.PRUEBA_ARCHIVOS ?? '';
const MEDIR = process.env.EXPORTAR_MEDIR !== '0';
const dueno = new Pool({ host: socket, user: 'plataforma', database: 'plataforma', max: 3 });
const app = new Pool({ host: socket, user: 'plataforma_app', password: process.env.PRUEBA_CLAVE_APP, database: 'plataforma', max: 3 });

let fallos = 0;
let n = 0;
function comprobar(ok: boolean, texto: string, detalle = ''): void {
  n++;
  if (ok) console.log(`OK    ${texto}`);
  else { fallos++; console.log(`FALLA ${texto}${detalle ? ` · ${detalle.slice(0, 600)}` : ''}`); }
}
const q = (sql: string, p: unknown[] = []) => dueno.query(sql, p);
const ISO_US = (c: string): string => `to_char(${c} AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')`;

// Los días de la prueba, relativos a hoy: las tramas vencen a los 30 días (RetencionService) y `hasta` no puede ser futuro.
const HOY = new Date(); HOY.setUTCHours(0, 0, 0, 0);
const dia = (atras: number): string => new Date(HOY.getTime() - atras * 86_400_000).toISOString().slice(0, 10);
const DESDE = `${dia(8)}T00:00:00Z`;
const HASTA = `${dia(2)}T00:00:00Z`;

// ── Siembra: el sitio A con los casos límite del punto 7 y el sitio B con marcas propias ─────────────────────────────────────────────
interface Sembrado { sitioA: string; sitioB: string; marcasB: string[]; usuarioA: string }
async function sembrar(): Promise<Sembrado> {
  const sitio = async (codigo: string, nombre: string): Promise<{ id: string; z1: string; z2: string }> => {
    const s = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ($1, $2, 'America/Santiago') RETURNING id`, [nombre, codigo])).rows[0].id as string;
    const z1 = (await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [s, 'Zona 1'])).rows[0].id as string;
    const z2 = (await q('INSERT INTO zona (sitio_id, nombre) VALUES ($1, $2) RETURNING id', [s, 'Zona 2'])).rows[0].id as string;
    return { id: s, z1, z2 };
  };
  const equipo = async (zona: string, idFisico: string, estado = 'activo'): Promise<string> =>
    (await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s, estado) VALUES ($1, $2, $2, 300, $3) RETURNING id`, [zona, idFisico, estado])).rows[0].id as string;
  const canal = async (d: string, magnitud: string): Promise<string> =>
    (await q('INSERT INTO canal (dispositivo_id, magnitud_codigo) VALUES ($1, $2) RETURNING id', [d, magnitud])).rows[0].id as string;
  const medicion = (c: string, t: string, valor: number, unidad: string) =>
    q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo) VALUES ($1, $2, $3, $4, $2, 'recepcion')`, [c, t, valor, unidad]);
  const trama = (d: string, t: string, topico: string, adaptador: string, carga: Buffer) =>
    q('INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador) VALUES ($1, $2, $3, $4, $5)', [d, t, topico, carga, adaptador]);
  const evento = (d: string | null, t: string, tipo: string, detalle: unknown, usuario: string | null = null) =>
    q('INSERT INTO evento (dispositivo_id, ocurrido_en, tipo, detalle, usuario_id) VALUES ($1, $2, $3, $4, $5)', [d, t, tipo, detalle === null ? null : JSON.stringify(detalle), usuario]);

  const A = await sitio('exp-a', 'Sitio «de prueba», con coma');
  const a1 = await equipo(A.z1, 'exp-a-1');
  const a2 = await equipo(A.z2, 'exp-a-2', 'mantenimiento');
  const a3 = await equipo(A.z1, 'exp-a-3', 'baja');
  const sinDatos = await equipo(A.z2, 'exp-a-4');
  const temp = await canal(a1, 'temperatura');
  const hum = await canal(a1, 'humedad');
  const pres = await canal(a2, 'presion');
  const bat = await canal(a3, 'bateria');
  await canal(sinDatos, 'temperatura');
  const d5 = dia(5);
  // Instantes con microsegundos; valores negativos, 1e-7 y el mayor double; una unidad con coma y comillas; textos que empiezan con =,
  // con '= y con un apóstrofo solo; saltos, tabulador, controles, un _xHHHH_ literal y formas de ancho completo.
  const casos: [string, number, string][] = [
    [`${DESDE}`, -12.5, 'Cel'], // justo en `desde`: entra
    [`${d5}T10:00:00.123456Z`, 1e-7, '=SUMA(A1)'],
    [`${d5}T10:00:00.000001Z`, 1.7976931348623157e308, "'=x"],
    [`${d5}T10:00:00.999999Z`, 0, "'"],
    [`${d5}T10:00:01.5Z`, 21.5, 'a,"b"'],
    [`${d5}T10:00:02.000002Z`, -3, 'dos\nlíneas\r\ny\ttab'],
    [`${d5}T10:00:03Z`, 4, '_x0041_ y _xABCD\u0001 y \u0002 & <b>'],
    [`${d5}T10:00:04Z`, -0.000123, ' espacio al borde '],
    [`${d5}T10:00:05Z`, 5, '＝ancho completo'],
    [`${d5}T10:00:06Z`, 6, "''+dos apóstrofos"],
    [`${d5}T10:00:07Z`, 7, ''],
  ];
  for (const [t, v, u] of casos) await medicion(temp, t, v, u);
  await medicion(temp, new Date(new Date(DESDE).getTime() - 1).toISOString().replace('Z', '999Z'), 99, 'antes'); // 1 µs antes: no entra
  await medicion(temp, HASTA, 99, 'en hasta'); // `hasta` es excluido
  for (let i = 0; i < 30; i++) await medicion(hum, `${dia(4)}T0${i % 10}:${String(10 + i).padStart(2, '0')}:00.${String(i).padStart(6, '0')}Z`, 40 + i / 10, '%RH');
  await medicion(pres, `${dia(3)}T12:00:00.5Z`, 1013.25, 'hPa');
  await medicion(bat, `${dia(6)}T08:00:00Z`, 87, '%EL');

  const t1 = `${d5}T11:00:00.000001Z`;
  await trama(a1, t1, 'sitio/exp-a/exp-a-1', 'senml', Buffer.from([0xf8, 0xff, 0x00, 0x01, 0x80, 0xc3, 0x28])); // no es UTF-8; su base64 empieza con «+»
  await trama(a1, t1, '=tópico ñ', '@plano', Buffer.from('[{"n":"temperatura","v":21.5,"u":"Cel"}]')); // mismo instante: desempata el id
  await trama(a1, `${d5}T11:00:01Z`, 'sitio/exp-a/exp-a-1', 'senml', randomBytes(65_536)); // 64 KiB: tres columnas en el XLSX
  await trama(a1, `${d5}T11:00:02Z`, "'+t", 'senml', Buffer.alloc(0));
  await trama(a2, `${dia(3)}T09:00:00Z`, 'sitio/exp-a/\u0001ctl_x0041_', 'plano', Buffer.from('_x0041_ & <x>'));
  await trama(a1, `${dia(9)}T00:00:00Z`, 'fuera', 'senml', Buffer.from('fuera del rango'));

  const persona = (await q(`INSERT INTO usuario (nombre, email, hash_password) VALUES ('Persona que configuró', 'quien@exportar.invalid', 'x') RETURNING id`)).rows[0].id as string;
  const te = `${d5}T12:00:00.000123Z`;
  await evento(a1, `${d5}T09:00:00Z`, 'alta', { via: 'mqtt', canales: ['temperatura', 'humedad'], origen: 'api' }, persona);
  await evento(a1, te, 'condicion_abierta', { tipo: 'umbral', valor: 50.5, nota: 'ñandú 🛠️ «comillas» "dobles"' });
  await evento(a1, te, '=tipo raro', null); // mismo instante: desempata el id
  await evento(a2, `${dia(3)}T10:00:00Z`, 'dispositivo_configurado', { antes: { estado: 'activo' }, despues: { estado: 'mantenimiento' }, origen: 'api' }, persona);
  await evento(a3, `${dia(6)}T09:00:00Z`, 'baja', { via: 'mqtt', estado_anterior: 'activo', credenciales_revocadas: 1, condiciones_cerradas: 0, origen: 'api' }, persona);
  await evento(null, `${d5}T13:00:00Z`, 'espera_primera_trama', { sitio_id: A.id, espera_primera_trama_h: 24, anterior: 168 }, persona); // del sitio, no de un equipo

  const B = await sitio('exp-b', 'Sitio B');
  const b1 = await equipo(B.z1, 'marca-b-1');
  const cb = await canal(b1, 'temperatura');
  await medicion(cb, `${d5}T10:00:00Z`, 31.4159, 'MARCA-B-UNIDAD');
  const cargaB = Buffer.from('MARCA-B-CARGA-0123456789');
  await trama(b1, `${d5}T10:00:00Z`, 'sitio/exp-b/MARCA-B-TOPICO', 'senml', cargaB);
  await evento(b1, `${d5}T10:00:00Z`, 'marca_b_evento', { marca: 'MARCA-B-DETALLE' });
  return {
    sitioA: A.id, sitioB: B.id, usuarioA: persona,
    marcasB: ['marca-b-1', 'MARCA-B', cb, createHash('sha256').update(cargaB).digest('hex'), cargaB.toString('base64'), 'marca_b_evento', b1],
  };
}

// ── Lo esperado, leído de la base con SQL propio (no con las consultas de la exportación) ─────────────────────────────────────────
interface Esperado {
  mediciones: { tiempo_utc: string; id_fisico: string; magnitud: string; valor: number; unidad: string; canal_id: string }[];
  tramas: { recibido_en_utc: string; id_fisico: string; topico: string; adaptador: string; payload: Buffer }[];
  eventos: { ocurrido_en_utc: string; id_fisico: string; tipo: string; detalle: unknown }[];
}
async function esperado(sitio: string, desde: string, hasta: string): Promise<Esperado> {
  const p = [sitio, desde, hasta];
  return {
    mediciones: (await q(`SELECT ${ISO_US('m.tiempo')} AS tiempo_utc, d.id_fisico, c.magnitud_codigo AS magnitud, m.valor, m.unidad, m.canal_id::text
                            FROM medicion m JOIN canal c ON c.id = m.canal_id JOIN dispositivo d ON d.id = c.dispositivo_id JOIN zona z ON z.id = d.zona_id
                           WHERE z.sitio_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3 ORDER BY d.id_fisico, c.magnitud_codigo, m.tiempo`, p)).rows,
    tramas: (await q(`SELECT ${ISO_US('t.recibido_en')} AS recibido_en_utc, d.id_fisico, t.topico, t.adaptador, t.payload
                        FROM trama t JOIN dispositivo d ON d.id = t.dispositivo_id JOIN zona z ON z.id = d.zona_id
                       WHERE z.sitio_id = $1 AND t.recibido_en >= $2 AND t.recibido_en < $3 ORDER BY d.id_fisico, t.recibido_en, t.id`, p)).rows,
    eventos: (await q(`SELECT ${ISO_US('e.ocurrido_en')} AS ocurrido_en_utc, d.id_fisico, e.tipo, e.detalle
                         FROM evento e JOIN dispositivo d ON d.id = e.dispositivo_id JOIN zona z ON z.id = d.zona_id
                        WHERE z.sitio_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3 ORDER BY d.id_fisico, e.ocurrido_en, e.id`, p)).rows,
  };
}
const sha = (b: Buffer): string => createHash('sha256').update(b).digest('hex');
const igualNum = (a: number, b: number): boolean => Object.is(a, b);
const igualJson = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);
const msDe = (iso: string): number => {
  const m = /^(.*)\.(\d{6})Z$/.exec(iso);
  return m ? new Date(`${m[1]}Z`).getTime() + Math.floor(Number(m[2]) / 1000) : Number.NaN;
};

// Compara fila a fila lo leído del archivo con la base; devuelve las diferencias (vacío = 0 diferencias).
type FilaLeida = Record<string, unknown>;
function diferencias(e: Esperado, leido: { mediciones: FilaLeida[]; tramas: FilaLeida[]; eventos: FilaLeida[] }): string[] {
  const d: string[] = [];
  const largo = (c: string, a: unknown[], b: unknown[]) => { if (a.length !== b.length) d.push(`${c}: ${b.length} filas en el archivo y ${a.length} en la base`); };
  largo('mediciones', e.mediciones, leido.mediciones);
  largo('tramas', e.tramas, leido.tramas);
  largo('eventos', e.eventos, leido.eventos);
  e.mediciones.forEach((x, i) => {
    const y = leido.mediciones[i] ?? {};
    for (const k of ['tiempo_utc', 'id_fisico', 'magnitud', 'unidad', 'canal_id'] as const) if (y[k] !== x[k]) d.push(`mediciones[${i}].${k}: ${JSON.stringify(y[k])} ≠ ${JSON.stringify(x[k])}`);
    if (!igualNum(y.valor as number, x.valor)) d.push(`mediciones[${i}].valor: ${String(y.valor)} ≠ ${x.valor}`);
    if ('fecha_ms' in y && y.fecha_ms !== msDe(x.tiempo_utc)) d.push(`mediciones[${i}].fecha_utc: ${String(y.fecha_ms)} ≠ ${msDe(x.tiempo_utc)}`);
  });
  e.tramas.forEach((x, i) => {
    const y = leido.tramas[i] ?? {};
    for (const k of ['recibido_en_utc', 'id_fisico', 'topico', 'adaptador'] as const) if (y[k] !== x[k]) d.push(`tramas[${i}].${k}: ${JSON.stringify(y[k])} ≠ ${JSON.stringify(x[k])}`);
    const carga = Buffer.from(String(y.payload_base64), 'base64');
    if (!carga.equals(x.payload) || Buffer.from(carga.toString('base64')).toString() !== String(y.payload_base64)) d.push(`tramas[${i}].payload_base64 no devuelve los bytes de la base`);
    if (y.bytes !== x.payload.length) d.push(`tramas[${i}].bytes: ${String(y.bytes)} ≠ ${x.payload.length}`);
    if (y.sha256 !== sha(x.payload) || y.sha256 !== sha(carga)) d.push(`tramas[${i}].sha256 no coincide con la huella de su carga`);
    if ('fecha_ms' in y && y.fecha_ms !== msDe(x.recibido_en_utc)) d.push(`tramas[${i}].fecha_utc`);
  });
  e.eventos.forEach((x, i) => {
    const y = leido.eventos[i] ?? {};
    for (const k of ['ocurrido_en_utc', 'id_fisico', 'tipo'] as const) if (y[k] !== x[k]) d.push(`eventos[${i}].${k}: ${JSON.stringify(y[k])} ≠ ${JSON.stringify(x[k])}`);
    if (!igualJson(y.detalle, x.detalle)) d.push(`eventos[${i}].detalle: ${JSON.stringify(y.detalle)} ≠ ${JSON.stringify(x.detalle)}`);
    if ('fecha_ms' in y && y.fecha_ms !== msDe(x.ocurrido_en_utc)) d.push(`eventos[${i}].fecha_utc`);
  });
  return d;
}

// ── Lectura de cada formato con los lectores de la prueba ─────────────────────────────────────────────────────────────────────────
function delCsv(entradas: EntradaZip[]): { leido: { mediciones: FilaLeida[]; tramas: FilaLeida[]; eventos: FilaLeida[] }; leeme: string; errores: string[] } {
  const errores: string[] = [];
  const conjunto = (nombre: string, columnas: string[], convertir: (r: Record<string, string>) => FilaLeida): FilaLeida[] => {
    const partes = entradas.filter((e) => e.nombre === `${nombre}.csv` || new RegExp(`^${nombre}-\\d+\\.csv$`).test(e.nombre));
    return partes.flatMap((p) => {
      const filas = leerCsv(p.datos.toString('utf8'));
      if ((filas[0] ?? []).join(',') !== columnas.join(',')) errores.push(`${p.nombre}: cabecera ${String(filas[0])}`);
      return filas.slice(1).map((f) => {
        if (f.length !== columnas.length) errores.push(`${p.nombre}: una fila con ${f.length} columnas`);
        return convertir(Object.fromEntries(columnas.map((c, i) => [c, desproteger(f[i] ?? '')])));
      });
    });
  };
  const leido = {
    mediciones: conjunto('mediciones', ['tiempo_utc', 'id_fisico', 'magnitud', 'valor', 'unidad', 'canal_id'], (r) => ({ ...r, valor: r.valor === '' ? Number.NaN : Number(r.valor) })),
    tramas: conjunto('tramas', ['recibido_en_utc', 'id_fisico', 'topico', 'adaptador', 'bytes', 'sha256', 'payload_base64'], (r) => ({ ...r, bytes: Number(r.bytes) })),
    eventos: conjunto('eventos', ['ocurrido_en_utc', 'id_fisico', 'tipo', 'detalle_json'], (r) => ({ ...r, detalle: r.detalle_json === '' ? null : JSON.parse(r.detalle_json ?? '') as unknown })),
  };
  return { leido, leeme: entradas.find((e) => e.nombre === 'LEEME.txt')?.datos.toString('utf8') ?? '', errores };
}
function delXlsx(entradas: EntradaZip[]) {
  const hojas = leerLibro(entradas);
  const errores: string[] = [];
  const texto = (c: CeldaLeida): string => (c === null ? '' : c.t === 'texto' ? c.v : `¡número ${c.v}!`);
  const numero = (c: CeldaLeida): number => (c !== null && c.t === 'numero' ? c.v : Number.NaN);
  const fecha = (c: CeldaLeida): number => (c !== null && c.t === 'numero' && c.estilo === 1 ? Math.round((c.v - 25_569) * 86_400_000) : Number.NaN);
  const conjunto = (base: string, columnas: string[], convertir: (f: CeldaLeida[]) => FilaLeida): FilaLeida[] =>
    hojas.filter((h) => h.nombre === base || new RegExp(`^${base} \\(\\d+\\)$`).test(h.nombre)).flatMap((h) => {
      const cab = (h.filas[0] ?? []).map(texto);
      if (cab.join(',') !== columnas.join(',')) errores.push(`${h.nombre}: cabecera ${cab.join(',')}`);
      return h.filas.slice(1).map(convertir);
    });
  const leido = {
    mediciones: conjunto('Mediciones', ['tiempo_utc', 'fecha_utc', 'id_fisico', 'magnitud', 'valor', 'unidad', 'canal_id'], (f) => ({
      tiempo_utc: texto(f[0] ?? null), fecha_ms: fecha(f[1] ?? null), id_fisico: texto(f[2] ?? null), magnitud: texto(f[3] ?? null), valor: numero(f[4] ?? null),
      unidad: texto(f[5] ?? null), canal_id: texto(f[6] ?? null) })),
    tramas: conjunto('Tramas', ['recibido_en_utc', 'fecha_utc', 'id_fisico', 'topico', 'adaptador', 'bytes', 'sha256', 'payload_base64', 'payload_base64_2', 'payload_base64_3'], (f) => ({
      recibido_en_utc: texto(f[0] ?? null), fecha_ms: fecha(f[1] ?? null), id_fisico: texto(f[2] ?? null), topico: texto(f[3] ?? null), adaptador: texto(f[4] ?? null),
      bytes: numero(f[5] ?? null), sha256: texto(f[6] ?? null), payload_base64: texto(f[7] ?? null) + texto(f[8] ?? null) + texto(f[9] ?? null) })),
    eventos: conjunto('Eventos', ['ocurrido_en_utc', 'fecha_utc', 'id_fisico', 'tipo', 'detalle_json'], (f) => ({
      ocurrido_en_utc: texto(f[0] ?? null), fecha_ms: fecha(f[1] ?? null), id_fisico: texto(f[2] ?? null), tipo: texto(f[3] ?? null),
      detalle: f[4] === null || f[4] === undefined ? null : JSON.parse(texto(f[4])) as unknown })),
  };
  const acerca = hojas[0]?.nombre === 'Acerca de' ? hojas[0].filas.slice(1).map((f): [string, string] => [texto(f[0] ?? null), texto(f[1] ?? null)]) : [];
  return { leido, hojas, acerca, errores };
}

// ── HTTP ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────────────
interface Persona { cookie: string; id: string }
let BASE = '';
async function bajar(quien: Persona | null, ruta: string): Promise<{ estado: number; cabeceras: Headers; cuerpo: Buffer }> {
  const r = await fetch(`${BASE}${ruta}`, { headers: quien === null ? {} : { cookie: quien.cookie } });
  return { estado: r.status, cabeceras: r.headers, cuerpo: Buffer.from(await r.arrayBuffer()) };
}
// Una descarga que se abre y NO se lee (queda frenada por la contrapresión) hasta que la prueba la corta.
function abrirSinLeer(quien: Persona, ruta: string): Promise<{ res: IncomingMessage; cortar: () => void }> {
  return new Promise((resolver, rechazar) => {
    const url = new URL(`${BASE}${ruta}`);
    const req = request({ host: url.hostname, port: url.port, path: url.pathname + url.search, headers: { cookie: quien.cookie } }, (res) => {
      res.pause();
      resolver({ res, cortar: () => { req.destroy(); res.destroy(); } });
    });
    req.on('error', (e) => { if (!req.destroyed) rechazar(e); });
    req.end();
  });
}
const esperar = (ms: number) => new Promise((r) => setTimeout(r, ms));
async function hasta(cond: () => boolean, ms = 10_000): Promise<boolean> {
  const fin = Date.now() + ms;
  while (Date.now() < fin) { if (cond()) return true; await esperar(25); }
  return cond();
}

// La aplicación compilada en un proceso aparte, en un puerto libre de 127.0.0.1, con el mismo entorno que la de este proceso.
async function servidorAparte(): Promise<{ pid: number; base: string; detener: () => void }> {
  const { spawn } = await import('node:child_process');
  const { createServer } = await import('node:net');
  const puerto = await new Promise<number>((r) => { const sv = createServer().listen(0, '127.0.0.1', () => { const p = (sv.address() as { port: number }).port; sv.close(() => r(p)); }); });
  const hijo = spawn(process.execPath, ['dist/main.js'], { env: { ...process.env, HTTP_PUERTO: String(puerto), HTTP_INTERFAZ: '127.0.0.1', LOG_FORMATO: 'json' }, stdio: 'ignore' });
  const base = `http://127.0.0.1:${puerto}`;
  let listo = false;
  for (let i = 0; i < 100 && !listo; i++) {
    listo = await fetch(`${base}/salud`).then((r) => r.status === 200, () => false);
    if (!listo) await esperar(100);
  }
  if (!listo || hijo.pid === undefined) { hijo.kill(); throw new Error('el proceso aparte no respondió /salud en 10 s'); }
  return { pid: hijo.pid, base, detener: () => { hijo.kill('SIGTERM'); } };
}
const deProc = (pid: number, campo: string): number => {
  const l = readFileSync(`/proc/${pid}/status`, 'utf8').split('\n').find((x) => x.startsWith(`${campo}:`));
  return Number(/(\d+) kB/.exec(l ?? '')?.[1] ?? 0) * 1024;
};
const rss = (pid: number): number => deProc(pid, 'VmRSS');
const hwm = (pid: number): number => deProc(pid, 'VmHWM');

async function principal() {
  const s = await sembrar();
  const rango = `desde=${encodeURIComponent(DESDE)}&hasta=${encodeURIComponent(HASTA)}`;
  const e = await esperado(s.sitioA, DESDE, HASTA);
  comprobar(e.mediciones.length === 11 + 30 + 1 + 1 && e.tramas.length === 5 && e.eventos.length === 5,
    'siembra del sitio A: 43 mediciones (con `desde` incluido, sin la de 1 µs antes ni la de `hasta`), 5 tramas y 5 eventos de equipos en el rango',
    `${e.mediciones.length} / ${e.tramas.length} / ${e.eventos.length}`);

  // ── La aplicación compilada ───────────────────────────────────────────────────────────────────────────────────────────────────
  Object.assign(process.env, {
    DB_NOMBRE: 'plataforma', DB_HOST: socket, DB_PUERTO: '5432', DB_APP_USUARIO: 'plataforma_app', DB_APP_CLAVE: process.env.PRUEBA_CLAVE_APP,
    MQTT_URL: 'mqtt://127.0.0.1:1', MQTT_BACKEND_CLAVE: 'sin-broker-en-esta-prueba', MQTT_CLIENT_ID: 'prueba-exportar', MQTT_ADMIN_CLAVE: '', HTTP_CLAVE_ADMIN: '',
    SUPERVISION_INTERVALO_S: '3600',
  });
  const { NestFactory } = await import('@nestjs/core');
  const compilada = '../dist/app.module.js';
  const { AppModule } = (await import(compilada)) as { AppModule: Type };
  const rutaCupo = '../dist/consulta/cupo-exportaciones.js';
  const { CupoExportaciones } = (await import(rutaCupo)) as { CupoExportaciones: Type<{ ocupados: number }> };
  const rutaDb = '../dist/db/db.module.js';
  const { POOL } = (await import(rutaDb)) as { POOL: string };
  const nest = await NestFactory.create(AppModule, { logger: false, abortOnError: false });
  await nest.listen(0, '127.0.0.1');
  BASE = (await nest.getUrl()).replace('[::1]', '127.0.0.1');
  const cupo = nest.get(CupoExportaciones);
  // Cuántas tandas de mediciones pide la exportación: se cuentan las consultas de los clientes que la aplicación toma del pool (la forma con
  // promesa de connect(), la que usan las exportaciones; pool.query usa la de callback y no pasa por aquí).
  const pool = nest.get<Pool>(POOL);
  let tandasMedicion = 0;
  // Una falla plantada: la siguiente consulta de un cliente prestado cuyo texto calce con `fallarUna` se rechaza (la base «no responde»).
  let fallarUna: RegExp | null = null;
  const envueltos = new WeakSet<PoolClient>();
  const conectar = pool.connect.bind(pool) as () => Promise<PoolClient>;
  (pool as unknown as { connect: (cb?: unknown) => unknown }).connect = (cb?: unknown) => {
    if (typeof cb === 'function') return (conectar as unknown as (c: unknown) => void)(cb);
    return conectar().then((c) => {
      if (!envueltos.has(c)) {
        envueltos.add(c);
        const consultar = c.query.bind(c) as (...a: unknown[]) => unknown;
        (c as unknown as { query: (...a: unknown[]) => unknown }).query = (...a: unknown[]) => {
          if (typeof a[0] === 'string' && a[0].includes('FROM medicion m') && a[0].includes('ORDER BY m.tiempo LIMIT')) tandasMedicion++;
          if (fallarUna !== null && typeof a[0] === 'string' && fallarUna.test(a[0])) {
            fallarUna = null;
            return Promise.reject(new Error('falla plantada por la prueba: la base no responde'));
          }
          return consultar(...a);
        };
      }
      return c;
    });
  };

  const persona = async (rol: string, sitioId: string): Promise<Persona> => {
    const u = await q(`INSERT INTO usuario (nombre, email, hash_password, terminos_version_aceptada, terminos_aceptados_en) VALUES ($1, $2, 'x', 1, now()) RETURNING id`,
      [`Persona ${rol}`, `${rol}-${randomBytes(4).toString('hex')}@prueba-exportar.invalid`]);
    await q('INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) VALUES ($1, $2, $3)', [u.rows[0].id, sitioId, rol]);
    const identificador = randomBytes(32).toString('base64url');
    await q(`INSERT INTO sesion (id, usuario_id, expira_en) VALUES ($1, $2, now() + INTERVAL '1 hour')`, [createHash('sha256').update(identificador).digest('hex'), u.rows[0].id]);
    return { cookie: `__Host-sesion=${identificador}`, id: u.rows[0].id as string };
  };
  try {
    const consulta = await persona('consulta', s.sitioA);
    const operador = await persona('operador', s.sitioA);
    const investigador = await persona('investigador', s.sitioA);
    const admin = await persona('administrador', s.sitioA);
    const adminB = await persona('administrador', s.sitioB);

    // ── Permisos (docs/20 §6, fila del 19/11/2026): las dos rutas ───────────────────────────────────────────────────────────────
    for (const ruta of [`/sitios/${s.sitioA}/exportar?${rango}`, `/sitios/${s.sitioA}/exportar/estimacion?${rango}`]) {
      const corta = ruta.includes('estimacion') ? 'GET /sitios/{id}/exportar/estimacion' : 'GET /sitios/{id}/exportar';
      const codigos = [
        (await bajar(null, ruta)).estado, (await bajar(consulta, ruta)).estado, (await bajar(operador, ruta)).estado, (await bajar(adminB, ruta)).estado,
        (await bajar(investigador, ruta.replace(s.sitioA, '00000000-0000-4000-8000-000000000000'))).estado, (await bajar(investigador, ruta)).estado, (await bajar(admin, ruta)).estado,
      ];
      comprobar(codigos.join(' ') === '401 403 403 404 404 200 200',
        `${corta}: sin sesión 401, consulta 403, operador técnico 403, administrador de otro sitio 404, sitio inexistente 404, investigador 200, administrador 200`, codigos.join(' '));
    }
    const otroCuerpo = await bajar(adminB, `/sitios/${s.sitioA}/exportar`);
    const inexistente = await bajar(adminB, '/sitios/00000000-0000-4000-8000-000000000000/exportar');
    comprobar(otroCuerpo.cuerpo.equals(inexistente.cuerpo), 'otro sitio responde lo mismo que uno inexistente (mismo 404 y mismo cuerpo, RF-41)');
    comprobar((await bajar(investigador, `/sitios/${s.sitioA}/exportar?formato=xls`)).estado === 400 && (await bajar(investigador, `/sitios/${s.sitioA}/exportar?desde=1999-01-01`)).estado === 400,
      'formato desconocido o rango antes del año 2000: 400');

    // ── Si la primera consulta falla, antes de enviar nada: 503 en JSON, no una descarga cortada (revisión del 19/11/2026) ────────
    const a1 = (await q(`SELECT id FROM dispositivo WHERE id_fisico = 'exp-a-1'`)).rows[0].id as string;
    for (const [nombreCaso, ruta, primera] of [
      ['GET /sitios/{id}/exportar (csv)', `/sitios/${s.sitioA}/exportar?${rango}`, /FROM canal ca JOIN dispositivo d/],
      ['GET /sitios/{id}/exportar (xlsx)', `/sitios/${s.sitioA}/exportar?formato=xlsx&${rango}`, /FROM canal ca JOIN dispositivo d/],
      ['GET /dispositivos/{id}/exportar', `/dispositivos/${a1}/exportar?${rango}`, /FROM medicion m JOIN canal c/],
    ] as const) {
      fallarUna = primera;
      const r = await bajar(investigador, ruta);
      const cuerpo = JSON.parse(r.cuerpo.toString() || '{}') as Record<string, unknown>;
      comprobar(fallarUna === null && r.estado === 503 && r.cabeceras.get('content-disposition') === null && r.cabeceras.get('content-type')?.startsWith('application/json') === true
        && cuerpo.statusCode === 503 && cuerpo.error === 'Service Unavailable' && cupo.ocupados === 0,
      `${nombreCaso}: si la primera consulta falla, 503 en JSON sin Content-Disposition (no un corte) y el cupo se suelta`,
      `${r.estado} ${r.cabeceras.get('content-type')} ${r.cabeceras.get('content-disposition')} ${r.cuerpo.toString().slice(0, 160)}`);
    }
    fallarUna = null;

    // ── Ida y vuelta en los tres formatos: 0 diferencias contra la base ─────────────────────────────────────────────────────────
    const nombre = `sitio_exp-a_${dia(8)}_${dia(2)}`;
    const csv = await bajar(investigador, `/sitios/${s.sitioA}/exportar?${rango}`);
    comprobar(csv.estado === 200 && csv.cabeceras.get('content-type') === 'application/zip' && csv.cabeceras.get('content-disposition') === `attachment; filename="${nombre}.zip"`
      && csv.cabeceras.get('cache-control') === 'no-store', 'csv (por omisión): 200, application/zip, attachment con sitio_<código>_<desde>_<hasta>.zip, no-store',
    `${csv.estado} ${csv.cabeceras.get('content-type')} ${csv.cabeceras.get('content-disposition')}`);
    const zipCsv = leerZip(csv.cuerpo);
    comprobar(zipCsv.map((x) => x.nombre).join(' ') === 'mediciones.csv tramas.csv eventos.csv LEEME.txt' && zipCsv.every((x) => x.metodo === 8 && x.flags === 8),
      'el zip: mediciones.csv, tramas.csv, eventos.csv y LEEME.txt al final; deflate con descriptor de datos; CRC y tamaños coinciden al leerlo con inflateRaw',
      zipCsv.map((x) => x.nombre).join(' '));
    const deCsv = delCsv(zipCsv);
    const difCsv = [...deCsv.errores, ...diferencias(e, deCsv.leido)];
    comprobar(difCsv.length === 0, `csv: ida y vuelta con el lector RFC 4180 y la regla inversa del apóstrofo, 0 diferencias en ${e.mediciones.length + e.tramas.length + e.eventos.length} filas (cada sha256 coincide con su carga)`, difCsv.slice(0, 5).join(' | '));
    const lineaM = csv.cuerpo.length > 0 ? zipCsv[0]?.datos.toString('utf8') ?? '' : '';
    comprobar(lineaM.includes(",'=SUMA(A1),") && lineaM.includes(",''=x,") && lineaM.includes(",',") && lineaM.includes(",'''+dos apóstrofos,") && lineaM.includes("'＝ancho"),
      "csv: lo que empieza con =, '=, ''+ o ＝ va con un apóstrofo más; el apóstrofo solo, tal cual");
    comprobar((zipCsv[1]?.datos.toString('utf8') ?? '').includes(",'+"), 'csv: la trama no UTF-8 tiene un base64 que empieza con «+» y va protegida (y vuelve exacta)');
    const leeme = deCsv.leeme;
    comprobar(leeme.includes('formato: exportacion-sitio/1') && leeme.includes(`filas en mediciones.csv: ${e.mediciones.length}`) && leeme.includes(`filas en tramas.csv: ${e.tramas.length}`)
      && leeme.includes(`filas en eventos.csv: ${e.eventos.length}`) && leeme.includes('30 días') && leeme.includes('apóstrofo'),
    'LEEME.txt: formato, conteos de cada archivo (iguales a la base), la retención de las tramas y la regla del apóstrofo', leeme.slice(-300));
    if (ARCHIVOS !== '') writeFileSync(join(ARCHIVOS, 'sitio.zip'), csv.cuerpo);

    const xlsx = await bajar(investigador, `/sitios/${s.sitioA}/exportar?formato=xlsx&${rango}`);
    comprobar(xlsx.estado === 200 && xlsx.cabeceras.get('content-type') === 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet'
      && xlsx.cabeceras.get('content-disposition') === `attachment; filename="${nombre}.xlsx"`, 'xlsx: 200, tipo de SpreadsheetML y nombre .xlsx');
    const zipX = leerZip(xlsx.cuerpo);
    const deX = delXlsx(zipX);
    comprobar(deX.hojas.map((h) => h.nombre).join('|') === 'Acerca de|Mediciones|Tramas|Eventos', 'xlsx: cuatro hojas, «Acerca de» la primera', deX.hojas.map((h) => h.nombre).join('|'));
    const difX = [...deX.errores, ...diferencias(e, deX.leido)];
    comprobar(difX.length === 0, 'xlsx: ida y vuelta leyendo el XML de cada hoja (entidades y _xHHHH_), 0 diferencias; la fecha de planilla da el milisegundo de cada instante', difX.slice(0, 5).join(' | '));
    const grande = deX.hojas[2]?.filas.slice(1).find((f) => f[9] !== null && f[9] !== undefined);
    comprobar(grande !== undefined && [7, 8, 9].map((i) => { const c = grande[i]; return c !== null && c !== undefined && c.t === 'texto' ? c.v.length : 0; }).join(',') === '32000,32000,23384',
      'xlsx: la trama de 64 KiB va partida en payload_base64, _2 y _3 (32 000, 32 000 y 23 384 caracteres)');
    const hojaM = zipX.find((x) => x.nombre === 'xl/worksheets/hoja1.xml')?.datos.toString('utf8') ?? '';
    comprobar(hojaM.includes('_x005F_x0041_') && hojaM.includes('_x0001_') && hojaM.includes('&#13;') && hojaM.includes('state="frozen"'),
      'xlsx: el _x0041_ literal va protegido (_x005F_), los controles como _xHHHH_, el retorno como &#13; y la primera fila fija');
    const acerca = Object.fromEntries(deX.acerca);
    comprobar(acerca['filas en hoja «Mediciones»'] === String(e.mediciones.length) && acerca['filas en hoja «Tramas»'] === String(e.tramas.length)
      && acerca['filas en hoja «Eventos»'] === String(e.eventos.length) && acerca.formato === 'exportacion-sitio/1',
    '«Acerca de»: formato y conteos de cada hoja, iguales a la base', JSON.stringify(acerca).slice(0, 300));
    if (ARCHIVOS !== '') writeFileSync(join(ARCHIVOS, 'sitio.xlsx'), xlsx.cuerpo);

    const json = await bajar(investigador, `/sitios/${s.sitioA}/exportar?formato=json&${rango}`);
    const v = JSON.parse(json.cuerpo.toString('utf8')) as Record<string, unknown> & { mediciones: FilaLeida[]; tramas: FilaLeida[]; eventos: FilaLeida[]; conteos: Record<string, number> };
    comprobar(json.cabeceras.get('content-disposition') === `attachment; filename="${nombre}.json"` && Object.keys(v).join(',') === 'formato,sitio,desde,hasta,generado_en,retencion_tramas_dias,mediciones,tramas,eventos,conteos',
      'json: nombre .json y las claves en orden, con conteos al final', Object.keys(v).join(','));
    const difJ = diferencias(e, v);
    comprobar(difJ.length === 0 && v.conteos.mediciones === e.mediciones.length && v.conteos.tramas === e.tramas.length && v.conteos.eventos === e.eventos.length,
      'json: ida y vuelta con JSON.parse, 0 diferencias; detalle como objeto (tildes y emoji intactos)', difJ.slice(0, 5).join(' | '));
    comprobar(JSON.stringify(v.sitio) === JSON.stringify({ codigo: 'exp-a', nombre: 'Sitio «de prueba», con coma' }) && v.desde === new Date(DESDE).toISOString(), 'json: sitio{codigo, nombre} y el rango pedido');

    // ── RF-41 y personas: nada del otro sitio; ningún dato de quién hizo los cambios ───────────────────────────────────────────
    const todo = [...zipCsv.map((x) => x.datos.toString('utf8')), ...zipX.map((x) => x.datos.toString('utf8')), json.cuerpo.toString('utf8')].join('\n');
    const fugas = s.marcasB.filter((m) => todo.includes(m));
    comprobar(fugas.length === 0, `ninguna de las ${s.marcasB.length} marcas del sitio B (id_fisico, canal, huella, carga, tipo, unidad) aparece en los tres archivos (RF-41)`, fugas.join(', '));
    const personas = ['quien@exportar.invalid', 'Persona que configuró', s.usuarioA, 'usuario_id'].filter((m) => todo.includes(m));
    comprobar(personas.length === 0 && !todo.includes('espera_primera_trama'), 'sin datos de personas (ni nombre, ni correo, ni id de quien hizo el cambio) y sin los eventos del sitio que no son de un equipo', personas.join(', '));

    // ── La paginación por clave da lo mismo con tandas de 2 (los empates de instante se desempatan por id) ──────────────────────
    const servicio = new ConsultaService(app);
    const comoLista = async <T>(g: AsyncIterable<T>): Promise<T[]> => { const r: T[] = []; for await (const x of g) r.push(x); return r; };
    const [chicas, grandes] = await Promise.all([2, 10_000].map((t) => servicio.conConexionExportacion(async (c) => ({
      m: await comoLista(servicio.medicionesSitio(c, s.sitioA, new Date(DESDE), new Date(HASTA), t)),
      t: await comoLista(servicio.tramasSitio(c, s.sitioA, new Date(DESDE), new Date(HASTA), t)),
      e: await comoLista(servicio.eventosSitio(c, s.sitioA, new Date(DESDE), new Date(HASTA), t)),
    }))));
    comprobar(JSON.stringify(chicas) === JSON.stringify(grandes) && chicas?.m.length === e.mediciones.length && chicas.t.length === e.tramas.length && chicas.e.length === e.eventos.length,
      'paginación por clave: con tandas de 2 filas, las tres fuentes dan exactamente lo mismo que con una tanda (con empates de instante en tramas y eventos)');

    // ── Estimación ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
    const est = JSON.parse((await bajar(investigador, `/sitios/${s.sitioA}/exportar/estimacion?${rango}`)).cuerpo.toString()) as Record<string, Record<string, unknown> | undefined> & { retencion_tramas_dias: number };
    const primera = (await q(`SELECT min(t.recibido_en) AS t FROM trama t JOIN dispositivo d ON d.id = t.dispositivo_id JOIN zona z ON z.id = d.zona_id WHERE z.sitio_id = $1 AND t.recibido_en >= $2 AND t.recibido_en < $3`, [s.sitioA, DESDE, HASTA])).rows[0].t as Date;
    comprobar(est.mediciones?.filas === e.mediciones.length && est.tramas?.filas === e.tramas.length && est.eventos?.filas === e.eventos.length && est.mediciones?.supera_tope === false
      && est.tramas?.desde === primera.toISOString() && (est.bytes_aproximados?.csv as number) > 0 && est.retencion_tramas_dias === 30,
    'estimación: los mismos conteos que la base, la trama más antigua del rango, la retención y bytes por formato', JSON.stringify(est));

    // ── Volumen: el sitio grande para el cupo, el corte y la medición ─────────────────────────────────────────────────────────────
    const N_EQUIPOS = 20;
    const POR_EQUIPO = MEDIR ? 50_000 : 10_000;
    const banco = (await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Banco', 'exp-banco', 'UTC') RETURNING id`)).rows[0].id as string;
    const zb = (await q(`INSERT INTO zona (sitio_id, nombre) VALUES ($1, 'Zona') RETURNING id`, [banco])).rows[0].id as string;
    const t0 = Date.now();
    await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) SELECT $1, 'banco-' || lpad(g::text, 2, '0'), 'Banco ' || g, 40 FROM generate_series(1, $2) g`, [zb, N_EQUIPOS]);
    await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT d.id, 'temperatura' FROM dispositivo d WHERE d.zona_id = $1`, [zb]);
    await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
             SELECT c.id, t, round((15 + 10 * random())::numeric, 2)::float8, 'Cel', t, 'recepcion'
               FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id,
                    LATERAL (SELECT now() - INTERVAL '24 days' + g * INTERVAL '40 seconds' + (random() * 1000)::int * INTERVAL '1 microsecond' AS t FROM generate_series(1, $2) g) x
              WHERE d.zona_id = $1`, [zb, POR_EQUIPO]);
    await q(`INSERT INTO trama (dispositivo_id, recibido_en, topico, payload, adaptador)
             SELECT d.id, now() - INTERVAL '23 days' + g * INTERVAL '400 seconds', 'sitio/exp-banco/' || d.id_fisico,
                    convert_to(format('[{"bn":"urn:dev:%s:","bt":%s},{"n":"temperatura","u":"Cel","v":%s},{"n":"humedad","u":"%%RH","v":%s}]',
                               d.id_fisico, 1790000000 + g * 400, round((15 + 10 * random())::numeric, 2), round((40 + 20 * random())::numeric, 1)), 'UTF8'), 'senml'
               FROM dispositivo d, generate_series(1, $2 / 10) g WHERE d.zona_id = $1`, [zb, POR_EQUIPO]);
    await q(`INSERT INTO evento (dispositivo_id, ocurrido_en, tipo, detalle)
             SELECT d.id, now() - INTERVAL '23 days' + g * INTERVAL '4000 seconds', CASE WHEN g % 2 = 0 THEN 'condicion_abierta' ELSE 'condicion_cerrada' END,
                    jsonb_build_object('tipo', 'umbral', 'valor', round((30 + 10 * random())::numeric, 2), 'umbral_alto', 30, 'regla_id', gen_random_uuid())
               FROM dispositivo d, generate_series(1, $2 / 100) g WHERE d.zona_id = $1`, [zb, POR_EQUIPO]);
    // El resto de la instalación: otro sitio con 380 canales en la misma ventana. Con solo los 20 canales del banco, el planificador lee el
    // índice de tiempo de la hypertable y filtra por canal (barato con tan pocos canales); con más canales pasa a uq_medicion_canal_tiempo
    // y el costo de cada tanda deja de depender del resto (medido al construir, 19/11/2026; el plan se comprueba abajo).
    await q(`INSERT INTO sitio (nombre, codigo, zona_horaria) VALUES ('Resto', 'exp-resto', 'UTC')`);
    await q(`INSERT INTO zona (sitio_id, nombre) SELECT id, 'Zona' FROM sitio WHERE codigo = 'exp-resto'`);
    await q(`INSERT INTO dispositivo (zona_id, id_fisico, nombre, intervalo_esperado_s) SELECT z.id, 'resto-' || lpad(g::text, 3, '0'), 'Resto ' || g, 800
               FROM generate_series(1, 380) g, zona z JOIN sitio st ON st.id = z.sitio_id WHERE st.codigo = 'exp-resto'`);
    await q(`INSERT INTO canal (dispositivo_id, magnitud_codigo) SELECT d.id, 'temperatura' FROM dispositivo d WHERE d.id_fisico LIKE 'resto-%'`);
    await q(`INSERT INTO medicion (canal_id, tiempo, valor, unidad, recibido_en, origen_tiempo)
             SELECT c.id, t, 20, 'RESTO-MARCA', t, 'recepcion' FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id,
                    LATERAL (SELECT now() - INTERVAL '24 days' + g * INTERVAL '800 seconds' + (random() * 1000)::int * INTERVAL '1 microsecond' AS t FROM generate_series(1, $1) g) x
              WHERE d.id_fisico LIKE 'resto-%'`, [MEDIR ? 2500 : 250]);
    await q('ANALYZE medicion; ANALYZE trama; ANALYZE evento; ANALYZE canal; ANALYZE dispositivo');
    const totalM = N_EQUIPOS * POR_EQUIPO;
    console.log(`      sitio del banco: ${totalM} mediciones, ${totalM / 10} tramas y ${totalM / 100} eventos (y ${380 * (MEDIR ? 2500 : 250)} mediciones de otro sitio de 380 canales) sembrados en ${((Date.now() - t0) / 1000).toFixed(1)} s`);
    const rangoBanco = `desde=${encodeURIComponent(new Date(Date.now() - 25 * 86_400_000).toISOString())}&hasta=${encodeURIComponent(new Date().toISOString())}`;
    const rutaBanco = (f: string) => `/sitios/${banco}/exportar?formato=${f}&${rangoBanco}`;
    const investigadorB = await persona('investigador', banco);

    // ── Cupo único (429) y corte cuando el cliente se va ─────────────────────────────────────────────────────────────────────────
    // En JSON: sin comprimir, pesa mucho más que lo que caben en los búferes del socket local, así que las dos quedan frenadas.
    const a = await abrirSinLeer(investigadorB, rutaBanco('json'));
    const b = await abrirSinLeer(investigadorB, rutaBanco('json'));
    comprobar(await hasta(() => cupo.ocupados === 2), 'dos descargas abiertas y sin leer ocupan el cupo (2)', String(cupo.ocupados));
    const tercera = await bajar(investigadorB, rutaBanco('xlsx'));
    const dispositivoBanco = (await q(`SELECT d.id FROM dispositivo d WHERE d.zona_id = $1 LIMIT 1`, [zb])).rows[0].id as string;
    const deDispositivo = await bajar(investigadorB, `/dispositivos/${dispositivoBanco}/exportar`);
    const estimarConCupo = await bajar(investigadorB, `/sitios/${banco}/exportar/estimacion?${rangoBanco}`);
    const codigoDe = (r: { cuerpo: Buffer }): unknown => (JSON.parse(r.cuerpo.toString() || '{}') as { codigo?: unknown }).codigo;
    comprobar([tercera, deDispositivo, estimarConCupo].every((r) => r.estado === 429 && codigoDe(r) === 'exportaciones_en_curso')
      && JSON.parse(tercera.cuerpo.toString()).message === 'hay 2 exportaciones o estimaciones en curso; inténtalo en un momento',
    'con el cupo lleno, la tercera responde 429 `exportaciones_en_curso`, sea exportación de sitio, de dispositivo o estimación (cupo único)',
    `${tercera.estado} ${deDispositivo.estado} ${estimarConCupo.estado} ${tercera.cuerpo.toString().slice(0, 160)}`);
    const tandasAntes = tandasMedicion;
    a.cortar();
    b.cortar();
    comprobar(await hasta(() => cupo.ocupados === 0), 'al cortar las dos descargas (el cliente cierra la conexión), el cupo vuelve a 0', String(cupo.ocupados));
    const tandasAlCortar = tandasMedicion;
    await esperar(1500);
    comprobar(tandasMedicion === tandasAlCortar && tandasAlCortar - tandasAntes <= 2 && await hasta(() => pool.totalCount === pool.idleCount),
      'después del corte la consulta deja de pedir tandas (ninguna en 1,5 s) y las conexiones vuelven al pool',
      `tandas: antes ${tandasAntes}, al cortar ${tandasAlCortar}, después ${tandasMedicion}; pool ${pool.idleCount}/${pool.totalCount}`);

    // ── Medición: 1 000 000 de mediciones (más tramas y eventos) en cada formato ─────────────────────────────────────────────────
    // La aplicación compilada en un proceso APARTE (`node dist/main.js`, como en la imagen), para que la memoria medida sea solo la de quien
    // sirve la exportación: VmRSS de /proc cada 20 ms y VmHWM (el pico desde que arrancó) al final. El cliente lee y descarta. Al final, las dos
    // que admite el cupo a la vez (csv y json), para ver el pico con el cupo lleno frente al límite de 512 MB del contenedor (docker-compose.yml).
    const medidas: Record<string, { s: number; bytes: number; rssPico: number; base: number }> = {};
    const aparte = await servidorAparte();
    const contar = (f: string): Promise<number> => new Promise<number>((resolver, rechazar) => {
      let bytes = 0;
      const url = new URL(`${aparte.base}${rutaBanco(f)}`);
      request({ host: url.hostname, port: url.port, path: url.pathname + url.search, headers: { cookie: investigadorB.cookie } }, (res) => {
        res.on('data', (t: Buffer) => { bytes += t.length; });
        res.on('end', () => resolver(bytes));
        res.on('error', rechazar);
      }).on('error', rechazar).end();
    });
    try {
      for (const f of [...(process.env.EXPORTAR_ORDEN ?? 'csv,xlsx,json').split(','), 'csv+json']) {
        const base = rss(aparte.pid);
        let pico = base;
        const muestreo = setInterval(() => { pico = Math.max(pico, rss(aparte.pid)); }, 20);
        const inicio = Date.now();
        const bytes = (await Promise.all(f.split('+').map(contar))).reduce((x, y) => x + y, 0);
        clearInterval(muestreo);
        medidas[f] = { s: (Date.now() - inicio) / 1000, bytes, rssPico: pico, base };
      }
      console.log(`      VmHWM del proceso aparte al terminar (el pico desde que arrancó): ${(hwm(aparte.pid) / 1e6).toFixed(1)} MB (10^6 bytes)`);
    } finally {
      aparte.detener();
    }
    // MB de 10^6 bytes, como los muestra el panel (lib/exportar.ts); el límite del contenedor (512M en docker-compose.yml) es de 2^20.
    const MB = (x: number): string => (x / 1e6).toFixed(1);
    comprobar((medidas['csv+json']?.rssPico ?? Infinity) < 450e6, 'con el cupo lleno (csv y json a la vez) el proceso queda bajo 450 MB residentes (límite del contenedor: 512 MiB)', MB(medidas['csv+json']?.rssPico ?? 0));
    for (const [f, m] of Object.entries(medidas)) console.log(`      medición ${f}: ${m.s.toFixed(1)} s, ${m.bytes} bytes (${MB(m.bytes)} MB) descargados; memoria residente del proceso que la sirve: ${m.base} bytes (${MB(m.base)} MB) al empezar, pico ${m.rssPico} bytes (${MB(m.rssPico)} MB)`);
    const zipBanco = leerZip((await bajar(investigadorB, rutaBanco('csv'))).cuerpo);
    const libroBanco = leerZip((await bajar(investigadorB, rutaBanco('xlsx'))).cuerpo);
    const comp = (z: EntradaZip[], re: RegExp): number => z.filter((x) => re.test(x.nombre)).reduce((s2, x) => s2 + x.comprimido, 0);
    const filasBanco = { mediciones: totalM, tramas: totalM / 10, eventos: totalM / 100 };
    const porFila = {
      csv: { mediciones: comp(zipBanco, /^mediciones/) / filasBanco.mediciones, tramas: comp(zipBanco, /^tramas/) / filasBanco.tramas, eventos: comp(zipBanco, /^eventos/) / filasBanco.eventos },
      xlsx: { mediciones: comp(libroBanco, /hoja1\.xml$/) / filasBanco.mediciones, tramas: comp(libroBanco, /hoja2\.xml$/) / filasBanco.tramas, eventos: comp(libroBanco, /hoja3\.xml$/) / filasBanco.eventos },
    };
    console.log(`      bytes por fila (archivo descargado ÷ filas): csv ${JSON.stringify(porFila.csv)} · xlsx ${JSON.stringify(porFila.xlsx)} · json ${(((medidas.json?.bytes ?? 0)) / (filasBanco.mediciones + filasBanco.tramas + filasBanco.eventos)).toFixed(1)} de promedio`);
    comprobar(zipBanco.find((x) => x.nombre === 'LEEME.txt')?.datos.toString().includes(`filas en mediciones.csv: ${totalM}`) === true
      && !zipBanco.some((x) => x.datos.includes('RESTO-MARCA')),
    `la exportación csv del banco trae las ${totalM} mediciones (lo dice su LEEME.txt), ninguna del otro sitio, y el zip se lee entero`);
    // El JSON por conjunto, para separar los bytes por fila de cada uno: se baja otra vez y se cortan sus tres listas.
    const jsonBanco = (await bajar(investigadorB, rutaBanco('json'))).cuerpo;
    const pos = (k: string): number => jsonBanco.indexOf(k === 'conteos' ? '"conteos":{' : `"${k}":[`);
    const porFilaJson = { mediciones: (pos('tramas') - pos('mediciones')) / filasBanco.mediciones, tramas: (pos('eventos') - pos('tramas')) / filasBanco.tramas, eventos: (pos('conteos') - pos('eventos')) / filasBanco.eventos };
    console.log(`      bytes por fila json: ${JSON.stringify(porFilaJson)}; fijos: csv ${(medidas.csv?.bytes ?? 0) - comp(zipBanco, /\.csv$/)}, xlsx ${(medidas.xlsx?.bytes ?? 0) - comp(libroBanco, /hoja[123]\.xml$/)}, json ${jsonBanco.length - (pos('conteos') - pos('mediciones'))}`);
    const est2 = JSON.parse((await bajar(investigadorB, `/sitios/${banco}/exportar/estimacion?${rangoBanco}`)).cuerpo.toString()) as { mediciones: { filas: number; supera_tope: boolean }; bytes_aproximados: Record<string, number> };
    const desvio = (f: string): number => Math.abs((est2.bytes_aproximados[f] ?? 0) - (medidas[f]?.bytes ?? 0)) / (medidas[f]?.bytes ?? 1);
    console.log(`      estimación del banco frente a lo descargado: ${['csv', 'xlsx', 'json'].map((f) => `${f} ${est2.bytes_aproximados[f]} / ${medidas[f]?.bytes} (${(100 * desvio(f)).toFixed(1)} %)`).join(' · ')}`);
    comprobar(est2.mediciones.filas === totalM && ['csv', 'xlsx', 'json'].every((f) => desvio(f) < 0.25),
      'estimación del banco: las mediciones contadas y los bytes de cada formato a menos de 25 % de lo descargado',
      `${JSON.stringify(est2.bytes_aproximados)} vs csv ${medidas.csv?.bytes} xlsx ${medidas.xlsx?.bytes} json ${medidas.json?.bytes}`);
    const conTope = await servicio.conConexionExportacion((c) => servicio.estimarSitio(c, banco, new Date(Date.now() - 25 * 86_400_000), new Date(), totalM - 1));
    comprobar(conTope.mediciones === totalM, `el conteo con tope ${totalM - 1} se detiene en ${totalM} (tope + 1): por encima, «más de»`, String(conTope.mediciones));

    // ── Planes de cada consulta (EXPLAIN (ANALYZE, BUFFERS)), resumidos ─────────────────────────────────────────────────────────
    if (MEDIR) {
      const canal = (await q(`SELECT c.id FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id WHERE d.zona_id = $1 ORDER BY d.id_fisico LIMIT 1`, [zb])).rows[0].id as string;
      const medio = (await q(`SELECT ${ISO_US('tiempo')} AS t FROM medicion WHERE canal_id = $1 ORDER BY tiempo OFFSET 25000 LIMIT 1`, [canal])).rows[0].t as string;
      const tMedio = (await q(`SELECT ${ISO_US('recibido_en')} AS t, id FROM trama WHERE dispositivo_id = $1 ORDER BY recibido_en, id OFFSET 2500 LIMIT 1`, [dispositivoBanco])).rows[0];
      const eMedio = (await q(`SELECT ${ISO_US('ocurrido_en')} AS t, id FROM evento WHERE dispositivo_id = $1 ORDER BY ocurrido_en, id OFFSET 250 LIMIT 1`, [dispositivoBanco])).rows[0];
      const d0 = new Date(Date.now() - 25 * 86_400_000);
      const d1 = new Date();
      // Los índices de `evento` y de dónde sale cada uno: idx_evento_dispositivo_id lo crea la convención de claves foráneas de la migración 05
      // (`'idx_' || tabla || '_' || columna`); idx_evento_dispositivo_ocurrido_en_id, la 23.
      const indicesEvento = (await q(`SELECT indexname, indexdef FROM pg_indexes WHERE tablename = 'evento' ORDER BY indexname`)).rows as { indexname: string; indexdef: string }[];
      console.log(`      índices de evento: ${indicesEvento.map((x) => x.indexdef.replace(/^CREATE (UNIQUE )?INDEX /, '')).join(' · ')}`);
      const planes: [string, string, unknown[]][] = [
        ['mediciones, primera tanda de un canal', `SELECT ${ISO_US('m.tiempo')} AS tiempo_utc, m.valor, m.unidad FROM medicion m WHERE m.canal_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3 AND ($4::timestamptz IS NULL OR m.tiempo > $4::timestamptz) ORDER BY m.tiempo LIMIT $5`, [canal, d0, d1, null, 10_000]],
        ['mediciones, tanda del medio de un canal', `SELECT ${ISO_US('m.tiempo')} AS tiempo_utc, m.valor, m.unidad FROM medicion m WHERE m.canal_id = $1 AND m.tiempo >= $2 AND m.tiempo < $3 AND ($4::timestamptz IS NULL OR m.tiempo > $4::timestamptz) ORDER BY m.tiempo LIMIT $5`, [canal, d0, d1, medio, 10_000]],
        ['tramas, tanda del medio de un dispositivo', `SELECT ${ISO_US('t.recibido_en')} AS recibido_en_utc, t.id, t.topico, t.adaptador, octet_length(t.payload) AS bytes, encode(sha256(t.payload), 'hex') AS sha256, translate(encode(t.payload, 'base64'), E'\\n', '') AS payload_base64 FROM trama t WHERE t.dispositivo_id = $1 AND t.recibido_en >= $2 AND t.recibido_en < $3 AND ($4::timestamptz IS NULL OR (t.recibido_en >= $4::timestamptz AND (t.recibido_en, t.id) > ($4::timestamptz, $5::uuid))) ORDER BY t.recibido_en, t.id LIMIT $6`, [dispositivoBanco, d0, d1, tMedio.t, tMedio.id, 250]],
        ['eventos de un dispositivo', `SELECT ${ISO_US('e.ocurrido_en')} AS ocurrido_en_utc, e.id, e.tipo, e.detalle FROM evento e WHERE e.dispositivo_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3 AND ($4::timestamptz IS NULL OR (e.ocurrido_en >= $4::timestamptz AND (e.ocurrido_en, e.id) > ($4::timestamptz, $5::uuid))) ORDER BY e.ocurrido_en, e.id LIMIT $6`, [dispositivoBanco, d0, d1, null, null, 10_000]],
        ['eventos de un dispositivo, tanda siguiente (con clave)', `SELECT ${ISO_US('e.ocurrido_en')} AS ocurrido_en_utc, e.id, e.tipo, e.detalle FROM evento e WHERE e.dispositivo_id = $1 AND e.ocurrido_en >= $2 AND e.ocurrido_en < $3 AND ($4::timestamptz IS NULL OR (e.ocurrido_en >= $4::timestamptz AND (e.ocurrido_en, e.id) > ($4::timestamptz, $5::uuid))) ORDER BY e.ocurrido_en, e.id LIMIT $6`, [dispositivoBanco, d0, d1, eMedio.t, eMedio.id, 10_000]],
        ['estimación, mediciones (tope 1 000 001)', `SELECT count(*)::int AS n FROM (SELECT 1 FROM canal ca JOIN dispositivo d ON d.id = ca.dispositivo_id JOIN zona z ON z.id = d.zona_id CROSS JOIN LATERAL (SELECT 1 FROM medicion m WHERE m.canal_id = ca.id AND m.tiempo >= $2 AND m.tiempo < $3 LIMIT $4) x WHERE z.sitio_id = $1 LIMIT $4) y`, [banco, d0, d1, 1_000_001]],
        ['estimación, tramas', `SELECT count(*)::int AS n FROM (SELECT 1 FROM dispositivo d JOIN zona z ON z.id = d.zona_id CROSS JOIN LATERAL (SELECT 1 FROM trama t WHERE t.dispositivo_id = d.id AND t.recibido_en >= $2 AND t.recibido_en < $3 LIMIT $4) x WHERE z.sitio_id = $1 LIMIT $4) y`, [banco, d0, d1, 1_000_001]],
        ['estimación, trama más antigua', `SELECT min(x.t) AS t FROM dispositivo d JOIN zona z ON z.id = d.zona_id CROSS JOIN LATERAL (SELECT t.recibido_en AS t FROM trama t WHERE t.dispositivo_id = d.id AND t.recibido_en >= $2 AND t.recibido_en < $3 ORDER BY t.recibido_en LIMIT 1) x WHERE z.sitio_id = $1`, [banco, d0, d1]],
      ];
      for (const [titulo, sql, p] of planes) {
        const plan = (await q(`EXPLAIN (ANALYZE, BUFFERS) ${sql}`, p)).rows.map((r) => String(r['QUERY PLAN']));
        const indices = [...new Set(plan.join('\n').match(/(?:Index Only Scan|Bitmap Index Scan|Index Scan|Seq Scan|Bitmap Heap Scan)(?: Backward)?(?: using \S+)? on \S+/g) ?? [])];
        const tiempo = plan.find((l) => l.startsWith('Execution Time'))?.replace('Execution Time: ', '') ?? '?';
        const buffers = plan.find((l) => l.trim().startsWith('Buffers:'))?.trim() ?? '';
        const seq = plan.some((l) => l.includes('Seq Scan on medicion') || l.includes('Seq Scan on _hyper') || l.includes('Seq Scan on trama') || l.includes('Seq Scan on evento'));
        console.log(`      plan · ${titulo}: ${tiempo}; ${buffers}; ${indices.slice(0, 3).join(' · ')}${indices.length > 3 ? ` (+${indices.length - 3})` : ''}`);
        if (process.env.EXPORTAR_PLANES === 'completos') console.log(plan.map((l) => `        ${l}`).join('\n'));
        // Los de medicion y trama van por fragmento (`_hyper_N_M_chunk_<nombre>`); los de evento, con su nombre completo y exacto.
        const [indice, nombreIndice]: [RegExp | null, string] = titulo.startsWith('mediciones') ? [/_chunk_uq_medicion_canal_tiempo(\s|$)/, 'uq_medicion_canal_tiempo']
          : titulo.startsWith('tramas') ? [/_chunk_idx_trama_dispositivo_id(\s|$)/, 'idx_trama_dispositivo_id']
            : titulo === 'eventos de un dispositivo' ? [/Scan on idx_evento_dispositivo_id(\s|$)/, 'idx_evento_dispositivo_id']
              : titulo.startsWith('eventos') ? [/ idx_evento_dispositivo_ocurrido_en_id(\s|$)/, 'idx_evento_dispositivo_ocurrido_en_id'] : [null, ''];
        comprobar(!seq && (indice === null || plan.some((l) => indice.test(l))),
          `plan · ${titulo}: sin recorrido secuencial de medicion, trama ni evento${nombreIndice === '' ? '' : `; por ${nombreIndice}`}`, plan.join(' / ').slice(0, 600));
      }
    }
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
