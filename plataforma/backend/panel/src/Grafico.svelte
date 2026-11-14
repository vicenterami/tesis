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
  // Tablero v3 (docs/19 §4, bloque L, punto 4): (b) el lienzo no repite el título: el título es el de la sección (o el que se pide con
  // `tituloVisible`, una sola línea), y `titulo` queda como nombre accesible y título de la tabla; (c) sin la tabla de leyenda de uPlot:
  // una etiqueta flotante propia, sobre su gancho del cursor, solo en el gráfico bajo el puntero (los sincronizados muestran la línea del
  // cursor), que se quita al salir, con Escape, al desplazar la página o al tocar fuera; con más de una serie, una leyenda fija de
  // nombres con su color; (d) puntos solo con 30 o menos y nunca en los bordes de la banda; (e) `enteros`: eje de enteros desde 0 (las
  // tramas); (g) alto según la pantalla (280 px; 200 px en un teléfono) si no se pide otro.
  // Promedio del sitio (docs/19 §4, M3): con `aportes` (cuántos dispositivos aportan en cada punto), la etiqueta flotante suma la fila
  // «aportan: 3 dispositivos» y «Ver los datos», una columna con lo mismo. Sin `aportes` (la ficha, la comparación), nada cambia.
  import { untrack } from 'svelte';
  import type uPlotTipo from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { EJE_TIEMPO, MAX_PUNTOS_DIBUJADOS, NOMBRES_FECHA, SELLO_LEYENDA, altoGrafico, decimalesDeSeries, filasEtiqueta, formatearNumero, horaEtiqueta, resumenRango, textoAportan, type FilaEtiqueta } from './lib/grafico';
  import { LIENZO, colorLecturaActual, colorPromedio, temaVivo, type Tema } from './lib/tema';
  import { fechaHora } from './lib/tiempo';

  import { cargarUplot } from './lib/cargar-uplot';

  export interface Linea {
    label: string;
    stroke: string;
    width: number;
    puntos?: boolean;
    // El valor que la etiqueta muestra para el cubo i (por defecto, el de la serie): las barras apiladas muestran el propio, no la suma.
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
    tituloVisible = false,
    lineas = null,
    ventana = null,
    banda = null,
    barras = false,
    enteros = false,
    umbrales = [],
    histeresis = [],
    franjas = [],
    alSeleccionar = null,
    alDobleClic = null,
    sincronizar = null,
    alto = null,
    aportes = null,
  }: {
    series: (number | null)[][];
    unidad: string;
    zona: string;
    titulo: string;
    tituloVisible?: boolean;
    lineas?: Linea[] | null;
    ventana?: { desde: number; hasta: number } | null;
    // Banda mín–máx del mismo matiz al 15 % (tablero v2, B4b y D3): índices de las series alta y baja.
    banda?: { alta: number; baja: number; color: string } | null;
    barras?: boolean;
    enteros?: boolean;
    umbrales?: Umbral[];
    histeresis?: { baja: number; alta: number }[];
    franjas?: Franja[];
    // Zoom por arrastre que refina (D1): quien llama pide la ventana nueva; el gráfico no cambia su escala por su cuenta.
    alSeleccionar?: ((desde: number, hasta: number) => void) | null;
    alDobleClic?: (() => void) | null;
    sincronizar?: string | null;
    alto?: number | null;
    // Cuántos dispositivos aportan en cada punto, alineado con `series[0]` (el promedio del sitio, M3).
    aportes?: (number | null)[] | null;
  } = $props();
  let marco: HTMLDivElement | undefined = $state();
  let contenedor: HTMLDivElement | undefined = $state();
  let grafico: uPlotTipo | undefined;
  let listo = $state(false); // reactivo: el efecto de datos corre también cuando el gráfico recién existe
  let ventanaVigente: { desde: number; hasta: number } | null = null; // la lee la función de rango; se pone al día antes de cada setData
  // Lo que se dibuja encima (umbrales, histéresis, franjas): se lee en el gancho de dibujo, así un cambio no recrea el gráfico.
  let encima = { umbrales: [] as Umbral[], histeresis: [] as { baja: number; alta: number }[], franjas: [] as Franja[] };
  // El alto reservado antes de que uPlot cargue (sin saltos: el hueco mide lo que medirá el gráfico).
  const altoInicial = untrack(() => alto ?? altoGrafico(typeof window === 'undefined' ? 0 : Math.min(window.innerWidth, 1200)));
  let altoVigente = $state(altoInicial);

  const lista = $derived<Linea[]>(lineas ?? [
    { label: 'promedio', stroke: colorPromedio($temaVivo), width: 2 },
    { label: 'lectura actual', stroke: colorLecturaActual($temaVivo), width: 0, puntos: true },
  ]);
  const esBorde = (s: number): boolean => banda !== null && (s === banda.alta || s === banda.baja);
  // Los decimales de la etiqueta flotante (L4c): los que distinguen dos valores de lo dibujado, los mismos para todas sus filas.
  const decimales = $derived(decimalesDeSeries(series));

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

  // ── Etiqueta flotante (L4c) ───────────────────────────────────────────────────────────────────────────────────────────────────────
  // Solo el gráfico que tiene el puntero (o el último toque) la muestra; los demás, sincronizados, reciben el mismo gancho y la callan.
  let bajoPuntero = false;
  // Tras un toque, el navegador emula el ratón y en algún momento da un `mouseleave` que no es «el puntero se fue» (y uPlot, al recibirlo,
  // esconde su cursor): mientras el último puntero fue un dedo, eso no quita la etiqueta (con el dedo, se va al tocar fuera o al desplazar);
  // un ratón de verdad lo restablece.
  let conDedo = false;
  let etiqueta = $state<{ x: number; y: number; derecha: boolean; arriba: boolean; hora: string; filas: FilaEtiqueta[] } | null>(null);
  let etiquetaEl: HTMLDivElement | undefined = $state();
  // Junto al punto y nunca fuera del gráfico: se mide la etiqueta ya dibujada y se acota a su marco (en un teléfono, una etiqueta anclada
  // a la derecha del punto se salía por la izquierda; lo mostró la prueba con pantalla táctil).
  $effect(() => {
    const e = etiqueta;
    const el = etiquetaEl;
    if (e === null || el === undefined || marco === undefined) return;
    const w = el.offsetWidth;
    const h = el.offsetHeight;
    const W = marco.clientWidth;
    const H = marco.clientHeight;
    const x = e.derecha ? e.x - 12 - w : e.x + 12;
    const y = e.arriba ? e.y - 12 - h : e.y + 12;
    el.style.left = `${Math.max(0, Math.min(x, W - w))}px`;
    el.style.top = `${Math.max(0, Math.min(y, H - h))}px`;
  });
  function quitarEtiqueta(): void {
    etiqueta = null;
  }
  function alMoverCursor(u: uPlotTipo): void {
    const i = u.cursor.idx;
    const left = u.cursor.left ?? -1;
    const top = u.cursor.top ?? -1;
    if (conDedo && left < 0 && etiqueta !== null) return; // el `mouseleave` emulado tras un toque: la etiqueta se queda en su punto
    if (!bajoPuntero || i === null || i === undefined || left < 0 || marco === undefined) {
      if (etiqueta !== null) etiqueta = null;
      return;
    }
    const t = (u.data[0] as number[])[i];
    if (t === undefined || t === null) return;
    // La posición del área de dibujo dentro del marco: la etiqueta va junto al punto y nunca se sale (se ancla al lado que tiene espacio).
    const m = marco.getBoundingClientRect();
    const o = u.over.getBoundingClientRect();
    const x = o.left - m.left + left;
    const y = o.top - m.top + top;
    etiqueta = {
      x, y, derecha: left > o.width / 2, arriba: top > o.height / 2,
      hora: horaEtiqueta(t, zona),
      filas: filasEtiqueta(untrack(() => series), untrack(() => lista), untrack(() => banda), i, unidad, untrack(() => decimales), untrack(() => aportes)),
    };
  }

  function opciones(UPlot: typeof uPlotTipo, ancho: number, tema: Tema): uPlotTipo.Options {
    const colores = LIENZO[tema];
    const barrasCamino = barras && typeof UPlot.paths?.bars === 'function' ? UPlot.paths.bars({ size: [0.7, 40] }) : undefined;
    const pocos = (_u: uPlotTipo, _s: number, i0: number, i1: number): boolean => i1 - i0 + 1 <= MAX_PUNTOS_DIBUJADOS;
    const lineasUplot: uPlotTipo.Series[] = lista.map((l, k) => ({
      label: l.label,
      stroke: l.stroke,
      width: l.width,
      // Los bordes de la banda nunca llevan puntos; la serie principal, solo con 30 o menos; «lectura actual» (sin línea), siempre.
      points: esBorde(k + 1) ? { show: false } : l.puntos ? { show: true, size: 6 } : { show: pocos, size: 5 },
      ...(barrasCamino !== undefined ? { paths: barrasCamino, fill: l.stroke, points: { show: false } } : {}),
    }));
    // La banda: sus dos series de borde existen (la etiqueta muestra mín y máx bajo el cursor) sin trazo propio.
    const bandas: uPlotTipo.Band[] = banda === null ? [] : [{ series: [banda.alta, banda.baja], fill: `${banda.color}26` }];
    const eje = { stroke: colores.texto, grid: { stroke: colores.rejilla, width: 1 }, ticks: { stroke: colores.rejilla, width: 1 } };
    // El eje vertical mide lo que sus números (no los 50 px fijos de uPlot más 30 del rótulo): en un teléfono, el área de dibujo gana ancho.
    const anchoEjeY = (_u: uPlotTipo, v: string[] | null): number => Math.max(28, ...(v ?? []).map((x) => String(x).length * 7.5)) + 10;
    const comunY = { label: unidad, labelSize: 18, labelGap: 2, size: anchoEjeY, ...eje, values: (_u: uPlotTipo, v: number[]) => v.map((x) => formatearNumero(x)) };
    const ejeY: uPlotTipo.Axis = enteros ? { ...comunY, incrs: [1, 2, 5, 10, 20, 50, 100, 200, 500, 1000, 2000, 5000, 10_000, 20_000, 50_000, 100_000] } : comunY;
    return {
      width: ancho,
      height: altoVigente,
      tzDate: (ts) => UPlot.tzDate(new Date(ts * 1000), zona),
      fmtDate: (tpl) => UPlot.fmtDate(tpl, NOMBRES_FECHA), // meses y días en español (docs/19 §6)
      scales: {
        x: { time: true, range: rangoX as uPlotTipo.Scale.Range },
        ...(enteros ? { y: { range: (_u: uPlotTipo, _min: number, max: number): uPlotTipo.Range.MinMax => [0, Math.max(1, Math.ceil(max))] } } : {}),
      },
      series: [{ label: 'Hora', value: SELLO_LEYENDA }, ...lineasUplot],
      bands: bandas,
      legend: { show: false },
      axes: [{ values: EJE_TIEMPO, ...eje }, ejeY],
      cursor: {
        ...(sincronizar !== null ? { sync: { key: sincronizar } } : {}),
        ...(alSeleccionar !== null ? { drag: { x: true, y: false, setScale: false } } : {}),
      },
      hooks: {
        draw: [(u: uPlotTipo) => dibujarEncima(u, colores)],
        setCursor: [alMoverCursor],
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
    const entra = (e?: Event): void => {
      bajoPuntero = true;
      if ((e as PointerEvent | undefined)?.pointerType === 'touch') conDedo = true;
    };
    const mueveRaton = (e: PointerEvent): void => {
      if (e.pointerType === 'mouse') conDedo = false;
    };
    // En una pantalla táctil uPlot no escucha el dedo (1.6.32, sin eventos táctiles): un toque lleva el cursor al punto tocado y la
    // etiqueta aparece ahí; un toque fuera la quita (L4c, decidido tras probarlo en el navegador con pantalla táctil).
    const toque = (e: PointerEvent): void => {
      if (e.pointerType !== 'touch' || grafico === undefined) return;
      bajoPuntero = true;
      conDedo = true;
      const r = grafico.over.getBoundingClientRect();
      grafico.setCursor({ left: e.clientX - r.left, top: e.clientY - r.top });
    };
    const sale = (): void => {
      if (conDedo) return;
      bajoPuntero = false;
      quitarEtiqueta();
    };
    void cargarUplot().then((UPlot) => {
      if (!activo) return;
      ventanaVigente = untrack(() => ventana);
      encima = untrack(() => ({ umbrales, histeresis, franjas }));
      const ancho = el.clientWidth || 600;
      altoVigente = untrack(() => alto) ?? altoGrafico(el.clientWidth);
      grafico = new UPlot(untrack(() => opciones(UPlot, ancho, tema)), untrack(() => series) as uPlotTipo.AlignedData, el);
      grafico.over?.addEventListener('dblclick', doble);
      grafico.over?.addEventListener('mouseenter', entra);
      grafico.over?.addEventListener('pointerdown', entra);
      grafico.over?.addEventListener('pointerup', toque);
      grafico.over?.addEventListener('pointermove', mueveRaton);
      grafico.over?.addEventListener('mouseleave', sale);
      observador = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => {
        altoVigente = untrack(() => alto) ?? altoGrafico(el.clientWidth);
        grafico?.setSize({ width: el.clientWidth, height: altoVigente });
      });
      observador?.observe(el);
      listo = true;
    });
    return () => {
      activo = false;
      observador?.disconnect();
      grafico?.over?.removeEventListener('dblclick', doble);
      grafico?.over?.removeEventListener('mouseenter', entra);
      grafico?.over?.removeEventListener('pointerdown', entra);
      grafico?.over?.removeEventListener('pointerup', toque);
      grafico?.over?.removeEventListener('pointermove', mueveRaton);
      grafico?.over?.removeEventListener('mouseleave', sale);
      grafico?.destroy();
      grafico = undefined;
      listo = false;
      etiqueta = null;
    };
  });

  // Mientras la etiqueta se ve: Escape la quita (WCAG 1.4.13), desplazar la página la quita (quedaría fuera de su punto) y tocar o
  // pulsar fuera del gráfico la quita (en una pantalla táctil no hay «salir» del puntero).
  $effect(() => {
    if (etiqueta === null) return;
    const tecla = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') quitarEtiqueta();
    };
    // Con el dedo no hay «salir» del puntero: tras desplazar, el gráfico deja de estar «bajo el puntero» (si no, al tocar otro gráfico
    // sincronizado este volvía a mostrar su etiqueta y quedaban dos); con el ratón sigue encima y la etiqueta vuelve al moverlo.
    const desplazar = (): void => {
      if (conDedo) bajoPuntero = false;
      quitarEtiqueta();
    };
    const fuera = (e: PointerEvent): void => {
      if (marco !== undefined && e.target instanceof Node && !marco.contains(e.target)) {
        bajoPuntero = false;
        quitarEtiqueta();
      }
    };
    document.addEventListener('keydown', tecla);
    window.addEventListener('scroll', desplazar, { capture: true, passive: true });
    document.addEventListener('pointerdown', fuera, true);
    return () => {
      document.removeEventListener('keydown', tecla);
      window.removeEventListener('scroll', desplazar, { capture: true });
      document.removeEventListener('pointerdown', fuera, true);
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

  // Leyenda fija (A3, L4c): con más de una serie (o con la banda), los nombres con su color; sin valores (los da la etiqueta).
  const leyenda = $derived.by(() => {
    const items = lista.filter((_l, k) => !esBorde(k + 1)).map((l) => ({ nombre: l.label, color: l.stroke, banda: false }));
    if (banda !== null) items.push({ nombre: 'mínimo–máximo', color: banda.color, banda: true });
    return items.length > 1 ? items : [];
  });

  // Texto alternativo y tabla de datos.
  const nombres = $derived(lista.map((l) => l.label));
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

{#if tituloVisible}<p class="titulo-grafico" data-titulo-grafico>{titulo}</p>{/if}
<div class="grafico-marco" bind:this={marco}>
  <div
    class="grafico"
    bind:this={contenedor}
    style:min-height="{altoVigente}px"
    role="img"
    aria-label={descripcion}
    data-titulo={titulo}
    data-puntos={series[0]?.length ?? 0}
    data-series={lista.length}
    data-umbrales={umbrales.length}
    data-franjas={franjas.length}
    data-banda={banda !== null}
  ></div>
  {#if etiqueta !== null}
    <div class="etiqueta-flotante" bind:this={etiquetaEl} aria-hidden="true" data-etiqueta-flotante>
      <span class="hora">{etiqueta.hora}</span>
      {#each etiqueta.filas as f, k (k)}
        <span class="fila">{#if f.aporte !== true}<span class="muestra-linea" class:banda={f.banda === true} style:background={f.color || null}></span>{/if}{f.nombre}: <strong>{f.valor}</strong></span>
      {/each}
    </div>
  {/if}
</div>
{#if leyenda.length > 0}
  <ul class="leyenda-fija" aria-label="Series de {titulo}" data-leyenda-fija>
    {#each leyenda as l (l.nombre)}<li><span class="muestra-linea" class:banda={l.banda} style:background={l.color}></span>{l.nombre}</li>{/each}
  </ul>
{/if}
<details class="datos-grafico" ontoggle={(e) => (datosAbiertos = e.currentTarget.open)} data-datos-grafico>
  <summary>Ver los datos</summary>
  {#if datosAbiertos}
    <div class="tabla-desplazable">
      <table data-tabla-grafico>
        <caption class="solo-lector">{titulo}</caption>
        <thead><tr><th scope="col">Hora ({zona})</th>{#each nombres as n, k (k)}<th scope="col">{n} ({unidad})</th>{/each}{#if aportes !== null}<th scope="col">Dispositivos que aportan</th>{/if}</tr></thead>
        <tbody>
          {#each series[0] ?? [] as t, i (i)}
            <tr><th scope="row">{t === null ? '—' : fechaHora(new Date(t * 1000).toISOString(), zona)}</th>{#each nombres as _n, k (k)}<td>{celda(k + 1, i)}</td>{/each}{#if aportes !== null}<td data-celda-aportan>{aportes[i] === null || aportes[i] === undefined ? '—' : textoAportan(aportes[i])}</td>{/if}</tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</details>
