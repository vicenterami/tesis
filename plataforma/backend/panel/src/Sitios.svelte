<script lang="ts">
  // P17 «Sitios» (docs/19 §4, U, punto 6): solo el administrador del sistema (acción `sistema`). La lista de sitios con su código, zona
  // horaria, zonas y dispositivos, y «Crear sitio» con su primera zona (POST /sitios, todo o nada). El código va en los tópicos y no cambia
  // después; por eso se sugiere desde el nombre y se muestra la regla. «Editar» cambia en la misma fila el nombre y la descripción
  // (PATCH /sitios/{id}, solo lo que cambió); el código y la zona horaria no se editan. Tras crear o editar, `alCambiar` recarga los sitios
  // de toda la aplicación. Bajo 700 px la tabla se desplaza dentro de su caja (como la de Usuarios), nunca la página.
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { pedir } from './lib/api';
  import type { Sitio } from './lib/modelo';
  import {
    MAX_DESCRIPCION_SITIO, MAX_NOMBRE_SITIO, MAX_NOMBRE_ZONA, ZONA_INICIAL, codigoSugerido, motivoDescripcionSitio, motivoNombreSitio, motivoNombreZona, motivoSitio, textoDeError, zonaInicial,
    zonasHorarias,
  } from './lib/estructura';
  import { fragmentoAjustes } from './lib/vista';

  let { sitios, alCambiar }: { sitios: Sitio[] | null; alCambiar: () => Promise<void> | void } = $props();

  let abierto = $state(false);
  let nombre = $state('');
  let codigo = $state('');
  let codigoTocado = $state(false);
  let descripcion = $state('');
  const zonas = zonasHorarias();
  let zonaHoraria = $state(zonaInicial(zonas));
  let primeraZona = $state(ZONA_INICIAL);
  let creando = $state(false);
  let error = $state<string | null>(null);
  let creado = $state<{ nombre: string; codigo: string } | null>(null);
  const uid = $props.id();
  $effect(() => {
    if (!codigoTocado) codigo = codigoSugerido(nombre);
  });
  const activas = (s: Sitio): number => s.zonas.filter((z) => z.activo !== false).length;
  const equipos = (s: Sitio): number => s.zonas.reduce((t, z) => t + (z.dispositivos ?? 0), 0);

  async function crear(): Promise<void> {
    if (creando) return;
    const motivo = motivoSitio(nombre, codigo) ?? motivoDescripcionSitio(descripcion) ?? motivoNombreZona(primeraZona);
    if (motivo !== null) { error = motivo; return; }
    creando = true;
    error = null;
    try {
      const r = await pedir<{ nombre: string; codigo: string }>('POST', '/sitios', {
        cuerpo: { nombre: nombre.trim(), codigo, zona_horaria: zonaHoraria, primera_zona: primeraZona.trim(), ...(descripcion.trim() === '' ? {} : { descripcion: descripcion.trim() }) },
      });
      creado = { nombre: r.nombre, codigo: r.codigo };
      abierto = false;
      nombre = ''; descripcion = ''; codigoTocado = false; primeraZona = ZONA_INICIAL;
      await alCambiar();
    } catch (e) {
      error = textoDeError(e);
    } finally {
      creando = false;
    }
  }

  // Editar en la misma fila: solo viaja lo que cambió; sin cambios, se cierra sin pedir nada. Una descripción vaciada se manda como null.
  let editando = $state<string | null>(null); // id del sitio
  let nombreEditado = $state('');
  let descripcionEditada = $state('');
  let guardando = $state(false);
  let errorEdicion = $state<string | null>(null);
  let guardado = $state<string | null>(null);
  function editar(s: Sitio): void {
    editando = s.id;
    nombreEditado = s.nombre;
    descripcionEditada = s.descripcion ?? '';
    errorEdicion = null;
    guardado = null;
  }
  async function guardar(s: Sitio): Promise<void> {
    if (guardando) return;
    const motivo = motivoNombreSitio(nombreEditado) ?? motivoDescripcionSitio(descripcionEditada);
    if (motivo !== null) { errorEdicion = motivo; return; }
    const cuerpo: { nombre?: string; descripcion?: string | null } = {};
    if (nombreEditado.trim() !== s.nombre) cuerpo.nombre = nombreEditado.trim();
    if (descripcionEditada.trim() !== (s.descripcion ?? '')) cuerpo.descripcion = descripcionEditada.trim() === '' ? null : descripcionEditada.trim();
    if (Object.keys(cuerpo).length === 0) { editando = null; return; }
    guardando = true;
    errorEdicion = null;
    try {
      await pedir('PATCH', `/sitios/${encodeURIComponent(s.id)}`, { cuerpo });
      guardado = `Sitio «${nombreEditado.trim()}» actualizado.`;
      editando = null;
      await alCambiar();
    } catch (e) {
      errorEdicion = textoDeError(e);
    } finally {
      guardando = false;
    }
  }
</script>

<h2 data-pantalla-sitios>Sitios</h2>
<p class="intro-publicar">Cada sitio agrupa sus zonas, sus equipos y sus personas. Aquí se crean; sus zonas y ajustes los cambia quien administra cada sitio.</p>

{#if creado !== null}
  <p role="status" class="vivo" data-sitio-creado>Sitio «{creado.nombre}» creado con su primera zona.
    <a href="#/usuarios">Agregar personas a este sitio</a> · <a href={fragmentoAjustes(creado.codigo)}>Sus zonas y ajustes</a></p>
{/if}

{#if guardado !== null}<p role="status" class="vivo" data-sitio-guardado>{guardado}</p>{/if}

{#if sitios === null}
  <p class="vacio" aria-busy="true">Cargando los sitios…</p>
{:else}
  <div class="tabla">
  <table data-tabla-sitios>
    <caption class="solo-lector">Sitios de la plataforma</caption>
    <thead><tr><th scope="col">Sitio</th><th scope="col">Código</th><th scope="col">Zona horaria</th><th scope="col">Zonas</th><th scope="col">Equipos</th><th scope="col">Acciones</th></tr></thead>
    <tbody>
      {#each sitios as s (s.id)}
        <tr data-sitio={s.codigo}>
          {#if editando === s.id}
            <td>
              <div class="campo">
                <label for="{uid}-ed-nombre-{s.id}">Nombre del sitio</label>
                <input id="{uid}-ed-nombre-{s.id}" bind:value={nombreEditado} maxlength={MAX_NOMBRE_SITIO} data-campo-editar-nombre />
                <label for="{uid}-ed-desc-{s.id}">Descripción (opcional)</label>
                <input id="{uid}-ed-desc-{s.id}" bind:value={descripcionEditada} maxlength={MAX_DESCRIPCION_SITIO} data-campo-editar-descripcion />
                {#if errorEdicion !== null}<span class="error-campo" role="alert" data-error-editar-sitio>{errorEdicion}</span>{/if}
              </div>
            </td>
          {:else}
            <td><a href={fragmentoAjustes(s.codigo)}>{s.nombre}</a>{#if s.descripcion}<br /><span class="vivo" data-descripcion-sitio>{s.descripcion}</span>{/if}</td>
          {/if}
          <td><code>{s.codigo}</code></td><td>{s.zona_horaria}</td><td>{activas(s)}</td><td>{equipos(s)}</td>
          <td class="acciones">
            {#if editando === s.id}
              <Boton etiqueta="Guardar" variante="principal" cargando={guardando} onclick={() => void guardar(s)} aria-label="Guardar los cambios de {s.nombre}" data-guardar-sitio />
              <Boton etiqueta="Cancelar" variante="discreto" onclick={() => (editando = null)} />
            {:else}
              <Boton etiqueta="Editar" variante="discreto" onclick={() => editar(s)} aria-label="Editar {s.nombre}" data-editar-sitio />
            {/if}
          </td>
        </tr>
      {:else}
        <tr><td colspan="6" class="vacio">Todavía no hay sitios.</td></tr>
      {/each}
    </tbody>
  </table>
  </div>
{/if}

{#if !abierto}
  <Boton etiqueta="Crear sitio" variante="principal" onclick={() => { abierto = true; creado = null; error = null; }} data-abrir-crear-sitio />
{:else}
  <form class="formulario-configurar formulario-sitio" onsubmit={(e) => { e.preventDefault(); void crear(); }} data-formulario-sitio>
    <h3>Crear sitio</h3>
    {#if error !== null}<Aviso tipo="error" texto={error} alCerrar={() => (error = null)} />{/if}
    <div class="campo">
      <label for="{uid}-nombre">Nombre</label>
      <input id="{uid}-nombre" bind:value={nombre} maxlength={MAX_NOMBRE_SITIO} placeholder="Por ejemplo, Sede Norte" data-campo-nombre-sitio />
    </div>
    <div class="campo">
      <label for="{uid}-codigo">Código</label>
      <input id="{uid}-codigo" bind:value={codigo} oninput={() => (codigoTocado = true)} maxlength="63" aria-describedby="{uid}-codigo-ayuda" data-campo-codigo-sitio />
      <span class="ayuda-campo" id="{uid}-codigo-ayuda">Va en el tópico de los equipos (<code>sitio/{codigo || 'código'}/…</code>) y no cambia después: minúsculas sin tildes, números y guiones.</span>
    </div>
    <div class="campo">
      <label for="{uid}-zona-horaria">Zona horaria</label>
      <select id="{uid}-zona-horaria" bind:value={zonaHoraria} data-campo-zona-horaria>
        {#each zonas as z (z)}<option value={z}>{z}</option>{/each}
      </select>
      <span class="ayuda-campo">Con ella se cuentan los «días» de sus datos; tampoco cambia después.</span>
    </div>
    <div class="campo">
      <label for="{uid}-descripcion">Descripción (opcional)</label>
      <input id="{uid}-descripcion" bind:value={descripcion} maxlength={MAX_DESCRIPCION_SITIO} data-campo-descripcion-sitio />
      <span class="ayuda-campo">Una línea para reconocerlo (hasta {MAX_DESCRIPCION_SITIO} caracteres); se puede cambiar después.</span>
    </div>
    <div class="campo">
      <label for="{uid}-primera">Primera zona</label>
      <input id="{uid}-primera" bind:value={primeraZona} maxlength={MAX_NOMBRE_ZONA} data-campo-primera-zona />
    </div>
    <Boton etiqueta="Crear sitio" variante="principal" tipo="submit" cargando={creando} data-crear-sitio />
    <Boton etiqueta="Cancelar" variante="discreto" onclick={() => (abierto = false)} />
  </form>
{/if}
