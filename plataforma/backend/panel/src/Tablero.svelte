<script lang="ts">
  // P1 Tablero del sitio (docs/19 §4, tablero v2, B; HU-16, RF-30, HU-15, HU-07). Lo primero que se ve al entrar. De arriba abajo: la
  // fila de filtros (rango con preajustes o a medida, en la zona del sitio; el sitio se elige en la cabecera), los indicadores, «Requiere
  // atención» y las gráficas del sitio. Datos: `GET /sitios/{id}/resumen` (una sola respuesta para todos los indicadores: un valor, un
  // estado, A4) y `GET /sitios/{id}/historico` por magnitud (hasta seis). En vivo: con una ventana que termina en «ahora», cada aviso
  // del canal de un dispositivo del sitio pide el resumen otra vez con antirrebote (como mucho uno cada 2 s, nunca dos en vuelo; §6); con una ventana fija, es
  // historia y no se mueve.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import BarrasOrdenadas from './BarrasOrdenadas.svelte';
  import Boton from './Boton.svelte';
  import Grafico from './Grafico.svelte';
  import GraficoSitio from './GraficoSitio.svelte';
  import Medidor from './Medidor.svelte';
  import SelectorRango from './SelectorRango.svelte';
  import Tarjeta from './Tarjeta.svelte';
  import ZonaSitio from './ZonaSitio.svelte';
  import { antirrebote } from './lib/antirrebote';
  import { esCancelacion, obtener } from './lib/api';
  import { avisoDeError } from './lib/avisos';
  import { ROTULO, rotuloCondicion } from './lib/estado-visual';
  import { RANGO_POR_DEFECTO, intervaloParaVentana, rango as datosRango, rotuloIntervalo, type ClaveRango } from './lib/grafico';
  import type { EventoVivo, HistoricoSitio, ResumenSitio, Sitio } from './lib/modelo';
  import { coloresSeries, temaVivo } from './lib/tema';
  import { haceCuanto, horaLocal, instanteDesdeLocal, localDesdeInstante } from './lib/tiempo';
  import type { PreferenciaUnidades } from './lib/unidades';
  import { MAX_COMPARAR, MAX_VENTANA_MS, fragmentoAlta, fragmentoComparar, fragmentoInventario, fragmentoTablero, SIN_FILTROS, type VentanaFija } from './lib/vista';
  import { abrirCanalCompartido, RECONECTADO, type EstadoCanal } from './lib/vivo';

  let {
    sitio,
    rango = null,
    fija = null,
    unidades,
    alCambiarVista = () => {},
  }: { sitio: Sitio; rango?: ClaveRango | null; fija?: VentanaFija | null; unidades: PreferenciaUnidades; alCambiarVista?: (f: string) => void } = $props();

  const MAX_GRAFICAS = 6;
  // Lo pedido (los botones lo marcan) y lo mostrado (de la última respuesta buena): como en la ficha, cambiar de rango no deja la
  // pantalla en blanco.
  let rangoElegido = $state<ClaveRango | null>(untrack(() => (fija === null ? (rango ?? RANGO_POR_DEFECTO) : null)));
  let fijaElegida = $state<VentanaFija | null>(untrack(() => fija));
  let resumen = $state<ResumenSitio | null>(null);
  let historicos = $state<HistoricoSitio[]>([]);
  let mostrada = $state<{ desde: Date; hasta: Date; intervalo: string } | null>(null);
  let cargando = $state(false);
  let error = $state<string | null>(null);
  let errorAMedida = $state<string | null>(null);
  let canal = $state<EstadoCanal>('conectando');
  let ahora = $state(new Date());
  let aMedidaAbierto = $state(untrack(() => fija !== null));
  let desdeLocal = $state('');
  let hastaLocal = $state('');

  const zona = $derived(sitio.zona_horaria);
  const ventanaGrafico = $derived(mostrada === null ? null : { desde: mostrada.desde.getTime() / 1000, hasta: mostrada.hasta.getTime() / 1000 });
  const sincronizar = $derived(`tablero-${sitio.id}`);
  const enInventario = (estado: 'normal' | 'alerta' | 'sin_senal' | 'inactivo' | null, orden: 'atencion' | 'entrega' = 'atencion'): void => {
    window.location.hash = fragmentoInventario({ ...SIN_FILTROS, sitio: sitio.codigo, estado, orden });
  };
  const sumaEstados = $derived(resumen === null ? 0 : resumen.dispositivos.normal + resumen.dispositivos.alerta + resumen.dispositivos.sin_senal + resumen.dispositivos.inactivo);
  const sinTramas = $derived(resumen !== null && resumen.tramas.recibidas + resumen.tramas.rechazadas === 0);
  // Tramas por cubo como barras apiladas (B4a): [tiempos, recibidas + rechazadas (dibujada primero), recibidas (encima)]. La leyenda de
  // cada una dice su propio número, no la suma.
  const tramas = $derived.by(() => {
    const cubos = resumen?.tramas.cubos ?? [];
    return {
      series: [cubos.map((c) => c.tiempo), cubos.map((c) => c.recibidas + c.rechazadas), cubos.map((c) => c.recibidas)],
      recibidas: cubos.map((c) => c.recibidas),
      rechazadas: cubos.map((c) => c.rechazadas),
    };
  });
  const colores = $derived(coloresSeries($temaVivo));
  const magnitudesDibujadas = $derived((resumen?.magnitudes ?? []).slice(0, MAX_GRAFICAS));
  const magnitudesEnLista = $derived((resumen?.magnitudes ?? []).slice(MAX_GRAFICAS));
  // P3b con esa magnitud y hasta seis dispositivos del sitio (B4b): los de peor entrega primero, que son los que más conviene mirar.
  const paraComparar = $derived((resumen?.entrega ?? []).map((e) => e.id).slice(0, MAX_COMPARAR));

  function ventanaPedida(): { desde: Date; hasta: Date; intervalo: string } {
    if (fijaElegida !== null) return { ...fijaElegida, intervalo: intervaloParaVentana(fijaElegida.hasta.getTime() - fijaElegida.desde.getTime()) };
    const r = datosRango(rangoElegido ?? RANGO_POR_DEFECTO);
    const hasta = new Date();
    return { desde: new Date(hasta.getTime() - r.ms), hasta, intervalo: r.intervalo };
  }
  const q = (v: { desde: Date; hasta: Date }, extra: Record<string, string> = {}): string =>
    new URLSearchParams({ ...extra, desde: v.desde.toISOString(), hasta: v.hasta.toISOString() }).toString();

  // Gana la última (§6): un cambio de rango cancela lo que estaba en vuelo, también el repedido del vivo; una cancelación nunca se
  // muestra como error. `generacion` cuenta las cargas: un resumen del vivo pedido antes de la última carga se descarta al llegar, así
  // los indicadores nunca quedan de un rango y las gráficas de otro (corrección del 11/11/2026).
  let control: AbortController | null = null;
  let controlResumen: AbortController | null = null;
  let generacion = 0;
  async function cargar(): Promise<void> {
    control?.abort();
    controlResumen?.abort();
    generacion++;
    const ctl = new AbortController();
    control = ctl;
    const v = ventanaPedida();
    const pedido = { rango: rangoElegido, fija: fijaElegida };
    cargando = true;
    try {
      const r = await obtener<ResumenSitio>(`/sitios/${encodeURIComponent(sitio.id)}/resumen?${q(v)}&${new URLSearchParams({ intervalo: v.intervalo })}`, ctl.signal);
      const hs = await Promise.all(
        r.magnitudes.slice(0, MAX_GRAFICAS).map((m) =>
          obtener<HistoricoSitio>(`/sitios/${encodeURIComponent(sitio.id)}/historico?${q(v, { magnitud: m.codigo, intervalo: v.intervalo })}`, ctl.signal),
        ),
      );
      if (ctl.signal.aborted) return;
      resumen = r;
      historicos = hs;
      mostrada = v;
      error = null;
      untrack(() => alCambiarVista(fragmentoTablero(sitio.codigo, pedido.rango, pedido.fija)));
    } catch (e) {
      if (esCancelacion(e) || ctl.signal.aborted) return;
      error = avisoDeError(e).texto; // lo anterior se queda a la vista; el error se dice
    } finally {
      if (control === ctl) cargando = false;
    }
  }
  // Solo el resumen (los indicadores), para el vivo: las gráficas son historia y se piden con el rango.
  const repedirResumen = antirrebote(async () => {
    if (fijaElegida !== null || mostrada === null) return;
    const v = ventanaPedida();
    const mia = generacion;
    const ctl = new AbortController();
    controlResumen = ctl;
    try {
      const r = await obtener<ResumenSitio>(`/sitios/${encodeURIComponent(sitio.id)}/resumen?${q(v)}&${new URLSearchParams({ intervalo: v.intervalo })}`, ctl.signal);
      if (ctl.signal.aborted || mia !== generacion || fijaElegida !== null) return; // llegó tarde: ya se pidió otro rango
      resumen = r;
    } catch {
      /* el próximo aviso lo vuelve a intentar; el error de la carga principal sí se muestra */
    } finally {
      if (controlResumen === ctl) controlResumen = null;
    }
  }, 2000);

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

  // Solo los avisos de dispositivos de ESTE sitio (corrección del 11/11/2026): el canal trae los de todos los sitios de la persona. Los
  // del sitio son los de `entrega` (todo dispositivo activo) y `atencion`; uno dado de alta después del último resumen entra en la
  // próxima carga (un cambio de rango, una reconexión o «Reintentar»).
  const delSitio = $derived(new Set([...(resumen?.entrega ?? []).map((x) => x.id), ...(resumen?.atencion ?? []).map((x) => x.id)]));
  function alEvento(e: EventoVivo): void {
    if ((e.tipo === 'condicion' || e.tipo === 'visto') && delSitio.has(e.dispositivo_id)) repedirResumen.pedir();
  }

  onMount(() => {
    void cargar();
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    const c = abrirCanalCompartido('/eventos', alEvento, (estado, motivo) => {
      canal = estado;
      if (estado === 'en_vivo' && motivo === RECONECTADO && fijaElegida === null) void cargar(); // el canal no guarda cola (F4)
    });
    return () => {
      clearInterval(reloj);
      control?.abort();
      controlResumen?.abort();
      repedirResumen.cancelar();
      c.cerrar();
    };
  });
</script>

<h2>Tablero · {sitio.nombre}</h2>
<div class="filtros" role="group" aria-label="Rango del tablero" aria-busy={cargando} data-cargando={cargando}>
  <SelectorRango rango={rangoElegido} conResolucion={false} alElegirRango={elegirRango} />
  <Boton etiqueta="A medida" presionado={fijaElegida !== null} ayuda="Elige la fecha y la hora de inicio y de fin, en la hora del sitio" onclick={abrirAMedida} data-a-medida />
  <span class="vivo {canal}" data-canal={canal}>
    {#if fijaElegida !== null}rango fijo: no se actualiza en vivo{:else}en vivo: {canal === 'en_vivo' ? 'conectado' : canal === 'conectando' ? 'conectando…' : 'reconectando'}{/if}
  </span>
  {#if cargando}<span class="vivo" data-cargando-texto>cargando…</span>{/if}
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
  <Aviso tipo="error" texto={`No se pudo leer el tablero: ${error}`} accion={{ etiqueta: 'Reintentar', alHacer: () => void cargar() }} />
{/if}
{#if resumen === null}
  {#if error === null}<p class="vacio">Cargando el tablero…</p>{/if}
{:else if resumen.dispositivos.total === 0}
  <!-- Vacíos con camino (B5) -->
  <div class="vacio" data-tablero-vacio>
    <p><strong>Este sitio aún no tiene dispositivos.</strong> Da de alta el primero con el asistente (la credencial se muestra una sola vez), o
      varios a la vez desde un archivo CSV.</p>
    <p class="acciones"><a href={fragmentoAlta('uno', '', sitio.codigo)} data-ir-alta>Da de alta el primero</a> <a href={fragmentoAlta('lote')} data-ir-alta-lote>Alta masiva por archivo</a>
      <a href="#/inventario">Ir al inventario</a></p>
  </div>
{:else}
  <ul class="indicadores" aria-label="Indicadores del sitio" data-indicadores>
    <Tarjeta titulo="Dispositivos" valor={resumen.dispositivos.total} detalle={`${sumaEstados === resumen.dispositivos.total ? 'normal, alerta, sin señal e inactivos' : 'el desglose no suma el total: recarga'}`}
      accion={{ etiqueta: 'Ver en el inventario', ayuda: 'Abre el inventario de este sitio', alHacer: () => enInventario(null) }} data-indicador="total" />
    {#each ['normal', 'alerta', 'sin_senal', 'inactivo'] as const as e (e)}
      <Tarjeta titulo={e === 'inactivo' ? 'Inactivos' : ROTULO[e]} estado={e} valor={resumen.dispositivos[e]}
        accion={{ etiqueta: 'Ver en el inventario', ayuda: `Abre el inventario de este sitio filtrado por «${ROTULO[e]}»`, alHacer: () => enInventario(e) }} data-indicador={e} />
    {/each}
    <Tarjeta titulo="Salud del sitio" ancha valor={resumen.salud.porcentaje === null ? '—' : `${Math.round(resumen.salud.porcentaje)} %`}
      detalle={`${resumen.salud.reportan} de ${resumen.salud.supervisados} reportan (en línea ÷ supervisados, sin los inactivos)`} data-indicador="salud">
      <Medidor porcentaje={resumen.salud.porcentaje} etiqueta="Salud del sitio" />
    </Tarjeta>
    <Tarjeta titulo="Tramas del rango" valor={resumen.tramas.recibidas} detalle={`recibidas · ${resumen.tramas.rechazadas.toLocaleString('es-CL')} rechazadas`} data-indicador="tramas" />
  </ul>

  <div class="paneles">
    <section class="panel-seccion" aria-labelledby="titulo-atencion" data-atencion>
      <h3 id="titulo-atencion">Requiere atención</h3>
      {#if resumen.atencion.length === 0}
        <p class="vivo" data-atencion-vacia>Ningún dispositivo en «Sin señal» ni en «Alerta».</p>
      {:else}
        <ul class="atencion">
          {#each resumen.atencion.slice(0, 10) as a (a.id)}
            <li data-atencion-fila={a.id}>
              <span class="estado {a.estado_visual}">{ROTULO[a.estado_visual]}</span>
              <a href={`#/dispositivos/${a.id}`}>{a.nombre}</a>
              <span class="vivo" title={a.visto_por_ultima_vez === null ? '' : horaLocal(a.visto_por_ultima_vez, zona)}>{haceCuanto(a.visto_por_ultima_vez, ahora)}</span>
              {#if a.tipos.length > 0}<span class="vivo">· {a.tipos.map(rotuloCondicion).join(', ')}</span>{/if}
            </li>
          {/each}
        </ul>
        <Boton etiqueta="Ver todos en el inventario" variante="discreto" onclick={() => enInventario(null)} data-atencion-todos />
      {/if}
    </section>
    <section class="panel-seccion" aria-labelledby="titulo-condiciones">
      <h3 id="titulo-condiciones">Condiciones abiertas por tipo</h3>
      {#if resumen.condiciones_abiertas.length === 0}
        <p class="vivo" data-condiciones-vacias>Ninguna condición abierta.</p>
      {:else}
        <BarrasOrdenadas titulo="Condiciones abiertas por tipo" barras={resumen.condiciones_abiertas.map((c) => ({ etiqueta: rotuloCondicion(c.tipo), valor: c.n, texto: c.n.toLocaleString('es-CL') }))} />
      {/if}
    </section>
  </div>

  <h3>Gráficas del sitio</h3>
  {#if sinTramas}
    <p class="vacio" data-sin-tramas>Sin tramas en este rango. <Boton etiqueta="Ver los últimos 30 días" onclick={() => elegirRango('30d')} data-ultimos-30 /></p>
  {/if}
  {#if mostrada !== null && ventanaGrafico !== null}
    <section class="panel-seccion" aria-labelledby="titulo-tramas">
      <h3 id="titulo-tramas" data-titulo-tramas>Tramas por cubo de {rotuloIntervalo(resumen.ventana.intervalo)}</h3>
      <Grafico series={tramas.series} unidad="tramas" {zona} titulo="Tramas recibidas y rechazadas" barras sincronizar={sincronizar} ventana={ventanaGrafico} alto={180}
        lineas={[
          { label: 'rechazadas', stroke: colores[1]!, width: 1, leyenda: (i) => (tramas.rechazadas[i] ?? 0).toLocaleString('es-CL') },
          { label: 'recibidas', stroke: colores[0]!, width: 1, leyenda: (i) => (tramas.recibidas[i] ?? 0).toLocaleString('es-CL') },
        ]} />
    </section>
    {#if historicos.length === 0}
      <p class="vacio" data-sin-magnitudes>El sitio no mide ninguna magnitud todavía: aparecerán aquí al llegar la primera medición.</p>
    {/if}
    <div class="paneles">
      {#each historicos as h, i (h.magnitud)}
        {@const m = magnitudesDibujadas[i]}
        {#if m !== undefined}
          <section class="panel-seccion" aria-labelledby="titulo-magnitud-{m.codigo}" data-magnitud-seccion={m.codigo}>
            <h4 id="titulo-magnitud-{m.codigo}">{m.nombre}</h4>
            <GraficoSitio historico={h} nombre={m.nombre} canales={m.canales} {zona} ventana={ventanaGrafico} {sincronizar} {unidades} />
            {#if paraComparar.length >= 2}
              <a href={fragmentoComparar(paraComparar, m.codigo, rangoElegido ?? '30d')} data-comparar-magnitud={m.codigo}>Comparar {m.nombre} entre dispositivos</a>
            {/if}
          </section>
        {/if}
      {/each}
    </div>
    {#if magnitudesEnLista.length > 0}
      <p class="vivo" data-magnitudes-lista>También mide: {magnitudesEnLista.map((m) => m.nombre).join(', ')} (se ven en la ficha de cada dispositivo).</p>
    {/if}
    <section class="panel-seccion" aria-labelledby="titulo-entrega">
      <h3 id="titulo-entrega">Entrega por dispositivo</h3>
      <p class="vivo">Tramas recibidas en el rango ÷ esperadas según su intervalo, de peor a mejor.</p>
      {#if resumen.entrega.filter((x) => x.porcentaje !== null).length === 0}
        <p class="vivo" data-entrega-vacia>Ningún dispositivo con intervalo esperado en este rango.</p>
      {:else}
        <BarrasOrdenadas titulo="Entrega por dispositivo" orden="asc" maximo={100}
          barras={resumen.entrega.filter((x) => x.porcentaje !== null).map((x) => ({ etiqueta: x.nombre, valor: Math.min(100, x.porcentaje!), texto: `${Math.round(x.porcentaje!)} % (${x.recibidas} de ${x.esperadas})` }))} />
        <Boton etiqueta="Ver todos por entrega" variante="discreto" onclick={() => enInventario(null, 'entrega')} data-entrega-todos />
      {/if}
    </section>
  {/if}
{/if}
