<script lang="ts">
  // Gráfico uPlot (docs/07, docs/19 P1, P3 y P3b). En la ficha, «promedio» del histórico agregado y «lectura actual» con lo que llega en
  // vivo; en la comparación, una serie por dispositivo (`lineas`); en el tablero, el promedio del sitio con su banda y las tramas por
  // cubo como barras. Las horas del eje van en la zona del sitio (docs/13). uPlot se carga aquí con import dinámico: lo que no dibuja
  // (el inventario, la entrada desde un teléfono) no descarga sus 51 KB.
  // El gráfico se crea UNA vez por montaje y después solo recibe datos (`setData`): sin `untrack`, el efecto que lo crea dependería de
  // `series` y lo destruiría y recrearía en cada lote de lecturas. Título, unidad, zona, líneas, banda y barras se leen al crear: quien
  // los cambie debe montar un componente nuevo ({#key}). Umbrales, histéresis y franjas se leen en cada dibujo (cambian sin recrear).
  // `ventana` (segundos Unix) fija el eje de tiempo a la ventana pedida, también sin puntos (docs/19 §4, incremento 2, punto 2).
  // Colores (docs/19 §4, tablero v2, A3): las series los traen de quien llama (lib/tema.ts); ejes, rejilla, umbrales y franjas, del tema
  // vigente (`temaVivo`: al cambiar el tema, el gráfico se crea de nuevo con los colores nuevos); nunca dos ejes verticales.
  // Texto alternativo (WCAG 1.1.1 y 1.3.1; corrección del 11/11/2026): el lienzo es una imagen con nombre (título y resumen del rango:
  // mínimo, máximo, último y cuántos puntos) y, debajo, «Ver los datos» abre una tabla con un renglón por cubo y una columna por serie
  // (con mínimo y máximo cuando hay banda). La tabla se arma solo al abrirla: con 2 500 puntos no pesa mientras está cerrada.
  import { untrack } from 'svelte';
  import type uPlotTipo from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { EJE_TIEMPO, NOMBRES_FECHA, SELLO_LEYENDA, formatearNumero, resumenRango } from './lib/grafico';
  import { LIENZO, colorLecturaActual, colorPromedio, temaVivo, type Tema } from './lib/tema';
  import { fechaHora } from './lib/tiempo';

  import { cargarUplot } from './lib/cargar-uplot';

  export interface Linea {
    label: string;
    stroke: string;
    width: number;
    puntos?: boolean;
    // El valor que la leyenda muestra para el cubo i (por defecto, el de la serie): las barras apiladas muestran el propio, no la suma.
    leyenda?: (i: number) => string;
  }
  export interface Umbral {
    valor: number;
    etiqueta: string;
  }
  export interface Franja {
    desde: number; // segundos Unix
    hasta: number;
    etiqueta: string;
  }

  let {
    series,
    unidad,
    zona,
    titulo,
    lineas = null,
    ventana = null,
    banda = null,
    barras = false,
    umbrales = [],
    histeresis = [],
    franjas = [],
    alSeleccionar = null,
    alDobleClic = null,
    sincronizar = null,
    alto = 280,
  }: {
    series: (number | null)[][];
    unidad: string;
    zona: string;
    titulo: string;
    lineas?: Linea[] | null;
    ventana?: { desde: number; hasta: number } | null;
    // Banda mín–máx del mismo matiz al 15 % (tablero v2, B4b y D3): índices de las series alta y baja.
    banda?: { alta: number; baja: number; color: string } | null;
    barras?: boolean;
    umbrales?: Umbral[];
    histeresis?: { baja: number; alta: number }[];
    franjas?: Franja[];
    // Zoom por arrastre que refina (D1): quien llama pide la ventana nueva; el gráfico no cambia su escala por su cuenta.
    alSeleccionar?: ((desde: number, hasta: number) => void) | null;
    alDobleClic?: (() => void) | null;
    sincronizar?: string | null;
    alto?: number;
  } = $props();
  let contenedor: HTMLDivElement | undefined = $state();
  let grafico: uPlotTipo | undefined;
  let listo = $state(false); // reactivo: el efecto de datos corre también cuando el gráfico recién existe
  let ventanaVigente: { desde: number; hasta: number } | null = null; // la lee la función de rango; se pone al día antes de cada setData
  // Lo que se dibuja encima (umbrales, histéresis, franjas): se lee en el gancho de dibujo, así un cambio no recrea el gráfico.
  let encima = { umbrales: [] as Umbral[], histeresis: [] as { baja: number; alta: number }[], franjas: [] as Franja[] };

  function rangoX(_u: uPlotTipo, min: number | null, max: number | null): uPlotTipo.Range.MinMax {
    const w = ventanaVigente;
    if (w === null) return [min, max];
    return [min === null ? w.desde : Math.min(min, w.desde), max === null ? w.hasta : Math.max(max, w.hasta)];
  }

  // Encima de las series: franjas de condiciones (verticales), banda de histéresis y líneas de umbral con su etiqueta (D4).
  function dibujarEncima(u: uPlotTipo, colores: (typeof LIENZO)['claro']): void {
    const { ctx, bbox } = u;
    const pr = devicePixelRatio || 1;
    ctx.save();
    ctx.beginPath();
    ctx.rect(bbox.left, bbox.top, bbox.width, bbox.height);
    ctx.clip();
    for (const f of encima.franjas) {
      const x0 = Math.max(bbox.left, u.valToPos(f.desde, 'x', true));
      const x1 = Math.min(bbox.left + bbox.width, u.valToPos(f.hasta, 'x', true));
      if (x1 <= x0) continue;
      ctx.fillStyle = colores.franja;
      ctx.fillRect(x0, bbox.top, x1 - x0, bbox.height);
    }
    for (const h of encima.histeresis) {
      const y0 = u.valToPos(h.alta, 'y', true);
      const y1 = u.valToPos(h.baja, 'y', true);
      ctx.fillStyle = colores.histeresis;
      ctx.fillRect(bbox.left, Math.min(y0, y1), bbox.width, Math.abs(y1 - y0));
    }
    ctx.strokeStyle = colores.umbral;
    ctx.fillStyle = colores.umbral;
    ctx.lineWidth = 1.5 * pr;
    ctx.setLineDash([6 * pr, 4 * pr]);
    ctx.font = `${12 * pr}px system-ui, sans-serif`;
    for (const t of encima.umbrales) {
      const y = u.valToPos(t.valor, 'y', true);
      ctx.beginPath();
      ctx.moveTo(bbox.left, y);
      ctx.lineTo(bbox.left + bbox.width, y);
      ctx.stroke();
      ctx.fillText(t.etiqueta, bbox.left + 4 * pr, y - 4 * pr);
    }
    ctx.restore();
  }

  function opciones(UPlot: typeof uPlotTipo, ancho: number, tema: Tema): uPlotTipo.Options {
    const colores = LIENZO[tema];
    const lista = lineas ?? [
      { label: 'promedio', stroke: colorPromedio(tema), width: 2 },
      { label: 'lectura actual', stroke: colorLecturaActual(tema), width: 0, puntos: true },
    ];
    const valor = (v: number | null): string => (v === null || v === undefined ? '—' : `${formatearNumero(v)} ${unidad}`);
    const barrasCamino = barras && typeof UPlot.paths?.bars === 'function' ? UPlot.paths.bars({ size: [0.7, 40] }) : undefined;
    const lineasUplot: uPlotTipo.Series[] = lista.map((l) => ({
      label: l.label,
      stroke: l.stroke,
      width: l.width,
      value: (_u: uPlotTipo, v: number | null, _s: number, i: number | null) => (l.leyenda !== undefined && i !== null ? l.leyenda(i) : valor(v)),
      ...(l.puntos ? { points: { show: true, size: 6 } } : {}),
      ...(barrasCamino !== undefined ? { paths: barrasCamino, fill: l.stroke, points: { show: false } } : {}),
    }));
    // La banda: sus dos series de borde existen (la leyenda muestra mín y máx bajo el cursor) sin trazo propio.
    const bandas: uPlotTipo.Band[] = banda === null ? [] : [{ series: [banda.alta, banda.baja], fill: `${banda.color}26` }];
    const eje = { stroke: colores.texto, grid: { stroke: colores.rejilla }, ticks: { stroke: colores.rejilla } };
    return {
      title: titulo,
      width: ancho,
      height: alto,
      tzDate: (ts) => UPlot.tzDate(new Date(ts * 1000), zona),
      fmtDate: (tpl) => UPlot.fmtDate(tpl, NOMBRES_FECHA), // meses y días en español (docs/19 §6)
      scales: { x: { time: true, range: rangoX as uPlotTipo.Scale.Range } },
      series: [{ label: 'Hora', value: SELLO_LEYENDA }, ...lineasUplot],
      bands: bandas,
      axes: [{ values: EJE_TIEMPO, ...eje }, { label: unidad, ...eje }],
      cursor: {
        ...(sincronizar !== null ? { sync: { key: sincronizar } } : {}),
        ...(alSeleccionar !== null ? { drag: { x: true, y: false, setScale: false } } : {}),
      },
      hooks: {
        draw: [(u: uPlotTipo) => dibujarEncima(u, colores)],
        ...(alSeleccionar !== null
          ? {
              setSelect: [
                (u: uPlotTipo) => {
                  const { left, width } = u.select;
                  if (width < 3) return; // un clic no es un arrastre
                  const desde = u.posToVal(left, 'x');
                  const hasta = u.posToVal(left + width, 'x');
                  u.setSelect({ left: 0, top: 0, width: 0, height: 0 }, false);
                  alSeleccionar?.(desde, hasta);
                },
              ],
            }
          : {}),
      },
    };
  }

  $effect(() => {
    if (contenedor === undefined) return;
    const el = contenedor;
    const tema = $temaVivo; // leído aquí, con seguimiento: otro tema recrea el gráfico
    let activo = true;
    let observador: ResizeObserver | undefined;
    const doble = (): void => alDobleClic?.();
    void cargarUplot().then((UPlot) => {
      if (!activo) return;
      ventanaVigente = untrack(() => ventana);
      encima = untrack(() => ({ umbrales, histeresis, franjas }));
      grafico = new UPlot(untrack(() => opciones(UPlot, el.clientWidth || 600, tema)), untrack(() => series) as uPlotTipo.AlignedData, el);
      grafico.over?.addEventListener('dblclick', doble);
      observador = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => grafico?.setSize({ width: el.clientWidth, height: untrack(() => alto) }));
      observador?.observe(el);
      listo = true;
    });
    return () => {
      activo = false;
      observador?.disconnect();
      grafico?.over?.removeEventListener('dblclick', doble);
      grafico?.destroy();
      grafico = undefined;
      listo = false;
    };
  });

  $effect(() => {
    const w = ventana;
    const s = series;
    if (!listo) return;
    ventanaVigente = w;
    grafico?.setData(s as uPlotTipo.AlignedData);
  });
  $effect(() => {
    const e = { umbrales, histeresis, franjas };
    if (!listo) return;
    encima = e;
    grafico?.redraw?.(false, false);
  });

  // Texto alternativo y tabla de datos.
  const nombres = $derived((lineas ?? [{ label: 'promedio' }, { label: 'lectura actual' }]).map((l) => l.label));
  const valorTexto = (v: number | null | undefined): string => (v === null || v === undefined || !Number.isFinite(v) ? '—' : `${formatearNumero(v)} ${unidad}`);
  const descripcion = $derived.by(() => {
    const valores = series[1] ?? [];
    const r = resumenRango(valores);
    if (r === null) return `${titulo}: sin datos en el rango.`;
    let ultimo: number | null = null;
    for (let i = valores.length - 1; i >= 0 && ultimo === null; i--) ultimo = valores[i] ?? null;
    return `${titulo}: ${nombres[0] ?? 'serie'} entre ${valorTexto(r.min)} y ${valorTexto(r.max)}, último ${valorTexto(ultimo)}, ${r.n} ${r.n === 1 ? 'punto' : 'puntos'}.`;
  });
  let datosAbiertos = $state(false);
  const celda = (s: number, i: number): string => {
    const l = lineas?.[s - 1];
    if (l?.leyenda !== undefined) return l.leyenda(i);
    return valorTexto(series[s]?.[i]);
  };
</script>

<div
  class="grafico"
  class:pequeno={alto < 250}
  bind:this={contenedor}
  role="img"
  aria-label={descripcion}
  data-puntos={series[0]?.length ?? 0}
  data-series={(lineas ?? [0, 0]).length}
  data-umbrales={umbrales.length}
  data-franjas={franjas.length}
  data-banda={banda !== null}
></div>
<details class="datos-grafico" ontoggle={(e) => (datosAbiertos = e.currentTarget.open)} data-datos-grafico>
  <summary>Ver los datos</summary>
  {#if datosAbiertos}
    <div class="tabla-desplazable">
      <table data-tabla-grafico>
        <caption class="solo-lector">{titulo}</caption>
        <thead><tr><th scope="col">Hora ({zona})</th>{#each nombres as n, k (k)}<th scope="col">{n} ({unidad})</th>{/each}</tr></thead>
        <tbody>
          {#each series[0] ?? [] as t, i (i)}
            <tr><th scope="row">{t === null ? '—' : fechaHora(new Date(t * 1000).toISOString(), zona)}</th>{#each nombres as _n, k (k)}<td>{celda(k + 1, i)}</td>{/each}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</details>
