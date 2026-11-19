<script lang="ts">
  // P15, sección «Vista pública», el k del sitio (docs/19 §4, Q, punto 3; bloque O, puntos 2 y «Bajar el k…»). Mudado desde «Publicar una vista»
  // (P9) el 18/11/2026 sin cambiar su comportamiento: bajarlo se confirma con «afecta a todos los enlaces públicos de este sitio» y lo
  // deducible; los avisos de la respuesta; el 409 `minimo_cambio` relee y vuelve a decidir; la respuesta de un sitio anterior no se escribe en
  // el nuevo. Su propia carga y su propia cancelación.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { AVISO_TODOS_LOS_ENLACES, avisoDeEnlace, deduciblePorK, minimoQueRige, type MinimoSitio } from './lib/enlaces';

  let { sitio }: { sitio: string } = $props(); // el id del sitio

  let minimo = $state<MinimoSitio | null>(null);
  let kElegido = $state(3);
  let confirmarK = $state(false);
  let avisosK = $state<string[]>([]);
  let guardandoK = $state(false);
  let avisoAjustes = $state<DatosAviso | null>(null);
  const carga = ultimaGana();
  const kInvalido = $derived(minimo === null || !Number.isInteger(kElegido) || kElegido < minimo.piso || kElegido > minimo.maximo
    ? `elige un número entero entre ${minimo?.piso ?? 1} y ${minimo?.maximo ?? 20}` : kElegido === minimo.minimo_dispositivos ? 'es el que ya rige' : null);

  async function cargar(): Promise<void> {
    const deSitio = sitio;
    try {
      const m = await obtener<MinimoSitio>(`/sitios/${encodeURIComponent(deSitio)}/enlaces/minimo`, carga.senal());
      if (sitio !== deSitio) return;
      // Si el k que rige cambió (otra persona), una confirmación abierta hablaba del de antes: se cierra.
      if (minimo !== null && m.minimo_dispositivos !== minimo.minimo_dispositivos) confirmarK = false;
      minimo = m;
      kElegido = m.minimo_dispositivos;
    } catch (e) {
      if (!esCancelacion(e) && sitio === deSitio) avisoAjustes = avisoDeError(e);
    }
  }

  function pedirGuardarK(): void {
    if (minimo === null || kInvalido !== null) return;
    if (kElegido < minimo.minimo_dispositivos) confirmarK = true; // bajarlo expone más: se confirma sabiendo lo que implica
    else void guardarK();
  }
  async function guardarK(): Promise<void> {
    if (guardandoK) return;
    const deSitio = sitio;
    guardandoK = true;
    avisoAjustes = null;
    const pedido = kElegido;
    try {
      // `anterior`: el k que esta pantalla leyó; si otra persona lo cambió entretanto, el servidor responde 409 sin cambiar nada.
      const cuerpo = minimo === null ? { minimo_dispositivos: pedido } : { minimo_dispositivos: pedido, anterior: minimo.minimo_dispositivos };
      const r = await pedir<MinimoSitio>('PUT', `/sitios/${encodeURIComponent(deSitio)}/enlaces/minimo`, { cuerpo });
      // Si mientras tanto se eligió otro sitio, la respuesta es del anterior: no se escribe en la pantalla del nuevo.
      if (sitio !== deSitio) return;
      minimo = r;
      kElegido = r.minimo_dispositivos;
      avisosK = r.avisos ?? [];
      confirmarK = false;
    } catch (x) {
      if (sitio !== deSitio) return;
      const rige = minimoQueRige(x);
      if (rige === null) avisoAjustes = avisoDeError(x);
      else {
        // Se relee y se vuelve a decidir con el k de ahora: si lo pedido lo baja, se confirma otra vez.
        confirmarK = false;
        await cargar();
        if (sitio !== deSitio) return; // durante la relectura se eligió otro sitio
        kElegido = pedido;
        avisoAjustes = { tipo: 'conflicto', texto: avisoDeEnlace(x).texto };
        if (minimo !== null && pedido < minimo.minimo_dispositivos) confirmarK = true;
      }
    } finally {
      if (sitio === deSitio) guardandoK = false; // el otro sitio puede tener su propio guardado en vuelo
    }
  }

  // Otro sitio es otro k: se olvida lo cargado y lo escrito, y se pide lo suyo.
  $effect(() => {
    void sitio;
    untrack(() => {
      carga.cancelar();
      minimo = null;
      avisosK = [];
      confirmarK = false;
      avisoAjustes = null;
      guardandoK = false;
      void cargar();
    });
  });
  onMount(() => () => carga.cancelar());
</script>

<div class="ajuste" data-ajuste-minimo>
  <h4>Mínimo de dispositivos por valor (k)</h4>
  {#if avisoAjustes !== null}<Aviso tipo={avisoAjustes.tipo} texto={avisoAjustes.texto} alCerrar={() => (avisoAjustes = null)} />{/if}
  {#if minimo === null}
    <p class="vacio" aria-busy="true">Cargando…</p>
  {:else}
    <p>Rige <strong data-minimo-actual>k = {minimo.minimo_dispositivos}</strong>{minimo.fijado ? ', fijado para este sitio' : `, el de omisión de esta instalación (${minimo.por_omision})`}.
      Un promedio que aportan menos de k dispositivos sale en blanco, igual que un tramo sin datos.</p>
    <p class="aviso-publico" data-aviso-todos>{AVISO_TODOS_LOS_ENLACES}</p>
    <div class="fila-campos">
      <label>k, de {minimo.piso} a {minimo.maximo}
        <input type="number" min={minimo.piso} max={minimo.maximo} step="1" bind:value={kElegido} oninput={() => (confirmarK = false)} data-minimo-campo />
      </label>
      <Boton etiqueta="Guardar el mínimo" cargando={guardandoK} etiquetaCargando="Guardando…" motivoDesactivado={guardandoK || confirmarK ? null : kInvalido} onclick={pedirGuardarK} data-guardar-minimo />
    </div>
    {#if confirmarK}
      <div class="confirmacion" role="alert" data-confirmar-minimo-aviso>
        <p>Vas a bajar k de {minimo.minimo_dispositivos} a {kElegido}. {AVISO_TODOS_LOS_ENLACES} {deduciblePorK(kElegido)}</p>
        <span class="acciones">
          <Boton etiqueta={`Bajar a ${kElegido}`} variante="peligro" cargando={guardandoK} etiquetaCargando="Guardando…" onclick={() => void guardarK()} data-confirmar-minimo />
          <Boton etiqueta="Cancelar" onclick={() => { confirmarK = false; kElegido = minimo?.minimo_dispositivos ?? kElegido; }} />
        </span>
      </div>
    {/if}
    {#if avisosK.length > 0}
      <div role="status" data-avisos-minimo>
        <p>Guardado: rige desde la próxima visita de cada enlace. Lo que un visitante podría deducir ahora:</p>
        <ul class="avisos-publicar">{#each avisosK as a (a)}<li data-aviso-minimo>{a}</li>{/each}</ul>
      </div>
    {/if}
  {/if}
</div>
