<script lang="ts">
  // Gráfico de un canal con uPlot (docs/07, docs/19 P3): dos series sobre el mismo eje de tiempo, «promedio» del histórico
  // agregado y «actual» con lo que llega en vivo. Las horas del eje van en la zona del sitio (docs/13).
  import uPlot from 'uplot';
  import 'uplot/dist/uPlot.min.css';
  import type { Series } from './lib/grafico';

  let { series, unidad, zona, titulo }: { series: Series; unidad: string; zona: string; titulo: string } = $props();
  let contenedor: HTMLDivElement | undefined = $state();
  let grafico: uPlot | undefined;

  function opciones(ancho: number): uPlot.Options {
    return {
      title: titulo,
      width: ancho,
      height: 280,
      tzDate: (ts) => uPlot.tzDate(new Date(ts * 1000), zona),
      series: [
        {},
        { label: 'promedio', stroke: '#0b3954', width: 2, value: (_u, v) => (v === null ? '—' : `${v} ${unidad}`) },
        { label: 'actual', stroke: '#c0392b', width: 0, points: { show: true, size: 6 }, value: (_u, v) => (v === null ? '—' : `${v} ${unidad}`) },
      ],
      axes: [{}, { label: unidad }],
    };
  }

  $effect(() => {
    if (contenedor === undefined) return;
    const el = contenedor;
    grafico = new uPlot(opciones(el.clientWidth || 600), series, el);
    const observador = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(() => grafico?.setSize({ width: el.clientWidth, height: 280 }));
    observador?.observe(el);
    return () => {
      observador?.disconnect();
      grafico?.destroy();
      grafico = undefined;
    };
  });

  $effect(() => {
    grafico?.setData(series);
  });
</script>

<div class="grafico" bind:this={contenedor} data-puntos={series[0].length}></div>
