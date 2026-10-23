<script lang="ts">
  // Hora del sitio y aviso de zona (docs/19 §4, incremento 2, punto 3; cierra la regla 6 de docs/13): todas las horas del panel van en
  // la zona del sitio; esta línea dice cuál es y qué hora es allí, al día cada segundo. El desfase se calcula del nombre IANA al
  // instante (cambia con el horario de verano). Si el navegador está en otra zona, lo avisa. `navegador` se inyecta en las pruebas.
  import { desfase, relojSitio, zonaDelNavegador } from './lib/tiempo';

  let { zona, navegador = zonaDelNavegador() }: { zona: string; navegador?: string | null } = $props();
  let ahora = $state(new Date());
  $effect(() => {
    const t = setInterval(() => (ahora = new Date()), 1000);
    return () => clearInterval(t);
  });
</script>

<p class="vivo" data-hora-sitio>Hora en el sitio: <span data-reloj-sitio>{relojSitio(zona, ahora)}</span> · {zona} ({desfase(zona, ahora)})</p>
{#if navegador !== null && navegador !== zona}
  <p class="aviso" role="note" data-aviso-zona>Tu navegador está en {navegador} ({desfase(navegador, ahora)}); todas las horas de esta pantalla van en la zona del sitio</p>
{/if}
