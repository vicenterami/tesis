<script lang="ts">
  // P15, sección «Vista pública», el tope de enlaces vivos del sitio (docs/19 §4, Q, punto 3; bloque O, punto del tope). Mudado desde
  // «Publicar una vista» (P9) el 18/11/2026 sin cambiar su comportamiento. Su propia carga y su propia cancelación.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import type { TopeEnlaces } from './lib/enlaces';

  let { sitio }: { sitio: string } = $props(); // el id del sitio

  let tope = $state<TopeEnlaces | null>(null);
  let topeElegido = $state(50);
  let guardandoTope = $state(false);
  let avisoAjustes = $state<DatosAviso | null>(null);
  const carga = ultimaGana();
  const topeInvalido = $derived(tope === null || !Number.isInteger(topeElegido) || topeElegido < 1 || topeElegido > tope.techo
    ? `elige un número entero entre 1 y ${tope?.techo ?? 200}` : topeElegido === tope.max_enlaces ? 'es el que ya rige' : null);

  async function cargar(): Promise<void> {
    const deSitio = sitio;
    try {
      const tp = await obtener<TopeEnlaces>(`/sitios/${encodeURIComponent(deSitio)}/enlaces/tope`, carga.senal());
      if (sitio !== deSitio) return;
      tope = tp;
      topeElegido = tp.max_enlaces;
    } catch (e) {
      if (!esCancelacion(e) && sitio === deSitio) avisoAjustes = avisoDeError(e);
    }
  }
  async function guardarTope(): Promise<void> {
    if (guardandoTope || topeInvalido !== null) return;
    const deSitio = sitio;
    guardandoTope = true;
    avisoAjustes = null;
    try {
      const r = await pedir<TopeEnlaces>('PUT', `/sitios/${encodeURIComponent(deSitio)}/enlaces/tope`, { cuerpo: { max_enlaces: topeElegido } });
      if (sitio !== deSitio) return; // la respuesta es del sitio anterior
      tope = r;
      topeElegido = r.max_enlaces;
      avisoAjustes = { tipo: 'exito', texto: `El tope de enlaces vivos de este sitio es ahora ${r.max_enlaces}.` };
    } catch (x) {
      if (sitio !== deSitio) return;
      avisoAjustes = avisoDeError(x);
    } finally {
      if (sitio === deSitio) guardandoTope = false;
    }
  }

  $effect(() => {
    void sitio;
    untrack(() => {
      carga.cancelar();
      tope = null;
      avisoAjustes = null;
      guardandoTope = false;
      void cargar();
    });
  });
  onMount(() => () => carga.cancelar());
</script>

<div class="ajuste" data-ajuste-tope>
  <h4>Tope de enlaces vivos</h4>
  {#if avisoAjustes !== null}<Aviso tipo={avisoAjustes.tipo} texto={avisoAjustes.texto} alCerrar={() => (avisoAjustes = null)} />{/if}
  {#if tope === null}
    <p class="vacio" aria-busy="true">Cargando…</p>
  {:else}
    <p>Hay <strong data-vivos>{tope.vivos}</strong> de <strong data-tope-actual>{tope.max_enlaces}</strong>{tope.fijado ? ', fijado para este sitio' : ` (el de omisión, ${tope.por_omision})`}.
      Bajarlo no revoca nada: impide crear otro hasta que haya lugar.</p>
    <div class="fila-campos">
      <label>Tope, de 1 a {tope.techo}
        <input type="number" min="1" max={tope.techo} step="1" bind:value={topeElegido} data-tope-campo />
      </label>
      <Boton etiqueta="Guardar el tope" cargando={guardandoTope} etiquetaCargando="Guardando…" motivoDesactivado={guardandoTope ? null : topeInvalido} onclick={() => void guardarTope()} data-guardar-tope />
    </div>
  {/if}
</div>
