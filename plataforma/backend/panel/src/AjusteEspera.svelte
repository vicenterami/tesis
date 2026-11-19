<script lang="ts">
  // P15, sección «Primera trama» (docs/19 §4, Q, punto 2): el plazo en horas que el sitio espera la primera trama de un equipo. Tiene su propia
  // carga y su propia cancelación (la del plazo, la de la pregunta «¿a cuántos afecta?» y la de cada guardado son distintas de las del k y el
  // tope: el 17/11/2026 compartir la cancelación hizo que un pedido cancelara a otro).
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    AL_VENCER_LA_ESPERA, CUANDO_RIGE_LA_ESPERA, POR_QUE_LA_ESPERA, acortaElPlazo, afectadosDe, avisoDeEspera, equivalenciaEnDias, esperaQueRige, faltaEspera,
    textoAfectados, textoEquivalencia, textoPlazoGuardado, type EsperaSitio,
  } from './lib/ajustes';

  let { sitio }: { sitio: string } = $props(); // el id del sitio

  let espera = $state<EsperaSitio | null>(null);
  let horas = $state(168);
  let guardando = $state(false);
  let consultando = $state(false);
  let afectados = $state<number | null>(null); // con un número, la confirmación de acortar está abierta
  let consultado = $state(0); // las horas que se consultaron y que «Guardar igual» guarda: exactamente ese valor
  let aviso = $state<DatosAviso | null>(null);
  const carga = ultimaGana();
  const cargaAfectados = ultimaGana();
  const falta = $derived(faltaEspera(horas, espera));
  const uid = $props.id();

  async function cargar(): Promise<void> {
    const deSitio = sitio;
    try {
      const r = await obtener<EsperaSitio>(`/sitios/${encodeURIComponent(deSitio)}/espera-primera-trama`, carga.senal());
      if (sitio !== deSitio) return;
      // Si el plazo que rige cambió (otra persona), una confirmación abierta hablaba del de antes: se cierra.
      if (espera !== null && r.espera_primera_trama_h !== espera.espera_primera_trama_h) afectados = null;
      espera = r;
      horas = r.espera_primera_trama_h;
    } catch (e) {
      if (!esCancelacion(e) && sitio === deSitio) aviso = avisoDeError(e);
    }
  }

  // Alargarlo o dejarlo igual se guarda directo; acortarlo pregunta antes a cuántos equipos afecta (con 0, también directo). Si la pregunta
  // falla, se dice y no se guarda: la pregunta no se salta.
  async function pedirGuardar(): Promise<void> {
    if (espera === null || falta !== null || guardando || consultando) return;
    afectados = null; // una confirmación vieja no sobrevive a una pregunta nueva
    const propuesto = horas;
    if (!acortaElPlazo(propuesto, espera)) {
      void guardar(propuesto);
      return;
    }
    const deSitio = sitio;
    consultando = true;
    aviso = null;
    try {
      const r = await obtener<EsperaSitio>(`/sitios/${encodeURIComponent(deSitio)}/espera-primera-trama?propuesto=${propuesto}`, cargaAfectados.senal());
      if (sitio !== deSitio) return;
      if (horas !== propuesto) return; // el campo cambió mientras se consultaba: la respuesta habla de otro valor y se descarta
      const n = afectadosDe(r);
      if (n > 0) {
        consultado = propuesto;
        afectados = n;
      } else void guardar(propuesto);
    } catch (e) {
      if (esCancelacion(e) || sitio !== deSitio) return;
      aviso = avisoDeError(e);
    } finally {
      if (sitio === deSitio) consultando = false;
    }
  }
  // Guarda exactamente `pedido`: el valor que se consultó o confirmó, no lo que diga el campo al guardar.
  async function guardar(pedido: number): Promise<void> {
    if (espera === null || guardando) return;
    const deSitio = sitio;
    guardando = true;
    aviso = null;
    try {
      // `anterior`: el plazo que esta pantalla leyó; si otra persona lo cambió entretanto, el servidor responde 409 sin cambiar nada.
      const r = await pedir<EsperaSitio>('PUT', `/sitios/${encodeURIComponent(deSitio)}/espera-primera-trama`, { cuerpo: { espera_primera_trama_h: pedido, anterior: espera.espera_primera_trama_h } });
      if (sitio !== deSitio) return; // la respuesta es del sitio anterior
      espera = r;
      horas = r.espera_primera_trama_h;
      afectados = null;
      aviso = { tipo: 'exito', texto: textoPlazoGuardado(r.espera_primera_trama_h) };
    } catch (x) {
      if (sitio !== deSitio) return;
      afectados = null;
      if (esperaQueRige(x) === null) aviso = avisoDeEspera(x);
      else {
        // Se relee y se deja lo pedido en el campo, con el aviso del valor nuevo que puso la otra persona.
        await cargar();
        if (sitio !== deSitio) return; // durante la relectura se eligió otro sitio
        horas = pedido;
        aviso = avisoDeEspera(x);
      }
    } finally {
      if (sitio === deSitio) guardando = false;
    }
  }

  // Otro sitio es otra sección: se olvida lo cargado y lo escrito, y se pide lo suyo.
  $effect(() => {
    void sitio;
    untrack(() => {
      carga.cancelar();
      cargaAfectados.cancelar();
      espera = null;
      afectados = null;
      aviso = null;
      guardando = false;
      consultando = false;
      void cargar();
    });
  });
  onMount(() => () => {
    carga.cancelar();
    cargaAfectados.cancelar();
  });
</script>

<div class="ajuste" data-ajuste-espera>
  <h4 id="{uid}-titulo">Plazo de la primera trama</h4>
  <p data-espera-al-vencer>{AL_VENCER_LA_ESPERA}</p>
  <p class="aviso-publico" data-espera-por-que>{POR_QUE_LA_ESPERA}</p>
  <p>{CUANDO_RIGE_LA_ESPERA}</p>
  {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
  {#if espera === null}
    <p class="vacio" aria-busy="true">Cargando…</p>
  {:else}
    <p>Rige <strong data-espera-actual>{espera.espera_primera_trama_h}</strong> h ({equivalenciaEnDias(espera.espera_primera_trama_h)}); el de omisión es de {espera.por_omision} h.</p>
    <div class="fila-campos">
      <label>Horas de espera, de {espera.minimo} a {espera.maximo}
        <input type="number" min={espera.minimo} max={espera.maximo} step="1" bind:value={horas} disabled={consultando || guardando} oninput={() => (afectados = null)} data-espera-campo />
      </label>
      <span class="vivo" aria-live="polite" data-espera-dias>{Number.isInteger(horas) && horas >= 1 ? textoEquivalencia(horas) : ''}</span>
      <Boton etiqueta="Guardar el plazo" cargando={guardando || consultando} etiquetaCargando={consultando ? 'Comprobando…' : 'Guardando…'}
        motivoDesactivado={guardando || consultando || afectados !== null ? null : falta} onclick={() => void pedirGuardar()} data-guardar-espera />
    </div>
    {#if afectados !== null}
      <div class="confirmacion" role="alert" data-confirmar-espera-aviso>
        <p>{textoAfectados(afectados)}</p>
        <span class="acciones">
          <Boton etiqueta="Guardar igual" variante="peligro" cargando={guardando} etiquetaCargando="Guardando…" onclick={() => void guardar(consultado)} data-confirmar-espera />
          <Boton etiqueta="Cancelar" onclick={() => { afectados = null; horas = espera?.espera_primera_trama_h ?? horas; }} />
        </span>
      </div>
    {/if}
  {/if}
</div>
