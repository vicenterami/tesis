<script lang="ts">
  // P16 Catálogo (docs/19 §4, T; TT-12): magnitudes y recetas de decodificación, solo para quien administra el sistema (App.svelte decide si se
  // muestra). Esta pantalla carga lo que las dos secciones comparten (las magnitudes, las unidades admitidas y las recetas) y las relee cuando una
  // sección guarda algo. La ruta nunca es «última vista» (punto 1).
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import CatalogoMagnitudes from './CatalogoMagnitudes.svelte';
  import CatalogoRecetas from './CatalogoRecetas.svelte';
  import { esCancelacion, obtener, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import type { Magnitud, Receta, SeccionCatalogo } from './lib/catalogo';

  let { seccion, alCambiarVista }: { seccion: SeccionCatalogo; alCambiarVista: (fragmento: string) => void } = $props();

  let magnitudes = $state<Magnitud[] | null>(null);
  let unidades = $state<string[]>([]);
  let recetas = $state<Receta[] | null>(null);
  let aviso = $state<DatosAviso | null>(null);
  const carga = ultimaGana();

  async function cargar(): Promise<void> {
    try {
      const senal = carga.senal();
      const [m, u, r] = await Promise.all([
        obtener<Magnitud[]>('/magnitudes', senal), obtener<string[]>('/magnitudes/unidades', senal), obtener<Receta[]>('/recetas-decodificacion', senal),
      ]);
      magnitudes = m;
      unidades = u;
      recetas = r;
      aviso = null;
    } catch (e) {
      if (!esCancelacion(e)) aviso = avisoDeError(e);
    }
  }
  onMount(() => {
    void cargar();
    return () => carga.cancelar();
  });
  const PESTANAS: { seccion: SeccionCatalogo; texto: string }[] = [{ seccion: 'magnitudes', texto: 'Magnitudes' }, { seccion: 'recetas', texto: 'Recetas de decodificación' }];
</script>

<section class="catalogo" aria-labelledby="titulo-catalogo" data-catalogo>
  <h2 id="titulo-catalogo">Catálogo</h2>
  <p class="ayuda-seccion">Lo que la plataforma sabe medir y cómo lee la trama de un equipo LoRaWAN. Lo que guardas aquí rige para todos los sitios
    desde la próxima trama. Nada se borra: una magnitud con mediciones o una receta en uso tienen historia.</p>
  <nav class="pestanas" aria-label="Secciones del catálogo">
    {#each PESTANAS as p (p.seccion)}
      <a href={`#/catalogo?seccion=${p.seccion}`} aria-current={seccion === p.seccion ? 'page' : undefined}
        onclick={(ev) => { ev.preventDefault(); alCambiarVista(`#/catalogo?seccion=${p.seccion}`); }} data-pestana={p.seccion}>{p.texto}</a>
    {/each}
  </nav>
  {#if aviso !== null}
    <Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />
    {#if magnitudes === null}<Boton etiqueta="Reintentar" onclick={() => void cargar()} />{/if}
  {/if}
  {#if magnitudes === null || recetas === null}
    {#if aviso === null}<p class="vacio" aria-busy="true">Cargando el catálogo…</p>{/if}
  {:else if seccion === 'magnitudes'}
    <CatalogoMagnitudes {magnitudes} {unidades} alGuardar={cargar} />
  {:else}
    <CatalogoRecetas {recetas} {magnitudes} alGuardar={cargar} />
  {/if}
</section>

<style>
  .ayuda-seccion { max-width: 72ch; color: var(--texto-secundario); }
  .pestanas { display: flex; gap: 0.25rem; border-bottom: 1px solid var(--borde); margin: 1rem 0; flex-wrap: wrap; }
  .pestanas a { padding: 0.5rem 0.9rem; text-decoration: none; border-bottom: 3px solid transparent; color: inherit; }
  .pestanas a[aria-current='page'] { border-bottom-color: var(--acento); font-weight: 600; }
  .pestanas a:focus-visible { outline: 2px solid var(--acento); outline-offset: 2px; }
</style>
