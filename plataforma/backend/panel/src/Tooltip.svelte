<script lang="ts">
  // Ayuda emergente (docs/19 §6, regla de componentes, 08/11/2026). Aparece al pasar el ratón Y al enfocar con el teclado (no solo con
  // el ratón: quien navega con Tab también la lee), se oculta con Escape sin mover el foco y no tapa nada importante. Su texto vive
  // SIEMPRE en el DOM con un id: el control que envuelve lo enlaza con `aria-describedby={id}`, así un lector de pantalla lo anuncia
  // aunque esté oculto a la vista. Nunca es la única forma de saber algo esencial: lo esencial va escrito al lado (motivo de un botón
  // desactivado, guía de perfiles).
  // WCAG 2.2, 1.4.13 (revisado el 13/11/2026, docs/19 §4, bloque L, punto 1e): (1) se descarta con Escape aunque el foco esté en otra
  // parte (la ayuda abierta por el puntero escucha la tecla en el documento mientras se ve); (2) admite el puntero encima: al salir del
  // control espera un instante antes de ocultarse, así el puntero cruza el espacio hasta la ayuda sin que se vaya; (3) dura mientras el
  // puntero o el foco sigan ahí. Un descarte con Escape vale hasta que el puntero y el foco se van.
  // `lado`: debajo del control (por defecto) o a su derecha (los enlaces de la barra lateral contraída).
  import type { Snippet } from 'svelte';

  let { id, texto, lado = 'abajo', children }: { id: string; texto: string; lado?: 'abajo' | 'derecha'; children: Snippet } = $props();
  let puntero = $state(false);
  let foco = $state(false);
  let descartada = $state(false);
  const visible = $derived((puntero || foco) && !descartada);
  let salida: ReturnType<typeof setTimeout> | null = null;

  function entrar(): void {
    if (salida !== null) clearTimeout(salida);
    salida = null;
    puntero = true;
  }
  function salir(): void {
    if (salida !== null) clearTimeout(salida);
    salida = setTimeout(() => {
      salida = null;
      puntero = false;
      if (!foco) descartada = false;
    }, 150);
  }
  $effect(() => {
    if (!visible) return;
    const alTeclear = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') descartada = true;
    };
    document.addEventListener('keydown', alTeclear);
    return () => document.removeEventListener('keydown', alTeclear);
  });
  $effect(() => () => {
    if (salida !== null) clearTimeout(salida);
  });
</script>

<!-- svelte-ignore a11y_no_static_element_interactions -->
<span
  class="con-tooltip"
  onmouseenter={entrar}
  onmouseleave={salir}
  onfocusin={() => (foco = true)}
  onfocusout={() => {
    foco = false;
    if (!puntero) descartada = false;
  }}
>
  {@render children()}
  <span role="tooltip" {id} class="tooltip" class:derecha={lado === 'derecha'} hidden={!visible} data-tooltip>{texto}</span>
</span>
