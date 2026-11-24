<script lang="ts">
  // P16, sección «Recetas de decodificación» (docs/19 §4, T, puntos 5 a 7). Una receta no se edita ni se borra: se crea (también «a partir de
  // otra», con -v2) y «Reemplazar por» mueve los equipos de una a otra. Probar no guarda nada; si la receta o los bytes cambian después, el
  // resultado anterior se tacha (nunca queda a la vista un resultado de otra receta).
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    ANCHO, AYUDA_TIPO, TIPOS_CAMPO, aPartirDe, campoVacio, comoSeLee, erroresReceta, formula, huellaPrueba, recetaDelForm, textoCampo, textoEquipos,
    textoReemplazado, textoReemplazo, type FormReceta, type Magnitud, type Receta,
  } from './lib/catalogo';

  let { recetas, magnitudes, alGuardar }: { recetas: Receta[]; magnitudes: Magnitud[]; alGuardar: () => Promise<void> } = $props();

  let abierta = $state(false);
  let f = $state<FormReceta>({ codigo: '', nombre: '', largo_bytes: null, campos: [campoVacio()] });
  let intentado = $state(false);
  let guardando = $state(false);
  let aviso = $state<DatosAviso | null>(null);
  // Probar sin guardar
  let bytes = $state('');
  let codificacion = $state<'hex' | 'base64'>('hex');
  let probando = $state(false);
  let prueba = $state<{ huella: string; ok: boolean; lecturas?: { magnitud: string; valor: number; unidad: string }[]; motivo?: string } | null>(null);
  // Reemplazar por
  let reemplazando = $state<string | null>(null); // el código de la receta en uso que se reemplaza
  let por = $state('');
  let moviendo = $state(false);
  const uid = $props.id();

  const errores = $derived(erroresReceta(f));
  const hayErrores = $derived(Object.keys(errores).length > 0);
  const huellaActual = $derived(huellaPrueba(f, bytes, codificacion));
  const pruebaAlDia = $derived(prueba !== null && prueba.huella === huellaActual);
  const enUso = (r: Receta): number => r.equipos ?? 0;

  function abrir(desde: Receta | null): void {
    f = desde === null ? { codigo: '', nombre: '', largo_bytes: null, campos: [campoVacio()] } : aPartirDe(desde);
    abierta = true; intentado = false; aviso = null; prueba = null; bytes = ''; reemplazando = null;
  }
  const leerEntero = (v: string): number | null => (v.trim() === '' ? null : Number(v));
  const err = (k: string): string | undefined => (intentado ? errores[k] : undefined);

  // Probar valida antes de enviar, en palabras (docs/19 §4, T, punto 9): sin código ni nombre todavía se puede probar; lo demás, como al crear.
  const erroresParaProbar = $derived(Object.entries(errores).filter(([k]) => k !== 'codigo' && k !== 'nombre'));
  async function probar(): Promise<void> {
    if (probando || bytes.trim() === '') return;
    if (erroresParaProbar.length > 0) { intentado = true; aviso = { tipo: 'error', texto: `Antes de probar: ${erroresParaProbar.map(([, m]) => m).join(' ')}` }; return; }
    probando = true; aviso = null;
    const huella = huellaActual;
    try {
      // Sin código todavía se prueba igual (la API lo nombra «prueba»); lo demás, como se crearía.
      const receta = recetaDelForm(f);
      const r = await pedir<{ ok: boolean; lecturas?: { magnitud: string; valor: number; unidad: string }[]; motivo?: string }>('POST', '/recetas-decodificacion/probar',
        { cuerpo: { receta: { ...receta, codigo: /^[a-z0-9][a-z0-9-]{2,62}$/.test(receta.codigo) ? receta.codigo : '' }, bytes, codificacion } });
      prueba = { huella, ...r };
    } catch (e) {
      prueba = null;
      aviso = avisoDeError(e);
    } finally {
      probando = false;
    }
  }

  async function crear(): Promise<void> {
    intentado = true;
    if (hayErrores || guardando) return;
    guardando = true; aviso = null;
    try {
      await pedir('POST', '/recetas-decodificacion', { cuerpo: recetaDelForm(f) });
      const codigo = f.codigo.trim();
      await alGuardar();
      abierta = false;
      aviso = { tipo: 'exito', texto: `Receta «${codigo}» creada. Asígnala a un equipo al darlo de alta o en su configuración, o usa «Reemplazar por».` };
    } catch (e) {
      aviso = e instanceof ErrorApi && e.codigo === 409 ? { tipo: 'conflicto', texto: e.motivos[0] ?? e.message } : avisoDeError(e);
    } finally {
      guardando = false;
    }
  }

  async function reemplazar(): Promise<void> {
    if (reemplazando === null || por === '' || moviendo) return;
    moviendo = true; aviso = null;
    const de = reemplazando, a = por;
    try {
      const r = await pedir<{ dispositivos: number; avisos: string[] }>('POST', `/recetas-decodificacion/${encodeURIComponent(de)}/reemplazar`, { cuerpo: { por: a } });
      await alGuardar();
      reemplazando = null; por = '';
      aviso = { tipo: 'exito', texto: [textoReemplazado(r.dispositivos, a), ...r.avisos.map((x) => `Ojo: ${x}.`)].join(' ') };
    } catch (e) {
      aviso = { tipo: 'error', texto: `Ningún equipo cambió: ${avisoDeError(e).texto}` };
    } finally {
      moviendo = false;
    }
  }
</script>

<div class="seccion-catalogo" data-seccion-recetas>
  <p class="ayuda-seccion">Una receta traduce los bytes de un equipo LoRaWAN cuya pasarela entrega la trama sin decodificar. Es solo dato: dónde está cada
    valor, de qué tipo es y cómo se convierte. Una receta no se edita después de creada: para corregirla, crea otra y usa «Reemplazar por».</p>
  {#if aviso !== null && !abierta}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
  {#if !abierta}<Boton etiqueta="Crear receta" icono="alta" onclick={() => abrir(null)} data-crear-receta />{/if}

  {#if abierta}
    <form class="formulario-catalogo" aria-labelledby="{uid}-titulo" onsubmit={(ev) => { ev.preventDefault(); void crear(); }} data-form-receta>
      <h3 id="{uid}-titulo">Crear receta</h3>
      {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}
      {#if intentado && hayErrores}
        <div class="resumen-errores" role="alert" data-resumen-errores>
          <p>Revisa {Object.keys(errores).length === 1 ? 'un campo' : `${Object.keys(errores).length} campos`}:</p>
          <ul>{#each Object.entries(errores) as [k, m] (k)}<li>{m}</li>{/each}</ul>
        </div>
      {/if}
      <div class="fila-campos">
        <label>Código
          <input bind:value={f.codigo} autocomplete="off" spellcheck="false" aria-invalid={err('codigo') !== undefined} data-campo="codigo" />
          <span class="ayuda-campo">Minúsculas, números y guiones; no se podrá cambiar.</span>
          {#if err('codigo')}<span class="error-campo">{err('codigo')}</span>{/if}
        </label>
        <label>Nombre
          <input bind:value={f.nombre} maxlength="120" aria-invalid={err('nombre') !== undefined} data-campo="nombre" />
          {#if err('nombre')}<span class="error-campo">{err('nombre')}</span>{/if}
        </label>
        <label>Largo exacto en bytes
          <input type="number" min="1" max="255" step="1" value={f.largo_bytes ?? ''} oninput={(ev) => (f.largo_bytes = leerEntero(ev.currentTarget.value))}
            aria-invalid={err('largo_bytes') !== undefined} data-campo="largo_bytes" />
          {#if err('largo_bytes')}<span class="error-campo">{err('largo_bytes')}</span>{/if}
        </label>
      </div>
      <fieldset>
        <legend>Campos</legend>
        <p class="ayuda-campo">Crudo: el número entero que se lee en esos bytes, antes de la fórmula. El primer byte de la trama es el 0.</p>
        {#if err('campos')}<span class="error-campo">{err('campos')}</span>{/if}
        <ol class="campos">
          {#each f.campos as c, i (i)}
            <li data-campo-receta={i}>
              <div class="fila-campos">
                <label>Magnitud
                  <select bind:value={c.magnitud} aria-invalid={err(`campo${i}.magnitud`) !== undefined} data-campo="magnitud">
                    <option value="" disabled>Elige</option>
                    {#each magnitudes as m (m.codigo)}<option value={m.codigo}>{m.nombre} ({comoSeLee(m.unidad)})</option>{/each}
                  </select>
                  {#if err(`campo${i}.magnitud`)}<span class="error-campo">{err(`campo${i}.magnitud`)}</span>{/if}
                </label>
                <label>Byte de inicio
                  <input type="number" min="0" step="1" value={c.desplazamiento ?? ''} oninput={(ev) => (c.desplazamiento = leerEntero(ev.currentTarget.value))}
                    aria-invalid={err(`campo${i}.desplazamiento`) !== undefined} data-campo="desplazamiento" />
                </label>
                <label>Tipo
                  <select bind:value={c.tipo} data-campo="tipo">{#each TIPOS_CAMPO as t (t)}<option value={t}>{t} ({ANCHO[t]} byte{ANCHO[t] === 1 ? '' : 's'})</option>{/each}</select>
                  <span class="ayuda-campo">{AYUDA_TIPO[c.tipo]}</span>
                </label>
                {#each [['sumar_antes', 'Sumar antes'], ['multiplicar_por', 'Multiplicar por'], ['dividir_por', 'Dividir por']] as [k, texto] (k)}
                  {@const clave = k as 'sumar_antes' | 'multiplicar_por' | 'dividir_por'}
                  <label>{texto}
                    <input type="number" step="1" value={c[clave] ?? ''} oninput={(ev) => (c[clave] = leerEntero(ev.currentTarget.value))}
                      aria-invalid={err(`campo${i}.${clave}`) !== undefined} data-campo={clave} />
                  </label>
                {/each}
                {#if f.campos.length > 1}<Boton etiqueta="Quitar" variante="peligro" onclick={() => (f.campos = f.campos.filter((_, j) => j !== i))} data-quitar-campo={i} />{/if}
              </div>
              {#if c.sumar_antes !== null && c.multiplicar_por !== null && c.dividir_por !== null}
                <p class="formula" data-formula={i}>{formula({ sumar_antes: c.sumar_antes, multiplicar_por: c.multiplicar_por, dividir_por: c.dividir_por })}</p>
              {/if}
              {#each ['desplazamiento', 'sumar_antes', 'multiplicar_por', 'dividir_por'] as k (k)}
                {#if err(`campo${i}.${k}`)}<span class="error-campo">{err(`campo${i}.${k}`)}</span>{/if}
              {/each}
            </li>
          {/each}
        </ol>
        <Boton etiqueta="Agregar campo" onclick={() => (f.campos = [...f.campos, campoVacio()])} motivoDesactivado={f.campos.length >= 32 ? 'Como mucho 32 campos.' : null} data-agregar-campo />
      </fieldset>
      <fieldset class="probar">
        <legend>Probar sin guardar</legend>
        <div class="fila-campos">
          <label class="bytes">Bytes de prueba
            <input bind:value={bytes} autocomplete="off" spellcheck="false" maxlength="1024" data-campo="bytes" />
            <span class="ayuda-campo">{codificacion === 'hex' ? 'Hexadecimal: dos dígitos por byte; los espacios entre bytes se ignoran.' : 'Base64, con su relleno «=».'}</span>
          </label>
          <span class="codificacion" role="radiogroup" aria-label="Cómo están escritos los bytes">
            <label><input type="radio" bind:group={codificacion} value="hex" data-codificacion="hex" /> Hexadecimal</label>
            <label><input type="radio" bind:group={codificacion} value="base64" data-codificacion="base64" /> Base64</label>
          </span>
          <Boton etiqueta="Probar" cargando={probando} etiquetaCargando="Probando…" motivoDesactivado={bytes.trim() === '' ? 'Escribe los bytes primero.' : null} onclick={() => void probar()} data-probar />
        </div>
        {#if prueba !== null}
          <div class="resultado" class:viejo={!pruebaAlDia} aria-live="polite" data-resultado-prueba={pruebaAlDia ? 'al-dia' : 'viejo'}>
            {#if !pruebaAlDia}<p class="ayuda-campo" data-prueba-vieja>La receta cambió: vuelve a probar.</p>{/if}
            {#if prueba.ok && prueba.lecturas}
              <table><thead><tr><th scope="col">Magnitud</th><th scope="col">Valor</th><th scope="col">Unidad</th></tr></thead>
                <tbody>{#each prueba.lecturas as l (l.magnitud)}<tr><td>{l.magnitud}</td><td>{l.valor.toLocaleString('es-CL', { maximumFractionDigits: 6 })}</td><td>{comoSeLee(l.unidad)}</td></tr>{/each}</tbody>
              </table>
            {:else}
              <p data-motivo-prueba>No se entiende con esta receta: {prueba.motivo}</p>
            {/if}
          </div>
        {/if}
      </fieldset>
      <p class="aviso-escritura">Una receta no se edita después de creada: para corregirla, crea otra y usa «Reemplazar por».</p>
      <p class="ayuda-campo" aria-live="polite" data-sin-probar>{pruebaAlDia && prueba?.ok ? 'Probada con la receta tal como está.' : 'Sin probar: puedes crearla igual.'}</p>
      <span class="acciones">
        <Boton etiqueta="Crear receta" tipo="submit" cargando={guardando} etiquetaCargando="Creando…" data-guardar-receta />
        <Boton etiqueta="Cancelar" onclick={() => { abierta = false; aviso = null; }} data-cancelar-receta />
      </span>
    </form>
  {/if}

  {#if recetas.length === 0}
    <p class="vacio" data-sin-recetas>No hay recetas. Una receta traduce los bytes de un equipo LoRaWAN cuya pasarela entrega la trama sin decodificar.</p>
  {:else}
    <ul class="lista-catalogo" data-lista-recetas>
      {#each recetas as r (r.codigo)}
        <li data-receta={r.codigo}>
          <div class="nombre"><strong>{r.nombre}</strong> <code>{r.codigo}</code></div>
          <div>{r.largo_bytes} bytes</div>
          <div class="campos-legibles">{r.campos.map(textoCampo).join(' · ')}</div>
          <div class="uso">{textoEquipos(r.equipos)}</div>
          <div class="acciones">
            <Boton etiqueta="Crear a partir de esta" onclick={() => abrir(r)} motivoDesactivado={abierta ? 'Termina o cancela el formulario abierto.' : null} data-a-partir={r.codigo} />
            {#if enUso(r) > 0 && recetas.length > 1}
              <Boton etiqueta="Reemplazar por…" onclick={() => { reemplazando = r.codigo; por = ''; aviso = null; }} data-reemplazar={r.codigo} />
            {/if}
          </div>
          {#if reemplazando === r.codigo}
            <div class="confirmacion" data-confirmar-reemplazo>
              <label>Reemplazar por
                <select bind:value={por} data-reemplazar-por>
                  <option value="" disabled>Elige la receta nueva</option>
                  {#each recetas.filter((x) => x.codigo !== r.codigo) as x (x.codigo)}<option value={x.codigo}>{x.codigo}</option>{/each}
                </select>
              </label>
              {#if por !== ''}<p data-texto-reemplazo>{textoReemplazo(enUso(r), r.codigo, por)}</p>{/if}
              <span class="acciones">
                <Boton etiqueta="Reemplazar" variante="peligro" cargando={moviendo} etiquetaCargando="Reemplazando…" motivoDesactivado={por === '' ? 'Elige la receta nueva.' : null}
                  onclick={() => void reemplazar()} data-confirmar-reemplazar />
                <Boton etiqueta="Cancelar" onclick={() => (reemplazando = null)} />
              </span>
            </div>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
</div>

<style>
  .ayuda-seccion { max-width: 72ch; color: var(--texto-secundario); }
  .formulario-catalogo { display: grid; gap: var(--e-3); padding: var(--e-4); margin: var(--e-3) 0; background: var(--superficie); border: 1px solid var(--borde); border-radius: var(--radio); max-width: 64rem; }
  .formulario-catalogo h3 { margin: 0; }
  fieldset { border: 1px solid var(--borde-tenue); border-radius: var(--radio); padding: var(--e-2) var(--e-3); margin: 0; min-width: 0; }
  legend { font-weight: 600; padding: 0 var(--e-1); }
  .campos { padding-left: 1.4rem; margin: 0 0 var(--e-2); display: grid; gap: var(--e-3); }
  .campos input[type='number'] { width: 8rem; max-width: 100%; }
  /* Un selector toma el ancho de su opción más larga: a 390 px se salía del borde (e2e del 23/11/2026). */
  .campos select, .formulario-catalogo input, .formulario-catalogo select { max-width: 100%; min-width: 0; }
  .formulario-catalogo label { max-width: 100%; }
  .formula { margin: 0.25rem 0 0; color: var(--texto-secundario); }
  .bytes { flex: 1 1 12rem; min-width: 0; }
  .bytes input { width: 100%; box-sizing: border-box; }
  .codificacion { display: inline-flex; gap: var(--e-3); align-items: center; }
  .resultado { margin-top: var(--e-2); }
  .resultado.viejo table, .resultado.viejo [data-motivo-prueba] { text-decoration: line-through; opacity: 0.6; }
  .resultado table { border-collapse: collapse; }
  .resultado th, .resultado td { text-align: left; padding: 0.2rem var(--e-3) 0.2rem 0; }
  .aviso-escritura { margin: 0; font-weight: 600; }
  .resumen-errores { border-left: 3px solid var(--error-borde); padding: var(--e-2) var(--e-3); background: var(--superficie-tenue); }
  .resumen-errores p, .resumen-errores ul { margin: 0; }
  .lista-catalogo { list-style: none; padding: 0; margin: var(--e-3) 0 0; }
  .lista-catalogo li { display: grid; grid-template-columns: minmax(12rem, 1.3fr) 6rem minmax(14rem, 2fr) 7rem auto; gap: var(--e-2) var(--e-3); align-items: baseline;
    padding: var(--e-2) 0; border-bottom: 1px solid var(--borde-tenue); }
  .lista-catalogo li .confirmacion { grid-column: 1 / -1; }
  .lista-catalogo code { color: var(--texto-secundario); }
  .campos-legibles, .uso { color: var(--texto-secundario); overflow-wrap: anywhere; }
  @media (max-width: 700px) {
    .lista-catalogo li { grid-template-columns: 1fr; gap: 0.15rem; padding: var(--e-3); border: 1px solid var(--borde-tenue); border-radius: var(--radio); margin-bottom: var(--e-2); }
    .formulario-catalogo { padding: var(--e-3); }
    .campos { padding-left: 1rem; }
    /* A ancho de teléfono, cada selector y el campo de bytes ocupan la línea entera: una etiqueta crece con el selector que lleva dentro. */
    .campos label:has(select), .bytes { flex: 1 1 100%; width: 100%; }
    .campos select, .bytes input { width: 100%; box-sizing: border-box; }
  }
</style>
