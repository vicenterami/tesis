<script lang="ts">
  // Tarjeta de valor del tablero (docs/19 §4, tablero v2, B2): un número grande con su título y, si lleva a algún lado, un botón con
  // texto (Boton.svelte, §6) que lo dice. No es un gráfico de una barra: el número es el dato. Título y valor van en una lista de
  // descripción (<dt>/<dd>): un `aria-describedby` sobre un <span> sin rol no se anuncia de forma fiable (corrección del 11/11/2026).
  import type { Snippet } from 'svelte';
  import Boton from './Boton.svelte';

  let {
    titulo,
    valor,
    detalle = '',
    estado = null,
    ancha = false,
    accion = null,
    children,
    ...resto
  }: {
    titulo: string;
    valor: string | number;
    detalle?: string;
    estado?: 'normal' | 'alerta' | 'sin_senal' | 'inactivo' | null;
    ancha?: boolean;
    accion?: { etiqueta: string; ayuda?: string; alHacer: () => void } | null;
    children?: Snippet;
    [k: `data-${string}`]: string | boolean | undefined;
  } = $props();
</script>

<li class="tarjeta" class:ancha {...resto}>
  <dl class="par">
    <dt class="titulo">{#if estado !== null}<span class="estado {estado}">{titulo}</span>{:else}{titulo}{/if}</dt>
    <dd class="n" data-valor>{typeof valor === 'number' ? valor.toLocaleString('es-CL') : valor}</dd>
  </dl>
  {#if detalle !== ''}<span class="detalle" data-detalle>{detalle}</span>{/if}
  {@render children?.()}
  {#if accion !== null}<Boton etiqueta={accion.etiqueta} ayuda={accion.ayuda ?? ''} variante="discreto" onclick={accion.alHacer} data-tarjeta-accion />{/if}
</li>
