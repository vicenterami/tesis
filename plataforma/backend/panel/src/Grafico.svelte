<script lang="ts">
  // Gráfico de un canal con uPlot (docs/07, docs/19 P3): dos series sobre el mismo eje de tiempo, «promedio» del histórico
  // agregado y «lectura actual» con lo que llega en vivo. Las horas del eje van en la zona del sitio (docs/13).
  // uPlot se carga aquí con import dinámico: el inventario (la pantalla de entrada, también en móvil) no descarga sus ~45 KB.
  // El gráfico se crea UNA vez por montaje y después solo recibe datos (`setData`): sin `untrack`, el efecto que lo crea
  // dependería de `series` y lo destruiría y recrearía en cada lote de lecturas (revisión del 12/10).
  import { untrack } from 'svelte';
  import type uPlotTipo from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import type { Series } from './lib/grafico';

  let { series, unidad, zona, titulo }: { series: Series; unidad: string; zona: string; titulo: string } = $props();
  let contenedor: HTMLDivElement | undefined = $state();
  let grafico: uPlotTipo | undefined;
  let listo = $state(false); // reactivo: el efecto de datos corre también cuando el gráfico recién existe

  function opciones(UPlot: typeof uPlotTipo, ancho: number): uPlotTipo.Options {
    return {
      title: titulo,
      width: ancho,
      height: 280,
      tzDate: (ts) => UPlot.tzDate(new Date(ts * 1000), zona),
      series: [
        {},
        { label: 'promedio', stroke: '#0b3954', width: 2, value: (_u, v) => (v === null ? '—' : `${v} ${unidad}`) },
        { label: 'lectura actual', stroke: '#c0392b', width: 0, points: { show: true, size: 6 }, value: (_u, v) => (v === null ? '—' : `${v} ${unidad}`) },
      ],
      axes: [{}, { label: unidad }],
    };
  }

  $effect(() => {
    if (contenedor === undefined) return;
    const el = contenedor;
    let activo = true;
    let observador: ResizeObserver | undefined;
    void import('uplot').then(({ default: UPlot }) => {
      if (!activo) return;
      grafico = new UPlot(opciones(UPlot, el.clientWidth || 600), untrack(() => series), el);
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
    if (listo) grafico?.setData(series);
  });
</script>

<div class="grafico" bind:this={contenedor} data-puntos={series[0].length}></div>
