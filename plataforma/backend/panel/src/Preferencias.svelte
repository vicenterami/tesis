<script lang="ts">
  // P13 Preferencias y mi cuenta (docs/19 §4, tablero v2, H; HU-28, HU-29, RF-55, RF-56; docs/20 §11; docs/21 §4 y §5).
  // Preferencias: unidades, zona horaria, tema, notificaciones del navegador (el permiso se pide al activarlas, nunca al cargar), vistas
  // guardadas y sitio predeterminado; en la base (`GET`/`PUT /preferencias`), guardadas de forma OPTIMISTA y reversible: se ven al instante y,
  // si el servidor las rechaza, vuelven atrás con un aviso que dice por qué. Los guardados van en fila (nunca dos `PUT` en vuelo: el
  // segundo llevaría un `actualizado_en` viejo y daría 409 contra el propio panel).
  // Mi cuenta: quién soy, sesiones abiertas con «Cerrar», términos aceptados, «Exportar mis datos» y «Darme de baja» (clave actual,
  // irreversible, explicada antes). Nada de eso es optimista.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, descargar, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { rotuloCondicion } from './lib/estado-visual';
  import type { Preferencias, Sitio } from './lib/modelo';
  import { permisoActual, type Permiso } from './lib/notificaciones';
  import { TIPOS_NOTIFICABLES, alternarNotificacion, cambiar, cuerpoPreferencias, enlaceDeVista, guardarVista, zonasIana } from './lib/preferencias';
  import { ROTULO_ROL, type Sesion } from './lib/sesion';
  import { aplicarTema, leerPreferenciaTema } from './lib/tema';
  import { fechaHora } from './lib/tiempo';

  let {
    sesion,
    sitios = null,
    ultimaVista = null,
    alCambiarPreferencias = () => {},
    alDarseDeBaja = () => {},
  }: { sesion: Sesion; sitios?: Sitio[] | null; ultimaVista?: string | null; alCambiarPreferencias?: (p: Preferencias) => void; alDarseDeBaja?: () => void } = $props();
  const uid = $props.id();

  let prefs = $state<Preferencias | null>(null);
  let errorCarga = $state<string | null>(null);
  let aviso = $state<DatosAviso | null>(null);
  let permiso = $state<Permiso>(permisoActual());
  let nombreVista = $state('');
  const zonas = zonasIana();
  const carga = ultimaGana();

  async function cargar(): Promise<void> {
    try {
      prefs = await obtener<Preferencias>('/preferencias', carga.senal());
      errorCarga = null;
    } catch (e) {
      if (!esCancelacion(e)) errorCarga = avisoDeError(e).texto;
    }
  }

  // Los guardados, en fila: cada uno espera al anterior y usa el `actualizado_en` que dejó.
  let cola: Promise<void> = Promise.resolve();
  function guardar(cambio: Partial<Preferencias>): void {
    if (prefs === null) return;
    const { nuevas, anteriores } = cambiar(prefs, cambio);
    prefs = nuevas; // optimista: se ve ya
    alCambiarPreferencias(nuevas);
    if (cambio.tema !== undefined) aplicarTema(leerPreferenciaTema(cambio.tema));
    cola = cola.then(async () => {
      try {
        const r = await pedir<Preferencias>('PUT', '/preferencias', { cuerpo: cuerpoPreferencias({ ...prefs!, ...cambio }) });
        prefs = { ...prefs!, actualizado_en: r.actualizado_en };
        alCambiarPreferencias(prefs);
      } catch (e) {
        // Vuelve atrás SOLO lo que este guardado cambió (otro posterior pudo cambiar otra cosa), y dice por qué.
        const revertido: Preferencias = { ...prefs! };
        for (const k of Object.keys(cambio) as (keyof Preferencias)[]) (revertido as Record<string, unknown>)[k] = anteriores[k];
        prefs = revertido;
        alCambiarPreferencias(revertido);
        if (cambio.tema !== undefined) aplicarTema(leerPreferenciaTema(anteriores.tema));
        const a = avisoDeError(e);
        aviso = { tipo: a.tipo, texto: `No se guardó la preferencia; volvió a la anterior. ${a.texto}` };
      }
    });
  }

  // Notificaciones del navegador: el permiso se pide AL ACTIVAR (docs/21 §5). Negado, la casilla no se marca y se dice por qué.
  // false = no se guardó (sin permiso): la casilla vuelve a desmarcarse, para que no diga lo que no es.
  async function alternar(tipo: string, activo: boolean): Promise<boolean> {
    if (prefs === null) return false;
    if (activo && permiso !== 'granted') {
      if (permiso === 'sin_soporte') {
        aviso = { tipo: 'info', texto: 'Este navegador no ofrece notificaciones: los avisos siguen apareciendo dentro de la página.' };
        return false;
      }
      try {
        permiso = (await Notification.requestPermission()) as Permiso;
      } catch {
        permiso = permisoActual();
      }
      if (permiso !== 'granted') {
        aviso = { tipo: 'info', texto: 'El navegador no dio permiso para notificar: los avisos siguen apareciendo dentro de la página. Puedes permitirlo en la configuración del sitio en tu navegador.' };
        return false;
      }
    }
    guardar({ notificar: alternarNotificacion(prefs, tipo, activo) });
    return true;
  }

  function guardarLaVista(): void {
    if (prefs === null || ultimaVista === null) return;
    const r = guardarVista(prefs.vistas ?? [], nombreVista, ultimaVista);
    if (typeof r === 'string') {
      aviso = { tipo: 'error', texto: `No se guardó la vista: ${r}.` };
      return;
    }
    nombreVista = '';
    guardar({ vistas: r });
  }

  // ── Mi cuenta ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  interface SesionAbiertaFila { id: string; creada_en: string; ultima_actividad: string; agente: string | null; origen: string | null; actual: boolean }
  let sesiones = $state<SesionAbiertaFila[] | null>(null);
  let errorSesiones = $state<string | null>(null);
  let cerrando = $state<string | null>(null);
  let terminos = $state<{ version: number | string } | null>(null);
  let exportando = $state(false);
  let clave = $state('');
  let entiendo = $state(false);
  let dandoDeBaja = $state(false);
  let errorBaja = $state<string | null>(null);

  async function cargarSesiones(): Promise<void> {
    try {
      sesiones = await obtener<SesionAbiertaFila[]>('/sesiones');
      errorSesiones = null;
    } catch (e) {
      if (!esCancelacion(e)) errorSesiones = avisoDeError(e).texto;
    }
  }
  async function cerrarSesion(s: SesionAbiertaFila): Promise<void> {
    cerrando = s.id;
    try {
      await pedir('DELETE', `/sesiones/${encodeURIComponent(s.id)}`);
      sesiones = (sesiones ?? []).filter((x) => x.id !== s.id); // tras la respuesta, nunca antes
      aviso = { tipo: 'exito', texto: 'Sesión cerrada: ese navegador tendrá que entrar de nuevo.' };
    } catch (e) {
      aviso = avisoDeError(e);
    } finally {
      cerrando = null;
    }
  }
  async function exportar(): Promise<void> {
    exportando = true;
    try {
      await descargar('/cuenta/exportar', 'mis-datos.json');
    } catch (e) {
      aviso = avisoDeError(e);
    } finally {
      exportando = false;
    }
  }
  async function darseDeBaja(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    if (dandoDeBaja || clave === '' || !entiendo) return;
    dandoDeBaja = true;
    errorBaja = null;
    try {
      // central: false → un 401 o 403 aquí es «la clave no es la tuya», no «tu sesión venció».
      await pedir('POST', '/cuenta/baja', { cuerpo: { clave }, central: false });
      clave = '';
      alDarseDeBaja();
    } catch (e) {
      clave = '';
      // El servidor responde 400 «la clave actual no es correcta» (sesion.service.ts, exigirClaveActual); 401 y 403, por si la sesión cambió.
      if (e instanceof ErrorApi && (e.codigo === 400 || e.codigo === 401 || e.codigo === 403)) errorBaja = 'La clave no es la actual: no se dio de baja nada.';
      else if (e instanceof ErrorApi && e.codigo === 409) errorBaja = e.motivos[0] ?? 'No se puede: eres el último administrador del sistema. Nombra a otro antes de darte de baja.';
      else errorBaja = avisoDeError(e).texto;
    } finally {
      dandoDeBaja = false;
    }
  }

  onMount(() => {
    void cargar();
    if (!sesion.sistema) {
      void cargarSesiones();
      void obtener<{ version: number | string }>('/terminos').then((t) => (terminos = t)).catch(() => undefined);
    }
    return () => carga.cancelar();
  });
  const vistaLegible = $derived(ultimaVista === null ? null : ultimaVista.replace(/^#\//, '').split('?')[0] || 'tablero');
</script>

<div class="preferencias" data-preferencias>
  <h2>Preferencias y mi cuenta</h2>
  {#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} alCerrar={() => (aviso = null)} />{/if}

  <section class="panel-seccion" aria-labelledby="{uid}-pref">
    <h3 id="{uid}-pref">Preferencias</h3>
    {#if errorCarga !== null}
      <p class="error" role="alert" data-error-preferencias>No se pudieron leer tus preferencias: {errorCarga} <Boton etiqueta="Reintentar" onclick={() => void cargar()} /></p>
    {:else if prefs === null}
      <p class="vacio">Cargando…</p>
    {:else}
      {@const p = prefs}
      <p class="vivo">Se guardan en tu cuenta (no en este navegador) y te siguen a cualquier equipo. Los datos guardados no cambian: la conversión es solo al mostrar.</p>
      <div class="formulario-configurar">
        <div class="campo">
          <label for="{uid}-temp">Temperatura</label>
          <select id="{uid}-temp" value={p.unidad_temperatura ?? 'C'} onchange={(e) => guardar({ unidad_temperatura: e.currentTarget.value as 'C' | 'F' })} data-pref="unidad_temperatura">
            <option value="C">Grados Celsius (°C)</option><option value="F">Grados Fahrenheit (°F)</option>
          </select>
        </div>
        <div class="campo">
          <label for="{uid}-long">Longitudes y niveles</label>
          <select id="{uid}-long" value={p.unidad_longitud ?? 'm'} onchange={(e) => guardar({ unidad_longitud: e.currentTarget.value as 'mm' | 'm' | 'km' })} data-pref="unidad_longitud">
            <option value="mm">Milímetros (mm)</option><option value="m">Metros (m)</option><option value="km">Kilómetros (km)</option>
          </select>
        </div>
        <div class="campo">
          <label for="{uid}-zona">Zona horaria</label>
          <select id="{uid}-zona" value={p.zona_horaria ?? 'sitio'} onchange={(e) => guardar({ zona_horaria: e.currentTarget.value })} aria-describedby="{uid}-zona-ayuda" data-pref="zona_horaria">
            <option value="sitio">La de cada sitio (recomendado)</option>
            {#each zonas as z (z)}<option value={z}>{z}</option>{/each}
          </select>
          <span class="ayuda-campo" id="{uid}-zona-ayuda">Con «la de cada sitio», las horas van en la zona del sitio del dato; con una propia, todas en la tuya, y la cabecera lo dice.</span>
        </div>
        <div class="campo">
          <label for="{uid}-tema">Tema</label>
          <select id="{uid}-tema" value={p.tema ?? 'sistema'} onchange={(e) => guardar({ tema: e.currentTarget.value as 'sistema' | 'claro' | 'oscuro' })} data-pref="tema">
            <option value="sistema">El del sistema operativo</option><option value="claro">Claro</option><option value="oscuro">Oscuro</option>
          </select>
        </div>
        {#if sitios !== null && sitios.length > 1}
          <div class="campo">
            <label for="{uid}-sitio">Sitio al entrar</label>
            <select id="{uid}-sitio" value={p.sitio_predeterminado ?? ''} onchange={(e) => guardar({ sitio_predeterminado: e.currentTarget.value || null })} data-pref="sitio_predeterminado">
              <option value="">El primero de la lista</option>
              {#each sitios as s (s.id)}<option value={s.id}>{s.nombre}</option>{/each}
            </select>
          </div>
        {/if}
      </div>

      <fieldset class="regla" data-pref-notificar>
        <legend>Notificación del navegador, además del aviso en pantalla</legend>
        <p class="ayuda-campo">{permiso === 'granted' ? 'El navegador ya dio permiso.' : permiso === 'denied' ? 'El navegador negó el permiso: actívalo en su configuración del sitio para recibirlas.' : permiso === 'sin_soporte' ? 'Este navegador no ofrece notificaciones.' : 'Al marcar la primera, el navegador te pedirá permiso.'}</p>
        <p class="ayuda-campo" data-ayuda-notificar>La notificación dice solo «N condiciones nuevas en» el sitio, sin el dispositivo ni el tipo (la puede ver quien mire tu pantalla bloqueada); el detalle está en el aviso dentro de la página.</p>
        {#each TIPOS_NOTIFICABLES as t (t)}
          <label class="marcar"><input type="checkbox" checked={(p.notificar ?? []).includes(t)} onchange={(e) => { const casilla = e.currentTarget; void alternar(t, casilla.checked).then((ok) => { if (!ok) casilla.checked = false; }); }} data-notificar={t} /> {rotuloCondicion(t)}</label>
        {/each}
      </fieldset>

      <h4>Vistas guardadas</h4>
      {#if (p.vistas ?? []).length === 0}
        <p class="vacio" data-sin-vistas>Sin vistas guardadas. Abre el tablero, el inventario o una ficha con los filtros y el rango que quieras, y vuelve aquí para guardarla con un nombre.</p>
      {:else}
        <ul data-vistas>
          {#each p.vistas ?? [] as v (v.nombre)}
            {@const enlace = enlaceDeVista(v)}
            <li data-vista={v.nombre}>{#if enlace !== null}<a href={enlace}>{v.nombre}</a>{:else}{v.nombre}{/if} <span class="vivo">({v.pantalla})</span>
              <Boton etiqueta="Borrar" variante="discreto" onclick={() => guardar({ vistas: (p.vistas ?? []).filter((x) => x.nombre !== v.nombre) })} /></li>
          {/each}
        </ul>
      {/if}
      {#if ultimaVista !== null}
        <form class="formulario-alta" onsubmit={(e) => { e.preventDefault(); guardarLaVista(); }} novalidate>
          <label>Guardar la última vista que abriste ({vistaLegible}) como <input type="text" maxlength="60" bind:value={nombreVista} data-nombre-vista /></label>
          <Boton tipo="submit" etiqueta="Guardar la vista" motivoDesactivado={nombreVista.trim() === '' ? 'falta el nombre' : null} data-guardar-vista />
        </form>
      {/if}
    {/if}
  </section>

  <section class="panel-seccion" aria-labelledby="{uid}-cuenta" data-mi-cuenta>
    <h3 id="{uid}-cuenta">Mi cuenta</h3>
    {#if sesion.sistema}
      <p class="vacio">Entraste como usuario del sistema (la clave por cabecera): no tiene cuenta propia que mostrar ni dar de baja.</p>
    {:else}
      <dl class="identidad">
        <dt>Nombre</dt><dd data-mi-nombre>{sesion.usuario.nombre}</dd>
        <dt>Correo</dt><dd>{sesion.usuario.email}</dd>
        <dt>Sitios y perfiles</dt><dd>{sesion.sitios.length === 0 ? 'ninguno' : sesion.sitios.map((s) => `${s.nombre} (${ROTULO_ROL[s.rol] ?? s.rol})`).join(', ')}</dd>
        <dt>Términos de uso</dt><dd data-terminos-aceptados>{terminos === null ? 'aceptados' : `versión ${terminos.version}, aceptada`} · <a href="#/legal?seccion=terminos">leerlos</a></dd>
      </dl>

      <h4>Sesiones abiertas</h4>
      {#if errorSesiones !== null}
        <p class="error" role="alert">{errorSesiones} <Boton etiqueta="Reintentar" onclick={() => void cargarSesiones()} /></p>
      {:else if sesiones === null}
        <p class="vacio">Cargando…</p>
      {:else}
        <ul class="lista-actividad" data-sesiones>
          {#each sesiones as s (s.id)}
            <li data-sesion-abierta={s.id}>
              <strong>{s.agente ?? 'navegador sin nombre'}</strong>{#if s.actual} <span class="vivo">(esta)</span>{/if}<br />
              <span class="vivo">desde {s.origen ?? 'origen desconocido'} · abierta el {fechaHora(s.creada_en, 'UTC')} UTC · última actividad {fechaHora(s.ultima_actividad, 'UTC')} UTC</span>
              <Boton etiqueta="Cerrar esta sesión" etiquetaCargando="Cerrando…" cargando={cerrando === s.id}
                motivoDesactivado={s.actual ? 'es la sesión que usas ahora: para cerrarla, «Salir»' : null} onclick={() => void cerrarSesion(s)} data-cerrar-sesion={s.id} />
            </li>
          {/each}
        </ul>
      {/if}

      <h4>Mis datos</h4>
      <p>Tu nombre, correo, sitios y perfiles, preferencias, sesiones y accesos, en un archivo JSON.
        <Boton etiqueta="Exportar mis datos" etiquetaCargando="Preparando…" cargando={exportando} onclick={() => void exportar()} data-exportar-mis-datos /></p>

      <h4>Darme de baja</h4>
      <div class="texto-legal" data-explicacion-baja>
        <p><strong>Es irreversible.</strong> Se borran tu nombre, tu correo y tu clave (la cuenta queda como «Cuenta dada de baja» con un código), se
          cierran todas tus sesiones y se borran tus preferencias y tus mensajes de soporte. Quedan las <strong>altas y cambios</strong> que hiciste,
          porque son el historial de los sitios, <strong>sin datos tuyos</strong> (ni nombre, ni correo, ni el motivo escrito en una baja). Tus
          <strong>accesos</strong> (entradas, salidas e intentos) quedan sin el correo, pero con la dirección IP: <strong>se borran a los 90 días</strong>.
          Los respaldos anteriores se borran al vencer (30 días). Si más adelante necesitas entrar, te pueden dar una cuenta nueva.</p>
      </div>
      <form class="formulario-alta" onsubmit={darseDeBaja} novalidate data-form-baja>
        <label>Tu clave actual <input type="password" autocomplete="current-password" bind:value={clave} data-clave-baja /></label>
        <label class="marcar"><input type="checkbox" bind:checked={entiendo} data-entiendo-baja /> Entiendo que no se puede deshacer</label>
        <Boton tipo="submit" variante="peligro" etiqueta="Darme de baja" etiquetaCargando="Dando de baja…" cargando={dandoDeBaja}
          motivoDesactivado={dandoDeBaja ? null : clave === '' ? 'falta tu clave actual' : !entiendo ? 'marca que entiendes que es irreversible' : null} data-darme-de-baja />
      </form>
      {#if errorBaja !== null}<Aviso tipo="error" texto={errorBaja} alCerrar={() => (errorBaja = null)} />{/if}
    {/if}
  </section>
</div>
