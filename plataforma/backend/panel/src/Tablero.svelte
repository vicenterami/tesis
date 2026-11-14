<script lang="ts">
  // P1 Tablero del sitio (docs/19 §4, tablero v2, B; desde el 13/11/2026, bloque L). Lo primero que se ve al entrar, en tres pestañas que
  // son enlaces con la vista en la URL (`#/?sitio=&ver=tendencias|red&rango=`; sin `ver`, el resumen): así «atrás» vuelve a la pestaña
  // anterior y una pestaña se comparte por enlace. Resumen (TableroResumen.svelte) es el presente; Tendencias y Red (TableroGraficas.svelte)
  // llevan la fila del rango. Solo se pide lo de la pestaña abierta. En la fila de las pestañas, el estado del canal en vivo y «Pausar»:
  // detiene toda actualización automática (WCAG 2.2, 2.2.2) y «Reanudar» vuelve a pedir una vez lo que se muestra (L4a).
  import { onMount } from 'svelte';
  import Boton from './Boton.svelte';
  import TableroGraficas from './TableroGraficas.svelte';
  import TableroResumen from './TableroResumen.svelte';
  import type { ClaveRango } from './lib/grafico';
  import type { Sitio } from './lib/modelo';
  import { relojSitio } from './lib/tiempo';
  import type { PreferenciaUnidades } from './lib/unidades';
  import { fragmentoTablero, type VentanaFija, type VerTablero } from './lib/vista';
  import { abrirCanalCompartido, type EstadoCanal } from './lib/vivo';

  let {
    sitio,
    ver = 'resumen',
    rango = null,
    fija = null,
    unidades,
    alCambiarVista = () => {},
  }: { sitio: Sitio; ver?: VerTablero; rango?: ClaveRango | null; fija?: VentanaFija | null; unidades: PreferenciaUnidades; alCambiarVista?: (f: string) => void } = $props();

  let canal = $state<EstadoCanal>('conectando');
  let pausado = $state(false);
  // Desde cuándo está en pausa (L4a): lo detenido no se lee como actual; en la hora del sitio, como el resto de la pantalla.
  let pausadoDesde = $state<Date | null>(null);
  function alternarPausa(): void {
    pausado = !pausado;
    pausadoDesde = pausado ? new Date() : null;
  }
  // El rango de Tendencias y Red se recuerda al pasar por el Resumen (que no lo lleva en la URL).
  let rangoRecordado = $state<ClaveRango | null>(null);
  let fijaRecordada = $state<VentanaFija | null>(null);
  $effect(() => {
    if (ver === 'resumen') return;
    rangoRecordado = rango;
    fijaRecordada = fija;
  });
  const PESTANAS: { ver: VerTablero; rotulo: string }[] = [
    { ver: 'resumen', rotulo: 'Resumen' },
    { ver: 'tendencias', rotulo: 'Tendencias' },
    { ver: 'red', rotulo: 'Red' },
  ];
  const enlace = (v: VerTablero): string => fragmentoTablero(sitio.codigo, v, ver === 'resumen' ? rangoRecordado : rango, ver === 'resumen' ? fijaRecordada : fija);

  onMount(() => {
    const c = abrirCanalCompartido('/eventos', () => {}, (estado) => (canal = estado));
    return () => c.cerrar();
  });
</script>

<div class="tablero-cabecera">
  <h2>Tablero <span class="solo-lector">· {sitio.nombre}</span></h2>
  <nav class="pestanas" aria-label="Vistas del tablero" data-pestanas>
    {#each PESTANAS as p (p.ver)}
      <a href={enlace(p.ver)} aria-current={ver === p.ver ? 'page' : undefined} data-pestana={p.ver}>{p.rotulo}</a>
    {/each}
  </nav>
  <div class="tablero-vivo">
    <span class="vivo {pausado ? 'en_pausa' : canal}" data-canal={canal}>
      {#if pausado}en pausa{#if pausadoDesde !== null}<span data-pausa-desde>{` desde las ${relojSitio(sitio.zona_horaria, pausadoDesde).slice(11)}`}</span>{/if}{:else}en vivo: {canal === 'en_vivo' ? 'conectado' : canal === 'conectando' ? 'conectando…' : 'reconectando'}{/if}
    </span>
    <Boton etiqueta={pausado ? 'Reanudar' : 'Pausar'} icono={pausado ? 'reanudar' : 'pausa'} variante="barra" presionado={pausado}
      ayuda={pausado ? 'Vuelve a pedir lo que se muestra y sigue actualizándolo' : 'Detiene toda actualización automática de esta pantalla'} onclick={alternarPausa} data-pausar />
  </div>
</div>

{#if ver === 'resumen'}
  <TableroResumen {sitio} {unidades} {pausado} />
{:else}
  <!-- {#key}: otra pestaña es otra carga (Tendencias pide los históricos; Red, no) -->
  {#key ver}
    <TableroGraficas {sitio} {ver} {rango} {fija} {unidades} {pausado} {alCambiarVista} />
  {/key}
{/if}
