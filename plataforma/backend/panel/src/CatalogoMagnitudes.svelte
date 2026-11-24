<script lang="ts">
  // P16, sección «Magnitudes» (docs/19 §4, T, puntos 2 a 4). La lista, y un formulario a la vez: crear o editar. Achicar el rango pregunta antes
  // cuántas mediciones de los últimos 7 días habrían quedado fuera (como acortar el plazo de la primera trama, bloque Q) y guarda exactamente el
  // rango consultado; el servidor bloquea (409 con la lista) si deja fuera una regla o una calibración, y el bloqueo optimista pide releer si otra
  // persona la cambió entretanto (sin perder lo escrito).
  import { onMount, tick } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    achicaElRango, comoSeLee, erroresMagnitud, normalizarAlias, textoCanales, textoFuera, textoImpacto, textoRango, textoSugerido,
    type FormMagnitud, type FueraDeRango, type Magnitud,
  } from './lib/catalogo';

  let { magnitudes, unidades, alGuardar }: { magnitudes: Magnitud[]; unidades: string[]; alGuardar: () => Promise<void> } = $props();

  // El formulario abierto: 'nueva', el código de la que se edita, o nada.
  let abierto = $state<string | null>(null);
  let f = $state<FormMagnitud>(vacio());
  let aliasNuevo = $state('');
  let marca = $state(''); // el actualizado_en leído: el bloqueo optimista
  let aviso = $state<DatosAviso | null>(null);
  let guardando = $state(false);
  let consultando = $state(false);
  let impacto = $state<{ n: number; k: number; min: number; max: number } | null>(null); // la confirmación de achicar, abierta
  let intentado = $state(false); // tras el primer «Guardar», los errores se muestran aunque el campo no se haya tocado
  let base = $state<FormMagnitud | null>(null); // lo leído al abrir: tras un 409 de relectura, solo lo que la persona cambió respecto de esto se conserva
  let titulo = $state<HTMLElement | null>(null);
  let resumen = $state<HTMLElement | null>(null);
  const cargaImpacto = ultimaGana();
  const uid = $props.id();

  const ROTULO: Record<string, string> = { codigo: 'Código: ', nombre: 'Nombre: ', unidad: 'Unidad: ', rango_min: 'Mínimo: ', rango_max: 'Máximo: ',
    umbral_alto_sugerido: 'Alto: ', umbral_bajo_sugerido: 'Bajo: ', histeresis_sugerida: 'Histéresis: ', alias: 'Alias: ' };
  const ordenadas = $derived([...magnitudes].sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')));
  const editada = $derived(abierto !== null && abierto !== 'nueva' ? magnitudes.find((m) => m.codigo === abierto) ?? null : null);
  const errores = $derived(abierto === null ? {} : erroresMagnitud(f, abierto === 'nueva', unidades));
  const hayErrores = $derived(Object.keys(errores).length > 0);
  const sinCambios = $derived(editada !== null && JSON.stringify(cambios(editada)) === '{}');

  function vacio(): FormMagnitud {
    return { codigo: '', nombre: '', unidad: '', rango_min: null, rango_max: null, umbral_alto_sugerido: null, umbral_bajo_sugerido: null, histeresis_sugerida: 0, alias: [] };
  }
  // El foco va al título del formulario al abrirlo (docs/19 §6): el botón que lo abrió desaparece.
  const enfocar = (el: () => HTMLElement | null): void => { void tick().then(() => el()?.focus()); };
  function abrirNueva(): void {
    abierto = 'nueva'; f = vacio(); base = null; marca = ''; aviso = null; impacto = null; intentado = false; aliasNuevo = '';
    enfocar(() => titulo);
  }
  function abrirEdicion(m: Magnitud): void {
    abierto = m.codigo; marca = m.actualizado_en; aviso = null; impacto = null; intentado = false; aliasNuevo = '';
    f = formDe(m);
    base = formDe(m);
    enfocar(() => titulo);
  }
  const formDe = (m: Magnitud): FormMagnitud => ({ codigo: m.codigo, nombre: m.nombre, unidad: m.unidad, rango_min: m.rango_min, rango_max: m.rango_max,
    umbral_alto_sugerido: m.umbral_alto_sugerido, umbral_bajo_sugerido: m.umbral_bajo_sugerido, histeresis_sugerida: m.histeresis_sugerida, alias: [...m.alias] });
  function cerrar(): void {
    cargaImpacto.cancelar(); abierto = null; impacto = null; aviso = null;
  }
  // Solo lo que cambió viaja en el PATCH (el alias, como lista completa si cambió).
  function cambios(m: Magnitud): Record<string, unknown> {
    const c: Record<string, unknown> = {};
    if (f.nombre.trim() !== m.nombre) c.nombre = f.nombre.trim();
    for (const k of ['rango_min', 'rango_max', 'umbral_alto_sugerido', 'umbral_bajo_sugerido'] as const) if ((f[k] ?? null) !== m[k]) c[k] = f[k];
    // Una histéresis vacía es 0, como la valida el panel y como la crea el alta (el servidor rechaza null).
    if ((f.histeresis_sugerida ?? 0) !== m.histeresis_sugerida) c.histeresis_sugerida = f.histeresis_sugerida ?? 0;
    if (JSON.stringify([...f.alias].sort()) !== JSON.stringify([...m.alias].sort())) c.alias = f.alias;
    return c;
  }
  function agregarAlias(): void {
    const a = normalizarAlias(aliasNuevo);
    if (a === '') return;
    f.alias = [...f.alias, a];
    aliasNuevo = '';
  }
  // Un número vacío del campo es null (sin sugerido de ese lado).
  const leerNumero = (v: string): number | null => (v.trim() === '' ? null : Number(v.replace(',', '.')));

  async function pedirGuardar(): Promise<void> {
    intentado = true;
    if (hayErrores) { enfocar(() => resumen); return; }
    if (guardando || consultando || abierto === null) return;
    impacto = null;
    if (editada !== null && f.rango_min !== null && f.rango_max !== null && achicaElRango(editada, f.rango_min, f.rango_max)) {
      const [min, max] = [f.rango_min, f.rango_max];
      consultando = true; aviso = null;
      try {
        const r = await obtener<{ mediciones: number; canales: number }>(
          `/magnitudes/${encodeURIComponent(editada.codigo)}/impacto?rango_min=${encodeURIComponent(String(min))}&rango_max=${encodeURIComponent(String(max))}`, cargaImpacto.senal());
        if (f.rango_min !== min || f.rango_max !== max) return; // los campos cambiaron mientras se consultaba: la respuesta habla de otro rango
        if (r.mediciones > 0) impacto = { n: r.mediciones, k: r.canales, min, max };
        else await guardar(min, max);
      } catch (e) {
        if (!esCancelacion(e)) aviso = { tipo: 'error', texto: `No se pudo saber cuántas mediciones afecta ese rango, así que no se guardó: ${avisoDeError(e).texto}` };
      } finally {
        consultando = false;
      }
      return;
    }
    await guardar(f.rango_min, f.rango_max);
  }

  // Guarda con exactamente el rango consultado o confirmado (no el que diga el campo si alguien lo tocó durante la confirmación).
  async function guardar(min: number | null, max: number | null): Promise<void> {
    if (abierto === null) return;
    guardando = true; aviso = null;
    const editando = editada;
    try {
      if (editando === null) {
        const cuerpo = { codigo: f.codigo.trim(), nombre: f.nombre.trim(), unidad: f.unidad, rango_min: min, rango_max: max, umbral_alto_sugerido: f.umbral_alto_sugerido,
          umbral_bajo_sugerido: f.umbral_bajo_sugerido, histeresis_sugerida: f.histeresis_sugerida ?? 0, alias: f.alias };
        await pedir('POST', '/magnitudes', { cuerpo });
      } else {
        const c = cambios(editando);
        if (min !== editando.rango_min) c.rango_min = min;
        if (max !== editando.rango_max) c.rango_max = max;
        await pedir('PATCH', `/magnitudes/${encodeURIComponent(editando.codigo)}`, { cuerpo: { actualizado_en: marca, ...c } });
      }
      impacto = null;
      await alGuardar();
      abierto = null;
      aviso = { tipo: 'exito', texto: 'Guardado. Rige desde la próxima trama.' };
    } catch (e) {
      impacto = null;
      aviso = await avisoDelGuardado(e, editando);
    } finally {
      guardando = false;
    }
  }

  async function avisoDelGuardado(e: unknown, editando: Magnitud | null): Promise<DatosAviso> {
    if (!(e instanceof ErrorApi) || e.codigo !== 409) return avisoDeError(e);
    const c = e.cuerpo as { fuera?: FueraDeRango[]; total?: number; actualizado_en?: string; alias?: unknown; message?: unknown };
    if (Array.isArray(c.fuera)) return { tipo: 'conflicto', texto: textoFuera(c.fuera, c.total ?? c.fuera.length) };
    if (editando !== null && typeof c.actualizado_en === 'string') {
      // Otra persona la cambió: se releen los valores guardados; de lo escrito se conserva SOLO lo que esta persona cambió respecto de lo que
      // leyó al abrir (base), y lo demás muestra lo nuevo: guardar con la marca nueva no pisa en silencio el cambio ajeno.
      const escrito = $state.snapshot(f);
      const leido = base;
      await alGuardar();
      const nueva = magnitudes.find((m) => m.codigo === editando.codigo);
      if (nueva !== undefined) {
        const fresco = formDe(nueva);
        const tocado = <K extends keyof FormMagnitud>(k: K): boolean => leido === null || JSON.stringify(escrito[k]) !== JSON.stringify(leido[k]);
        for (const k of Object.keys(fresco) as (keyof FormMagnitud)[]) if (tocado(k)) (fresco as unknown as Record<string, unknown>)[k] = escrito[k];
        marca = nueva.actualizado_en; base = formDe(nueva); f = fresco;
      } else {
        // Ya no está en el catálogo (la aplicación no borra magnitudes: solo pasaría por una operación directa en la base): se cierra.
        abierto = null;
        return { tipo: 'conflicto', texto: `La magnitud «${editando.codigo}» ya no está en el catálogo: se recargó la lista.` };
      }
      const hora = new Date(c.actualizado_en).toLocaleTimeString('es-CL', { hour: '2-digit', minute: '2-digit' });
      return { tipo: 'conflicto', texto: `Alguien cambió esta magnitud a las ${hora}: revisa los valores nuevos y vuelve a guardar.` };
    }
    return { tipo: 'conflicto', texto: typeof c.message === 'string' ? c.message : e.message };
  }
  onMount(() => () => cargaImpacto.cancelar());
</script>

<div class="seccion-catalogo" data-seccion-magnitudes>
  <p class="ayuda-seccion">Cada magnitud tiene una unidad, un rango válido (lo de fuera va a cuarentena) y, si quieres, un umbral sugerido que se ofrece al
    configurar un canal. No hay «Borrar»: una magnitud con canales o mediciones tiene historia.</p>
  {#if aviso !== null && abierto === null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
  {#if abierto === null}<Boton etiqueta="Crear magnitud" icono="alta" onclick={abrirNueva} data-crear-magnitud />{/if}

  {#if abierto !== null}
    <form class="formulario-catalogo" aria-labelledby="{uid}-titulo" onsubmit={(ev) => { ev.preventDefault(); void pedirGuardar(); }} data-form-magnitud>
      <h3 id="{uid}-titulo" tabindex="-1" bind:this={titulo}>{editada === null ? 'Crear magnitud' : `Editar ${editada.nombre}`}</h3>
      {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
      {#if intentado && hayErrores}
        <div class="resumen-errores" role="alert" tabindex="-1" bind:this={resumen} data-resumen-errores>
          <p>Revisa {Object.keys(errores).length === 1 ? 'un campo' : `${Object.keys(errores).length} campos`}:</p>
          <ul>{#each Object.entries(errores) as [k, m] (k)}<li>{ROTULO[k] ?? ''}{m}</li>{/each}</ul>
        </div>
      {/if}
      {#if editada === null}
        <div class="fila-campos">
          <label>Código
            <input bind:value={f.codigo} autocomplete="off" spellcheck="false" aria-invalid={intentado && errores.codigo !== undefined} aria-describedby="{uid}-codigo" data-campo="codigo" />
            <span id="{uid}-codigo" class="ayuda-campo">Minúsculas, números y «_», empieza con letra; no se podrá cambiar.</span>
            {#if intentado && errores.codigo}<span class="error-campo">{errores.codigo}</span>{/if}
          </label>
          <label>Unidad
            <select bind:value={f.unidad} aria-invalid={intentado && errores.unidad !== undefined} data-campo="unidad">
              <option value="" disabled>Elige una unidad</option>
              {#each unidades as u (u)}<option value={u}>{comoSeLee(u)} ({u})</option>{/each}
            </select>
            <span class="ayuda-campo">No se podrá cambiar.</span>
            {#if intentado && errores.unidad}<span class="error-campo">{errores.unidad}</span>{/if}
          </label>
        </div>
      {:else}
        <p class="solo-lectura" data-solo-lectura>Código <strong>{editada.codigo}</strong> · unidad <strong>{comoSeLee(editada.unidad)}</strong> ({editada.unidad}).
          No cambian: los citan los canales, las reglas y las mediciones guardadas.</p>
      {/if}
      <label class="campo-ancho">Nombre
        <input bind:value={f.nombre} maxlength="80" aria-invalid={intentado && errores.nombre !== undefined} data-campo="nombre" />
        {#if intentado && errores.nombre}<span class="error-campo">{errores.nombre}</span>{/if}
      </label>
      <fieldset>
        <legend>Rango válido</legend>
        <div class="fila-campos">
          <label>Mínimo
            <input type="number" step="any" value={f.rango_min ?? ''} oninput={(ev) => { f.rango_min = leerNumero(ev.currentTarget.value); impacto = null; }}
              disabled={consultando} aria-invalid={intentado && errores.rango_min !== undefined} data-campo="rango_min" />
            {#if intentado && errores.rango_min}<span class="error-campo">{errores.rango_min}</span>{/if}
          </label>
          <label>Máximo
            <input type="number" step="any" value={f.rango_max ?? ''} oninput={(ev) => { f.rango_max = leerNumero(ev.currentTarget.value); impacto = null; }}
              disabled={consultando} aria-invalid={intentado && errores.rango_max !== undefined} data-campo="rango_max" />
            {#if intentado && errores.rango_max}<span class="error-campo">{errores.rango_max}</span>{/if}
          </label>
        </div>
      </fieldset>
      <fieldset>
        <legend>Umbral sugerido</legend>
        <p class="ayuda-campo">Se ofrece al configurar un canal de esta magnitud; no crea alertas solo.</p>
        <div class="fila-campos">
          {#each [['umbral_alto_sugerido', 'Alto'], ['umbral_bajo_sugerido', 'Bajo'], ['histeresis_sugerida', 'Histéresis']] as [k, texto] (k)}
            {@const clave = k as 'umbral_alto_sugerido' | 'umbral_bajo_sugerido' | 'histeresis_sugerida'}
            <label>{texto}
              <input type="number" step="any" value={f[clave] ?? ''} oninput={(ev) => { f[clave] = leerNumero(ev.currentTarget.value); }}
                aria-invalid={intentado && errores[clave] !== undefined} data-campo={clave} />
              {#if intentado && errores[clave]}<span class="error-campo">{errores[clave]}</span>{/if}
            </label>
          {/each}
        </div>
      </fieldset>
      <fieldset>
        <legend>Alias</legend>
        <p class="ayuda-campo">Las claves con que un decodificador de pasarela nombra esta magnitud. Quitar uno rige desde la próxima trama: las que lo traigan
          dejarán de reconocerlo.</p>
        {#if f.alias.length === 0}<p class="ayuda-campo" data-sin-alias>Sin alias.</p>{/if}
        <ul class="alias">
          {#each f.alias as a, i (a + i)}
            <li><code>{a}</code> <Boton etiqueta="Quitar" variante="peligro" onclick={() => (f.alias = f.alias.filter((_, j) => j !== i))} data-quitar-alias={a} /></li>
          {/each}
        </ul>
        <div class="fila-campos">
          <label>Agregar alias
            <input bind:value={aliasNuevo} autocomplete="off" spellcheck="false" onkeydown={(ev) => { if (ev.key === 'Enter') { ev.preventDefault(); agregarAlias(); } }} data-campo="alias-nuevo" />
            <span class="ayuda-campo">Minúsculas, números, «_», «.» y «-», hasta 64.</span>
          </label>
          <Boton etiqueta="Agregar" onclick={agregarAlias} motivoDesactivado={aliasNuevo.trim() === '' ? 'Escribe la clave primero.' : null} data-agregar-alias />
        </div>
        {#if errores.alias}<span class="error-campo" role="alert" data-error-alias>{errores.alias}</span>{/if}
      </fieldset>
      {#if impacto !== null}
        <div class="confirmacion" role="alert" data-confirmar-rango>
          <p>{textoImpacto(impacto.n, impacto.k)}</p>
          <span class="acciones">
            <Boton etiqueta="Guardar igual" variante="peligro" cargando={guardando} etiquetaCargando="Guardando…" onclick={() => { if (impacto !== null) void guardar(impacto.min, impacto.max); }} data-guardar-igual />
            <Boton etiqueta="Cancelar" onclick={() => (impacto = null)} />
          </span>
        </div>
      {/if}
      <span class="acciones">
        <Boton etiqueta={editada === null ? 'Crear magnitud' : 'Guardar'} tipo="submit" cargando={guardando || consultando}
          etiquetaCargando={consultando ? 'Comprobando…' : 'Guardando…'} motivoDesactivado={sinCambios ? 'No hay cambios.' : impacto !== null ? 'Confirma o cancela arriba.' : null} data-guardar-magnitud />
        <Boton etiqueta="Cancelar" onclick={cerrar} data-cancelar-magnitud />
      </span>
    </form>
  {/if}

  {#if ordenadas.length === 0}
    <p class="vacio" data-catalogo-vacio>El catálogo está vacío: crea la primera magnitud.</p>
  {:else}
    <ul class="lista-catalogo" data-lista-magnitudes>
      {#each ordenadas as m (m.codigo)}
        <li data-magnitud={m.codigo}>
          <div class="nombre"><strong>{m.nombre}</strong> <code>{m.codigo}</code></div>
          <div><span title={`Símbolo SenML: ${m.unidad}`}>{comoSeLee(m.unidad)}</span> · {textoRango(m)}</div>
          <div class="sugerido">{textoSugerido(m)}</div>
          <div class="alias-lista">{m.alias.length > 0 ? m.alias.join(', ') : 'sin alias'}</div>
          <div class="uso">{textoCanales(m.canales)}</div>
          <div class="acciones"><Boton etiqueta="Editar" onclick={() => abrirEdicion(m)} motivoDesactivado={abierto !== null ? 'Termina o cancela el formulario abierto.' : null} data-editar-magnitud={m.codigo} /></div>
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ayuda-seccion { max-width: 72ch; color: var(--texto-secundario); }
  .formulario-catalogo { display: grid; gap: var(--e-3); padding: var(--e-4); margin: var(--e-3) 0; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); max-width: 60rem; }
  .formulario-catalogo h3 { margin: 0; }
  fieldset { border: 1px solid var(--borde-tenue); border-radius: var(--radio); padding: var(--e-2) var(--e-3); margin: 0; min-width: 0; }
  legend { font-weight: 600; padding: 0 var(--e-1); }
  .campo-ancho { display: grid; gap: 0.2rem; max-width: 32rem; }
  .formulario-catalogo input, .formulario-catalogo select { max-width: 100%; min-width: 0; }
  .solo-lectura { margin: 0; color: var(--texto-secundario); }
  .resumen-errores { border-left: 3px solid var(--error-borde); padding: var(--e-2) var(--e-3); background: var(--superficie-tenue); }
  .resumen-errores p, .resumen-errores ul { margin: 0; }
  .alias { list-style: none; padding: 0; margin: 0 0 var(--e-2); display: flex; flex-wrap: wrap; gap: var(--e-2); }
  .alias li { display: inline-flex; gap: var(--e-1); align-items: center; }
  .lista-catalogo { list-style: none; padding: 0; margin: var(--e-3) 0 0; display: grid; gap: 0; }
  .lista-catalogo li { display: grid; grid-template-columns: minmax(12rem, 1.4fr) minmax(10rem, 1.2fr) minmax(10rem, 1fr) minmax(8rem, 1fr) 7rem auto; gap: var(--e-2) var(--e-3);
    align-items: baseline; padding: var(--e-2) 0; border-bottom: 1px solid var(--borde-tenue); }
  .lista-catalogo code { color: var(--texto-secundario); }
  .sugerido, .alias-lista, .uso { color: var(--texto-secundario); overflow-wrap: anywhere; }
  @media (max-width: 700px) {
    .lista-catalogo li { grid-template-columns: 1fr; gap: 0.15rem; padding: var(--e-3); border: 1px solid var(--borde-tenue); border-radius: var(--radio); margin-bottom: var(--e-2); }
  }
</style>
