// Alta masiva por archivo (docs/19 §4, F2; docs/10 §8.4 punto 65 iv): validación completa EN MEMORIA, fila por fila, con la misma
// función del alta de a uno (validarAlta) y los catálogos leídos una vez; el informe dice por qué se rechaza cada fila, y las rechazadas
// no bloquean a las válidas. Función pura: los catálogos los trae el servicio; aquí no hay base ni broker.
import { BadRequestException, PayloadTooLargeException } from '@nestjs/common';
import { AltaValidada, Formato, validarAlta } from './alta.dto.js';

// Una sola constante para el tope (la usan la validación y la documentación del contrato): 500 filas por lote.
export const MAX_FILAS_LOTE = 500;
// Lo que se recomienda al cliente para `modo=crear` (D-103 A, 11/11/2026): tandas de 50 filas (≈ 7 s cada una, docs/16 §61), para que
// ninguna petición se acerque al corte del proxy. El backend no lo exige: el tope sigue en 500.
export const TANDA_CLIENTE_LOTE = 50;
export const MODOS_LOTE = ['validar', 'crear'] as const;
export type ModoLote = (typeof MODOS_LOTE)[number];
export const COLUMNAS_LOTE = ['id_fisico', 'nombre', 'zona', 'via', 'formato', 'intervalo_esperado_s', 'canales', 'pasarela'] as const;

export type Resultado = 'valida' | 'creada' | 'rechazada' | 'existe';
export interface FilaInforme {
  n: number; // la fila del archivo: la 1 es la cabecera del CSV, la primera fila de datos es la 2 (la que la persona ve en su planilla)
  id_fisico: string;
  resultado: Resultado;
  motivo: string | null;
  id: string | null;
  credencial: string | null;
  topico: string | null;
}
export interface ZonaCatalogo { id: string; nombre: string; sitio_id: string; sitio_codigo: string }
export interface PasarelaCatalogo { id: string; id_fisico: string; sitio_id: string; activo: boolean; formato: Formato }
export interface Catalogos {
  zonas: readonly ZonaCatalogo[]; // solo las de los sitios donde quien carga puede dar de alta (las demás «no existen»: RF-41)
  magnitudes: ReadonlyMap<string, string>; // código → unidad canónica
  pasarelas: readonly PasarelaCatalogo[];
  existentes: ReadonlyMap<string, { id: string; estado: string }>; // dispositivos de SUS sitios con el id_fisico de alguna fila
  idsDePasarela: ReadonlySet<string>; // id_fisico ya usados por una pasarela de sus sitios (comparten espacio de nombres: migración 11)
  // id_fisico de alguna fila que ya usa un dispositivo o una pasarela de OTRO sitio: no se revela de quién ni su id ni su estado (RF-41).
  // Sigue sin poder usarse (id_fisico es único en toda la plataforma): la fila se rechaza con un motivo que no dice más.
  ajenos: ReadonlySet<string>;
}
export interface AltaDeLote { n: number; alta: AltaValidada; formato: Formato; sitio_codigo: string }

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const texto = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

export function modoLote(v: unknown): ModoLote {
  if (typeof v === 'string' && (MODOS_LOTE as readonly string[]).includes(v)) return v as ModoLote;
  throw new BadRequestException(`modo debe ser uno de: ${MODOS_LOTE.join(', ')}`);
}

// La forma del cuerpo: `{filas: [...]}` con 1 a 500 objetos. Más de 500 es 413 (el tope que promete la pantalla, probado en el borde).
export function filasDelCuerpo(cuerpo: unknown): Record<string, unknown>[] {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) throw new BadRequestException(['el cuerpo debe ser un objeto JSON con `filas`']);
  const filas = (cuerpo as { filas?: unknown }).filas;
  if (!Array.isArray(filas) || filas.length === 0) throw new BadRequestException(['filas debe ser una lista con al menos una fila']);
  if (filas.length > MAX_FILAS_LOTE) throw new PayloadTooLargeException(`el lote trae ${filas.length} filas y el máximo es ${MAX_FILAS_LOTE}: divídelo`);
  return filas.map((f) => (typeof f === 'object' && f !== null && !Array.isArray(f) ? (f as Record<string, unknown>) : {}));
}

// `canales` como en el CSV: «magnitud:unidad;magnitud:unidad» (la unidad es opcional; si viene, debe ser la canónica del catálogo).
export function leerCanales(v: unknown, magnitudes: ReadonlyMap<string, string>, motivos: string[]): { magnitud: string }[] {
  const t = texto(v);
  if (t === '') {
    motivos.push('canales vacío: «magnitud:unidad;magnitud:unidad»');
    return [];
  }
  const canales: { magnitud: string }[] = [];
  for (const parte of t.split(';').map((x) => x.trim()).filter((x) => x !== '')) {
    const [m = '', u] = parte.split(':').map((x) => x.trim());
    const magnitud = m.toLowerCase();
    const canonica = magnitudes.get(magnitud);
    if (canonica === undefined) motivos.push(`magnitud desconocida: ${magnitud || '(vacía)'}`);
    else if (u !== undefined && u !== '' && u !== canonica) motivos.push(`${magnitud}: la unidad es ${canonica}, no ${u}`);
    canales.push({ magnitud });
  }
  return canales;
}

export function validarLote(filas: readonly Record<string, unknown>[], cat: Catalogos, reservados: readonly string[] = []): { informe: FilaInforme[]; altas: AltaDeLote[] } {
  const informe: FilaInforme[] = [];
  const altas: AltaDeLote[] = [];
  const vistos = new Map<string, number>();
  filas.forEach((f, i) => {
    const n = i + 2;
    const idFisico = texto(f.id_fisico).toLowerCase();
    const fila = (resultado: Resultado, motivo: string | null, id: string | null = null): FilaInforme =>
      ({ n, id_fisico: idFisico, resultado, motivo, id, credencial: null, topico: null });
    const motivos: string[] = [];
    for (const k of Object.keys(f)) if (!(COLUMNAS_LOTE as readonly string[]).includes(k)) motivos.push(`columna no admitida: ${k}`);
    const antes = vistos.get(idFisico);
    if (idFisico !== '' && antes !== undefined) {
      informe.push(fila('rechazada', `id_fisico repetido: ya está en la fila ${antes}`));
      return;
    }
    if (idFisico !== '') vistos.set(idFisico, n);
    if (cat.ajenos.has(idFisico)) {
      informe.push(fila('rechazada', 'identificador no disponible'));
      return;
    }
    const existente = cat.existentes.get(idFisico);
    if (existente !== undefined) {
      const remedio = existente.estado === 'activo' ? '' : `; está en ${existente.estado}: reactivarlo desde su ficha`;
      informe.push(fila('existe', `ya está dado de alta${remedio}`, existente.id));
      return;
    }
    if (cat.idsDePasarela.has(idFisico)) motivos.push(`id_fisico «${idFisico}» ya lo usa una pasarela`);

    // Zona: su UUID o su nombre, entre las zonas de los sitios donde quien carga puede dar de alta.
    const z = texto(f.zona);
    const candidatas = UUID.test(z) ? cat.zonas.filter((x) => x.id === z.toLowerCase()) : cat.zonas.filter((x) => x.nombre.toLowerCase() === z.toLowerCase());
    let zona: ZonaCatalogo | undefined;
    if (z === '') motivos.push('zona vacía');
    else if (candidatas.length === 0) motivos.push(`zona «${z}» no existe en tus sitios`);
    else if (candidatas.length > 1) motivos.push(`zona «${z}» existe en más de un sitio: usa su id`);
    else zona = candidatas[0];

    const via = texto(f.via).toLowerCase() || 'mqtt';
    // Pasarela (solo lorawan): su id_fisico o su UUID, del mismo sitio y activa; el nodo hereda su formato.
    const p = texto(f.pasarela);
    let pasarela: PasarelaCatalogo | undefined;
    if (p !== '') {
      pasarela = cat.pasarelas.find((x) => (UUID.test(p) ? x.id === p.toLowerCase() : x.id_fisico === p.toLowerCase()));
      if (pasarela === undefined) motivos.push(`pasarela «${p}» no existe`);
      else if (zona !== undefined && pasarela.sitio_id !== zona.sitio_id) motivos.push(`la pasarela ${pasarela.id_fisico} pertenece a otro sitio`);
      else if (!pasarela.activo) motivos.push(`la pasarela ${pasarela.id_fisico} está dada de baja`);
    }
    let formato: string | undefined = texto(f.formato).toLowerCase() || undefined;
    if (via === 'lorawan' && formato !== undefined) {
      if (pasarela !== undefined && formato !== pasarela.formato) motivos.push(`formato: un nodo lorawan hereda el de su pasarela (${pasarela.formato})`);
      formato = undefined;
    }
    const canales = leerCanales(f.canales, cat.magnitudes, motivos);
    const intervaloTexto = texto(f.intervalo_esperado_s);
    const cuerpo: Record<string, unknown> = {
      id_fisico: idFisico, nombre: texto(f.nombre), zona_id: zona?.id ?? '00000000-0000-0000-0000-000000000000', via,
      intervalo_esperado_s: /^\d+$/.test(intervaloTexto) ? Number(intervaloTexto) : intervaloTexto, canales,
    };
    if (formato !== undefined) cuerpo.formato = formato;
    if (p !== '') cuerpo.pasarela_id = pasarela?.id ?? p;
    // La misma validación del alta de a uno (forma del id_fisico, reservados, vía, formato, intervalo, canales repetidos…).
    let alta: AltaValidada | undefined;
    try {
      alta = validarAlta(cuerpo, reservados);
    } catch (e) {
      const r = e instanceof BadRequestException ? (e.getResponse() as { message?: unknown }).message : undefined;
      const lista: string[] = Array.isArray(r) ? r.map((x) => (typeof x === 'string' ? x : JSON.stringify(x))) : [typeof r === 'string' ? r : (e as Error).message];
      for (const m of lista) if (!motivos.includes(m)) motivos.push(m);
    }
    if (motivos.length > 0 || alta === undefined || zona === undefined) {
      informe.push(fila('rechazada', motivos.join('; ') || 'fila inválida'));
      return;
    }
    altas.push({ n, alta, formato: alta.formato ?? pasarela?.formato ?? 'senml', sitio_codigo: zona.sitio_codigo });
    informe.push(fila('valida', null));
  });
  return { informe, altas };
}

export function totales(informe: readonly FilaInforme[]): { validas: number; rechazadas: number; existentes: number } {
  return {
    validas: informe.filter((f) => f.resultado === 'valida' || f.resultado === 'creada').length,
    rechazadas: informe.filter((f) => f.resultado === 'rechazada').length,
    existentes: informe.filter((f) => f.resultado === 'existe').length,
  };
}

// Límite de tasa del lote (docs/11 §4): como mucho LOTES_POR_MINUTO peticiones por persona en una ventana deslizante de un minuto. En la
// memoria del proceso: con varias instancias no vale (docs/11 §4, fila del alta masiva).
export const LOTES_POR_MINUTO = 10;
export class TasaPorPersona {
  private readonly marcas = new Map<string, number[]>();
  constructor(private readonly tope = LOTES_POR_MINUTO, private readonly ventanaMs = 60_000) {}
  // true = se admite (y se anota); false = se pasó del tope.
  admitir(clave: string, ahora = Date.now()): boolean {
    const vivas = (this.marcas.get(clave) ?? []).filter((t) => ahora - t < this.ventanaMs);
    if (vivas.length >= this.tope) {
      this.marcas.set(clave, vivas);
      return false;
    }
    vivas.push(ahora);
    this.marcas.set(clave, vivas);
    if (this.marcas.size > 1000) for (const [k, v] of this.marcas) if (v.every((t) => ahora - t >= this.ventanaMs)) this.marcas.delete(k);
    return true;
  }
}
