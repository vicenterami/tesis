<script lang="ts">
  // Medidor de una sola rampa (docs/19 §4, tablero v2, B2): la salud del sitio en porcentaje. El número y su frase van escritos al lado
  // (la tarjeta), así el medidor nunca es la única forma de leerlo; aquí se expone como `meter` con su valor para un lector de pantalla.
  // Sin dato (nadie supervisado), un `meter` sin `aria-valuenow` no dice nada: es una imagen que dice «sin datos» (corrección del 11/11/2026).
  let { porcentaje, etiqueta }: { porcentaje: number | null; etiqueta: string } = $props();
  const p = $derived(porcentaje === null ? 0 : Math.max(0, Math.min(100, porcentaje)));
</script>

{#if porcentaje === null}
  <svg class="medidor" viewBox="0 0 100 12" preserveAspectRatio="none" role="img" aria-label="{etiqueta}: sin datos" data-medidor="">
    <rect class="pista" x="0.5" y="0.5" width="99" height="11" rx="3" />
  </svg>
{:else}
  <svg class="medidor" viewBox="0 0 100 12" preserveAspectRatio="none" role="meter" aria-label={etiqueta}
    aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(p)} data-medidor={Math.round(p)}>
    <rect class="pista" x="0.5" y="0.5" width="99" height="11" rx="3" />
    <rect class="relleno" x="0.5" y="0.5" width={(p / 100) * 99} height="11" rx="3" />
  </svg>
{/if}
