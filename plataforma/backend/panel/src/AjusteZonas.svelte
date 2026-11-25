<script lang="ts">
  // P15, sección «Zonas» (docs/19 §4, U, punto 5): las zonas del sitio con cuántos dispositivos activos tiene cada una; agregar, renombrar
  // en la misma fila y retirar (o volver a ofrecer). Una zona no se borra: se retira, y solo sin dispositivos activos (el servidor lo
  // comprueba y responde 409 con cuántos; aquí el botón ya viene desactivado con su motivo). Tras cada cambio, `alCambiar` recarga los sitios
  // (las zonas viajan en GET /sitios) para que el alta y la configuración vean lo mismo.
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { pedir } from './lib/api';
  import type { Sitio } from './lib/modelo';
  import { MAX_NOMBRE_ZONA, motivoNombreZona, textoDeError, textoDispositivos } from './lib/estructura';

  let { sitio, alCambiar }: { sitio: Sitio; alCambiar: () => Promise<void> | void } = $props();

  let nueva = $state('');
  let editando = $state<string | null>(null); // id de la zona que se renombra
  let nombreEditado = $state('');
  let ocupado = $state(false);
  let error = $state<string | null>(null);
  let hecho = $state<string | null>(null);
  const uid = $props.id();
  const zonas = $derived([...sitio.zonas].sort((x, y) => Number(y.activo !== false) - Number(x.activo !== false) || x.nombre.localeCompare(y.nombre, 'es')));

  // Devuelve si el cambio salió bien: lo escrito se borra solo entonces (un segundo envío mientras el primero sigue, o un error, lo dejan).
  async function enviar(f: () => Promise<unknown>, exito: string): Promise<boolean> {
    if (ocupado) return false;
    ocupado = true;
    error = null;
    hecho = null;
    try {
      await f();
      hecho = exito;
      await alCambiar();
      return true;
    } catch (e) {
      error = textoDeError(e);
      return false;
    } finally {
      ocupado = false;
    }
  }

  function agregar(): void {
    const motivo = motivoNombreZona(nueva);
    if (motivo !== null) { error = motivo; return; }
    const nombre = nueva.trim();
    void enviar(() => pedir('POST', `/sitios/${encodeURIComponent(sitio.id)}/zonas`, { cuerpo: { nombre } }), `Zona «${nombre}» creada.`).then((bien) => {
      if (bien) nueva = '';
    });
  }
  function renombrar(id: string, antes: string): void {
    const motivo = motivoNombreZona(nombreEditado);
    if (motivo !== null) { error = motivo; return; }
    const nombre = nombreEditado.trim();
    if (nombre === antes) { editando = null; return; }
    void enviar(() => pedir('PATCH', `/zonas/${encodeURIComponent(id)}`, { cuerpo: { nombre } }), `«${antes}» ahora se llama «${nombre}».`).then((bien) => {
      if (bien) editando = null;
    });
  }
  const cambiarActivo = (id: string, nombre: string, activo: boolean): void =>
    void enviar(() => pedir('PATCH', `/zonas/${encodeURIComponent(id)}`, { cuerpo: { activo } }), activo ? `«${nombre}» se vuelve a ofrecer.` : `«${nombre}» quedó retirada.`);
</script>

<p class="ayuda-campo">Las zonas ordenan los equipos del sitio (un edificio, un sector, una sala). Una zona no se borra: se retira, y deja de ofrecerse al dar de alta
  o configurar; su historia se conserva.</p>
{#if error !== null}<Aviso tipo="error" texto={error} alCerrar={() => (error = null)} />{/if}
{#if hecho !== null}<p role="status" class="vivo" data-zonas-hecho>{hecho}</p>{/if}

<ul class="lista-zonas" data-lista-zonas>
  {#each zonas as z (z.id)}
    {@const activa = z.activo !== false}
    {@const n = z.dispositivos ?? 0}
    <li data-zona={z.nombre} class:retirada={!activa}>
      {#if editando === z.id}
        <label class="solo-lector" for="{uid}-ren-{z.id}">Nuevo nombre de «{z.nombre}»</label>
        <input id="{uid}-ren-{z.id}" bind:value={nombreEditado} maxlength={MAX_NOMBRE_ZONA}
          onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); renombrar(z.id, z.nombre); } }} data-campo-renombrar />
        <Boton etiqueta="Guardar" cargando={ocupado} onclick={() => renombrar(z.id, z.nombre)} aria-label="Guardar el nombre de {z.nombre}" data-guardar-zona />
        <Boton etiqueta="Cancelar" variante="discreto" onclick={() => (editando = null)} />
      {:else}
        <span class="nombre-zona">{z.nombre}</span>
        <span class="vivo">{activa ? textoDispositivos(n) : 'retirada'}</span>
        <Boton etiqueta="Renombrar" variante="discreto" onclick={() => { editando = z.id; nombreEditado = z.nombre; error = null; }}
          aria-label="Renombrar {z.nombre}" data-renombrar-zona />
        {#if activa}
          <Boton etiqueta="Retirar" variante="discreto" onclick={() => cambiarActivo(z.id, z.nombre, false)} aria-label="Retirar {z.nombre}"
            motivoDesactivado={n > 0 ? `Tiene ${textoDispositivos(n)}: muévelos de zona o dalos de baja antes de retirarla.` : null} data-retirar-zona />
        {:else}
          <Boton etiqueta="Volver a ofrecer" variante="discreto" onclick={() => cambiarActivo(z.id, z.nombre, true)} aria-label="Volver a ofrecer {z.nombre}" data-reactivar-zona />
        {/if}
      {/if}
    </li>
  {:else}
    <li class="vacio" data-sin-zonas>Este sitio todavía no tiene zonas: agrega la primera para poder dar de alta equipos.</li>
  {/each}
</ul>

<form class="agregar-zona" onsubmit={(e) => { e.preventDefault(); agregar(); }} data-agregar-zona>
  <label for="{uid}-nueva">Zona nueva</label>
  <input id="{uid}-nueva" bind:value={nueva} maxlength={MAX_NOMBRE_ZONA} placeholder="Por ejemplo, Invernadero norte" data-campo-zona-nueva />
  <Boton etiqueta="Agregar zona" variante="principal" tipo="submit" cargando={ocupado} data-boton-agregar-zona />
</form>
