<script lang="ts">
  // Lo que ve quien visita una vista pública (P9; docs/19 §4, O, punto 9), dibujado igual en su pantalla (Publico.svelte) y en la vista
  // previa de quien publica (Publicar.svelte, punto 3: «exactamente lo que verá el visitante»). Título, sitio, «actualizado hace…», una
  // tarjeta por magnitud con el promedio de ahora, su unidad y «promedio de k o más dispositivos», una fila por zona publicada con su valor
  // y, si k > 1, el aviso de lo que se oculta con su explicación; debajo, la tendencia con el selector de ventana (las que permite el enlace)
  // y una gráfica por magnitud con su tabla de datos (Grafico.svelte, «Ver los datos»). Lo oculto y lo que no tiene datos se ven igual:
  // «Sin dato» y un hueco. Toda hora, en la zona del sitio. Al refrescar, solo se anuncia la hora del último dato (role="status"), sin
  // mover el foco. Al pie, la línea fija del punto 9.
  import Boton from './Boton.svelte';
  import Grafico from './Grafico.svelte';
  import Icono from './Icono.svelte';
  import { AVISO_PROTEGIDO, TEXTO_PIE, armarVista, explicacionProtegido, type VentanaPublica, type VistaPublica } from './lib/publico';
  import { SERIES, temaVivo } from './lib/tema';

  let {
    vista,
    ahora,
    alCambiarVentana,
    cargando = false,
    previa = false,
  }: { vista: VistaPublica; ahora: Date; alCambiarVentana: (v: VentanaPublica) => void; cargando?: boolean; previa?: boolean } = $props();

  const d = $derived(armarVista(vista, ahora));
  // En la pantalla del visitante el título es el encabezado de la página; en la vista previa, uno de la sección que la contiene.
  const h1 = $derived(previa ? 'h3' : 'h1');
  const h2 = $derived(previa ? 'h4' : 'h2');
  const h3 = $derived(previa ? 'h5' : 'h3');
  const lineas = (nombres: string[]): { label: string; stroke: string; width: number }[] =>
    nombres.map((label, i) => ({ label, stroke: SERIES[$temaVivo][i % SERIES[$temaVivo].length]!, width: i === 0 ? 2.5 : 1.5 }));
</script>

<article class="vista-publica" class:previa aria-busy={cargando || undefined} data-vista-publica>
  <header class="vp-cabecera">
    <svelte:element this={h1} class="vp-titulo" data-vp-titulo>{d.titulo === '' ? 'Sin título todavía' : d.titulo}</svelte:element>
    <p class="vp-sitio" data-vp-sitio>{d.sitio}</p>
    {#if d.descripcion !== null}<p class="vp-descripcion" data-vp-descripcion>{d.descripcion}</p>{/if}
    <p class="vivo vp-hora"><span data-vp-actualizado>{d.actualizado}</span>. <span data-vp-zona-horaria>{d.zonaHoraria}</span>.</p>
    <!-- Lo único que se anuncia al refrescar: la hora del último dato (WCAG 4.1.3), sin mover el foco -->
    <p class="solo-lector" role="status" data-vp-anuncio>{d.ultimoDato === null ? '' : `Último dato: ${d.ultimoDato}`}</p>
  </header>

  <ul class="vp-tarjetas" aria-label="Ahora, por magnitud">
    {#each d.tarjetas as t (t.codigo)}
      <li class="vp-tarjeta" data-vp-magnitud={t.codigo}>
        <svelte:element this={h2} class="vp-magnitud">{t.nombre}</svelte:element>
        <p class="vp-valor" class:sin-valor={!t.conValor} data-vp-ahora>{t.ahora}</p>
        <p class="vivo" data-vp-k>{d.textoK}, ahora</p>
        {#if t.zonas.length > 0}
          <table class="vp-zonas" data-vp-zonas>
            <caption class="solo-lector">{t.nombre} por zona, ahora</caption>
            <tbody>
              {#each t.zonas as z, i (i)}
                <tr data-vp-zona={z.nombre}><th scope="row">{z.nombre}</th><td data-vp-zona-ahora>{z.ahora}</td></tr>
              {/each}
            </tbody>
          </table>
        {/if}
        {#if t.protegido}
          <div class="vp-protegido" data-vp-protegido>
            <p><Icono nombre="aviso" tamano={18} /> {AVISO_PROTEGIDO}</p>
            <details><summary>Qué significa</summary><p>{explicacionProtegido(d.k)}</p></details>
          </div>
        {/if}
      </li>
    {/each}
  </ul>

  <section class="vp-tendencia" aria-label="Tendencia">
    <div class="vp-tendencia-cabecera">
      <svelte:element this={h2} class="vp-seccion">Tendencia</svelte:element>
      {#if d.ventanas.length > 1}
        <div class="vp-ventanas" role="group" aria-label="Ventana de tiempo" data-vp-ventanas>
          {#each d.ventanas as w (w.clave)}
            <Boton etiqueta={w.rotulo} variante="discreto" presionado={w.clave === d.ventana} onclick={() => alCambiarVentana(w.clave)} data-vp-ventana={w.clave} />
          {/each}
        </div>
      {:else}
        <p class="vivo" data-vp-ventana-unica>{d.ventanas[0]?.rotulo ?? ''}</p>
      {/if}
    </div>
    {#each d.tarjetas as t (t.codigo)}
      <div class="vp-grafica" data-vp-grafica={t.codigo}>
        <svelte:element this={h3} class="vp-magnitud">{t.nombre} ({t.unidad})</svelte:element>
        {#if t.conDatos}
          <p class="vivo">{d.textoK}, {d.cada}{t.zonas.length > 0 ? '; también por zona' : ''}.</p>
          <!-- {#key}: otra ventana u otras series es otro gráfico (Grafico lee las líneas al crearse) -->
          {#key `${d.ventana}|${t.nombresSeries.join('|')}`}
            <Grafico series={t.series} unidad={t.unidad} zona={d.zona} titulo={`${t.nombre} (${t.unidad}), ${d.sitio}`} lineas={lineas(t.nombresSeries)} ventana={d.graficoVentana} />
          {/key}
        {:else}
          <p class="vacio" data-vp-sin-datos>Sin datos de {t.nombre} en esta ventana.</p>
        {/if}
      </div>
    {/each}
  </section>

  <footer class="vp-pie" data-vp-pie>{TEXTO_PIE}</footer>
</article>
