<script lang="ts">
  // Gráfico uPlot (docs/07, docs/19 P3 y P3b). En la ficha, dos series sobre el mismo eje de tiempo: «promedio» del histórico
  // agregado y «lectura actual» con lo que llega en vivo; en la comparación, una serie por dispositivo (`lineas`). Las horas del
  // eje van en la zona del sitio (docs/13). uPlot se carga aquí con import dinámico: el inventario (la pantalla de entrada, también
  // en móvil) no descarga sus 51 KB.
  // El gráfico se crea UNA vez por montaje y después solo recibe datos (`setData`): sin `untrack`, el efecto que lo crea
  // dependería de `series` y lo destruiría y recrearía en cada lote de lecturas. Título, unidad, zona y líneas se leen al crear:
  // quien cambie de canal o de series debe montar un componente nuevo (la ficha y la comparación lo hacen con {#key}).
  // `ventana` (segundos Unix) fija el eje de tiempo a la ventana pedida, también sin puntos (docs/19 §4, incremento 2, punto 2): se
  // ve QUÉ ventana está vacía. Si hay puntos fuera de ella (el primer cubo empieza antes de `desde`; el vivo llega después de
  // `hasta`), el eje se amplía para incluirlos.
  import { untrack } from 'svelte';
  import type uPlotTipo from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import { EJE_TIEMPO, NOMBRES_FECHA, SELLO_LEYENDA } from './lib/grafico';

  export interface Linea {
    label: string;
    stroke: string;
    width: number;
    puntos?: boolean;
  }
  // Las dos series de la ficha (P3).
  const LINEAS_FICHA: Linea[] = [
    { label: 'promedio', stroke: '#0b3954', width: 2 },
    { label: 'lectura actual', stroke: '#c0392b', width: 0, puntos: true },
  ];

  let {
    series,
    unidad,
    zona,
    titulo,
    lineas = LINEAS_FICHA,
    ventana = null,
  }: { series: (number | null)[][]; unidad: string; zona: string; titulo: string; lineas?: Linea[]; ventana?: { desde: number; hasta: number } | null } = $props();
  let contenedor: HTMLDivElement | undefined = $state();
  let grafico: uPlotTipo | undefined;
  let listo = $state(false); // reactivo: el efecto de datos corre también cuando el gráfico recién existe
  let ventanaVigente: { desde: number; hasta: number } | null = null; // la lee la función de rango; se pone al día antes de cada setData

  function rangoX(_u: uPlotTipo, min: number | null, max: number | null): uPlotTipo.Range.MinMax {
    const w = ventanaVigente;
    if (w === null) return [min, max];
    return [min === null ? w.desde : Math.min(min, w.desde), max === null ? w.hasta : Math.max(max, w.hasta)];
  }

  function opciones(UPlot: typeof uPlotTipo, ancho: number): uPlotTipo.Options {
    const valor = (_u: uPlotTipo, v: number | null): string => (v === null || v === undefined ? '—' : `${v} ${unidad}`);
    return {
      title: titulo,
      width: ancho,
      height: 280,
      tzDate: (ts) => UPlot.tzDate(new Date(ts * 1000), zona),
      fmtDate: (tpl) => UPlot.fmtDate(tpl, NOMBRES_FECHA), // meses y días en español (docs/19 §6)
      scales: { x: { time: true, range: rangoX as uPlotTipo.Scale.Range } },
      series: [
        { label: 'Hora', value: SELLO_LEYENDA },
        ...lineas.map((l) => ({ label: l.label, stroke: l.stroke, width: l.width, value: valor, ...(l.puntos ? { points: { show: true, size: 6 } } : {}) })),
      ],
      axes: [{ values: EJE_TIEMPO }, { label: unidad }],
    };
  }

  $effect(() => {
    if (contenedor === undefined) return;
    const el = contenedor;
    let activo = true;
    let observador: ResizeObserver | undefined;
    void import('uplot').then(({ default: UPlot }) => {
      if (!activo) return;
      ventanaVigente = untrack(() => ventana);
      grafico = new UPlot(opciones(UPlot, el.clientWidth || 600), untrack(() => series) as uPlotTipo.AlignedData, el);
      observador = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => grafico?.setSize({ width: el.clientWidth, height: 280 }));
      observador?.observe(el);
      listo = true;
    });
    return () => {
      activo = false;
      observador?.disconnect();
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
</script>

<div class="grafico" bind:this={contenedor} data-puntos={series[0]?.length ?? 0} data-series={lineas.length}></div>
