<script lang="ts">
  // Pantalla de usuarios (P10, parte de administración; docs/19 §4; HU-18, RF-43, RF-44; docs/20 §4 y §6). Solo para quien administra
  // algún sitio, y solo sobre sus sitios: la lista, el alta con clave temporal (mostrada UNA vez; un correo de una cuenta inactiva ofrece
  // «Reactivar»), desactivar con motivo y reactivar con una temporal nueva, asignar una temporal nueva («olvidé mi clave») y uno de los
  // cuatro perfiles en cada uno de sus sitios (el administrador del sistema, además, el perfil global). Todo cambio lleva el `actualizado_en` leído: si otra persona
  // lo cambió entretanto, 409 y el aviso pide recargar (nunca pisa). La guía de perfiles sale de la matriz de permisos del servidor
  // (lib/ayudas.ts): no puede decir algo distinto de lo que el servidor permite.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import Tooltip from './Tooltip.svelte';
  import { ErrorApi, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { ayudaDeRol, guiaDePerfiles } from './lib/ayudas';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import type { Sitio } from './lib/modelo';
  import { ROTULO_ROL, type Rol, type Sesion } from './lib/sesion';
  import {
    AVISO_MOTIVO, MAX_MOTIVO, ROLES_DE_SITIO, aplicarRespuesta, cambioBaja, cambioReactivar, cambioRol, cambioTemporal, cuerpoAlta, motivoDeBajaInvalido,
    motivosAlta, reactivableDe, rolEn, type CambioUsuario, type UsuarioConClave, type UsuarioListado,
  } from './lib/usuarios';

  let { sesion }: { sesion: Sesion } = $props();

  // El administrador del sistema (perfil global, docs/20 §2) administra todos los sitios: los pide a GET /sitios; los demás, los de la
  // sesión donde su perfil puede «usuarios». Son los únicos donde se da de alta o se cambia un rol.
  const soyGlobal = $derived(!sesion.sistema && sesion.administrador_sistema === true);
  let todosLosSitios = $state<{ sitio_id: string; codigo: string; nombre: string }[]>([]);
  const misSitios = $derived(sesion.sistema ? [] : soyGlobal ? todosLosSitios : sesion.sitios.filter((s) => (sesion.permisos[s.rol] ?? []).includes('usuarios')));
  const yo = $derived(sesion.sistema ? null : sesion.usuario.id);
  const guia = $derived(guiaDePerfiles(sesion.permisos));
  // La cuenta de un administrador del sistema solo la cambia otro (revisión del 11/11/2026): el servidor respondería 403.
  const intocable = (u: UsuarioListado): string | null =>
    u.administrador_sistema === true && !soyGlobal ? 'es administrador del sistema: solo otro administrador del sistema cambia su cuenta' : null;

  let usuarios = $state<UsuarioListado[]>([]);
  let cargado = $state(false);
  let aviso = $state<DatosAviso | null>(null);
  let ocupado = $state<string | null>(null); // el usuario con un cambio en vuelo
  // Un cambio rechazado (409, 403) deja los selectores como estaban: la fila se vuelve a dibujar desde los datos leídos.
  let version = $state(0);
  // La clave temporal recién creada o asignada: se muestra una vez y se olvida al ocultarla o al salir de la pantalla.
  let unaVez = $state<{ nombre: string; email: string; clave: string; vence: string | null } | null>(null);
  let copiada = $state<'no' | 'si' | 'manual'>('no');

  // Alta
  let nombre = $state('');
  let email = $state('');
  let sitioAlta = $state('');
  let rolAlta = $state<Rol>('consulta');
  let globalAlta = $state(false); // perfil de administrador del sistema: la casilla solo aparece para quien ya lo tiene
  let creando = $state(false);
  const faltaAlta = $derived(motivosAlta(nombre, email, sitioAlta, globalAlta));
  // El correo del alta es de una cuenta inactiva que puedo ver (409 `reactivable`): se ofrece reactivarla en vez de crear otra.
  let reactivable = $state<UsuarioListado | null>(null);
  // La baja: el motivo se escribe en la fila antes de confirmar (el servidor lo exige; migración 24).
  let bajaDe = $state<string | null>(null);
  let motivoBaja = $state('');

  const lista = ultimaGana(); // una recarga nueva cancela la anterior: la respuesta vieja nunca pisa a la nueva
  async function cargar(): Promise<void> {
    try {
      usuarios = await obtener<UsuarioListado[]>('/usuarios', lista.senal());
    } catch (e) {
      if (esCancelacion(e)) return;
      aviso = avisoDeError(e);
    } finally {
      cargado = true;
    }
  }

  // La hora de vencimiento la dice el servidor (CLAVE_TEMPORAL_HORAS, 1–72 h; 2 por defecto): el panel no supone un plazo fijo.
  const fechaHora = (iso: string): string => new Date(iso).toLocaleString('es-CL', { dateStyle: 'short', timeStyle: 'short', hourCycle: 'h23' });

  function mostrarClave(u: UsuarioConClave): void {
    unaVez = { nombre: u.nombre, email: u.email, clave: u.clave, vence: u.clave_temporal_vence_en };
    copiada = 'no';
  }

  async function crear(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (creando || faltaAlta.length > 0) return;
    creando = true;
    aviso = null;
    reactivable = null;
    try {
      const u = await pedir<UsuarioConClave>('POST', '/usuarios', { cuerpo: cuerpoAlta(nombre, email, sitioAlta, rolAlta, globalAlta) });
      mostrarClave(u);
      aviso = { tipo: 'exito', texto: `${u.nombre} quedó dado de alta como ${globalAlta ? 'administrador del sistema' : ROTULO_ROL[rolAlta]}.` };
      nombre = email = '';
      globalAlta = false;
      await cargar();
    } catch (x) {
      reactivable = x instanceof ErrorApi && x.codigo === 409 ? reactivableDe(x.cuerpo) : null;
      aviso = reactivable === null ? avisoDeError(x) : null;
    } finally {
      creando = false;
    }
  }

  async function cambiar(u: UsuarioListado, cambio: CambioUsuario, exito: string): Promise<void> {
    if (ocupado !== null) return;
    ocupado = u.id;
    aviso = null;
    try {
      const r = await pedir<UsuarioListado | UsuarioConClave>('PATCH', `/usuarios/${encodeURIComponent(u.id)}`, { cuerpo: cambio });
      // La temporal se separa de la fila: va solo al aviso «una vez», nunca a la lista (que vive mientras la pantalla esté abierta).
      const { lista: nueva, clave } = aplicarRespuesta(usuarios, r);
      if (clave !== null) mostrarClave({ ...r, clave });
      usuarios = nueva;
      aviso = { tipo: 'exito', texto: exito };
    } catch (x) {
      aviso = avisoDeError(x);
      version++;
    } finally {
      ocupado = null;
    }
  }

  // Reactivar la cuenta inactiva que encontró el alta: PATCH con activo: true y una clave temporal nueva (la de antes no vuelve).
  async function reactivar(): Promise<void> {
    const r = reactivable;
    if (r === null || ocupado !== null) return;
    ocupado = r.id;
    try {
      const u = await pedir<UsuarioConClave>('PATCH', `/usuarios/${encodeURIComponent(r.id)}`, { cuerpo: cambioReactivar(r) });
      mostrarClave(u);
      aviso = { tipo: 'exito', texto: `${u.nombre} quedó activo de nuevo, con una clave temporal nueva.` };
      reactivable = null;
      nombre = email = '';
      await cargar();
    } catch (x) {
      aviso = avisoDeError(x);
    } finally {
      ocupado = null;
    }
  }

  function abrirBaja(u: UsuarioListado): void {
    bajaDe = u.id;
    motivoBaja = '';
  }
  async function confirmarBaja(e: SubmitEvent, u: UsuarioListado): Promise<void> {
    e.preventDefault();
    if (motivoDeBajaInvalido(motivoBaja) !== null) return;
    await cambiar(u, cambioBaja(u, motivoBaja), `${u.nombre} quedó inactivo.`);
    if (aviso?.tipo === 'exito') bajaDe = null;
  }

  function alCambiarRol(u: UsuarioListado, sitioId: string, valor: string): void {
    const rol = valor === '' ? null : (valor as Rol);
    const sitio = misSitios.find((s) => s.sitio_id === sitioId)?.nombre ?? 'el sitio';
    void cambiar(u, cambioRol(u, sitioId, rol), rol === null ? `${u.nombre} ya no tiene acceso a ${sitio}.` : `${u.nombre} es ahora ${ROTULO_ROL[rol]} en ${sitio}.`);
  }

  async function copiar(): Promise<void> {
    if (unaVez === null) return;
    try {
      await navigator.clipboard.writeText(unaVez.clave);
      copiada = 'si';
    } catch {
      // Sin portapapeles (una dirección que el navegador no trata como segura): se selecciona el texto para copiarlo a mano.
      const el = document.querySelector('[data-clave-temporal]');
      const sel = window.getSelection();
      if (el !== null && sel !== null) {
        const rango = document.createRange();
        rango.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(rango);
      }
      copiada = 'manual';
    }
  }

  onMount(() => {
    if (soyGlobal) {
      void obtener<Sitio[]>('/sitios', lista.senal())
        .then((s) => {
          todosLosSitios = s.map((x) => ({ sitio_id: x.id, codigo: x.codigo, nombre: x.nombre }));
          if (sitioAlta === '' && todosLosSitios.length > 0) sitioAlta = todosLosSitios[0]!.sitio_id;
        })
        .catch((e: unknown) => { if (!esCancelacion(e)) aviso = avisoDeError(e); });
    }
    if (sitioAlta === '' && misSitios.length > 0) sitioAlta = misSitios[0]!.sitio_id;
    void cargar();
    return () => lista.cancelar();
  });
</script>

<h2>Usuarios</h2>

<section class="guia-perfiles" aria-labelledby="titulo-guia" data-guia-perfiles>
  <h3 id="titulo-guia">Qué puede hacer cada perfil</h3>
  <ul>
    {#each guia as g (g.rol)}<li data-guia-rol={g.rol}>{g.texto}</li>{/each}
  </ul>
  <p class="vivo">Sale de la tabla de permisos del servidor: el rol vale por sitio, y una persona puede tener roles distintos en sitios distintos.</p>
</section>

{#if aviso !== null}<Aviso tipo={aviso.tipo} texto={aviso.texto} accion={aviso.tipo === 'conflicto' ? { etiqueta: 'Recargar', alHacer: () => { aviso = null; void cargar(); } } : undefined} alCerrar={() => (aviso = null)} />{/if}

{#if reactivable !== null}
  <div class="reactivable" role="status" data-reactivable>
    <p>Ya existe una cuenta <strong>inactiva</strong> con ese correo ({reactivable.nombre}). En vez de crear otra, puedes reactivarla: recibirá
      una clave temporal nueva (la de antes no vuelve).</p>
    <span class="acciones">
      <Boton etiqueta="Reactivar" variante="principal" cargando={ocupado === reactivable.id} etiquetaCargando="Reactivando…"
        ayuda="La cuenta vuelve a estar activa, con sus sitios de antes, y una clave temporal nueva que verás una vez" onclick={() => void reactivar()} data-reactivar-alta />
      <Boton etiqueta="Cancelar" onclick={() => (reactivable = null)} />
    </span>
  </div>
{/if}

{#if unaVez !== null}
  <div class="clave-una-vez" data-clave-una-vez>
    <!-- Región viva solo el texto del aviso: un lector de pantalla anuncia que hay una clave, no la lee en voz alta (la clave no es región viva) -->
    <p role="status">
      Clave temporal de <strong>{unaVez.nombre}</strong> ({unaVez.email}). <strong>No se vuelve a mostrar</strong>: cópiala ahora y entrégala
      por un canal seguro. {#if unaVez.vence !== null}Vence el <span data-vence-temporal>{fechaHora(unaVez.vence)}</span>{:else}Vence en pocas horas{/if}; al entrar
      con ella, el sistema le pide elegir una clave propia.
    </p>
    <code data-clave-temporal>{unaVez.clave}</code>
    <span class="acciones">
      <Boton etiqueta={copiada === 'si' ? 'Copiada' : 'Copiar'} ayuda="Copia la clave temporal al portapapeles" onclick={() => void copiar()} data-copiar-clave />
      <Boton etiqueta="Ya la entregué: ocultar" onclick={() => (unaVez = null)} data-ocultar-clave />
    </span>
    {#if copiada === 'manual'}<p class="vivo">El navegador no deja copiar desde esta dirección: la clave quedó seleccionada; cópiala con Ctrl+C.</p>{/if}
  </div>
{/if}

<section aria-labelledby="titulo-alta">
  <h3 id="titulo-alta">Dar de alta a una persona</h3>
  {#if misSitios.length === 0 && !soyGlobal}
    <p class="vacio">No administras ningún sitio con sesión propia: el alta la hace un administrador de sitio desde aquí.</p>
  {:else}
    <form class="formulario-alta" onsubmit={crear} novalidate data-alta-usuario>
      <label>Nombre <input type="text" maxlength="80" autocomplete="off" bind:value={nombre} /></label>
      <label>Correo <input type="email" maxlength="254" autocomplete="off" bind:value={email} /></label>
      <label>Sitio
        <select bind:value={sitioAlta} data-sitio-alta>
          {#if globalAlta}<option value="">ninguno (alcanza a todos)</option>{/if}
          {#each misSitios as s (s.sitio_id)}<option value={s.sitio_id}>{s.nombre}</option>{/each}
        </select>
      </label>
      <label>Rol
        <Tooltip id="ayuda-rol-alta" texto={ayudaDeRol(rolAlta, sesion.permisos)}>
          <select bind:value={rolAlta} aria-describedby="ayuda-rol-alta" data-rol-alta>
            {#each ROLES_DE_SITIO as r (r)}<option value={r}>{ROTULO_ROL[r]}</option>{/each}
          </select>
        </Tooltip>
      </label>
      {#if soyGlobal}
        <label class="casilla"><input type="checkbox" bind:checked={globalAlta} aria-describedby="ayuda-global-alta" data-global-alta />
          Administrador del sistema</label>
        <span id="ayuda-global-alta" class="vivo">Todos los sitios, el soporte y el estado del sistema; solo otro administrador del sistema cambia su cuenta.</span>
      {/if}
      <Boton tipo="submit" variante="principal" etiqueta="Dar de alta" etiquetaCargando="Dando de alta…" cargando={creando}
        motivoDesactivado={creando ? null : (faltaAlta[0] ?? null)} ayuda="Crea la cuenta con una clave temporal que verás una sola vez" data-crear-usuario />
    </form>
  {/if}
</section>

<section aria-labelledby="titulo-lista">
  <h3 id="titulo-lista">Personas de tus sitios</h3>
  {#if !cargado}
    <p class="vacio">Cargando…</p>
  {:else if usuarios.length === 0}
    <p class="vacio">Nadie más en tus sitios todavía: da de alta a la primera persona con el formulario de arriba.</p>
  {:else}
    <div class="tabla">
      <table data-usuarios>
        <thead>
          <tr><th scope="col">Nombre</th><th scope="col">Correo</th><th scope="col">Rol por sitio</th><th scope="col">Estado</th><th scope="col">Acciones</th></tr>
        </thead>
        <tbody>
          {#each usuarios as u (`${u.id}:${version}`)}
            <tr data-usuario={u.email} aria-busy={ocupado === u.id}>
              <td>{u.nombre}{#if u.id === yo} <span class="vivo">(tú)</span>{/if}</td>
              <td>{u.email}</td>
              <td>
                {#if !u.en_mis_sitios}<p class="vivo" data-fuera-de-mis-sitios>Ya no está en tus sitios; puedes devolverle uno.</p>{/if}
                {#each misSitios as s (s.sitio_id)}
                  <label class="rol-sitio">{s.nombre}
                    <Tooltip id={`ayuda-rol-${u.id}-${s.sitio_id}`} texto={rolEn(u, s.sitio_id) === null ? 'Sin acceso a este sitio' : ayudaDeRol(rolEn(u, s.sitio_id)!, sesion.permisos)}>
                      <select value={rolEn(u, s.sitio_id) ?? ''} disabled={ocupado !== null || u.id === yo || intocable(u) !== null} aria-describedby={`ayuda-rol-${u.id}-${s.sitio_id}`}
                        onchange={(e) => alCambiarRol(u, s.sitio_id, e.currentTarget.value)} data-rol-sitio={s.codigo}>
                        <option value="">sin acceso</option>
                        {#each ROLES_DE_SITIO as r (r)}<option value={r}>{ROTULO_ROL[r]}</option>{/each}
                      </select>
                    </Tooltip>
                  </label>
                {/each}
                {#if u.id === yo}<span class="vivo">Tu propio rol lo cambia otro administrador.</span>{/if}
              </td>
              <td data-estado-usuario>
                {u.activo ? 'activo' : 'inactivo'}
                {#if u.clave_temporal && u.clave_temporal_vence_en !== null}<br /><span class="vivo">clave temporal sin cambiar; vence el {fechaHora(u.clave_temporal_vence_en)}</span>{/if}
              </td>
              <td class="acciones">
                <Boton etiqueta={u.activo ? 'Desactivar' : 'Activar'} variante={u.activo ? 'peligro' : 'normal'}
                  ayuda={u.activo ? 'Pide el motivo; corta sus sesiones y ya no puede entrar; su rastro se conserva' : 'Vuelve a poder entrar con una clave temporal nueva que verás una vez (la de antes no vuelve)'}
                  motivoDesactivado={u.id === yo ? 'no puedes desactivarte a ti mismo' : intocable(u)} cargando={ocupado === u.id}
                  onclick={() => (u.activo ? abrirBaja(u) : void cambiar(u, cambioReactivar(u), `${u.nombre} quedó activo, con una clave temporal nueva.`))} data-alternar-activo />
                <Boton etiqueta="Asignar clave temporal" ayuda="Para quien olvidó su clave: una temporal nueva, de vigencia corta, que verás una vez; corta sus sesiones"
                  motivoDesactivado={u.id === yo ? 'tu clave la cambias tú, desde la cabecera' : !u.activo ? 'actívalo primero' : intocable(u)} cargando={ocupado === u.id}
                  onclick={() => void cambiar(u, cambioTemporal(u), `${u.nombre} tiene una clave temporal nueva.`)} data-asignar-temporal />
                {#if bajaDe === u.id && u.activo}
                  <form class="baja-motivo" onsubmit={(e) => void confirmarBaja(e, u)} novalidate data-baja-motivo>
                    <label for={`motivo-${u.id}`}>Motivo de la baja</label>
                    <input id={`motivo-${u.id}`} type="text" maxlength={MAX_MOTIVO} autocomplete="off" bind:value={motivoBaja}
                      aria-describedby={`aviso-motivo-${u.id}`} data-motivo-baja />
                    <span id={`aviso-motivo-${u.id}`} class="vivo">{AVISO_MOTIVO}</span>
                    <Boton tipo="submit" variante="peligro" etiqueta="Confirmar la baja" cargando={ocupado === u.id} etiquetaCargando="Dando de baja…"
                      motivoDesactivado={ocupado === u.id ? null : motivoDeBajaInvalido(motivoBaja)} data-confirmar-baja />
                    <Boton etiqueta="Cancelar" onclick={() => (bajaDe = null)} data-cancelar-baja />
                  </form>
                {/if}
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
