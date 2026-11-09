<script lang="ts">
  // Botón del panel (docs/19 §6, regla de componentes, 08/11/2026). Reglas que el componente hace cumplir:
  //  - etiqueta de texto OBLIGATORIA: ningún botón solo con icono (sin ella, el componente no se dibuja y lo dice);
  //  - `ayuda`: el tooltip, al pasar el ratón y al enfocar con el teclado, enlazado con aria-describedby;
  //  - `cargando`: el botón queda desactivado, con aria-busy y la etiqueta en gerundio («Entrando…»): un doble clic no envía dos veces;
  //  - `motivoDesactivado`: si hay motivo, el botón está desactivado y el motivo se ESCRIBE al lado, visible (un botón desactivado no
  //    recibe el foco ni el ratón en todos los navegadores: su tooltip no alcanzaría).
  import type { HTMLButtonAttributes } from 'svelte/elements';
  import Tooltip from './Tooltip.svelte';

  type Propias = {
    etiqueta: string;
    ayuda?: string;
    cargando?: boolean;
    etiquetaCargando?: string;
    motivoDesactivado?: string | null;
    tipo?: 'button' | 'submit';
    variante?: 'normal' | 'principal' | 'peligro' | 'discreto';
    presionado?: boolean;
  };
  let {
    etiqueta,
    ayuda = '',
    cargando = false,
    etiquetaCargando = '',
    motivoDesactivado = null,
    tipo = 'button',
    variante = 'normal',
    presionado = undefined,
    ...resto
  }: Propias & Omit<HTMLButtonAttributes, 'type' | 'disabled' | 'children' | 'aria-describedby' | 'aria-pressed' | 'aria-busy'> = $props();

  // Antes de dibujar (y cada vez que cambie): sin etiqueta, falla en voz alta en vez de dejar un botón mudo.
  $effect.pre(() => {
    if (typeof etiqueta !== 'string' || etiqueta.trim() === '') throw new Error('Boton: la etiqueta de texto es obligatoria (docs/19 §6: ningún botón solo con icono)');
  });

  const uid = $props.id();
  const idAyuda = `${uid}-ayuda`;
  const idMotivo = `${uid}-motivo`;
  const conMotivo = $derived(typeof motivoDesactivado === 'string' && motivoDesactivado.trim() !== '');
  const describe = $derived([ayuda !== '' ? idAyuda : '', conMotivo ? idMotivo : ''].filter((x) => x !== '').join(' ') || undefined);
</script>

{#snippet boton()}
  <button
    {...resto}
    type={tipo}
    class="boton {variante}"
    disabled={cargando || conMotivo}
    aria-busy={cargando || undefined}
    aria-pressed={presionado}
    aria-describedby={describe}
  >{cargando ? etiquetaCargando || `${etiqueta}…` : etiqueta}</button>
{/snippet}

<span class="boton-envoltura">
  {#if ayuda !== ''}
    <Tooltip id={idAyuda} texto={ayuda}>{@render boton()}</Tooltip>
  {:else}
    {@render boton()}
  {/if}
  {#if conMotivo}<span class="motivo-desactivado" id={idMotivo} data-motivo-desactivado>{motivoDesactivado}</span>{/if}
</span>
