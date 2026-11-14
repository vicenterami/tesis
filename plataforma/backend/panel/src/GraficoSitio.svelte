<script lang="ts">
  // Una magnitud del sitio (docs/19 §4, tablero v2, B4b): el promedio del sitio por cubo con la banda mín–máx del mismo matiz al 15 % y
  // cuántos dispositivos aportan, sobre uPlot con el cursor sincronizado con las demás gráficas del tablero. Desde el bloque M (14/11/2026)
  // el promedio es el de los dispositivos (cada uno con su lectura propia o vigente) y el rótulo lo dice: «Promedio de los dispositivos que
  // reportan, cada 15 minutos (hasta 9)», con el número de los que aportan en algún tramo (`dispositivos` del histórico); la etiqueta
  // flotante y «Ver los datos» dicen cuántos aportan en cada punto (`n`). La unidad, la de la persona
  // (lib/unidades.ts: se convierte al mostrar). Nunca dos ejes: cada magnitud es su propia gráfica, alineada en el tiempo.
  // Desde el tablero v3 (bloque L, punto 4): el título es el de la sección (el lienzo no lo repite) y una magnitud sin datos en el rango no
  // llega aquí: Tendencias la nombra en una línea, sin lienzo (L4f).
  import Grafico from './Grafico.svelte';
  import { rotuloCada } from './lib/grafico';
  import type { HistoricoSitio } from './lib/modelo';
  import { colorPromedio, temaVivo } from './lib/tema';
  import { conversion, convertirSerie, type PreferenciaUnidades } from './lib/unidades';

  let {
    historico,
    nombre,
    zona,
    ventana,
    sincronizar,
    unidades,
  }: { historico: HistoricoSitio; nombre: string; zona: string; ventana: { desde: number; hasta: number }; sincronizar: string; unidades: PreferenciaUnidades } = $props();
  const c = $derived(conversion(historico.unidad, unidades, historico.magnitud));
  // [tiempos, promedio, mínimo, máximo]: la banda va entre las series 3 (alta) y 2 (baja).
  const series = $derived([historico.tiempos, convertirSerie(historico.valores, c), convertirSerie(historico.minimos, c), convertirSerie(historico.maximos, c)]);
  const color = $derived(colorPromedio($temaVivo));
</script>

<div data-grafico-sitio={historico.magnitud}>
  <p class="vivo" data-aporte>Promedio de los dispositivos que reportan, {rotuloCada(historico.intervalo)} (hasta {historico.dispositivos})</p>
  <Grafico
    {series}
    unidad={c.simbolo}
    {zona}
    titulo={`${nombre} (${c.simbolo})`}
    lineas={[
      { label: 'promedio', stroke: color, width: 2 },
      { label: 'mínimo', stroke: color, width: 0 },
      { label: 'máximo', stroke: color, width: 0 },
    ]}
    banda={{ alta: 3, baja: 2, color }}
    {ventana}
    {sincronizar}
    aportes={historico.n}
  />
</div>
