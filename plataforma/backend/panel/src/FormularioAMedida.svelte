<script lang="ts">
  // El formulario del rango «a medida» (HU-07; docs/19 §4, B1 y D6): «Desde» y «Hasta» en la hora de la zona del sitio, con la ayuda y el
  // error ligados a los dos campos (`aria-describedby`). Lo usan el tablero del sitio y la ficha del dispositivo; la validación es una sola
  // (`validarAMedida`, lib/vista.ts) y el error se dice aquí, junto a los campos, sin pedir nada. `idBase` evita ids repetidos en la página.
  import { untrack } from 'svelte';
  import Boton from './Boton.svelte';
  import { localDesdeInstante } from './lib/tiempo';
  import { MAX_VENTANA_MS, validarAMedida, type VentanaFija } from './lib/vista';

  let { zona, inicial, idBase = 'a-medida', alAplicar }: { zona: string; inicial: VentanaFija; idBase?: string; alAplicar: (v: VentanaFija) => void } = $props();

  let desdeLocal = $state(untrack(() => localDesdeInstante(inicial.desde, zona)));
  let hastaLocal = $state(untrack(() => localDesdeInstante(inicial.hasta, zona)));
  let error = $state<string | null>(null);

  function aplicar(e: SubmitEvent): void {
    e.preventDefault();
    const r = validarAMedida(desdeLocal, hastaLocal, zona);
    error = r.error;
    if (r.ventana !== null) alAplicar(r.ventana);
  }
</script>

<form class="filtros" onsubmit={aplicar} novalidate data-form-a-medida>
  <label>Desde <input type="datetime-local" bind:value={desdeLocal} aria-describedby="{idBase}-ayuda {idBase}-error" aria-invalid={error !== null} data-desde /></label>
  <label>Hasta <input type="datetime-local" bind:value={hastaLocal} aria-describedby="{idBase}-ayuda {idBase}-error" aria-invalid={error !== null} data-hasta /></label>
  <Boton etiqueta="Aplicar" tipo="submit" variante="principal" data-aplicar-a-medida />
  <span class="vivo" id="{idBase}-ayuda">En la hora del sitio ({zona}); hasta {Math.round(MAX_VENTANA_MS / 86_400_000)} días.</span>
  {#if error !== null}<span class="error" id="{idBase}-error" role="alert" data-error-a-medida>{error}</span>{/if}
</form>
