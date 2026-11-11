<script lang="ts">
  // P11 Legal y acerca de (docs/19 §4, P11; HU-27, HU-31; docs/21 §4–§7): el pie «Legal y acerca de» de toda pantalla lleva aquí, también
  // antes de entrar y con la sesión restringida por términos (las páginas legales responden 200 en ese caso, docs/20 §12). Cuatro
  // apartados: Privacidad (`GET /privacidad`, generada en el servidor desde el inventario de docs/21 con el responsable configurado),
  // Términos de uso (`GET /terminos`, con versión y fecha), Acerca de (`GET /acerca`: versión, commit, AGPL, avisos de terceros) y
  // Soporte (`POST /soporte`, texto sin adjuntos, con límite de tasa: un 429 dice cuántos segundos esperar). Más la licencia y la cookie,
  // que no dependen del servidor. Los textos se muestran como texto, nunca como HTML (lib/legal.ts).
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { MAX_SOPORTE, bloquesDeTexto, esPrivacidad, limpio, textoDe, type Privacidad, type TextoLegal } from './lib/legal';
  import type { SeccionLegal } from './lib/vista';

  let { seccion = undefined, conSesion = false }: { seccion?: SeccionLegal; conSesion?: boolean } = $props();
  const avisos = `${import.meta.env.BASE_URL}avisos-de-terceros.txt`;

  let privacidad = $state<Privacidad | null | 'error'>(null);
  let terminos = $state<TextoLegal | null | 'error'>(null);
  let acerca = $state<Record<string, unknown> | null | 'error'>(null);
  let mensaje = $state('');
  let enviando = $state(false);
  let avisoSoporte = $state<DatosAviso | null>(null);

  // central: false → estas páginas se leen también sin sesión: un 401 aquí no lleva a «Entrar».
  const leer = (ruta: string): Promise<unknown> => pedir<unknown>('GET', ruta, { central: false });
  onMount(() => {
    void leer('/privacidad').then((x) => (privacidad = esPrivacidad(x) ? x : 'error')).catch(() => (privacidad = 'error'));
    void leer('/terminos').then((x) => (terminos = textoDe(x) ?? 'error')).catch(() => (terminos = 'error'));
    void leer('/acerca').then((x) => (acerca = typeof x === 'object' && x !== null ? (x as Record<string, unknown>) : 'error')).catch(() => (acerca = 'error'));
    if (seccion !== undefined) queueMicrotask(() => document.getElementById(`legal-${seccion}`)?.scrollIntoView?.());
  });

  async function enviar(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    const texto = mensaje.trim();
    if (enviando || texto === '' || texto.length > MAX_SOPORTE) return;
    enviando = true;
    avisoSoporte = null;
    try {
      await pedir('POST', '/soporte', { cuerpo: { texto }, central: false });
      mensaje = '';
      avisoSoporte = { tipo: 'exito', texto: 'Mensaje enviado: lo lee el administrador del sistema.' };
    } catch (e) {
      avisoSoporte = e instanceof ErrorApi && e.codigo === 401 ? { tipo: 'info', texto: 'Para escribir a soporte, entra con tu cuenta (así se puede responder).' } : avisoDeError(e);
    } finally {
      enviando = false;
    }
  }
  const texto = (x: unknown): string => (typeof x === 'string' || typeof x === 'number' ? String(x) : '');
</script>

{#snippet documento(t: TextoLegal | null | 'error', que: string)}
  {#if t === null}
    <p class="vacio">Cargando…</p>
  {:else if t === 'error'}
    <p class="vacio" data-legal-sin-texto>No se pudo leer {que} del servicio: recarga en un momento.</p>
  {:else}
    {#if t.version !== undefined}<p class="vivo" data-version-legal>Versión {t.version}{t.fecha ? `, del ${t.fecha}` : ''}.</p>{/if}
    <div class="texto-legal">
      {#each bloquesDeTexto(t.texto) as b, i (i)}
        {#if b.tipo === 'titulo'}<h4>{b.texto}</h4>
        {:else if b.tipo === 'lista'}<ul>{#each b.items as it, j (j)}<li>{it}</li>{/each}</ul>
        {:else}<p>{b.texto}</p>{/if}
      {/each}
    </div>
  {/if}
{/snippet}

<div class="legal" data-legal>
  <h2>Legal y acerca de</h2>
  <nav aria-label="Apartados" class="acciones">
    <a href="#/legal?seccion=privacidad">Privacidad</a><a href="#/legal?seccion=terminos">Términos de uso</a>
    <a href="#/legal?seccion=acerca">Acerca de</a><a href="#/legal?seccion=soporte">Soporte</a>
  </nav>
  <section id="legal-privacidad" aria-labelledby="titulo-privacidad" data-legal-privacidad>
    <h3 id="titulo-privacidad">Privacidad</h3>
    {#if privacidad === null}
      <p class="vacio">Cargando…</p>
    {:else if privacidad === 'error'}
      <p class="vacio" data-legal-sin-texto>No se pudo leer la página de privacidad del servicio: recarga en un momento.</p>
    {:else}
      {@const pv = privacidad}
      <p class="vivo" data-version-legal>Versión {pv.version}, del {pv.fecha}.</p>
      {#if pv.responsable !== null}
        <p data-responsable>Responsable de los datos: <strong>{pv.responsable.nombre}</strong> · contacto: {pv.responsable.contacto}</p>
      {:else if pv.aviso_responsable !== null}
        <p class="vivo" data-sin-responsable>{pv.aviso_responsable}</p>
      {/if}
      <h4>Qué datos se guardan</h4>
      <ul class="lista-actividad" data-inventario-privacidad>
        {#each pv.datos as d, i (i)}
          <li><strong>{limpio(d.dato)}</strong>: {limpio(d.para_que)}. <span class="vivo">Dónde: {limpio(d.donde)}. Cuánto tiempo: {limpio(d.cuanto_tiempo)}. Quién accede: {limpio(d.quien_accede)}.</span></li>
        {/each}
      </ul>
      {#each pv.secciones as s, i (i)}
        <h4>{limpio(s.titulo)}</h4>
        {#each s.parrafos as par, j (j)}<p>{limpio(par)}</p>{/each}
      {/each}
    {/if}
  </section>
  <section aria-labelledby="titulo-cookies">
    <h3 id="titulo-cookies">Cookies</h3>
    <p data-legal-cookie>El panel usa una sola cookie, <code>__Host-sesion</code>: la de la sesión, estrictamente necesaria para entrar. Vence a los
      30 minutos sin actividad o a las 8 horas de abierta, lo que ocurra primero; se borra al salir o al cerrar el navegador. No hay cookies de
      terceros ni de analítica.</p>
  </section>
  <section id="legal-terminos" aria-labelledby="titulo-terminos" data-legal-terminos>
    <h3 id="titulo-terminos">Términos de uso</h3>
    {@render documento(terminos, 'los términos de uso')}
  </section>
  <section id="legal-acerca" aria-labelledby="titulo-acerca" data-legal-acerca>
    <h3 id="titulo-acerca">Acerca de</h3>
    {#if acerca !== null && acerca !== 'error'}
      <dl class="identidad" data-acerca>
        {#if texto(acerca.version) !== ''}<dt>Versión</dt><dd data-acerca-version>{texto(acerca.version)}</dd>{/if}
        {#if texto(acerca.commit) !== ''}<dt>Commit</dt><dd data-acerca-commit><code>{texto(acerca.commit)}</code></dd>{/if}
      </dl>
    {:else if acerca === 'error'}
      <p class="vacio">No se pudo leer la versión del servicio.</p>
    {/if}
    <p data-legal-licencia>Este sistema es software libre bajo la licencia <strong>GNU Affero General Public License, versión 3</strong> (AGPL-3.0-only): puedes
      usarlo, estudiarlo, modificarlo y redistribuirlo. Si lo ofreces como servicio en una red, debes ofrecer también su código fuente a
      quienes lo usen, con tus cambios.</p>
    <!-- AGPL §13 (decidido el 11/11/2026): el aviso del servidor siempre, y el código fuente: el enlace si la instancia lo configuró; si no,
         a quién pedirlo. Sin sesión el servidor no dice la versión ni el commit, pero esto sí. -->
    {#if acerca !== null && acerca !== 'error' && texto(acerca.aviso_licencia) !== ''}<p data-aviso-licencia>{texto(acerca.aviso_licencia)}</p>{/if}
    <p data-codigo-fuente>Código fuente:
      {#if acerca !== null && acerca !== 'error' && /^https:\/\//.test(texto(acerca.codigo_fuente))}<a href={texto(acerca.codigo_fuente)} rel="noopener">{texto(acerca.codigo_fuente)}</a>.
      {:else}pídelo al responsable (<a href="#/legal?seccion=soporte">Soporte</a>).{/if}</p>
    <p>El panel y el servicio incluyen bibliotecas de terceros bajo sus propias licencias: <a href={avisos} data-avisos-terceros>avisos de terceros (texto)</a>.</p>
  </section>
  <section id="legal-soporte" aria-labelledby="titulo-soporte" data-legal-soporte>
    <h3 id="titulo-soporte">Soporte</h3>
    {#if privacidad !== null && privacidad !== 'error' && privacidad.responsable !== null}<p data-contacto>Contacto del responsable: {privacidad.responsable.contacto}</p>{/if}
    {#if avisoSoporte !== null}<Aviso tipo={avisoSoporte.tipo} texto={avisoSoporte.texto} alCerrar={() => (avisoSoporte = null)} />{/if}
    {#if conSesion}
      <form class="texto-legal" onsubmit={enviar} novalidate data-form-soporte>
        <div class="campo">
          <label for="soporte-texto">Tu mensaje (sin adjuntos)</label>
          <textarea id="soporte-texto" rows="5" maxlength={MAX_SOPORTE} bind:value={mensaje} aria-describedby="soporte-ayuda" data-soporte-texto></textarea>
          <span class="ayuda-campo" id="soporte-ayuda">{mensaje.length} de {MAX_SOPORTE} caracteres. Lo lee el administrador del sistema; no escribas claves.</span>
        </div>
        <Boton tipo="submit" variante="principal" etiqueta="Enviar a soporte" etiquetaCargando="Enviando…" cargando={enviando}
          motivoDesactivado={enviando ? null : mensaje.trim() === '' ? 'escribe el mensaje' : null} data-enviar-soporte />
      </form>
    {:else}
      <p class="vivo">Para escribir a soporte, entra con tu cuenta.</p>
    {/if}
  </section>
  <p><a href="#/">Volver al tablero</a></p>
</div>
