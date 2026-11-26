<script lang="ts">
  // «Lo que la trama trae y no se guarda» (docs/19 §4 AA, punto 6; docs/10 §8.4 punto 72 i), en P6 Configurar y en la ficha. Solo con la
  // acción `escribir`: lee cargas crudas, que no son públicas. Cada clave con su magnitud del catálogo (o «sin magnitud en el catálogo»), su
  // último valor y hace cuánto; con magnitud, «Agregar» crea el canal (`POST /dispositivos/{id}/canales`) y la clave sale de la lista.
  // Bajo demanda (por omisión): no relee las tramas al abrir la pantalla, sino al pulsar «Revisar las tramas»; releer 20 cargas en cada
  // visita a la ficha o a P6 no se justifica (`bajoDemanda={false}` revisa al montar).
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { haceCuanto } from './lib/tiempo';
  import { simbolo } from './lib/unidades';

  interface Clave { clave: string; magnitud: string | null; valor: number | null; unidad: string | null; visto: string; origen: 'carga' | 'enlace' }
  let {
    dispositivoId,
    sitioCodigo,
    sesion = null,
    administraCatalogo = false,
    alAgregar = () => {},
    bajoDemanda = true,
  }: { dispositivoId: string; sitioCodigo: string; sesion?: Sesion | null; administraCatalogo?: boolean; alAgregar?: (magnitud: string) => void; bajoDemanda?: boolean } = $props();
  const uid = $props.id();

  const puede = $derived(puedeEn(sesion, 'escribir', sitioCodigo));
  let datos = $state<{ revisadas: number; claves: Clave[] } | null>(null);
  let error = $state<string | null>(null);
  let agregando = $state<string | null>(null);
  let aviso = $state<DatosAviso | null>(null);
  let pedido = $state(false);
  const carga = ultimaGana();

  async function cargar(): Promise<void> {
    pedido = true;
    try {
      const r = await obtener<{ revisadas: number; claves: Clave[] }>(`/dispositivos/${encodeURIComponent(dispositivoId)}/sin-guardar`, carga.senal());
      if (!Array.isArray(r?.claves) || typeof r.revisadas !== 'number') throw new Error('respuesta con otra forma');
      datos = r;
      error = null;
    } catch (e) {
      if (!esCancelacion(e)) error = avisoDeError(e).texto;
    }
  }
  onMount(() => {
    if (puede && !bajoDemanda) void cargar();
    return () => carga.cancelar();
  });

  async function agregar(c: Clave): Promise<void> {
    if (c.magnitud === null || agregando !== null) return;
    const magnitud = c.magnitud;
    agregando = magnitud;
    aviso = null;
    try {
      const r = await pedir<{ agregada?: boolean }>('POST', `/dispositivos/${encodeURIComponent(dispositivoId)}/canales`, { cuerpo: { magnitud } });
      if (datos !== null) datos = { ...datos, claves: datos.claves.filter((x) => x.magnitud !== magnitud) };
      aviso = r?.agregada === false
        ? { tipo: 'info', texto: `«${magnitud}»: el equipo ya la guardaba (se agregó desde otra pantalla).` }
        : { tipo: 'exito', texto: `«${magnitud}»: se guarda desde la próxima trama; lo que llegó antes no se rellena.` };
      alAgregar(magnitud);
    } catch (e) {
      aviso = avisoDeError(e);
    } finally {
      agregando = null;
    }
  }
  const valor = (c: Clave): string => (c.valor === null ? 'sin valor numérico' : `${c.valor.toLocaleString('es-CL', { maximumFractionDigits: 3 }).replace('-', '−')}${c.unidad ? ` ${simbolo(c.unidad)}` : ''}`);
</script>

{#if puede}
  <section class="panel-seccion" aria-labelledby="{uid}-titulo" data-sin-guardar>
    <h3 id="{uid}-titulo">Lo que la trama trae y no se guarda</h3>
    {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
    <!-- Un error al volver a revisar (429 por el tope, 503 por el tiempo) se dice sin borrar la lista que ya se ve (docs/19 §4 AA, punto 6). -->
    {#if error !== null && datos !== null}<div data-sin-guardar-error><Aviso tipo="error" texto={`No se pudieron volver a revisar las tramas: ${error}`} alCerrar={() => (error = null)} /></div>{/if}
    {#if !pedido}
      <p class="vivo">Revisa las tramas recientes de este equipo para ver si traen algo que no guarda (otra magnitud, la señal del enlace).
        <Boton etiqueta="Revisar las tramas" onclick={() => void cargar()} data-revisar-tramas /></p>
    {:else if error !== null && datos === null}
      <Aviso tipo="error" texto={`No se pudieron revisar las tramas: ${error}`} accion={{ etiqueta: 'Volver a revisar', alHacer: () => void cargar() }} />
    {:else if datos === null}
      <p class="vacio" aria-busy="true">Revisando las tramas recientes…</p>
    {:else if datos.claves.length === 0}
      <p class="vivo" data-sin-guardar-vacio>{datos.revisadas === 0 ? 'Aún no hay tramas retenidas de este equipo para revisar.' : `Nada que agregar: las ${datos.revisadas} tramas más recientes no traen nada que este equipo no guarde.`}</p>
    {:else}
      <p class="vivo">De las {datos.revisadas} tramas más recientes. Solo se ofrece lo que tiene magnitud en el catálogo.</p>
      <ul class="lista-sin-guardar" data-sin-guardar-lista>
        {#each datos.claves as c (c.clave)}
          <li data-sin-guardar-clave={c.clave}>
            <span><code>{c.clave}</code>{c.origen === 'enlace' ? ' (señal del enlace)' : ''}: {valor(c)} · {haceCuanto(c.visto, new Date())}</span>
            {#if c.magnitud !== null}
              <Boton etiqueta={`Agregar ${c.magnitud}`} etiquetaCargando="Agregando…" cargando={agregando === c.magnitud} motivoDesactivado={agregando !== null && agregando !== c.magnitud ? 'otra en curso' : null}
                onclick={() => void agregar(c)} data-agregar-clave={c.magnitud} />
            {:else}
              <span class="vivo" data-sin-magnitud>sin magnitud en el catálogo{#if administraCatalogo}: <a href="#/catalogo?seccion=magnitudes" data-ir-catalogo>créala o dale un alias en el catálogo</a>{:else}: pídelo a quien administra el sistema{/if}</span>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
    {#if datos !== null}<p class="vivo"><Boton etiqueta="Volver a revisar" variante="discreto" onclick={() => void cargar()} data-revisar-otra-vez /></p>{/if}
  </section>
{/if}
