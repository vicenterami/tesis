<script lang="ts">
  // Ruteo por fragmento (docs/19 §1): `#/` tablero (desde el tablero v2, A1), `#/inventario` inventario, `#/dispositivos/<id>` ficha, `#/comparar?dispositivos=…` comparación (P3b),
  // `#/usuarios` usuarios (P10), `#/legal` legal y acerca de (P11, también antes de entrar). Así ninguna ruta del panel choca con las de la API, que viven en la raíz del mismo origen. La vista
  // (canal, rango, filtros) va tras el `?` del fragmento (docs/19 §4, incremento 1, punto 1): se lee al cargar y en cada `hashchange`
  // (atrás, un enlace); cada pantalla la escribe con `replaceState`, que no ensucia el historial ni dispara `hashchange`.
  //
  // Sesión (P10; docs/20 §3): al cargar, `GET /sesion` dice si hay una. Sin ella, la pantalla «Entrar»; con clave temporal, el cambio
  // obligatorio; con sesión, las pantallas. Las pantallas (y sus canales en vivo) existen solo «dentro»: al salir o al vencer la sesión se
  // desmontan, y con ellas se cierran sus `EventSource` y se cancelan sus peticiones; al volver a entrar se montan y reabren. Un 401 en
  // cualquier petición (lib/api.ts, manejo central) guarda la ruta, muestra «Entrar» y, tras entrar, vuelve a esa misma ruta.
  import { onMount } from 'svelte';
  import Actividad from './Actividad.svelte';
  import Alta from './Alta.svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import Configurar from './Configurar.svelte';
  import Notificaciones from './Notificaciones.svelte';
  import Preferencias from './Preferencias.svelte';
  import Terminos from './Terminos.svelte';
  import CambiarClave from './CambiarClave.svelte';
  import Comparar from './Comparar.svelte';
  import Entrar from './Entrar.svelte';
  import Ficha from './Ficha.svelte';
  import Inventario from './Inventario.svelte';
  import Legal from './Legal.svelte';
  import Tablero from './Tablero.svelte';
  import Usuarios from './Usuarios.svelte';
  import { ErrorApi, alPerderSesion, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { olvidarMarcados } from './lib/comparar';
  import type { Preferencias as DatosPreferencias, Salud, Sitio } from './lib/modelo';
  import { crearRenovador, puedeEnAlguno, quienSoy, trasAvisoDeSesion, type Fase, type Sesion, type SesionAbierta } from './lib/sesion';
  import { aplicarTema, leerPreferenciaTema } from './lib/tema';
  import { preferenciaUnidades } from './lib/unidades';
  import { fragmentoInventario, fragmentoTablero, leerVista, redireccionVieja } from './lib/vista';

  let fase = $state<Fase>('comprobando');
  let sesion = $state<Sesion | null>(null);
  let mensajeEntrar = $state<string | null>(null);
  let avisoCabecera = $state<DatosAviso | null>(null);
  let cambiandoClave = $state(false); // cambio voluntario desde la cabecera (el obligatorio es la fase «cambiar»)
  let saliendo = $state(false);
  // La temporal que la persona acaba de escribir al entrar: solo en memoria, para no pedirla dos veces; se borra al cambiarla.
  let claveRecienUsada = $state<string | null>(null);
  // La ruta donde estaba cuando la sesión venció: tras entrar, se vuelve a ella.
  let rutaGuardada: string | null = null;

  let ruta = $state(window.location.hash);
  let salud = $state<string>('consultando…');
  const vista = $derived(leerVista(ruta));
  const quien = $derived(sesion === null ? null : quienSoy(sesion));
  // El usuario del sistema (clave por cabecera) no tiene personas a su cargo: la pantalla de usuarios es solo para personas con sesión.
  const administraUsuarios = $derived(sesion !== null && !sesion.sistema && puedeEnAlguno(sesion, 'usuarios'));
  const email = $derived(sesion !== null && !sesion.sistema ? sesion.usuario.email : null);
  // Administrador del sistema (P12, A1): el usuario del sistema o, con los cinco perfiles (docs/20 §2), la persona que la sesión declare.
  const administraSistema = $derived(sesion !== null && (sesion.sistema || sesion.administrador_sistema === true));
  // P14 Actividad: quien administra algún sitio (la misma acción de la matriz que la pantalla de usuarios) o el sistema.
  const veActividad = $derived(sesion !== null && !sesion.sistema && (puedeEnAlguno(sesion, 'auditoria') || sesion.administrador_sistema === true));
  // P7 Alta: quien puede escribir en algún sitio (el servidor decide igual).
  const daDeAlta = $derived(sesion !== null && puedeEnAlguno(sesion, 'escribir'));
  // La última vista de datos abierta (tablero, inventario o ficha): P13 la ofrece para guardarla con un nombre.
  let ultimaVista = $state<string | null>(null);
  $effect(() => {
    if (vista.pantalla === 'tablero' || vista.pantalla === 'inventario' || vista.pantalla === 'ficha') ultimaVista = ruta === '' ? '#/' : ruta;
  });
  function alCambiarPreferencias(p: DatosPreferencias): void {
    if (sesion !== null) sesion = { ...sesion, preferencias: p };
  }
  // Términos pendientes (docs/20 §12): la clave temporal va primero; después, la aceptación.
  const fasePorSesion = (s: Sesion): Fase => (!s.sistema && s.clave_temporal ? 'cambiar' : !s.sistema && s.terminos?.pendiente === true ? 'terminos' : 'dentro');
  const unidades = $derived(preferenciaUnidades(sesion?.preferencias));

  // Armazón (docs/19 §4, tablero v2, A1): los sitios de la persona (`GET /sitios`) para el selector de la cabecera, que aparece solo con
  // más de uno; el sitio vive en la URL (`?sitio=<código>`) y, si no viene, rige la preferencia `sitio_predeterminado` o el primero.
  let sitios = $state<Sitio[] | null>(null);
  let errorSitios = $state<string | null>(null);
  let menuAbierto = $state(false);
  const cargaSitios = ultimaGana();
  async function cargarSitios(): Promise<void> {
    try {
      sitios = await obtener<Sitio[]>('/sitios', cargaSitios.senal());
      errorSitios = null;
    } catch (e) {
      if (esCancelacion(e)) return;
      errorSitios = avisoDeError(e).texto;
    }
  }
  const sitioPredeterminado = $derived.by(() => {
    if (sitios === null || sitios.length === 0) return '';
    const p = sesion?.preferencias?.sitio_predeterminado ?? null;
    return (sitios.find((x) => x.codigo === p || x.id === p) ?? sitios[0]!).codigo;
  });
  // El sitio de la pantalla: el de la URL si es de la persona; si no, el predeterminado (en el inventario, «todos» es válido).
  const sitioDeVista = $derived.by(() => {
    if (vista.pantalla === 'tablero') return sitios?.some((x) => x.codigo === vista.sitio) ? vista.sitio : sitioPredeterminado;
    if (vista.pantalla === 'inventario') return vista.filtros.sitio;
    return null;
  });
  const sitioActual = $derived(sitios?.find((x) => x.codigo === sitioDeVista) ?? null);
  function elegirSitio(codigo: string): void {
    if (vista.pantalla === 'tablero') alCambiarVista(fragmentoTablero(codigo, vista.rango, vista.fija));
    else if (vista.pantalla === 'inventario') alCambiarVista(fragmentoInventario({ ...vista.filtros, sitio: codigo, zona: '', pagina: 1 }));
  }
  // Una ruta nueva cierra el menú plegado (el teléfono vuelve a ver la pantalla, no el menú).
  $effect(() => {
    void ruta;
    menuAbierto = false;
  });

  // Una pantalla cambió su vista: se reemplaza la entrada actual del historial (nunca pushState por cada filtro) y `ruta` se
  // pone al día, para que un `hashchange` posterior hacia la vista anterior se note como cambio.
  function alCambiarVista(fragmento: string): void {
    if (fragmento !== window.location.hash) history.replaceState(history.state, '', fragmento);
    ruta = fragmento;
  }

  function volverARutaGuardada(): void {
    if (rutaGuardada !== null && rutaGuardada !== window.location.hash) alCambiarVista(rutaGuardada);
    rutaGuardada = null;
  }

  async function cargarSesion(): Promise<void> {
    try {
      // central: false → aquí un 401 no es «venció», es «no hay sesión»: se muestra «Entrar» sin aviso.
      const s = await pedir<Sesion>('GET', '/sesion', { central: false });
      sesion = s;
      aplicarTema(leerPreferenciaTema(s.preferencias?.tema)); // «sistema» mientras el backend no traiga la preferencia
      fase = fasePorSesion(s);
      if (fase === 'dentro') {
        volverARutaGuardada();
        void cargarSitios();
      }
      renovador.renovado();
    } catch (e) {
      sesion = null;
      if (e instanceof ErrorApi && e.codigo === 401) fase = 'entrar';
      else {
        avisoCabecera = avisoDeError(e);
        fase = 'sin_servicio';
      }
    }
  }

  // Renovación (docs/20 §3): como mucho un GET /sesion cada 5 min, solo si la persona interactúa. Un 401 lo trata el cliente HTTP.
  const renovador = crearRenovador(() =>
    pedir<Sesion>('GET', '/sesion').then((s) => {
      sesion = s;
      if (fasePorSesion(s) !== 'dentro') fase = fasePorSesion(s);
    }),
  );

  function alEntrar(s: SesionAbierta, temporal: string | null): void {
    mensajeEntrar = null;
    claveRecienUsada = temporal;
    fase = s.usuario.clave_temporal ? 'cambiar' : 'comprobando'; // sin parpadeo de «Entrar» mientras llega GET /sesion
    void cargarSesion();
  }

  function alCambiarClave(): void {
    claveRecienUsada = null;
    cambiandoClave = false;
    avisoCabecera = { tipo: 'exito', texto: 'Clave cambiada. Tus otras sesiones se cerraron.' };
    void cargarSesion();
  }

  // Tras darse de baja (P13; docs/20 §11): el servidor ya revocó las sesiones y borró la cookie; el panel queda como al salir.
  function alDarseDeBaja(): void {
    olvidarMarcados();
    rutaGuardada = null;
    claveRecienUsada = null;
    alCambiarVista('#/');
    sitios = null;
    aplicarTema('sistema');
    sesion = null;
    mensajeEntrar = 'Tu cuenta quedó dada de baja: tus datos personales se borraron. Gracias por usar el sistema.';
    fase = 'entrar';
  }

  async function salir(todas: boolean): Promise<void> {
    if (saliendo) return;
    saliendo = true;
    avisoCabecera = null;
    try {
      await pedir('DELETE', todas ? '/sesion?todas=true' : '/sesion', { central: false });
      mensajeEntrar = todas ? 'Cerraste la sesión en todos tus navegadores y equipos.' : 'Cerraste la sesión.';
    } catch (e) {
      // Ya no había sesión (401): da lo mismo, se sale. Sin red o con el servicio caído, la sesión sigue viva en el servidor: se dice.
      if (!(e instanceof ErrorApi && e.codigo === 401)) {
        avisoCabecera = avisoDeError(e);
        saliendo = false;
        return;
      }
      mensajeEntrar = 'Tu sesión ya estaba cerrada.';
    }
    claveRecienUsada = null;
    rutaGuardada = null;
    olvidarMarcados();
    // Quien sale deja el panel en el tablero (la llegada, A1): la próxima persona que entre en este navegador no hereda la pantalla de la
    // anterior, ni su sitio ni su tema.
    alCambiarVista('#/');
    sitios = null;
    aplicarTema('sistema');
    sesion = null;
    cambiandoClave = false;
    fase = 'entrar';
    saliendo = false;
  }

  onMount(() => {
    // Un enlace viejo `#/?estado=…` lleva al inventario (`#/inventario?…`), sin sumar una entrada al historial.
    const redirigir = (): void => {
      const nueva = redireccionVieja(window.location.hash);
      if (nueva !== null) history.replaceState(history.state, '', nueva);
    };
    redirigir();
    ruta = window.location.hash;
    const alCambiar = (): void => {
      redirigir();
      ruta = window.location.hash;
    };
    window.addEventListener('hashchange', alCambiar);
    void obtener<Salud>('/salud')
      .then((s) => (salud = `${s.estado}, base ${s.base}, ${s.tablas} tablas`))
      .catch(() => (salud = 'sin respuesta'));
    // Lo que vale para toda la aplicación (lib/api.ts): 401 → «Entrar» guardando la ruta y olvidando la temporal recién escrita; 403
    // por clave temporal → cambio obligatorio, solo con sesión (lib/sesion.ts, trasAvisoDeSesion).
    const dejar = alPerderSesion((motivo) => {
      olvidarMarcados(); // las casillas «comparar» no pasan a quien entre después
      const e = trasAvisoDeSesion({ fase, sesion, claveRecienUsada, cambiandoClave, rutaGuardada, mensajeEntrar }, motivo, window.location.hash);
      ({ fase, sesion, claveRecienUsada, cambiandoClave, rutaGuardada, mensajeEntrar } = e);
    });
    void cargarSesion();
    // La persona interactúa: se renueva la sesión como mucho cada 5 min (el renovador lo acota; aquí solo se le avisa).
    const actividad = (): void => {
      if (fase === 'dentro') renovador.actividad();
    };
    const tipos = ['pointerdown', 'keydown', 'mousemove', 'touchstart', 'wheel'] as const;
    for (const t of tipos) window.addEventListener(t, actividad, { passive: true });
    return () => {
      window.removeEventListener('hashchange', alCambiar);
      for (const t of tipos) window.removeEventListener(t, actividad);
      dejar();
      cargaSitios.cancelar();
    };
  });
</script>

<header class="principal">
  <h1>Registro, gestión y monitoreo de dispositivos IoT</h1>
  {#if fase === 'dentro'}
    {#if sitios !== null && sitios.length > 1 && (vista.pantalla === 'tablero' || vista.pantalla === 'inventario')}
      <label class="selector-sitio">Sitio
        <select value={sitioDeVista ?? ''} onchange={(e) => elegirSitio(e.currentTarget.value)} data-selector-sitio>
          {#if vista.pantalla === 'inventario'}<option value="">todos los sitios</option>{/if}
          {#each sitios as x (x.id)}<option value={x.codigo}>{sitios.filter((y) => y.nombre === x.nombre).length > 1 ? `${x.nombre} (${x.codigo})` : x.nombre}</option>{/each}
        </select>
      </label>
    {/if}
    <span class="menu-boton"><Boton etiqueta="Menú" variante="discreto" aria-expanded={menuAbierto} aria-controls="menu-principal"
      onclick={() => (menuAbierto = !menuAbierto)} data-menu /></span>
    <!-- El menú según el rol (A1): las pantallas que aún no existen se nombran sin enlace, para que nadie pulse una página vacía -->
    <nav id="menu-principal" aria-label="Pantallas" class:abierto={menuAbierto} data-menu-principal>
      <a href="#/" aria-current={vista.pantalla === 'tablero' ? 'page' : undefined} data-ir-tablero>Tablero</a>
      <a href="#/inventario" aria-current={vista.pantalla === 'inventario' ? 'page' : undefined} data-ir-inventario>Inventario</a>
      <span class="nav-pendiente" data-nav-pendiente>Condiciones (próximamente)</span>
      <span class="nav-pendiente" data-nav-pendiente>Cuarentena (próximamente)</span>
      {#if veActividad}<a href="#/actividad" aria-current={vista.pantalla === 'actividad' ? 'page' : undefined} data-ir-actividad>Actividad</a>{/if}
      {#if administraUsuarios}<a href="#/usuarios" aria-current={vista.pantalla === 'usuarios' ? 'page' : undefined} data-ir-usuarios>Usuarios</a>{/if}
      {#if daDeAlta}<a href="#/alta" aria-current={vista.pantalla === 'alta' ? 'page' : undefined} data-ir-alta-menu>Dar de alta</a>{/if}
      {#if administraSistema}<span class="nav-pendiente" data-nav-pendiente>Estado del sistema (próximamente)</span>{/if}
    </nav>
  {/if}
  <span class="vivo" data-salud>servicio: {salud}</span>
  {#if fase === 'dentro' && quien !== null}
    <details class="cuenta" data-quien>
      <summary>Cuenta: <strong data-quien-nombre>{quien.nombre}</strong></summary>
      <div class="cuenta-menu">
        <span class="vivo" data-quien-sitios>{quien.sitios}</span>
        <a href="#/preferencias" data-ir-preferencias>Preferencias y mi cuenta</a>
        {#if sesion !== null && !sesion.sistema}
          <Boton etiqueta="Cambiar la clave" variante="discreto" onclick={() => (cambiandoClave = true)} data-cambiar-mi-clave />
          <Boton etiqueta="Salir" etiquetaCargando="Saliendo…" cargando={saliendo} onclick={() => void salir(false)} data-salir />
          <Boton etiqueta="Cerrar en todos lados" variante="discreto" cargando={saliendo}
            ayuda="Cierra también las sesiones abiertas en otros navegadores o equipos" onclick={() => void salir(true)} data-salir-todas />
        {/if}
      </div>
    </details>
  {/if}
</header>
<main>
  {#if avisoCabecera !== null}<Aviso tipo={avisoCabecera.tipo} texto={avisoCabecera.texto} alCerrar={() => (avisoCabecera = null)} />{/if}
  {#if vista.pantalla === 'legal'}
    <!-- P11: también antes de entrar y con los términos pendientes (docs/19 §4, P11; docs/20 §12) -->
    <Legal seccion={vista.seccion} conSesion={fase === 'dentro' || fase === 'terminos'} />
  {:else if fase === 'comprobando'}
    <p class="vacio">Comprobando la sesión…</p>
  {:else if fase === 'sin_servicio'}
    <p class="vacio">No se pudo comprobar la sesión. <Boton etiqueta="Reintentar" onclick={() => { avisoCabecera = null; fase = 'comprobando'; void cargarSesion(); }} data-reintentar-sesion /></p>
  {:else if fase === 'entrar'}
    <Entrar {alEntrar} mensaje={mensajeEntrar} />
  {:else if fase === 'terminos'}
    <Terminos alAceptar={() => { fase = 'comprobando'; void cargarSesion(); }} alSalir={() => void salir(false)} />
  {:else if fase === 'cambiar' || cambiandoClave}
    <CambiarClave {email} claveActual={claveRecienUsada} obligatorio={fase === 'cambiar'} alListo={alCambiarClave}
      alSalir={() => (fase === 'cambiar' ? void salir(false) : (cambiandoClave = false))} />
  {:else if sesion !== null}
    {#if vista.pantalla === 'ficha'}
      <!-- {#key}: otro dispositivo es otra ficha (otro canal en vivo, otro histórico), no la misma con otro id -->
      {#key vista.id}
        <Ficha id={vista.id} canal={vista.canal} rango={vista.rango} res={vista.res} fija={vista.fija} {sesion} {unidades} {alCambiarVista} />
      {/key}
    {:else if vista.pantalla === 'comparar'}
      <!-- otro conjunto de dispositivos es otra comparación (otras fichas, otras series) -->
      {#key vista.dispositivos.join(',')}
        <Comparar dispositivos={vista.dispositivos} magnitud={vista.magnitud} rango={vista.rango} res={vista.res} {alCambiarVista} />
      {/key}
    {:else if vista.pantalla === 'configurar'}
      {#key vista.id}<Configurar id={vista.id} {sesion} {sitios} />{/key}
    {:else if vista.pantalla === 'alta'}
      <Alta modo={vista.modo} idFisico={vista.idFisico} sitio={vista.sitio} {sesion} {sitios} />
    {:else if vista.pantalla === 'preferencias'}
      <Preferencias {sesion} {sitios} {ultimaVista} {alCambiarPreferencias} {alDarseDeBaja} />
    {:else if vista.pantalla === 'actividad'}
      <Actividad filtros={vista.filtros} {sesion} {sitios} {alCambiarVista} />
    {:else if vista.pantalla === 'usuarios'}
      {#if administraUsuarios && !sesion.sistema}
        <Usuarios {sesion} />
      {:else}
        <p class="vacio" data-sin-usuarios>Tu rol no administra personas en ningún sitio: pídeselo a quien administra el tuyo. <a href="#/">Volver al tablero</a></p>
      {/if}
    {:else if vista.pantalla === 'inventario'}
      <Inventario filtros={vista.filtros} {sitios} {alCambiarVista} />
    {:else if errorSitios !== null}
      <p class="error" role="alert" data-error-sitios>No se pudieron leer tus sitios: {errorSitios} <Boton etiqueta="Reintentar" onclick={() => void cargarSitios()} /></p>
    {:else if sitios === null}
      <p class="vacio">Cargando tus sitios…</p>
    {:else if sitioActual === null}
      <p class="vacio" data-sin-sitios>No tienes sitios asignados: pídele a quien administra el tuyo que te dé acceso. <a href="#/inventario">Ir al inventario</a></p>
    {:else}
      <!-- {#key}: otro sitio es otro tablero (otro resumen, otras gráficas) -->
      {#key sitioActual.id}
        <Tablero sitio={sitioActual} rango={vista.pantalla === 'tablero' ? vista.rango : null} fija={vista.pantalla === 'tablero' ? vista.fija : null} {unidades} {alCambiarVista} />
      {/key}
    {/if}
  {/if}
</main>
{#if fase === 'dentro' && sesion !== null}
  <!-- Avisos de condiciones nuevas en cualquier pantalla (E); se desmontan al salir, con su canal -->
  <Notificaciones notificar={sesion.preferencias?.notificar ?? []} />
{/if}
<footer class="pie">
  <a href="#/legal" data-ir-legal>Legal y acerca de</a>
</footer>
