<script lang="ts">
  // P9, la pantalla de quien visita sin cuenta (docs/19 §4, O, puntos 5 a 9 y 11). La monta main.ts en lugar de la aplicación cuando el
  // fragmento es `#/v/<token>`: sin armazón, sin pedir la sesión ni la salud, sin leer preferencias y sin «Entrar». El token llega por
  // `token` (leído ANTES de montar) y viaja solo en la cabecera `X-Enlace-Publico` (lib/publico.ts); no se guarda en ningún almacenamiento
  // del navegador. La primera petición lleva `carga=si` (un acceso); los refrescos, cada 60 s, no. «Pausar actualización» (WCAG 2.2.2).
  // 404 → un solo mensaje y nada más; 429 y 503 → se conserva lo último mostrado, se dice y se reintenta en un minuto.
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import VistaPublicaCuerpo from './VistaPublicaCuerpo.svelte';
  import { REFRESCO_MS, TEXTO_NO_DISPONIBLE, TEXTO_PIE, pedirVistaPublica, textoDeResultado, type VentanaPublica, type VistaPublica } from './lib/publico';
  import { aplicarTema, temaVivo } from './lib/tema';

  // `cadaMs`: el período de refresco (60 s); las pruebas lo acortan.
  let { token, cadaMs = REFRESCO_MS }: { token: string | null; cadaMs?: number } = $props();

  let vista = $state<VistaPublica | null>(null);
  let noDisponible = $state(false);
  let problema = $state<string | null>(null); // 429, 503 o sin conexión: lo último mostrado sigue
  let cargando = $state(false);
  let pausado = $state(false);
  let ahora = $state(new Date());
  let ventana: VentanaPublica = '24h';
  let primera = true; // `carga=si` solo en la primera petición que llega al servidor
  let ctl: AbortController | null = null;
  let temporizador: ReturnType<typeof setTimeout> | null = null;

  async function cargar(): Promise<void> {
    if (token === null) {
      noDisponible = true;
      return;
    }
    ctl?.abort();
    const c = new AbortController();
    ctl = c;
    cargando = true;
    try {
      const r = await pedirVistaPublica(token, ventana, primera, c.signal);
      // Un 429 del proxy o la falta de red no llegaron al backend: la carga todavía no se contó.
      if (r.tipo !== 'sin_conexion' && r.tipo !== 'muchas_visitas') primera = false;
      ahora = new Date();
      if (r.tipo === 'ok') {
        vista = r.vista;
        problema = null;
      } else if (r.tipo === 'no_disponible') {
        noDisponible = true;
        vista = null;
      } else problema = textoDeResultado(r);
    } catch {
      return; // cancelada: otra petición la reemplazó
    } finally {
      if (ctl === c) cargando = false;
    }
    programar();
  }
  function programar(): void {
    if (temporizador !== null) clearTimeout(temporizador);
    temporizador = null;
    if (pausado || noDisponible) return;
    temporizador = setTimeout(() => void cargar(), cadaMs);
  }
  function alternarPausa(): void {
    pausado = !pausado;
    if (pausado) {
      if (temporizador !== null) clearTimeout(temporizador);
      temporizador = null;
    } else void cargar();
  }
  function cambiarVentana(v: VentanaPublica): void {
    if (v === ventana) return;
    ventana = v;
    void cargar();
  }
  // El tema: el del sistema operativo, y un botón que vale solo para esta visita (sin cuenta no hay dónde guardarlo, y nada va al navegador).
  const temaSiguiente = $derived($temaVivo === 'oscuro' ? 'claro' : 'oscuro');

  onMount(() => {
    document.title = 'Vista pública · registro y monitoreo de dispositivos IoT';
    void cargar();
    // «Actualizado hace…» avanza aunque esté en pausa (sin pedir nada).
    const reloj = setInterval(() => (ahora = new Date()), 30_000);
    return () => {
      clearInterval(reloj);
      if (temporizador !== null) clearTimeout(temporizador);
      ctl?.abort();
    };
  });
</script>

<div class="pagina-publica">
  <div class="vp-barra">
    {#if vista !== null && !noDisponible}
      <Boton etiqueta={pausado ? 'Reanudar actualización' : 'Pausar actualización'} icono={pausado ? 'reanudar' : 'pausa'} variante="discreto"
        ayuda={pausado ? 'Vuelve a pedir los datos ahora y cada minuto' : 'La página deja de actualizarse sola cada minuto'} onclick={alternarPausa} data-vp-pausa />
    {/if}
    <Boton etiqueta={temaSiguiente === 'oscuro' ? 'Tema oscuro' : 'Tema claro'} icono={temaSiguiente === 'oscuro' ? 'luna' : 'sol'} variante="discreto"
      onclick={() => aplicarTema(temaSiguiente)} data-tema />
  </div>
  <main id="contenido" tabindex="-1">
    {#if noDisponible}
      <h1 class="vp-titulo">Vista pública</h1>
      <p class="vp-no-disponible" role="alert" data-vp-no-disponible>{TEXTO_NO_DISPONIBLE}</p>
      <footer class="vp-pie" data-vp-pie>{TEXTO_PIE}</footer>
    {:else}
      {#if problema !== null}<div data-vp-problema><Aviso tipo="espera" texto={problema} /></div>{/if}
      {#if vista !== null}
        <VistaPublicaCuerpo {vista} {ahora} {cargando} alCambiarVentana={cambiarVentana} />
      {:else if problema === null}
        <p class="vacio" aria-busy="true" data-vp-cargando>Cargando la vista…</p>
      {/if}
    {/if}
  </main>
</div>
