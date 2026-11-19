<script lang="ts">
  // P15, «Ajustes del sitio» (docs/19 §4, Q): `#/sitio/ajustes?sitio=<código>`, para quien tiene la acción `ajustes` o `enlaces` en el sitio
  // (administrador de sitio y del sistema; docs/20 §6). Lo que rige a todo un sitio, en dos secciones, cada una por su acción:
  //  · «Primera trama» (`ajustes`): el plazo en horas, con su equivalencia en días y lo que pasa al vencer (AjusteEspera).
  //  · «Vista pública» (`enlaces`): el k y el tope de enlaces vivos, mudados desde «Publicar una vista» (AjusteMinimo, AjusteTope).
  // Cada ajuste es un componente con su propia carga y su propia cancelación.
  import AjusteEspera from './AjusteEspera.svelte';
  import AjusteMinimo from './AjusteMinimo.svelte';
  import AjusteTope from './AjusteTope.svelte';
  import { puedeEnSitio, sitiosConAjustes } from './lib/ajustes';
  import type { Sitio } from './lib/modelo';
  import type { Sesion } from './lib/sesion';
  import { fragmentoAjustes } from './lib/vista';

  let { sitio: codigoPedido, sesion, sitios, alCambiarVista }: { sitio: string; sesion: Sesion; sitios: Sitio[] | null; alCambiarVista: (f: string) => void } = $props();

  const mios = $derived(sitios === null ? [] : sitiosConAjustes(sesion, sitios));
  const sitio = $derived(mios.find((x) => x.codigo === codigoPedido) ?? mios[0] ?? null);
  const conEspera = $derived(sitio !== null && puedeEnSitio(sesion, sitio, 'ajustes'));
  const conVistaPublica = $derived(sitio !== null && puedeEnSitio(sesion, sitio, 'enlaces'));
  const uid = $props.id();
</script>

<h2 data-ajustes-sitio>Ajustes del sitio</h2>
<p class="intro-publicar">Lo que rige a todo el sitio, no a un equipo: cuánto se espera la primera trama de un equipo nuevo y los límites de la vista pública.</p>

{#if sitios === null}
  <p class="vacio" aria-busy="true">Cargando tus sitios…</p>
{:else if sitio === null}
  <p class="vacio" data-sin-ajustes>Tu rol no cambia ajustes en ningún sitio: los cambia quien administra el tuyo. <a href="#/">Volver al tablero</a></p>
{:else}
  {#if mios.length > 1}
    <label class="selector-publicar">Sitio
      <select value={sitio.codigo} onchange={(e) => alCambiarVista(fragmentoAjustes(e.currentTarget.value))} data-sitio-ajustes>
        {#each mios as x (x.id)}<option value={x.codigo}>{x.nombre}</option>{/each}
      </select>
    </label>
  {:else}
    <p class="vivo" data-sitio-ajustes-nombre>Sitio: <strong>{sitio.nombre}</strong></p>
  {/if}

  {#if conEspera}
    <section aria-labelledby="{uid}-espera" class="ajustes-sitio" data-seccion-primera-trama>
      <h3 id="{uid}-espera">Primera trama</h3>
      <AjusteEspera sitio={sitio.id} />
    </section>
  {/if}
  {#if conVistaPublica}
    <section aria-labelledby="{uid}-publica" class="ajustes-sitio" data-seccion-vista-publica>
      <h3 id="{uid}-publica">Vista pública</h3>
      <AjusteMinimo sitio={sitio.id} />
      <AjusteTope sitio={sitio.id} />
    </section>
  {/if}
{/if}
