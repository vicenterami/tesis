<script lang="ts">
  // Notificaciones en pantalla (docs/19 §4, tablero v2, E; HU-24, HU-25; §6 «Avisos» y «Nada se repite por cada evento»): en cualquier
  // pantalla, una condición que se abre en un sitio de la persona aparece como aviso agrupado por dispositivo, en una región aria-live que
  // no roba el foco; y, para los tipos elegidos en P13 con el permiso dado, también como notificación del navegador (una por dispositivo:
  // `tag` la reemplaza en vez de apilarla). Los nombres llegan con la lista de abiertas, pedida con antirrebote (una por segundo como
  // mucho), nunca una petición por evento. El canal es el de toda la persona (`GET /eventos`, el servidor lo acota a sus sitios), compartido.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import { URL_ABIERTAS, obtener } from './lib/api';
  import { antirrebote } from './lib/antirrebote';
  import type { Condicion, EventoVivo } from './lib/modelo';
  import { MAX_GRUPOS, MAX_GRUPOS_ANGOSTO, TITULO_NOTIFICACION, agregarCondicion, cuerpoNotificacion, debeNotificar, permisoActual, ponerNombres, textoGrupo, type GrupoAviso } from './lib/notificaciones';
  import { abrirCanalCompartido, type Canal } from './lib/vivo';
  import { seguirAngosto } from './lib/medios';

  let { notificar = [] }: { notificar?: readonly string[] } = $props();

  let grupos = $state<GrupoAviso[]>([]);
  let nombres = new Map<string, string>();
  const sitioDe = new Map<string, string>(); // dispositivo → nombre de su sitio (llega con la lista de abiertas)
  const nuevasPorSitio = new Map<string, number>(); // sitio (o '' si aún no se sabe) → condiciones nuevas desde que se abrió la página
  let angosto = $state(false);
  // Lo que ocupan los avisos fijos al pie, en la variable --alto-avisos de la raíz (app.css): con ella el navegador deja ese margen libre
  // al llevar el foco a un control (scroll-padding-bottom) y la página tiene hacia dónde desplazarse (padding-bottom de <main>). La prueba
  // con navegador real mostró que un margen fijo de 8rem no alcanzaba con dos avisos en teléfono (WCAG 2.4.11; corrección del 11/11/2026).
  let contenedor = $state<HTMLDivElement | null>(null);
  $effect(() => {
    const el = contenedor;
    if (el === null || typeof ResizeObserver === 'undefined') return;
    const raiz = document.documentElement;
    const medir = (): void => raiz.style.setProperty('--alto-avisos', `${Math.ceil(el.getBoundingClientRect().height)}px`);
    const o = new ResizeObserver(medir);
    o.observe(el);
    medir();
    return () => {
      o.disconnect();
      raiz.style.removeProperty('--alto-avisos');
    };
  });
  const limite = $derived(angosto ? MAX_GRUPOS_ANGOSTO : MAX_GRUPOS);
  const visibles = $derived(grupos.slice(0, limite));
  const plegados = $derived(grupos.slice(limite, MAX_GRUPOS)); // en teléfono, los que no caben a la vista
  const restantes = $derived(Math.max(0, grupos.length - MAX_GRUPOS));

  const pedirNombres = antirrebote(async () => {
    const l = await obtener<Condicion[]>(URL_ABIERTAS);
    for (const c of l) {
      nombres.set(c.dispositivo_id, c.dispositivo);
      if (typeof c.sitio === 'string') sitioDe.set(c.dispositivo_id, c.sitio);
    }
    grupos = ponerNombres(grupos, nombres);
  });

  function alEvento(e: EventoVivo): void {
    if (e.tipo !== 'condicion' || e.estado !== 'abierta') return;
    grupos = agregarCondicion(grupos, e, new Date(), nombres.get(e.dispositivo_id) ?? null);
    if (!nombres.has(e.dispositivo_id)) pedirNombres.pedir();
    if (debeNotificar(String(e.condicion), notificar, permisoActual())) {
      try {
        // Cuerpo genérico: el detalle (dispositivo, tipo) solo en la pantalla. Una por sitio: `tag` la reemplaza en vez de apilarla.
        const sitio = sitioDe.get(e.dispositivo_id) ?? null;
        const n = (nuevasPorSitio.get(sitio ?? '') ?? 0) + 1;
        nuevasPorSitio.set(sitio ?? '', n);
        new Notification(TITULO_NOTIFICACION, { body: cuerpoNotificacion(n, sitio), tag: `condiciones-${sitio ?? 'sitios'}` });
      } catch {
        // Un navegador que no deja crearla fuera de un service worker (algunos móviles): queda el aviso en pantalla.
      }
    }
  }

  onMount(() => {
    // El mismo canal sin filtro que el tablero, el inventario y la comparación (lib/vivo.ts, abrirCanalCompartido): una conexión por pestaña.
    const canal: Canal = abrirCanalCompartido('/eventos', alEvento, () => {});
    const dejarDeSeguir = seguirAngosto((x) => (angosto = x));
    return () => {
      dejarDeSeguir();
      canal.cerrar();
      pedirNombres.cancelar();
    };
  });
</script>

<div class="notificaciones" aria-live="polite" aria-relevant="additions text" bind:this={contenedor} data-notificaciones>
  {#each visibles as g (g.dispositivo_id)}
    <Aviso tipo="info" texto={textoGrupo(g)} alCerrar={() => (grupos = grupos.filter((x) => x.dispositivo_id !== g.dispositivo_id))}>
      · <a href={`#/dispositivos/${g.dispositivo_id}`} data-aviso-ficha>Abrir la ficha</a>
    </Aviso>
  {/each}
  {#if plegados.length > 0}
    <details class="avisos-plegados" data-avisos-plegados>
      <summary>y {plegados.length + restantes} más</summary>
      {#each plegados as g (g.dispositivo_id)}
        <Aviso tipo="info" texto={textoGrupo(g)} alCerrar={() => (grupos = grupos.filter((x) => x.dispositivo_id !== g.dispositivo_id))}>
          · <a href={`#/dispositivos/${g.dispositivo_id}`} data-aviso-ficha>Abrir la ficha</a>
        </Aviso>
      {/each}
      {#if restantes > 0}<p class="vivo">y {restantes} dispositivos más con condiciones nuevas</p>{/if}
    </details>
  {:else if restantes > 0}<p class="vivo" data-mas-avisos>y {restantes} dispositivos más con condiciones nuevas</p>{/if}
</div>
