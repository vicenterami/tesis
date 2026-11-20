<script lang="ts">
  // Hora del sitio y aviso de zona (docs/19 §4, incremento 2, punto 3; cierra la regla 6 de docs/13): las horas del panel van en la zona
  // del sitio; esta línea dice cuál es y qué hora es allí, al día cada segundo. El desfase se calcula del nombre IANA al instante (cambia
  // con el horario de verano). Si el navegador está en otra zona, lo avisa. `navegador` se inyecta en las pruebas.
  // Zona propia (P13, bloque H): si la persona eligió una distinta de la del sitio, las horas que se muestran van en la suya, y la línea
  // lo dice con la hora de allí y la del sitio; entonces no se avisa por el navegador (ya eligió). `zonasDeLaLista` es el número de zonas
  // distintas de una lista (inventario, comparar): con varias y sin zona propia, cada fila va en la de su sitio.
  import { desfase, relojSitio, veEnOtraZona, zonaDelNavegador, zonaVista } from './lib/tiempo';
  import { zonaPropia } from './lib/zona-propia.svelte';

  let { zona, navegador = zonaDelNavegador(), zonasDeLaLista = 1 }: { zona: string; navegador?: string | null; zonasDeLaLista?: number } = $props();
  let ahora = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (ahora = new Date()), 1000);
    return () => clearInterval(t);
  });
  const propia = $derived(zonasDeLaLista > 1 ? zonaPropia() !== null : veEnOtraZona(zona));
  const mostrada = $derived(zonaVista(zona));
</script>

{#if propia}
  <p class="vivo" data-hora-sitio data-zona-propia>Hora en tu zona: <span data-reloj-sitio>{relojSitio(mostrada, ahora)}</span> · {mostrada} ({desfase(mostrada, ahora)})</p>
  <p class="aviso" role="note" data-aviso-zona-propia>Elegiste ver las horas en {mostrada}
    {#if zonasDeLaLista > 1}en lugar de la de cada sitio{:else}en lugar de la del sitio ({zona}, {desfase(zona, ahora)}){/if}; las fechas que escribes en un filtro o una exportación siguen en la zona del sitio</p>
{:else if zonasDeLaLista > 1}
  <p class="vivo" data-hora-sitio>{zonasDeLaLista} zonas horarias: cada fila va en la de su sitio</p>
{:else}
  <p class="vivo" data-hora-sitio>Hora en el sitio: <span data-reloj-sitio>{relojSitio(zona, ahora)}</span> · {zona} ({desfase(zona, ahora)})</p>
  {#if navegador !== null && navegador !== zona}
    <p class="aviso" role="note" data-aviso-zona>Tu navegador está en {navegador} ({desfase(navegador, ahora)}); todas las horas de esta pantalla van en la zona del sitio</p>
  {/if}
{/if}
