<script lang="ts">
  // Mensaje para la persona (docs/19 §6, regla de componentes, 08/11/2026): éxito, error, conflicto (409: «alguien lo cambió, recarga»),
  // espera (429, con los segundos) e información. Los errores y los conflictos se anuncian como alerta (role="alert"); lo demás, como
  // estado (role="status"), que un lector de pantalla lee sin interrumpir. El estado nunca va solo por color: el texto lo dice.
  import type { Snippet } from 'svelte';
  import Boton from './Boton.svelte';
  import type { TipoAviso } from './lib/avisos';

  let {
    tipo = 'info',
    texto = '',
    children,
    accion,
    alCerrar,
  }: { tipo?: TipoAviso; texto?: string; children?: Snippet; accion?: { etiqueta: string; alHacer: () => void }; alCerrar?: () => void } = $props();
</script>

<div class="aviso-caja {tipo}" role={tipo === 'error' || tipo === 'conflicto' ? 'alert' : 'status'} data-aviso={tipo}>
  <span class="aviso-texto">{texto}{@render children?.()}</span>
  {#if accion !== undefined}<Boton etiqueta={accion.etiqueta} onclick={accion.alHacer} data-aviso-accion />{/if}
  {#if alCerrar !== undefined}<Boton etiqueta="Cerrar aviso" variante="discreto" onclick={alCerrar} />{/if}
</div>
