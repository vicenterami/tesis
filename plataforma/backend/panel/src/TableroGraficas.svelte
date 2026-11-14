<script lang="ts">
  // Pestañas Tendencias y Red del tablero (docs/19 §4, bloque L, puntos 2 y 4). Tendencias: una gráfica por magnitud que el sitio mide
  // (hasta seis; las demás, en una línea; las que no tienen datos en el rango, nombradas en una línea y sin lienzo, L4f). Red: las tramas
  // por cubo (barras apiladas, eje de enteros) y la entrega por dispositivo. Las dos llevan la fila del rango (B1) y se piden al abrir la
  // pestaña, no al entrar al tablero; las magnitudes, de la más extendida (más dispositivos) a la menos (decidido al implementar). Vivas
  // donde sirve (L4a): con «última hora» o «24 horas», se repiden solas mientras llegan avisos de
  // dispositivos del sitio, como mucho una vez cada sexta parte del cubo (entre 5 y 60 s), sin dos pedidos en vuelo, solo con la pestaña
  // del navegador visible y con la ventana alineada al cubo; se lee «actualizado hace N s». Con 7 o 30 días, «Actualizar»; con un rango
  // fijo, es historia. «Pausar» (en la fila del tablero) detiene el refresco; «Reanudar» pide una vez.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import BarrasOrdenadas from './BarrasOrdenadas.svelte';
  import Boton from './Boton.svelte';
  import Grafico from './Grafico.svelte';
  import GraficoSitio from './GraficoSitio.svelte';
  import SelectorRango from './SelectorRango.svelte';
  import ZonaSitio from './ZonaSitio.svelte';
  import { esDelSitio } from './lib/ahora';
  import { esCancelacion, obtener } from './lib/api';
  import { avisoDeError } from './lib/avisos';
  import { RANGO_POR_DEFECTO, intervaloParaVentana, resumenRango, rotuloIntervalo, type ClaveRango } from './lib/grafico';
  import type { EventoVivo, HistoricoSitio, ResumenSitio, Sitio } from './lib/modelo';
  import { esRangoVivo, limitador, periodoRefrescoMs, ventanaAlineada } from './lib/refresco';
  import { coloresSeries, temaVivo } from './lib/tema';
  import { instanteDesdeLocal, localDesdeInstante } from './lib/tiempo';
  import type { PreferenciaUnidades } from './lib/unidades';
  import { MAX_COMPARAR, MAX_VENTANA_MS, SIN_FILTROS, fragmentoComparar, fragmentoInventario, fragmentoTablero, type VentanaFija } from './lib/vista';
  import { RECONECTADO, abrirCanalCompartido } from './lib/vivo';

  let {
    sitio,
    ver,
    rango = null,
    fija = null,
    unidades,
    pausado = false,
    alCambiarVista = () => {},
  }: { sitio: Sitio; ver: 'tendencias' | 'red'; rango?: ClaveRango | null; fija?: VentanaFija | null; unidades: PreferenciaUnidades; pausado?: boolean; alCambiarVista?: (f: string) => void } = $props();

  const MAX_GRAFICAS = 6;
  // Lo pedido (los botones lo marcan) y lo mostrado (de la última respuesta buena): cambiar de rango no deja la pantalla en blanco.
  let rangoElegido = $state<ClaveRango | null>(untrack(() => (fija === null ? (rango ?? RANGO_POR_DEFECTO) : null)));
  let fijaElegida = $state<VentanaFija | null>(untrack(() => fija));
  let resumen = $state<ResumenSitio | null>(null);
  let historicos = $state<HistoricoSitio[]>([]);
  let mostrada = $state<{ desde: Date; hasta: Date; intervalo: string; cargadaEn: number } | null>(null);
  let cargando = $state(false);
  let error = $state<string | null>(null);
  let errorAMedida = $state<string | null>(null);
  let aMedidaAbierto = $state(untrack(() => fija !== null));
  let desdeLocal = $state('');
  let hastaLocal = $state('');
  let ahora = $state(Date.now());

  const zona = $derived(sitio.zona_horaria);
  const id = $derived(encodeURIComponent(sitio.id));
  const vivo = $derived(fijaElegida === null && esRangoVivo(rangoElegido));
  const ventanaGrafico = $derived(mostrada === null ? null : { desde: mostrada.desde.getTime() / 1000, hasta: mostrada.hasta.getTime() / 1000 });
  const sincronizar = $derived(`tablero-${sitio.id}`);
  const colores = $derived(coloresSeries($temaVivo));
  // Tramas por cubo como barras apiladas (B4a): [tiempos, recibidas + rechazadas (dibujada primero), recibidas (encima)]. La etiqueta de
  // cada una dice su propio número, no la suma.
  const tramas = $derived.by(() => {
    const cubos = resumen?.tramas.cubos ?? [];
    return {
      series: [cubos.map((c) => c.tiempo), cubos.map((c) => c.recibidas + c.rechazadas), cubos.map((c) => c.recibidas)],
      recibidas: cubos.map((c) => c.recibidas),
      rechazadas: cubos.map((c) => c.rechazadas),
    };
  });
  // Las magnitudes dibujadas (hasta seis, las que tienen datos en el rango), las que quedan en la lista y las que no tienen datos.
  // Las que más dispositivos miden, primero (con más de seis, las seis más extendidas se dibujan; las demás van a la lista).
  const magnitudes = $derived([...(resumen?.magnitudes ?? [])].sort((a, b) => b.canales - a.canales || a.nombre.localeCompare(b.nombre, 'es')));
  const conDatos = $derived(historicos.filter((h) => resumenRango(h.valores) !== null));
  const sinDatos = $derived(historicos.filter((h) => resumenRango(h.valores) === null).map((h) => magnitudes.find((m) => m.codigo === h.magnitud)?.nombre ?? h.magnitud));
  const enLista = $derived(magnitudes.slice(MAX_GRAFICAS).map((m) => m.nombre));
  // P3b con esa magnitud y hasta seis dispositivos del sitio (B4b): los de peor entrega primero, que son los que más conviene mirar.
  const paraComparar = $derived((resumen?.entrega ?? []).map((e) => e.id).slice(0, MAX_COMPARAR));
  const entregas = $derived((resumen?.entrega ?? []).filter((x) => x.porcentaje !== null));

  function ventanaPedida(): { desde: Date; hasta: Date; intervalo: string } {
    if (fijaElegida !== null) return { ...fijaElegida, intervalo: intervaloParaVentana(fijaElegida.hasta.getTime() - fijaElegida.desde.getTime()) };
    return ventanaAlineada(rangoElegido ?? RANGO_POR_DEFECTO, new Date());
  }
  const q = (v: { desde: Date; hasta: Date }, extra: Record<string, string> = {}): string =>
    new URLSearchParams({ ...extra, desde: v.desde.toISOString(), hasta: v.hasta.toISOString() }).toString();

  // Gana la última (§6): un cambio de rango cancela lo que estaba en vuelo, también un refresco; una cancelación nunca se muestra como
  // error. `automatico`: el refresco en vivo (no marca «cargando…» ni cambia la URL).
  let control: AbortController | null = null;
  async function cargar(automatico = false): Promise<void> {
    // Un refresco automático nunca pisa una carga que la persona pidió y sigue en vuelo (un cambio de rango): esa ya trae lo último.
    if (automatico && cargando) return;
    control?.abort();
    const ctl = new AbortController();
    control = ctl;
    const v = ventanaPedida();
    const pedido = { rango: rangoElegido, fija: fijaElegida };
    if (!automatico) cargando = true;
    if (!automatico) refresco.marcar();
    try {
      const r = await obtener<ResumenSitio>(`/sitios/${id}/resumen?${q(v, { intervalo: v.intervalo })}`, ctl.signal);
      const hs = ver === 'tendencias'
        ? await Promise.all([...r.magnitudes].sort((a, b) => b.canales - a.canales || a.nombre.localeCompare(b.nombre, 'es')).slice(0, MAX_GRAFICAS).map((m) => obtener<HistoricoSitio>(`/sitios/${id}/historico?${q(v, { magnitud: m.codigo, intervalo: v.intervalo })}`, ctl.signal)))
        : [];
      if (ctl.signal.aborted) return;
      if (automatico && pausado) return; // se pausó con el refresco en vuelo: no llega a dibujarse (L4a)
      resumen = r;
      historicos = hs;
      mostrada = { ...v, cargadaEn: Date.now() };
      error = null;
      if (!automatico) untrack(() => alCambiarVista(fragmentoTablero(sitio.codigo, ver, pedido.rango, pedido.fija)));
    } catch (e) {
      if (esCancelacion(e) || ctl.signal.aborted) return;
      error = avisoDeError(e).texto; // lo anterior se queda a la vista; el error se dice
    } finally {
      if (control === ctl) cargando = false;
    }
  }
  // El refresco solo corre en un rango vivo y sin pausa: lo programado antes de cambiar de rango o de pausar no pide nada.
  const refresco = limitador(() => (vivo && !pausado ? cargar(true) : Promise.resolve()), () => periodoRefrescoMs(ventanaPedida().intervalo));

  function elegirRango(r: ClaveRango): void {
    rangoElegido = r;
    fijaElegida = null;
    aMedidaAbierto = false;
    errorAMedida = null;
    void cargar();
  }
  function abrirAMedida(): void {
    const v = mostrada ?? ventanaPedida();
    desdeLocal = localDesdeInstante(v.desde, zona);
    hastaLocal = localDesdeInstante(v.hasta, zona);
    aMedidaAbierto = true;
  }
  // El rango a medida (HU-07): las horas se escriben en la zona del sitio; se valida antes de pedir y el error va junto a los campos.
  function aplicarAMedida(e: SubmitEvent): void {
    e.preventDefault();
    const d = instanteDesdeLocal(desdeLocal, zona);
    const h = instanteDesdeLocal(hastaLocal, zona);
    if (d === null || h === null) errorAMedida = 'Escribe la fecha y la hora de inicio y de fin.';
    else if (h.getTime() <= d.getTime()) errorAMedida = 'El fin debe ser posterior al inicio.';
    else if (h.getTime() - d.getTime() > MAX_VENTANA_MS) errorAMedida = 'Como mucho 366 días.';
    else {
      errorAMedida = null;
      fijaElegida = { desde: d, hasta: h };
      rangoElegido = null;
      void cargar();
    }
  }

  // La URL cambió desde fuera (atrás, un enlace compartido): se reaplica si difiere de lo pedido.
  $effect(() => {
    const r = rango;
    const f = fija;
    untrack(() => {
      if (mostrada === null) return;
      const mismaFija = (f === null && fijaElegida === null) || (f !== null && fijaElegida !== null && f.desde.getTime() === fijaElegida.desde.getTime() && f.hasta.getTime() === fijaElegida.hasta.getTime());
      const mismoRango = f !== null || (r ?? RANGO_POR_DEFECTO) === rangoElegido;
      if (mismaFija && mismoRango) return;
      fijaElegida = f;
      rangoElegido = f === null ? (r ?? RANGO_POR_DEFECTO) : null;
      void cargar();
    });
  });

  // Pausar: lo que ya estaba programado se olvida. Reanudar: una vez lo que se muestra (como al reconectar).
  let pausaAnterior = untrack(() => pausado);
  $effect(() => {
    const p = pausado;
    untrack(() => {
      if (!pausaAnterior && p) refresco.soltar();
      if (pausaAnterior && !p && mostrada !== null) void cargar(true);
      pausaAnterior = p;
    });
  });

  // Los avisos de dispositivos del sitio piden un refresco (el limitador decide cuándo); con `sitio_id` nulo, los de la entrega y la
  // atención (todo dispositivo activo del sitio está en la entrega, hasta 50).
  const visibles = $derived(new Set([...(resumen?.entrega ?? []).map((x) => x.id), ...(resumen?.atencion ?? []).map((x) => x.id)]));
  function alEvento(e: EventoVivo): void {
    if (pausado || !vivo || e.tipo === 'latido' || !esDelSitio(e, sitio.id, visibles)) return;
    refresco.aviso();
  }

  onMount(() => {
    void cargar();
    const reloj = setInterval(() => (ahora = Date.now()), 1000);
    const c = abrirCanalCompartido('/eventos', alEvento, (estado, motivo) => {
      if (estado === 'en_vivo' && motivo === RECONECTADO && fijaElegida === null && !pausado) void cargar(true); // el canal no guarda cola (F4)
    });
    return () => {
      clearInterval(reloj);
      control?.abort();
      refresco.cancelar();
      c.cerrar();
    };
  });
  const haceSegundosCarga = $derived(mostrada === null ? 0 : Math.max(0, Math.round((ahora - mostrada.cargadaEn) / 1000)));
</script>

<div class="filtros" role="group" aria-label="Rango de las gráficas" aria-busy={cargando} data-cargando={cargando}>
  <SelectorRango rango={rangoElegido} conResolucion={false} alElegirRango={elegirRango} />
  <Boton etiqueta="A medida" presionado={fijaElegida !== null} ayuda="Elige la fecha y la hora de inicio y de fin, en la hora del sitio" onclick={abrirAMedida} data-a-medida />
  <span class="vivo estado-refresco" data-refresco>
    {#if cargando || mostrada === null}cargando…
    {:else if fijaElegida !== null}rango fijo: no se actualiza
    {:else if pausado}en pausa
    {:else if vivo}actualizado hace {haceSegundosCarga} s
    {:else}actualizado hace {haceSegundosCarga < 60 ? `${haceSegundosCarga} s` : `${Math.floor(haceSegundosCarga / 60)} min`}{/if}
  </span>
  {#if !vivo && fijaElegida === null}
    <Boton etiqueta="Actualizar" variante="discreto" ayuda="Con 7 o 30 días las gráficas no se actualizan solas: vuelve a pedirlas" onclick={() => void cargar()} data-actualizar />
  {/if}
</div>
{#if aMedidaAbierto}
  <form class="filtros" onsubmit={aplicarAMedida} novalidate data-form-a-medida>
    <label>Desde <input type="datetime-local" bind:value={desdeLocal} aria-describedby="a-medida-ayuda a-medida-error" data-desde /></label>
    <label>Hasta <input type="datetime-local" bind:value={hastaLocal} aria-describedby="a-medida-ayuda a-medida-error" data-hasta /></label>
    <Boton etiqueta="Aplicar" tipo="submit" variante="principal" data-aplicar-a-medida />
    <span class="vivo" id="a-medida-ayuda">En la hora del sitio ({zona}); hasta 366 días.</span>
    {#if errorAMedida !== null}<span class="error" id="a-medida-error" role="alert" data-error-a-medida>{errorAMedida}</span>{/if}
  </form>
{/if}
<ZonaSitio {zona} />

{#if error !== null}
  <Aviso tipo="error" texto={`No se pudieron leer las gráficas: ${error}`} accion={{ etiqueta: 'Reintentar', alHacer: () => void cargar() }} />
{/if}
{#if resumen === null || mostrada === null || ventanaGrafico === null}
  {#if error === null}<div class="hueco hueco-graficas" aria-busy="true" aria-label="Cargando las gráficas" data-cargando-graficas></div>{/if}
{:else if ver === 'tendencias'}
  {#if magnitudes.length === 0}
    <p class="vacio" data-sin-magnitudes>El sitio no mide ninguna magnitud todavía: aparecerán aquí al llegar la primera medición.</p>
  {:else if conDatos.length === 0}
    <p class="vacio" data-sin-datos-rango>Sin mediciones en este rango. <Boton etiqueta="Ver los últimos 30 días" onclick={() => elegirRango('30d')} data-ultimos-30 /></p>
  {/if}
  <div class="paneles graficas">
    {#each conDatos as h (h.magnitud)}
      {@const m = magnitudes.find((x) => x.codigo === h.magnitud)}
      {#if m !== undefined}
        <section class="panel-seccion" aria-labelledby="titulo-magnitud-{m.codigo}" data-magnitud-seccion={m.codigo}>
          <div class="seccion-cabecera">
            <h3 id="titulo-magnitud-{m.codigo}">{m.nombre}</h3>
            {#if paraComparar.length >= 2}
              <a class="enlace-secundario" href={fragmentoComparar(paraComparar, m.codigo, rangoElegido ?? '30d')} data-comparar-magnitud={m.codigo}>Comparar dispositivos</a>
            {/if}
          </div>
          <GraficoSitio historico={h} nombre={m.nombre} canales={m.canales} {zona} ventana={ventanaGrafico} {sincronizar} {unidades} />
        </section>
      {/if}
    {/each}
  </div>
  {#if sinDatos.length > 0 && conDatos.length > 0}
    <p class="vivo" data-magnitudes-vacias>Sin datos en este rango: {sinDatos.join(', ')}.</p>
  {/if}
  {#if enLista.length > 0}
    <p class="vivo" data-magnitudes-lista>También mide: {enLista.join(', ')} (se ven en la ficha de cada dispositivo).</p>
  {/if}
{:else}
  <section class="panel-seccion" aria-labelledby="titulo-tramas">
    <h3 id="titulo-tramas" data-titulo-tramas>Tramas por cubo de {rotuloIntervalo(resumen.ventana.intervalo)}</h3>
    <p class="vivo">{resumen.tramas.recibidas.toLocaleString('es-CL')} recibidas · {resumen.tramas.rechazadas.toLocaleString('es-CL')} rechazadas en el rango</p>
    {#if resumen.tramas.recibidas + resumen.tramas.rechazadas === 0}
      <p class="vacio" data-sin-tramas>Sin tramas en este rango. <Boton etiqueta="Ver los últimos 30 días" onclick={() => elegirRango('30d')} data-ultimos-30 /></p>
    {:else}
      <Grafico series={tramas.series} unidad="tramas" {zona} titulo="Tramas recibidas y rechazadas" barras enteros {sincronizar} ventana={ventanaGrafico}
        lineas={[
          { label: 'rechazadas', stroke: colores[1]!, width: 1, leyenda: (i) => (tramas.rechazadas[i] ?? 0).toLocaleString('es-CL') },
          { label: 'recibidas', stroke: colores[0]!, width: 1, leyenda: (i) => (tramas.recibidas[i] ?? 0).toLocaleString('es-CL') },
        ]} />
    {/if}
  </section>
  <section class="panel-seccion" aria-labelledby="titulo-entrega">
    <h3 id="titulo-entrega">Entrega por dispositivo</h3>
    <p class="vivo">Tramas recibidas en el rango ÷ esperadas según su intervalo, de peor a mejor.</p>
    {#if entregas.length === 0}
      <p class="vivo" data-entrega-vacia>Ningún dispositivo con intervalo esperado en este rango.</p>
    {:else}
      <BarrasOrdenadas titulo="Entrega por dispositivo" orden="asc" maximo={100}
        barras={entregas.map((x) => ({ id: x.id, etiqueta: x.nombre, valor: Math.min(100, x.porcentaje!), texto: `${Math.round(x.porcentaje!)} % (${x.recibidas.toLocaleString('es-CL')} de ${x.esperadas.toLocaleString('es-CL')})` }))} />
      <p class="ver-todos"><a href={fragmentoInventario({ ...SIN_FILTROS, sitio: sitio.codigo, orden: 'entrega' })} data-entrega-todos>Ver todos por entrega</a></p>
    {/if}
  </section>
{/if}
