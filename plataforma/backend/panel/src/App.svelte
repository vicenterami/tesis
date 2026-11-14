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
  //
  // Armazón del tablero v3 (docs/19 §4, bloque L, punto 1): barra lateral con icono y texto por entrada, que se contrae a iconos con «Menú»
  // (expandida desde 1 280 px, contraída entre 1 000 y 1 279 px; el estado vale mientras la página sigue abierta, en memoria); bajo
  // 1 000 px, el mismo menú es un cajón (Escape, tocar fuera o elegir un destino lo cierran; el foco queda dentro y vuelve a «Menú»). La
  // barra superior lleva «Menú», el sitio, el tema y la cuenta. Primero recibe el foco «Saltar al contenido» (2.4.1); el orden es barra
  // superior, menú y contenido (2.4.3). La línea «servicio: …» vive en «Legal y acerca de»; aquí solo se dice si el servicio falla.
  // Carga a pedido (P4 del bloque L): el tablero y «Entrar» van en el paquete inicial; las demás pantallas, con `import()` al abrirlas.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import Entrar from './Entrar.svelte';
  import Icono, { type NombreIcono } from './Icono.svelte';
  import Notificaciones from './Notificaciones.svelte';
  import Tablero from './Tablero.svelte';
  import Tooltip from './Tooltip.svelte';
  import { ErrorApi, alPerderSesion, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { olvidarMarcados } from './lib/comparar';
  import { fijarPreferencias, guardarPreferencias, olvidarPreferencias, suscribirPreferencias } from './lib/escritor-preferencias';
  import { seguirArmazon, type AnchoArmazon } from './lib/medios';
  import type { Preferencias as DatosPreferencias, Salud, Sitio } from './lib/modelo';
  import { crearRenovador, puedeEnAlguno, quienSoy, trasAvisoDeSesion, type Fase, type Sesion, type SesionAbierta } from './lib/sesion';
  import { aplicarTema, leerPreferenciaTema, temaVivo } from './lib/tema';
  import { preferenciaUnidades } from './lib/unidades';
  import { fragmentoInventario, fragmentoTablero, leerVista, redireccionVieja } from './lib/vista';

  let fase = $state<Fase>('comprobando');
  let sesion = $state<Sesion | null>(null);
  let mensajeEntrar = $state<string | null>(null);
  let avisoCabecera = $state<DatosAviso | null>(null);
  let avisoServicio = $state<string | null>(null);
  let cambiandoClave = $state(false); // cambio voluntario desde la cabecera (el obligatorio es la fase «cambiar»)
  let saliendo = $state(false);
  // La temporal que la persona acaba de escribir al entrar: solo en memoria, para no pedirla dos veces; se borra al cambiarla.
  let claveRecienUsada = $state<string | null>(null);
  // La ruta donde estaba cuando la sesión venció: tras entrar, se vuelve a ella.
  let rutaGuardada: string | null = null;

  let ruta = $state(window.location.hash);
  const vista = $derived(leerVista(ruta));
  const quien = $derived(sesion === null ? null : quienSoy(sesion));
  const dentro = $derived(fase === 'dentro' && sesion !== null);
  // El usuario del sistema (clave por cabecera) no tiene personas a su cargo: la pantalla de usuarios es solo para personas con sesión.
  const administraUsuarios = $derived(sesion !== null && !sesion.sistema && puedeEnAlguno(sesion, 'usuarios'));
  const email = $derived(sesion !== null && !sesion.sistema ? sesion.usuario.email : null);
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

  // Los sitios de la persona (`GET /sitios`) para el selector de la barra superior, que aparece solo con más de uno; el sitio vive en la
  // URL (`?sitio=<código>`) y, si no viene, rige la preferencia `sitio_predeterminado` o el primero.
  let sitios = $state<Sitio[] | null>(null);
  let errorSitios = $state<string | null>(null);
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
  // El sitio que nombra la barra superior: el de la pantalla o, fuera del tablero y del inventario, el predeterminado.
  const sitioNombrado = $derived(sitioActual ?? sitios?.find((x) => x.codigo === sitioPredeterminado) ?? null);
  function elegirSitio(codigo: string): void {
    if (vista.pantalla === 'tablero') alCambiarVista(fragmentoTablero(codigo, vista.ver, vista.rango, vista.fija));
    else if (vista.pantalla === 'inventario') alCambiarVista(fragmentoInventario({ ...vista.filtros, sitio: codigo, zona: '', pagina: 1 }));
  }

  // ── Menú lateral y cajón (L1) ───────────────────────────────────────────────────────────────────────────────────────────────────
  let ancho = $state<AnchoArmazon>('expandido');
  let contraidoElegido = $state<boolean | null>(null); // null: lo que toca por el ancho; en memoria, nunca en la cuenta ni el navegador
  let cajonAbierto = $state(false);
  let navegacion = $state<HTMLElement | null>(null);
  const contraido = $derived(ancho !== 'cajon' && (contraidoElegido ?? ancho === 'contraido'));
  const botonMenu = (): HTMLElement | null => document.querySelector<HTMLElement>('[data-menu]');
  function alternarMenu(): void {
    if (ancho === 'cajon') {
      if (cajonAbierto) cerrarCajon();
      else cajonAbierto = true;
    } else contraidoElegido = !contraido;
  }
  function cerrarCajon(): void {
    if (!cajonAbierto) return;
    cajonAbierto = false;
    queueMicrotask(() => botonMenu()?.focus());
  }
  // Al abrir el cajón, el foco entra en él (al primer destino); mientras está abierto no sale (Tab da la vuelta dentro) y lo demás queda
  // inerte (ni el puntero ni el teclado llegan a lo que está detrás).
  $effect(() => {
    if (!cajonAbierto || navegacion === null) return;
    const nav = navegacion;
    queueMicrotask(() => nav.querySelector<HTMLElement>('a, button')?.focus());
  });
  function teclaEnCajon(e: KeyboardEvent): void {
    if (!cajonAbierto) return;
    if (e.key === 'Escape') {
      e.preventDefault();
      cerrarCajon();
      return;
    }
    if (e.key !== 'Tab' || navegacion === null) return;
    const enfocables = [...navegacion.querySelectorAll<HTMLElement>('a[href], button:not([disabled])')];
    if (enfocables.length === 0) return;
    const primero = enfocables[0]!;
    const ultimo = enfocables.at(-1)!;
    const foco = document.activeElement;
    if (foco === null || !navegacion.contains(foco)) {
      // El foco quedó fuera (un clic en el fondo lo dejó en el cuerpo de la página): Tab lo devuelve al cajón, nunca a lo de detrás.
      e.preventDefault();
      (e.shiftKey ? ultimo : primero).focus();
    } else if (e.shiftKey && foco === primero) {
      e.preventDefault();
      ultimo.focus();
    } else if (!e.shiftKey && foco === ultimo) {
      e.preventDefault();
      primero.focus();
    }
  }
  // Se escucha en el documento mientras el cajón está abierto: Escape y Tab valen esté donde esté el foco.
  $effect(() => {
    if (!cajonAbierto) return;
    document.addEventListener('keydown', teclaEnCajon);
    return () => document.removeEventListener('keydown', teclaEnCajon);
  });
  // Elegir un destino cierra el cajón (la ruta cambia o, si es la misma, el clic igual lo cierra).
  function alElegirDestino(): void {
    if (cajonAbierto) cerrarCajon();
  }
  $effect(() => {
    void ruta;
    untrack(() => {
      if (cajonAbierto) cerrarCajon();
    });
  });
  $effect(() => {
    if (ancho !== 'cajon') cajonAbierto = false;
  });
  // «Saltar al contenido»: un enlace a #contenido cambiaría la ruta del panel (el fragmento es la ruta); se lleva el foco a mano.
  function saltar(e: MouseEvent): void {
    e.preventDefault();
    document.getElementById('contenido')?.focus();
  }
  interface Destino { ruta: string; texto: string; icono: NombreIcono; activo: boolean; dato: string }
  const destinos = $derived.by((): Destino[] => {
    const lista: Destino[] = [
      { ruta: '#/', texto: 'Tablero', icono: 'tablero', activo: vista.pantalla === 'tablero', dato: 'tablero' },
      { ruta: '#/inventario', texto: 'Inventario', icono: 'inventario', activo: vista.pantalla === 'inventario' || vista.pantalla === 'ficha' || vista.pantalla === 'comparar' || vista.pantalla === 'configurar', dato: 'inventario' },
    ];
    if (veActividad) lista.push({ ruta: '#/actividad', texto: 'Actividad', icono: 'actividad', activo: vista.pantalla === 'actividad', dato: 'actividad' });
    if (administraUsuarios) lista.push({ ruta: '#/usuarios', texto: 'Usuarios', icono: 'usuarios', activo: vista.pantalla === 'usuarios', dato: 'usuarios' });
    if (daDeAlta) lista.push({ ruta: '#/alta', texto: 'Dar de alta', icono: 'alta', activo: vista.pantalla === 'alta', dato: 'alta-menu' });
    return lista;
  });

  const destinoLegal = $derived<Destino>({ ruta: '#/legal', texto: 'Legal y acerca de', icono: 'legal', activo: vista.pantalla === 'legal', dato: 'legal' });

  // ── Tema con un botón (L5) ─────────────────────────────────────────────────────────────────────────────────────────────────────
  // Dice lo que hará («Tema oscuro» o «Tema claro»); se aplica al instante y, con sesión, se guarda por el único escritor de preferencias
  // (la fila de P13); si el servidor lo rechaza, vuelve y lo dice. Sin sesión (o como usuario del sistema), vale para esta visita.
  const temaSiguiente = $derived($temaVivo === 'oscuro' ? 'claro' : 'oscuro');
  async function alternarTema(): Promise<void> {
    const nuevo = temaSiguiente;
    aplicarTema(nuevo);
    if (!dentro || sesion === null || sesion.sistema) return;
    const r = await guardarPreferencias({ tema: nuevo });
    if (!r.ok) avisoCabecera = { tipo: avisoDeError(r.error).tipo, texto: `No se guardó el tema; volvió al anterior. ${avisoDeError(r.error).texto}` };
  }
  // Toda preferencia guardada (aquí o en P13) llega a la sesión y su tema se aplica: un rechazo deja el tema que el servidor tiene.
  onMount(() =>
    suscribirPreferencias((p) => {
      if (sesion !== null && !sesion.sistema) {
        sesion = { ...sesion, preferencias: p };
        aplicarTema(leerPreferenciaTema(p.tema));
      }
    }),
  );

  // Una pantalla cambió su vista: se reemplaza la entrada actual del historial (nunca pushState por cada filtro) y `ruta` se
  // pone al día, para que un `hashchange` posterior hacia la vista anterior se note como cambio.
  // El fragmento del navegador que el panel ya procesó (leído de vuelta: el navegador puede codificarlo distinto de como se escribió).
  let hashProcesado = '';
  function alCambiarVista(fragmento: string): void {
    // Una navegación que el panel aún no procesó (el clic ya cambió la URL; su `hashchange` llega en la tarea siguiente) manda sobre la
    // vista que una carga en vuelo quiere escribir: sin esto, esa carga reemplazaba la URL nueva y la persona se quedaba donde estaba.
    if (window.location.hash !== hashProcesado) return;
    if (fragmento !== window.location.hash) history.replaceState(history.state, '', fragmento);
    hashProcesado = window.location.hash;
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
      fijarPreferencias(s.sistema ? null : s.preferencias);
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

  // Al salir o al darse de baja, la persona siguiente no hereda nada: ni la pantalla, ni el sitio, ni el tema, ni las preferencias.
  function dejarLimpio(): void {
    olvidarMarcados();
    olvidarPreferencias();
    rutaGuardada = null;
    claveRecienUsada = null;
    alCambiarVista('#/');
    sitios = null;
    aplicarTema('sistema');
    sesion = null;
    cambiandoClave = false;
    contraidoElegido = null;
  }

  // Tras darse de baja (P13; docs/20 §11): el servidor ya revocó las sesiones y borró la cookie; el panel queda como al salir.
  function alDarseDeBaja(): void {
    dejarLimpio();
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
    dejarLimpio();
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
    hashProcesado = window.location.hash;
    const alCambiar = (): void => {
      redirigir();
      ruta = window.location.hash;
      hashProcesado = window.location.hash;
    };
    window.addEventListener('hashchange', alCambiar);
    // El estado del servicio se lee en «Legal y acerca de»; aquí solo importa si falla, y se dice con un aviso.
    void obtener<Salud>('/salud')
      .then((s) => (avisoServicio = s.estado === 'ok' ? null : `el servicio responde con estado «${s.estado}» (base ${s.base}).`))
      .catch((e: unknown) => (avisoServicio = `no responde (${avisoDeError(e).texto})`));
    // Lo que vale para toda la aplicación (lib/api.ts): 401 → «Entrar» guardando la ruta y olvidando la temporal recién escrita; 403
    // por clave temporal → cambio obligatorio, solo con sesión (lib/sesion.ts, trasAvisoDeSesion).
    const dejar = alPerderSesion((motivo) => {
      olvidarMarcados(); // las casillas «comparar» no pasan a quien entre después
      if (motivo === 'sin_sesion') olvidarPreferencias(); // tampoco las preferencias ni lo que esperaba en su fila de guardado
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
    const dejarArmazon = seguirArmazon((a) => (ancho = a));
    return () => {
      window.removeEventListener('hashchange', alCambiar);
      for (const t of tipos) window.removeEventListener(t, actividad);
      dejar();
      dejarArmazon();
      cargaSitios.cancelar();
    };
  });
</script>

<!-- Una pantalla que no se pudo descargar (se cortó la red, o la página quedó de una versión anterior del panel) lo dice, con camino -->
{#snippet sinPantalla()}
  <Aviso tipo="error" texto="No se pudo cargar esta pantalla (¿se cortó la conexión o se actualizó el sistema?): recarga la página." />
{/snippet}

{#snippet botonTema()}
  <Boton etiqueta={temaSiguiente === 'oscuro' ? 'Tema oscuro' : 'Tema claro'} icono={temaSiguiente === 'oscuro' ? 'luna' : 'sol'} variante="barra"
    onclick={() => void alternarTema()} data-tema />
{/snippet}

{#snippet destino(d: Destino)}
  <a href={d.ruta} aria-current={d.activo ? 'page' : undefined} aria-label={contraido ? d.texto : undefined} onclick={alElegirDestino} {...{ [`data-ir-${d.dato}`]: '' }}>
    <Icono nombre={d.icono} tamano={22} /><span class="texto">{d.texto}</span>
  </a>
{/snippet}

<a class="saltar" href="#contenido" onclick={saltar} inert={cajonAbierto || undefined} data-saltar>Saltar al contenido</a>
<div class="armazon" class:con-menu={dentro} class:contraido={dentro && contraido} class:es-cajon={dentro && ancho === 'cajon'} class:cajon-abierto={cajonAbierto}>
  <header class="barra-superior" inert={cajonAbierto || undefined}>
    {#if dentro}
      <Boton etiqueta="Menú" icono="menu" variante="barra" aria-expanded={ancho === 'cajon' ? cajonAbierto : !contraido} aria-controls="menu-principal"
        onclick={alternarMenu} data-menu />
      {#if sitios !== null && sitios.length > 1 && (vista.pantalla === 'tablero' || vista.pantalla === 'inventario')}
        <label class="selector-sitio"><span class="solo-ancho">Sitio</span><span class="solo-lector solo-angosto">Sitio</span>
          <select value={sitioDeVista ?? ''} onchange={(e) => elegirSitio(e.currentTarget.value)} data-selector-sitio>
            {#if vista.pantalla === 'inventario'}<option value="">todos los sitios</option>{/if}
            {#each sitios as x (x.id)}<option value={x.codigo}>{sitios.filter((y) => y.nombre === x.nombre).length > 1 ? `${x.nombre} (${x.codigo})` : x.nombre}</option>{/each}
          </select>
        </label>
      {:else if sitios !== null && sitios.length === 1 && sitioNombrado !== null}
        <span class="sitio-nombre" title={sitioNombrado.nombre} data-sitio-nombre>{sitioNombrado.nombre}</span>
      {/if}
    {:else}
      <h1 class="marca-entrada">Registro, gestión y monitoreo de dispositivos IoT</h1>
    {/if}
    <span class="espacio"></span>
    {#if !dentro || ancho !== 'cajon'}{@render botonTema()}{/if}
    {#if dentro && quien !== null}
      <details class="cuenta" data-quien>
        <summary><Icono nombre="cuenta" /><span class="solo-angosto">Cuenta</span><span class="solo-ancho">Cuenta: <strong data-quien-nombre>{quien.nombre}</strong></span></summary>
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

  {#if dentro}
    <!-- El menú según el rol (L1a): solo pantallas que existen. En el cajón, el tema va dentro (L5). -->
    <nav id="menu-principal" class="lateral" aria-label="Pantallas" bind:this={navegacion} data-menu-principal
      role={ancho === 'cajon' && cajonAbierto ? 'dialog' : undefined} aria-modal={ancho === 'cajon' && cajonAbierto ? 'true' : undefined}>
      <p class="marca" title="Registro, gestión y monitoreo de dispositivos IoT"><span class="marca-sigla" aria-hidden="true">IoT</span><span class="texto">Registro y monitoreo</span></p>
      <ul class="destinos">
        {#each destinos as d (d.ruta)}
          <li>
            {#if contraido}<Tooltip id={`ayuda-menu-${d.dato}`} texto={d.texto} lado="derecha">{@render destino(d)}</Tooltip>{:else}{@render destino(d)}{/if}
          </li>
        {/each}
      </ul>
      <div class="pie-lateral">
        {#if ancho === 'cajon'}{@render botonTema()}{/if}
        {#if contraido}
          <Tooltip id="ayuda-menu-legal" texto="Legal y acerca de" lado="derecha">{@render destino(destinoLegal)}</Tooltip>
        {:else}
          {@render destino(destinoLegal)}
        {/if}
        <!-- El cajón es un diálogo modal: su cierre también es un control con nombre (L1c), el último del cajón -->
        {#if ancho === 'cajon'}<Boton etiqueta="Cerrar menú" icono="cerrar" variante="barra" onclick={cerrarCajon} data-cerrar-menu />{/if}
      </div>
    </nav>
    {#if cajonAbierto}
      <!-- Tocar fuera del cajón lo cierra (L1c); el velo no es un control: Escape y elegir un destino también lo cierran -->
      <!-- svelte-ignore a11y_click_events_have_key_events, a11y_no_static_element_interactions -->
      <div class="velo" onclick={cerrarCajon} data-velo></div>
    {/if}
  {/if}

  <main id="contenido" tabindex="-1" inert={cajonAbierto || undefined}>
    {#if dentro}<h1 class="solo-lector">Registro, gestión y monitoreo de dispositivos IoT</h1>{/if}
    {#if avisoServicio !== null}<div data-aviso-servicio><Aviso tipo="error" texto={`El servicio ${avisoServicio}`} alCerrar={() => (avisoServicio = null)} /></div>{/if}
    {#if avisoCabecera !== null}<Aviso tipo={avisoCabecera.tipo} texto={avisoCabecera.texto} alCerrar={() => (avisoCabecera = null)} />{/if}
    {#if vista.pantalla === 'legal'}
      <!-- P11: también antes de entrar y con los términos pendientes (docs/19 §4, P11; docs/20 §12) -->
      {#await import('./Legal.svelte') then { default: Legal }}<Legal seccion={vista.seccion} conSesion={fase === 'dentro' || fase === 'terminos'} />{:catch}{@render sinPantalla()}{/await}
    {:else if fase === 'comprobando'}
      <p class="vacio">Comprobando la sesión…</p>
    {:else if fase === 'sin_servicio'}
      <p class="vacio">No se pudo comprobar la sesión. <Boton etiqueta="Reintentar" onclick={() => { avisoCabecera = null; fase = 'comprobando'; void cargarSesion(); }} data-reintentar-sesion /></p>
    {:else if fase === 'entrar'}
      <Entrar {alEntrar} mensaje={mensajeEntrar} />
    {:else if fase === 'terminos'}
      {#await import('./Terminos.svelte') then { default: Terminos }}
        <Terminos alAceptar={() => { fase = 'comprobando'; void cargarSesion(); }} alSalir={() => void salir(false)} />
      {:catch}{@render sinPantalla()}{/await}
    {:else if fase === 'cambiar' || cambiandoClave}
      {#await import('./CambiarClave.svelte') then { default: CambiarClave }}
        <CambiarClave {email} claveActual={claveRecienUsada} obligatorio={fase === 'cambiar'} alListo={alCambiarClave}
          alSalir={() => (fase === 'cambiar' ? void salir(false) : (cambiandoClave = false))} />
      {:catch}{@render sinPantalla()}{/await}
    {:else if sesion !== null}
      {#if vista.pantalla === 'ficha'}
        <!-- {#key}: otro dispositivo es otra ficha (otro canal en vivo, otro histórico), no la misma con otro id -->
        {#key vista.id}
          {#await import('./Ficha.svelte') then { default: Ficha }}
            <Ficha id={vista.id} canal={vista.canal} rango={vista.rango} res={vista.res} fija={vista.fija} {sesion} {unidades} {alCambiarVista} />
          {:catch}{@render sinPantalla()}{/await}
        {/key}
      {:else if vista.pantalla === 'comparar'}
        <!-- otro conjunto de dispositivos es otra comparación (otras fichas, otras series) -->
        {#key vista.dispositivos.join(',')}
          {#await import('./Comparar.svelte') then { default: Comparar }}
            <Comparar dispositivos={vista.dispositivos} magnitud={vista.magnitud} rango={vista.rango} res={vista.res} {alCambiarVista} />
          {:catch}{@render sinPantalla()}{/await}
        {/key}
      {:else if vista.pantalla === 'configurar'}
        {#key vista.id}{#await import('./Configurar.svelte') then { default: Configurar }}<Configurar id={vista.id} {sesion} {sitios} />{:catch}{@render sinPantalla()}{/await}{/key}
      {:else if vista.pantalla === 'alta'}
        {#await import('./Alta.svelte') then { default: Alta }}<Alta modo={vista.modo} idFisico={vista.idFisico} sitio={vista.sitio} {sesion} {sitios} />{:catch}{@render sinPantalla()}{/await}
      {:else if vista.pantalla === 'preferencias'}
        {#await import('./Preferencias.svelte') then { default: Preferencias }}<Preferencias {sesion} {sitios} {ultimaVista} {alCambiarPreferencias} {alDarseDeBaja} />{:catch}{@render sinPantalla()}{/await}
      {:else if vista.pantalla === 'actividad'}
        {#await import('./Actividad.svelte') then { default: Actividad }}<Actividad filtros={vista.filtros} {sesion} {sitios} {alCambiarVista} />{:catch}{@render sinPantalla()}{/await}
      {:else if vista.pantalla === 'usuarios'}
        {#if administraUsuarios && !sesion.sistema}
          {#await import('./Usuarios.svelte') then { default: Usuarios }}<Usuarios {sesion} />{:catch}{@render sinPantalla()}{/await}
        {:else}
          <p class="vacio" data-sin-usuarios>Tu rol no administra personas en ningún sitio: pídeselo a quien administra el tuyo. <a href="#/">Volver al tablero</a></p>
        {/if}
      {:else if vista.pantalla === 'inventario'}
        {#await import('./Inventario.svelte') then { default: Inventario }}<Inventario filtros={vista.filtros} {sitios} {alCambiarVista} />{:catch}{@render sinPantalla()}{/await}
      {:else if errorSitios !== null}
        <p class="error" role="alert" data-error-sitios>No se pudieron leer tus sitios: {errorSitios} <Boton etiqueta="Reintentar" onclick={() => void cargarSitios()} /></p>
      {:else if sitios === null}
        <div class="hueco hueco-indicadores" aria-busy="true" aria-label="Cargando tus sitios"></div>
      {:else if sitioActual === null}
        <p class="vacio" data-sin-sitios>No tienes sitios asignados: pídele a quien administra el tuyo que te dé acceso. <a href="#/inventario">Ir al inventario</a></p>
      {:else}
        <!-- {#key}: otro sitio es otro tablero (otro resumen, otras gráficas) -->
        {#key sitioActual.id}
          <Tablero sitio={sitioActual} ver={vista.pantalla === 'tablero' ? vista.ver : 'resumen'} rango={vista.pantalla === 'tablero' ? vista.rango : null}
            fija={vista.pantalla === 'tablero' ? vista.fija : null} {unidades} {alCambiarVista} />
        {/key}
      {/if}
    {/if}
  </main>
</div>
{#if dentro && sesion !== null}
  <!-- Avisos de condiciones nuevas en cualquier pantalla (E); se desmontan al salir, con su canal -->
  <Notificaciones notificar={sesion.preferencias?.notificar ?? []} />
{/if}
{#if !dentro}
  <footer class="pie">
    <a href="#/legal" data-ir-legal>Legal y acerca de</a>
  </footer>
{/if}
