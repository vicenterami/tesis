<script lang="ts">
  // «Elegir qué ver» (docs/19 §4 AA, punto 7; RF-56, HU-29): una casilla por magnitud ofrecida, marcada = se ve. Nada oculto por omisión.
  // En el Resumen se abre con el botón y se guarda con «Guardar» (un solo PUT con la lista completa); en P13 va siempre abierta y cada
  // casilla guarda al cambiar, como el resto de esa pantalla. La ficha y «Red» no la usan: muestran siempre todo.
  import Boton from './Boton.svelte';
  import { alternarOculta } from './lib/preferencias';

  let {
    magnitudes,
    ocultas,
    alGuardar,
    siempreAbierto = false,
    guardando = false,
  }: {
    magnitudes: readonly { codigo: string; nombre: string }[];
    ocultas: readonly string[];
    alGuardar: (ocultas: string[]) => void | Promise<void>;
    siempreAbierto?: boolean;
    guardando?: boolean;
  } = $props();
  const uid = $props.id();

  let abierto = $state(false);
  let borrador = $state<string[]>([]);
  const ofrecidas = $derived(magnitudes.map((m) => m.codigo));
  const vigentes = $derived(siempreAbierto ? [...ocultas] : borrador);
  const ocultasAqui = $derived(ocultas.filter((m) => ofrecidas.includes(m)).length);

  function abrir(): void {
    borrador = [...ocultas];
    abierto = true;
  }
  function alternar(codigo: string, ver: boolean): void {
    const nuevas = alternarOculta(vigentes, ofrecidas, codigo, ver);
    if (siempreAbierto) void alGuardar(nuevas);
    else borrador = nuevas;
  }
  async function guardar(): Promise<void> {
    await alGuardar(borrador);
    abierto = false;
  }
</script>

<div class="elegir-que-ver" data-elegir-que-ver>
  {#if !siempreAbierto}
    <p class="vivo fila-elegir">
      {#if ocultasAqui > 0}<span data-ocultas-cuenta>{ocultasAqui === 1 ? '1 magnitud oculta' : `${ocultasAqui} magnitudes ocultas`}.</span>{/if}
      <Boton etiqueta="Elegir qué ver" variante="discreto" presionado={abierto} ayuda="Marca las magnitudes que quieres ver en el Resumen y en «Tendencias»; la ficha muestra siempre todo"
        onclick={() => (abierto ? (abierto = false) : abrir())} data-abrir-elegir />
    </p>
  {/if}
  {#if siempreAbierto || abierto}
    <fieldset class="regla" aria-describedby="{uid}-ayuda" data-lista-elegir>
      <legend>Magnitudes que ves</legend>
      <p class="ayuda-campo" id="{uid}-ayuda">Desmarca las que no quieres ver en el Resumen ni en «Tendencias». La ficha de cada equipo y «Red» muestran siempre todo.</p>
      {#each magnitudes as m (m.codigo)}
        <label class="marcar"><input type="checkbox" checked={!vigentes.includes(m.codigo)} disabled={guardando}
          onchange={(e) => alternar(m.codigo, e.currentTarget.checked)} data-ver-magnitud={m.codigo} /> {m.nombre}</label>
      {/each}
      {#if !siempreAbierto}
        <span class="acciones">
          <Boton tipo="button" variante="principal" etiqueta="Guardar" etiquetaCargando="Guardando…" cargando={guardando} onclick={() => void guardar()} data-guardar-elegir />
          <Boton etiqueta="Cancelar" variante="discreto" onclick={() => (abierto = false)} data-cancelar-elegir />
        </span>
      {/if}
    </fieldset>
  {/if}
</div>
