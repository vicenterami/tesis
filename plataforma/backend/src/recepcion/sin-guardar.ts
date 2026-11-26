// «Lo que la trama trae y no se guarda» (docs/10 §8.4 punto 72 i; docs/19 §4 AA, punto 6): se releen las tramas ya retenidas de un equipo
// (las aceptadas de `trama` y las rechazadas de `cuarentena`) con el adaptador de su formato, igual que en la recepción pero sin escribir
// nada, y se juntan las claves que traen y el equipo no guarda. Nada nuevo se persiste: lo que se ve vence con la retención de las tramas.
// Aquí, lo puro (sin base): recibe las filas y el contexto del equipo, devuelve la lista.
import type { Adaptador } from './adaptadores/adaptador.js';
import { DestinoClave, resolverDesde } from './adaptadores/mapa-claves.js';
import type { Receta } from './adaptadores/receta.js';
import { ContextoTrama, Lectura, MAGNITUDES_ENLACE } from './lectura.js';
import { limpia } from './texto.js';

export const MAX_TRAMAS_SIN_GUARDAR = 20; // las tramas más recientes que se releen por petición
export const MAX_CLAVES_SIN_GUARDAR = 50;
export const TOPE_SIN_GUARDAR_MS = 5_000; // statement_timeout de la relectura, en el servidor (docs/10 §8.4 punto 72 i)
export const MAX_SIN_GUARDAR_EN_CURSO = 1; // relecturas simultáneas por proceso; otra, 429
export const ESPERA_SIN_GUARDAR_MS = 10_000; // una relectura cada 10 s por persona y equipo; antes, 429
const MAX_CLAVE = 32; // como en la línea de registro de la trama: recortada y sin caracteres invisibles

export interface FilaRetenida { payload: Buffer; topico: string; recibido_en: Date }
export interface EquipoSinGuardar {
  formato: string; idFisico: string; declaradas: readonly string[]; catalogo: ReadonlySet<string>;
  decodificador: string | null; receta: Receta | null; alias: Record<string, DestinoClave> | null;
}
export interface ClaveSinGuardar {
  clave: string;
  magnitud: string | null; // la magnitud del catálogo que la recibiría; null = sin magnitud en el catálogo (ni alias)
  valor: number | null; // el último valor NUMÉRICO visto; un texto no se muestra
  unidad: string | null;
  visto: string; // instante de recepción de la trama más reciente que la trajo (ISO 8601 UTC)
  origen: 'carga' | 'enlace';
}

// La magnitud del tópico directo (sitio/<s>/dispositivo/<id>/<magnitud>): la necesita el formato «plano».
const MAGNITUD_TOPICO = /^sitio\/[^/]+\/dispositivo\/[^/]+\/([^/]+)$/;
const numero = (v: unknown): number | null => (typeof v === 'number' && Number.isFinite(v) ? v : null);

// Los valores de las claves fuera del mapa, del cuerpo JSON (en ChirpStack, de `object`; en Milesight, del cuerpo), leídos UNA vez por
// trama (corrección del 25/11/2026: leerlo por cada clave eran miles de JSON.parse de hasta 64 KiB por petición). Solo números.
function fuenteDeValores(formato: string, carga: Buffer): Record<string, unknown> | null {
  try {
    const v = JSON.parse(carga.toString('utf8')) as Record<string, unknown> | null;
    const fuente = formato === 'chirpstack' ? v?.object : v;
    return typeof fuente === 'object' && fuente !== null && !Array.isArray(fuente) ? (fuente as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}
const valorDe = (fuente: Record<string, unknown> | null, clave: string): number | null =>
  fuente !== null && Object.prototype.hasOwnProperty.call(fuente, clave) ? numero(fuente[clave]) : null;

export function clavesSinGuardar(filas: readonly FilaRetenida[], e: EquipoSinGuardar, adaptadores: ReadonlyMap<string, Adaptador>): ClaveSinGuardar[] {
  const adaptador = adaptadores.get(e.formato);
  if (adaptador === undefined) return [];
  const dePasarela = e.formato === 'chirpstack' || e.formato === 'milesight';
  const resolver = resolverDesde(dePasarela ? e.alias : null);
  // Dos grupos, cada uno hasta el tope (corrección del 25/11/2026): primero la señal del enlace y las claves con magnitud en el catálogo
  // (las que se pueden agregar), después las que no la tienen. Así miles de claves desconocidas no dejan fuera la señal.
  const conMagnitud = new Map<string, ClaveSinGuardar>();
  const sinMagnitud = new Map<string, ClaveSinGuardar>();
  const vista = (clave: string): boolean => conMagnitud.has(clave) || sinMagnitud.has(clave);
  const agregar = (c: ClaveSinGuardar): void => {
    const grupo = c.magnitud !== null ? conMagnitud : sinMagnitud;
    if (grupo.size < MAX_CLAVES_SIN_GUARDAR && !vista(c.clave)) grupo.set(c.clave, c);
  };
  // De la más reciente a la más antigua: la primera vez que aparece una clave, es su último valor.
  for (const f of [...filas].sort((a, b) => b.recibido_en.getTime() - a.recibido_en.getTime())) {
    const ctx: ContextoTrama = {
      topico: f.topico, idFisico: e.idFisico, magnitudTopico: (MAGNITUD_TOPICO.exec(f.topico)?.[1] ?? '').toLowerCase(), carga: f.payload,
      recibidoEn: f.recibido_en, deveui: dePasarela ? e.idFisico : undefined, decodificador: e.decodificador ?? undefined,
      receta: e.receta ?? undefined, resolver,
    };
    let lecturas: Lectura[] = [];
    try {
      if (!adaptador.reconoce(ctx)) continue;
      lecturas = adaptador.analizar(ctx);
    } catch {
      // Una trama que no se entiende no ofrece lecturas; las claves fuera del mapa que alcanzó a anotar («ninguna clave conocida»), sí.
    }
    const visto = f.recibido_en.toISOString();
    for (const m of MAGNITUDES_ENLACE) {
      const v = ctx.enlace?.[m];
      if (v !== undefined && !e.declaradas.includes(m)) agregar({ clave: m, magnitud: e.catalogo.has(m) ? m : null, valor: v, unidad: m === 'rssi' ? 'dBm' : 'dB', visto, origen: 'enlace' });
    }
    for (const l of lecturas) {
      if (e.declaradas.includes(l.magnitud)) continue;
      const enCatalogo = e.catalogo.has(l.magnitud);
      agregar({ clave: limpia(l.magnitud, MAX_CLAVE), magnitud: enCatalogo ? l.magnitud : null, valor: numero(l.valor), unidad: l.unidad ?? null, visto, origen: 'carga' });
    }
    // Las claves fuera del mapa: se muestran limpias, y el valor se busca con la clave tal como llegó (la limpia puede no existir en la carga).
    const ignoradas = ctx.ignoradas ?? [];
    const crudas = ctx.ignoradasCrudas ?? [];
    const nuevas = ignoradas.map((k, i) => [k, crudas[i] ?? k] as const).filter(([k]) => !k.endsWith(' (repetida)') && !vista(k));
    if (nuevas.length > 0 && sinMagnitud.size < MAX_CLAVES_SIN_GUARDAR) {
      const fuente = fuenteDeValores(e.formato, f.payload);
      for (const [k, cruda] of nuevas) agregar({ clave: k, magnitud: null, valor: valorDe(fuente, cruda), unidad: null, visto, origen: 'carga' });
    }
  }
  return [...conMagnitud.values(), ...sinMagnitud.values()].slice(0, MAX_CLAVES_SIN_GUARDAR);
}
