<script lang="ts">
  // Ruteo por fragmento (docs/19 §1): `#/` inventario, `#/dispositivos/<id>` ficha, `#/comparar?dispositivos=…` comparación (P3b),
  // `#/usuarios` usuarios (P10). Así ninguna ruta del panel choca con las de la API, que viven en la raíz del mismo origen. La vista
  // (canal, rango, filtros) va tras el `?` del fragmento (docs/19 §4, incremento 1, punto 1): se lee al cargar y en cada `hashchange`
  // (atrás, un enlace); cada pantalla la escribe con `replaceState`, que no ensucia el historial ni dispara `hashchange`.
  //
  // Sesión (P10; docs/20 §3): al cargar, `GET /sesion` dice si hay una. Sin ella, la pantalla «Entrar»; con clave temporal, el cambio
  // obligatorio; con sesión, las pantallas. Las pantallas (y sus canales en vivo) existen solo «dentro»: al salir o al vencer la sesión se
  // desmontan, y con ellas se cierran sus `EventSource` y se cancelan sus peticiones; al volver a entrar se montan y reabren. Un 401 en
  // cualquier petición (lib/api.ts, manejo central) guarda la ruta, muestra «Entrar» y, tras entrar, vuelve a esa misma ruta.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import CambiarClave from './CambiarClave.svelte';
  import Comparar from './Comparar.svelte';
  import Entrar from './Entrar.svelte';
  import Ficha from './Ficha.svelte';
  import Inventario from './Inventario.svelte';
  import Usuarios from './Usuarios.svelte';
  import { ErrorApi, alPerderSesion, obtener, pedir } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import type { Salud } from './lib/modelo';
  import { crearRenovador, puedeEnAlguno, quienSoy, trasAvisoDeSesion, type Fase, type Sesion, type SesionAbierta } from './lib/sesion';
  import { leerVista } from './lib/vista';

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
      fase = !s.sistema && s.clave_temporal ? 'cambiar' : 'dentro';
      if (fase === 'dentro') volverARutaGuardada();
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
      if (!s.sistema && s.clave_temporal) fase = 'cambiar';
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
    // Quien sale deja el panel en el inventario: la próxima persona que entre en este navegador no hereda la pantalla de la anterior.
    alCambiarVista('#/');
    sesion = null;
    cambiandoClave = false;
    fase = 'entrar';
    saliendo = false;
  }

  onMount(() => {
    const alCambiar = (): void => {
      ruta = window.location.hash;
    };
    window.addEventListener('hashchange', alCambiar);
    void obtener<Salud>('/salud')
      .then((s) => (salud = `${s.estado}, base ${s.base}, ${s.tablas} tablas`))
      .catch(() => (salud = 'sin respuesta'));
    // Lo que vale para toda la aplicación (lib/api.ts): 401 → «Entrar» guardando la ruta y olvidando la temporal recién escrita; 403
    // por clave temporal → cambio obligatorio, solo con sesión (lib/sesion.ts, trasAvisoDeSesion).
    const dejar = alPerderSesion((motivo) => {
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
    };
  });
</script>

<header class="principal">
  <h1>Registro, gestión y monitoreo de dispositivos IoT</h1>
  {#if fase === 'dentro'}
    <nav aria-label="Pantallas">
      <a href="#/" aria-current={vista.pantalla === 'inventario' ? 'page' : undefined}>Inventario</a>
      {#if administraUsuarios}<a href="#/usuarios" aria-current={vista.pantalla === 'usuarios' ? 'page' : undefined} data-ir-usuarios>Usuarios</a>{/if}
    </nav>
  {/if}
  <span class="vivo" data-salud>servicio: {salud}</span>
  {#if fase === 'dentro' && quien !== null}
    <div class="quien" data-quien>
      <span><strong data-quien-nombre>{quien.nombre}</strong> · <span data-quien-sitios>{quien.sitios}</span></span>
      {#if sesion !== null && !sesion.sistema}
        <Boton etiqueta="Cambiar la clave" variante="discreto" onclick={() => (cambiandoClave = true)} data-cambiar-mi-clave />
        <Boton etiqueta="Salir" etiquetaCargando="Saliendo…" cargando={saliendo} onclick={() => void salir(false)} data-salir />
        <Boton etiqueta="Cerrar en todos lados" variante="discreto" cargando={saliendo}
          ayuda="Cierra también las sesiones abiertas en otros navegadores o equipos" onclick={() => void salir(true)} data-salir-todas />
      {/if}
    </div>
  {/if}
</header>
<main>
  {#if avisoCabecera !== null}<Aviso tipo={avisoCabecera.tipo} texto={avisoCabecera.texto} alCerrar={() => (avisoCabecera = null)} />{/if}
  {#if fase === 'comprobando'}
    <p class="vacio">Comprobando la sesión…</p>
  {:else if fase === 'sin_servicio'}
    <p class="vacio">No se pudo comprobar la sesión. <Boton etiqueta="Reintentar" onclick={() => { avisoCabecera = null; fase = 'comprobando'; void cargarSesion(); }} data-reintentar-sesion /></p>
  {:else if fase === 'entrar'}
    <Entrar {alEntrar} mensaje={mensajeEntrar} />
  {:else if fase === 'cambiar' || cambiandoClave}
    <CambiarClave {email} claveActual={claveRecienUsada} obligatorio={fase === 'cambiar'} alListo={alCambiarClave}
      alSalir={() => (fase === 'cambiar' ? void salir(false) : (cambiandoClave = false))} />
  {:else if sesion !== null}
    {#if vista.pantalla === 'ficha'}
      <!-- {#key}: otro dispositivo es otra ficha (otro canal en vivo, otro histórico), no la misma con otro id -->
      {#key vista.id}
        <Ficha id={vista.id} canal={vista.canal} rango={vista.rango} res={vista.res} {sesion} {alCambiarVista} />
      {/key}
    {:else if vista.pantalla === 'comparar'}
      <!-- otro conjunto de dispositivos es otra comparación (otras fichas, otras series) -->
      {#key vista.dispositivos.join(',')}
        <Comparar dispositivos={vista.dispositivos} magnitud={vista.magnitud} rango={vista.rango} res={vista.res} {alCambiarVista} />
      {/key}
    {:else if vista.pantalla === 'usuarios'}
      {#if administraUsuarios && !sesion.sistema}
        <Usuarios {sesion} />
      {:else}
        <p class="vacio" data-sin-usuarios>Tu rol no administra personas en ningún sitio: pídeselo a quien administra el tuyo. <a href="#/">Volver al inventario</a></p>
      {/if}
    {:else}
      <Inventario filtros={vista.filtros} {alCambiarVista} />
    {/if}
  {/if}
</main>
