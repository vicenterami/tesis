<script lang="ts">
  // Pantalla de usuarios (P10, parte de administración; docs/19 §4; HU-18, RF-43, RF-44; docs/20 §4 y §6). Solo para quien administra
  // algún sitio, y solo sobre sus sitios: la lista, el alta con clave temporal (mostrada UNA vez), activar y desactivar, asignar una
  // temporal nueva («olvidé mi clave») y el rol en cada uno de sus sitios. Todo cambio lleva el `actualizado_en` leído: si otra persona
  // lo cambió entretanto, 409 y el aviso pide recargar (nunca pisa). La guía de perfiles sale de la matriz de permisos del servidor
  // (lib/ayudas.ts): no puede decir algo distinto de lo que el servidor permite.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import Tooltip from './Tooltip.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { ayudaDeRol, guiaDePerfiles } from './lib/ayudas';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { ROTULO_ROL, type Rol, type Sesion } from './lib/sesion';
  import { aplicarRespuesta, cambioActivo, cambioRol, cambioTemporal, cuerpoAlta, motivosAlta, rolEn, type CambioUsuario, type UsuarioConClave, type UsuarioListado } from './lib/usuarios';

  let { sesion }: { sesion: Sesion } = $props();

  // Los sitios que administro (de la sesión): los únicos donde puedo dar de alta o cambiar un rol.
  const misSitios = $derived(sesion.sistema ? [] : sesion.sitios.filter((s) => (sesion.permisos[s.rol] ?? []).includes('usuarios')));
  const yo = $derived(sesion.sistema ? null : sesion.usuario.id);
  const guia = $derived(guiaDePerfiles(sesion.permisos));
  const ROLES: Rol[] = ['consulta', 'administrador'];

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
  let creando = $state(false);
  const faltaAlta = $derived(motivosAlta(nombre, email, sitioAlta));

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
    try {
      const u = await pedir<UsuarioConClave>('POST', '/usuarios', { cuerpo: cuerpoAlta(nombre, email, sitioAlta, rolAlta) });
      mostrarClave(u);
      aviso = { tipo: 'exito', texto: `${u.nombre} quedó dado de alta como ${ROTULO_ROL[rolAlta]}.` };
      nombre = email = '';
      await cargar();
    } catch (x) {
      aviso = avisoDeError(x);
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
  {#if misSitios.length === 0}
    <p class="vacio">No administras ningún sitio con sesión propia: el alta la hace un administrador de sitio desde aquí.</p>
  {:else}
    <form class="formulario-alta" onsubmit={crear} novalidate data-alta-usuario>
      <label>Nombre <input type="text" maxlength="80" autocomplete="off" bind:value={nombre} /></label>
      <label>Correo <input type="email" maxlength="254" autocomplete="off" bind:value={email} /></label>
      <label>Sitio
        <select bind:value={sitioAlta}>
          {#each misSitios as s (s.sitio_id)}<option value={s.sitio_id}>{s.nombre}</option>{/each}
        </select>
      </label>
      <label>Rol
        <Tooltip id="ayuda-rol-alta" texto={ayudaDeRol(rolAlta, sesion.permisos)}>
          <select bind:value={rolAlta} aria-describedby="ayuda-rol-alta" data-rol-alta>
            {#each ROLES as r (r)}<option value={r}>{ROTULO_ROL[r]}</option>{/each}
          </select>
        </Tooltip>
      </label>
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
                      <select value={rolEn(u, s.sitio_id) ?? ''} disabled={ocupado !== null || u.id === yo} aria-describedby={`ayuda-rol-${u.id}-${s.sitio_id}`}
                        onchange={(e) => alCambiarRol(u, s.sitio_id, e.currentTarget.value)} data-rol-sitio={s.codigo}>
                        <option value="">sin acceso</option>
                        {#each ROLES as r (r)}<option value={r}>{ROTULO_ROL[r]}</option>{/each}
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
                  ayuda={u.activo ? 'Corta sus sesiones y ya no puede entrar; su rastro se conserva' : 'Vuelve a poder entrar con su clave'}
                  motivoDesactivado={u.id === yo ? 'no puedes desactivarte a ti mismo' : null} cargando={ocupado === u.id}
                  onclick={() => void cambiar(u, cambioActivo(u, !u.activo), `${u.nombre} quedó ${u.activo ? 'inactivo' : 'activo'}.`)} data-alternar-activo />
                <Boton etiqueta="Asignar clave temporal" ayuda="Para quien olvidó su clave: una temporal nueva, de vigencia corta, que verás una vez; corta sus sesiones"
                  motivoDesactivado={u.id === yo ? 'tu clave la cambias tú, desde la cabecera' : !u.activo ? 'actívalo primero' : null} cargando={ocupado === u.id}
                  onclick={() => void cambiar(u, cambioTemporal(u), `${u.nombre} tiene una clave temporal nueva.`)} data-asignar-temporal />
              </td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}
</section>
