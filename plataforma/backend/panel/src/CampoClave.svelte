<script lang="ts">
  // Campo donde la persona teclea una clave, con «Mostrar» al lado (docs/19 §4, P10, «Ver lo que se escribe»). Nace oculto; mostrar es
  // por campo; al enviar el formulario vuelve a ocultarse. Visible u oculto conserva su `autocomplete` y nunca pasa por el corrector
  // ortográfico ni por las mayúsculas automáticas: un corrector en línea recibiría la clave. El botón lleva icono y texto (docs/19 §6).
  import type { HTMLInputAttributes } from 'svelte/elements';
  import Boton from './Boton.svelte';

  let {
    value = $bindable(''),
    ...resto
  }: { value?: string } & Omit<HTMLInputAttributes, 'type' | 'value' | 'spellcheck' | 'autocapitalize' | 'autocorrect'> = $props();

  let visible = $state(false);
  let campo = $state<HTMLInputElement | null>(null);

  $effect(() => {
    const formulario = campo?.form;
    if (!formulario) return;
    const ocultar = (): void => { visible = false; };
    formulario.addEventListener('submit', ocultar);
    return () => formulario.removeEventListener('submit', ocultar);
  });
</script>

<span class="campo-clave" data-campo-clave>
  <input {...resto} bind:this={campo} bind:value type={visible ? 'text' : 'password'} spellcheck="false" autocapitalize="off" autocorrect="off" />
  <Boton etiqueta={visible ? 'Ocultar' : 'Mostrar'} icono={visible ? 'ocultar' : 'mostrar'} variante="discreto" presionado={visible}
    ayuda={visible ? 'Vuelve a ocultar lo que escribiste' : 'Deja ver lo que escribiste en este campo'} onclick={() => (visible = !visible)} data-ver-clave />
</span>
