<script lang="ts">
  // Pantalla P10 «Entrar» (docs/19 §4; docs/20 §3 y §4). Correo y clave, con el autocompletado que entienden los gestores de claves.
  // Cualquier rechazo de credenciales (usuario inexistente, inactivo o clave mala) se muestra con el MISMO texto: el servidor ya responde
  // igual y en el mismo tiempo, y la pantalla no debe deshacer eso. El 429 dice cuánto esperar. Sin correo saliente: quien olvidó su
  // clave pide una temporal a quien administra su sitio.
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { TEXTO_CREDENCIALES, type SesionAbierta } from './lib/sesion';
  // alEntrar recibe la clave escrita solo si era temporal (para no pedirla otra vez en el cambio obligatorio; vive en memoria).
  let { alEntrar, mensaje = null }: { alEntrar: (s: SesionAbierta, claveTemporal: string | null) => void; mensaje?: string | null } = $props();

  let email = $state('');
  let clave = $state('');
  let cargando = $state(false);
  let aviso = $state<DatosAviso | null>(null);

  async function entrar(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (cargando) return;
    aviso = null;
    if (email.trim() === '' || clave === '') {
      aviso = { tipo: 'error', texto: 'Escribe tu correo y tu clave.' };
      return;
    }
    cargando = true;
    try {
      // central: false → un 401 aquí es «credenciales no válidas», no «tu sesión venció».
      const s = await pedir<SesionAbierta>('POST', '/sesion', { cuerpo: { email: email.trim(), clave }, central: false });
      const temporal = s.usuario.clave_temporal ? clave : null;
      clave = '';
      alEntrar(s, temporal);
    } catch (x) {
      aviso = x instanceof ErrorApi && (x.codigo === 401 || x.codigo === 400) ? { tipo: 'error', texto: TEXTO_CREDENCIALES } : avisoDeError(x);
    } finally {
      cargando = false;
    }
  }
</script>

<section class="tarjeta-sesion" aria-labelledby="titulo-entrar">
  <h2 id="titulo-entrar">Entrar</h2>
  {#if mensaje !== null}<Aviso tipo="info" texto={mensaje} />{/if}
  <form onsubmit={entrar} novalidate data-entrar>
    <label for="entrar-email">Correo</label>
    <input id="entrar-email" name="email" type="email" autocomplete="username" inputmode="email" maxlength="254" bind:value={email} required />
    <label for="entrar-clave">Clave</label>
    <input id="entrar-clave" name="clave" type="password" autocomplete="current-password" maxlength="128" bind:value={clave} required />
    {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} />{/if}
    <Boton tipo="submit" variante="principal" etiqueta="Entrar" etiquetaCargando="Entrando…" {cargando} data-boton-entrar />
  </form>
  <details class="olvido">
    <summary>¿Olvidaste tu clave?</summary>
    <p>Pídele una clave temporal al administrador de tu sitio. Vale pocas horas (te dirá hasta cuándo) y, al entrar con ella, el sistema te pide elegir una nueva. No se envían correos.</p>
  </details>
</section>
