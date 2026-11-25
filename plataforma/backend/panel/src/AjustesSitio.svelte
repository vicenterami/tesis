<script lang="ts">
  // P15, «Ajustes del sitio» (docs/19 §4, Q): `#/sitio/ajustes?sitio=<código>`, para quien tiene la acción `ajustes` o `enlaces` en el sitio
  // (administrador de sitio y del sistema; docs/20 §6). Lo que rige a todo un sitio, en dos secciones, cada una por su acción:
  //  · «Primera trama» (`ajustes`): el plazo en horas, con su equivalencia en días y lo que pasa al vencer (AjusteEspera).
  //  · «Vista pública» (`enlaces`): el k y el tope de enlaces vivos, mudados desde «Publicar una vista» (AjusteMinimo, AjusteTope).
  // Cada ajuste es un componente con su propia carga y su propia cancelación.
  import AjusteEspera from './AjusteEspera.svelte';
  import AjusteMinimo from './AjusteMinimo.svelte';
  import AjusteTope from './AjusteTope.svelte';
  import AjusteZonas from './AjusteZonas.svelte';
  import { puedeEnSitio, sitiosConAjustes } from './lib/ajustes';
  import type { Sitio } from './lib/modelo';
  import type { Sesion } from './lib/sesion';
  import { fragmentoAjustes } from './lib/vista';

  let { sitio: codigoPedido, sesion, sitios, alCambiarVista, alCambiarSitios = () => undefined }: {
    sitio: string; sesion: Sesion; sitios: Sitio[] | null; alCambiarVista: (f: string) => void; alCambiarSitios?: () => Promise<void> | void;
  } = $props();

  const mios = $derived(sitios === null ? [] : sitiosConAjustes(sesion, sitios));
  // Un sitio pedido que no es de la persona NO se reemplaza por otro (podría cambiar ajustes de uno que no quería): se dice y se ofrecen los suyos.
  // Solo cuando la dirección no pide ninguno se toma el primero.
  const noEncontrado = $derived(codigoPedido !== '' && mios.length > 0 && !mios.some((x) => x.codigo === codigoPedido));
  const sitio = $derived(noEncontrado ? null : (mios.find((x) => x.codigo === codigoPedido) ?? mios[0] ?? null));
  const conEspera = $derived(sitio !== null && puedeEnSitio(sesion, sitio, 'ajustes'));
  const conVistaPublica = $derived(sitio !== null && puedeEnSitio(sesion, sitio, 'enlaces'));
  const uid = $props.id();
</script>

<h2 data-ajustes-sitio>Ajustes del sitio</h2>
<p class="intro-publicar">Lo que rige a todo el sitio, no a un equipo: sus zonas, cuánto se espera la primera trama de un equipo nuevo y los límites de la vista pública.</p>

{#if sitios === null}
  <p class="vacio" aria-busy="true">Cargando tus sitios…</p>
{:else if noEncontrado}
  <p class="vacio" role="alert" data-sitio-no-encontrado>Ese sitio no existe o no lo administras. Elige uno de los tuyos:</p>
  <ul data-sitios-de-ajustes>
    {#each mios as x (x.id)}<li><a href={fragmentoAjustes(x.codigo)}>{x.nombre}</a></li>{/each}
  </ul>
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
    <section aria-labelledby="{uid}-zonas" class="ajustes-sitio" data-seccion-zonas>
      <h3 id="{uid}-zonas">Zonas</h3>
      <AjusteZonas {sitio} alCambiar={alCambiarSitios} />
    </section>
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
