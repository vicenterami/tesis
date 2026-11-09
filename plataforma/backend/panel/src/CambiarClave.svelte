<script lang="ts">
  // Cambio de clave (docs/20 §4): obligatorio al entrar con una clave temporal (el guardia responde 403 a todo lo demás hasta que se
  // cambie) y disponible desde la cabecera. Las reglas se muestran ANTES de escribir y se comprueban mientras se escribe con los mismos
  // números del servidor (lib/clave.ts); quien decide es el servidor, y si rechaza, sus motivos se muestran tal cual. La respuesta trae
  // una cookie nueva (identificador regenerado) y cierra las demás sesiones de la persona.
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { REGLAS_CLAVE, motivosDeClaveNueva } from './lib/clave';
  import type { SesionAbierta } from './lib/sesion';

  let {
    email = null,
    claveActual = null,
    obligatorio = true,
    alListo,
    alSalir,
  }: { email?: string | null; claveActual?: string | null; obligatorio?: boolean; alListo: (s: SesionAbierta) => void; alSalir: () => void } = $props();

  // La temporal que la persona acaba de escribir al entrar viaja en memoria y no se vuelve a pedir; si no se conoce (recargó la página),
  // se pide.
  let actual = $state('');
  let nueva = $state('');
  let repetida = $state('');
  let cargando = $state(false);
  let aviso = $state<DatosAviso | null>(null);
  const conocida = $derived(claveActual !== null && claveActual !== '');
  const motivos = $derived(motivosDeClaveNueva(nueva, repetida, { email, actual: conocida ? claveActual : actual }));
  const motivoBoton = $derived(!conocida && actual === '' ? 'escribe tu clave actual' : nueva === '' ? 'escribe la clave nueva' : motivos.length > 0 ? motivos[0]! : null);

  async function cambiar(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (cargando || motivoBoton !== null) return;
    aviso = null;
    cargando = true;
    try {
      const s = await pedir<SesionAbierta>('POST', '/sesion/clave', { cuerpo: { actual: conocida ? claveActual : actual, nueva } });
      actual = nueva = repetida = '';
      alListo(s);
    } catch (x) {
      // 400: la actual no es correcta o la nueva no cumple las reglas del servidor; sus motivos, tal cual.
      aviso = x instanceof ErrorApi && x.codigo === 400 ? { tipo: 'error', texto: x.motivos.join('; ') || 'Revisa las claves.' } : avisoDeError(x);
    } finally {
      cargando = false;
    }
  }
</script>

<section class="tarjeta-sesion" aria-labelledby="titulo-clave">
  <h2 id="titulo-clave">{obligatorio ? 'Elige tu clave' : 'Cambiar la clave'}</h2>
  {#if obligatorio}
    <Aviso tipo="info" texto="Entraste con una clave temporal: antes de seguir, elige una clave tuya. La temporal deja de servir al cambiarla." />
  {/if}
  <ul class="reglas-clave" data-reglas-clave>
    {#each REGLAS_CLAVE as r (r)}<li>{r}</li>{/each}
  </ul>
  <form onsubmit={cambiar} novalidate data-cambiar-clave>
    <!-- El correo como campo de usuario oculto: así el gestor de claves sabe de qué cuenta es la clave nueva. -->
    {#if email !== null}<input type="email" name="email" autocomplete="username" value={email} readonly hidden />{/if}
    {#if !conocida}
      <label for="clave-actual">Clave actual (o la temporal que te dieron)</label>
      <input id="clave-actual" type="password" autocomplete="current-password" maxlength="1024" bind:value={actual} />
    {/if}
    <label for="clave-nueva">Clave nueva</label>
    <input id="clave-nueva" type="password" autocomplete="new-password" maxlength="128" bind:value={nueva} aria-describedby="clave-estado" />
    <label for="clave-repetida">Repite la clave nueva</label>
    <input id="clave-repetida" type="password" autocomplete="new-password" maxlength="128" bind:value={repetida} />
    <p id="clave-estado" class="vivo" aria-live="polite" data-clave-estado>
      {#if nueva === ''}Aún no escribes la clave nueva.{:else if motivos.length === 0}Cumple las reglas que se comprueban aquí; el servidor revisa además la lista de claves comunes.{:else}{motivos.join('; ')}.{/if}
    </p>
    {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} />{/if}
    <Boton tipo="submit" variante="principal" etiqueta="Guardar la clave nueva" etiquetaCargando="Guardando…" {cargando} motivoDesactivado={cargando ? null : motivoBoton} data-guardar-clave />
  </form>
  <Boton etiqueta={obligatorio ? 'Salir sin cambiarla' : 'Volver'} variante="discreto" onclick={alSalir} data-salir-clave />
</section>
