<script lang="ts">
  // Ayuda emergente (docs/19 §6, regla de componentes, 08/11/2026). Aparece al pasar el ratón Y al enfocar con el teclado (no solo con
  // el ratón: quien navega con Tab también la lee), se oculta con Escape sin mover el foco y no tapa nada importante. Su texto vive
  // SIEMPRE en el DOM con un id: el control que envuelve lo enlaza con `aria-describedby={id}`, así un lector de pantalla lo anuncia
  // aunque esté oculto a la vista. Nunca es la única forma de saber algo esencial: lo esencial va escrito al lado (motivo de un botón
  // desactivado, guía de perfiles).
  import type { Snippet } from 'svelte';

  let { id, texto, children }: { id: string; texto: string; children: Snippet } = $props();
  let visible = $state(false);
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="con-tooltip"
  onmouseenter={() => (visible = true)}
  onmouseleave={() => (visible = false)}
  onfocusin={() => (visible = true)}
  onfocusout={() => (visible = false)}
  onkeydown={(e) => {
    if (e.key === 'Escape') visible = false;
  }}
>
  {@render children()}
  <span role="tooltip" {id} class="tooltip" hidden={!visible} data-tooltip>{texto}</span>
</span>
