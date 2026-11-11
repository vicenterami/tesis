<script lang="ts">
  // Aceptación de los términos de uso (docs/20 §12; docs/19 §4, P11; RF-53, HU-27). Con la sesión restringida (el servidor responde 403
  // `terminos_pendientes` a todo lo que no sea legal, aceptar o salir), el panel muestra el texto completo, «Acepto los términos (versión
  // N)» y «Salir»; sin aceptar no se ve ningún dato (las pantallas no se montan). Aceptar no es optimista: espera la respuesta.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { bloquesDeTexto, textoDe, type TextoLegal } from './lib/legal';

  let { alAceptar, alSalir }: { alAceptar: () => void; alSalir: () => void } = $props();
  let t = $state<TextoLegal | null>(null);
  let error = $state<DatosAviso | null>(null);
  let aceptando = $state(false);

  async function cargar(): Promise<void> {
    try {
      t = textoDe(await pedir<unknown>('GET', '/terminos', { central: false }));
      error = t === null ? { tipo: 'error', texto: 'El servicio no entregó el texto de los términos.' } : null;
    } catch (e) {
      error = avisoDeError(e);
    }
  }
  async function aceptar(): Promise<void> {
    if (t === null || aceptando) return;
    aceptando = true;
    error = null;
    try {
      await pedir('POST', '/terminos/aceptar', { cuerpo: { version: t.version } });
      alAceptar();
    } catch (e) {
      error = avisoDeError(e);
      aceptando = false;
    }
  }
  onMount(() => void cargar());
</script>

<div class="tarjeta-sesion texto-legal" data-terminos>
  <h2>Términos de uso</h2>
  <p>Antes de seguir, lee y acepta los términos de uso{t?.version !== undefined ? ` (versión ${t.version}${t.fecha ? `, del ${t.fecha}` : ''})` : ''}. Hasta
    aceptarlos no se muestra ningún dato. También puedes leer la <a href="#/legal?seccion=privacidad">página de privacidad</a>.</p>
  {#if error !== null}<Aviso tipo={error.tipo} texto={error.texto} accion={t === null ? { etiqueta: 'Reintentar', alHacer: () => void cargar() } : undefined} />{/if}
  {#if t === null}
    {#if error === null}<p class="vacio">Cargando…</p>{/if}
  {:else}
    <div class="texto-legal" data-texto-terminos>
      {#each bloquesDeTexto(t.texto) as b, i (i)}
        {#if b.tipo === 'titulo'}<h3>{b.texto}</h3>
        {:else if b.tipo === 'lista'}<ul>{#each b.items as it, j (j)}<li>{it}</li>{/each}</ul>
        {:else}<p>{b.texto}</p>{/if}
      {/each}
    </div>
  {/if}
  <span class="acciones">
    <Boton variante="principal" etiqueta={`Acepto los términos (versión ${t?.version ?? '…'})`} etiquetaCargando="Aceptando…" cargando={aceptando}
      motivoDesactivado={t === null ? 'cargando el texto' : null} onclick={() => void aceptar()} data-aceptar-terminos />
    <Boton etiqueta="Salir" onclick={alSalir} data-salir-terminos />
  </span>
</div>
