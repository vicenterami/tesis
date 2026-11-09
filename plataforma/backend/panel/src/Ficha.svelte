<script lang="ts">
  // Pantalla P3 (docs/19 §4): identidad, estado visual, una tarjeta por canal, gráfico histórico que sigue en vivo,
  // condiciones del dispositivo y sus tramas rechazadas. Datos: GET /dispositivos/{id}, /canales/{id}/historico,
  // /condiciones?dispositivo=, /cuarentena?dispositivo= y el canal en vivo filtrado por dispositivo.
  import { onMount, untrack } from 'svelte';
  import Grafico from './Grafico.svelte';
  import SelectorRango from './SelectorRango.svelte';
  import ZonaSitio from './ZonaSitio.svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { descargar, esCancelacion, mensajeError, obtener, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { canalCallado, enLinea, estadoVisual, ROTULO, rotuloCondicion } from './lib/estado-visual';
  import { RANGO_POR_DEFECTO, agregarLectura, formatearValor, rango as datosRango, rangoQueContiene, resolucionValida, resumenRango, rotuloIntervalo, seriesDesdeHistorico, urlHistorico, ventana, type ClaveRango, type ClaveResolucion, type Series } from './lib/grafico';
  import type { Condicion, DispositivoFicha, EventoVivo, Historico, TramaRechazada } from './lib/modelo';
  import { duracion, fechaHora, haceCuanto, haceSegundos, horaLocal } from './lib/tiempo';
  import { fragmentoComparar, fragmentoFicha } from './lib/vista';
  import { recordarMarcados } from './lib/comparar';
  import { RECONECTADO, abrirCanal, type EstadoCanal } from './lib/vivo';
  import { antirrebote, porLotes } from './lib/antirrebote';

  // canal y rango: la vista inicial que trae la URL (ya validada por leerVista; null = por defecto). alCambiarVista escribe la
  // vista en la URL (App.svelte); sin él (las pruebas que montan la ficha sola), no se escribe nada.
  let {
    id,
    canal: canalInicial = null,
    rango: rangoInicial = null,
    res: resInicial = null,
    sesion = null,
    alCambiarVista = () => {},
  }: { id: string; canal?: string | null; rango?: ClaveRango | null; res?: ClaveResolucion | null; sesion?: Sesion | null; alCambiarVista?: (fragmento: string) => void } = $props();

  let d = $state<DispositivoFicha | null>(null);
  let condiciones = $state<Condicion[]>([]);
  let rechazadas = $state<TramaRechazada[]>([]);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let pausado = $state(false);
  // Estado inicial desde la URL: se lee una vez aquí; los cambios posteriores de la URL los aplica el efecto de más abajo.
  let canalElegido = $state<string | null>(untrack(() => canalInicial));
  let rangoElegido = $state<ClaveRango>(untrack(() => rangoInicial) ?? RANGO_POR_DEFECTO);
  // Resolución (incremento 2, punto 4): null = «auto»; una que no sirve para el rango vuelve a «auto».
  let resElegida = $state<ClaveResolucion | null>(untrack(() => resolucionValida(rangoInicial ?? RANGO_POR_DEFECTO, resInicial)));
  let listo = $state(false); // la ficha cargó y el canal elegido está validado contra sus canales
  // «En vivo» con prueba (punto 5): cuándo pasó el canal a en_vivo y cuándo llegó (reloj local) la última lectura de cada canal.
  let enVivoDesde = $state<number | null>(null);
  let llegadas = $state<Record<string, number>>({});
  let series = $state<Series>([[], [], []]);
  let historico = $state<Historico | null>(null);
  let errorHistorico = $state<string | null>(null);
  // Cambio de rango sin pantalla en blanco (incremento 2, punto 2): canal, rango y resolución ELEGIDOS son lo que se pidió (los
  // botones los marcan); `mostrada` es lo que el gráfico dibuja, de la última respuesta buena. Mientras llega la nueva, el gráfico
  // conserva la anterior y dice «cargando…»; con error, la conserva y la URL sigue diciendo lo que se ve.
  let mostrada = $state<{ canal: string; rango: ClaveRango; res: ClaveResolucion | null; desde: Date; hasta: Date } | null>(null);
  let cargando = $state(false);
  let descargando = $state(false);
  let avisoDescarga = $state<DatosAviso | null>(null);
  // Exportar exige el rol administrador en el sitio del dispositivo (docs/20 §6): se sabe por la matriz de la sesión; si el panel no lo
  // sabe (montado sin sesión, en las pruebas), deja la decisión al servidor y muestra su 403.
  const motivoExportar = $derived(d === null || puedeEn(sesion, 'exportar', d.sitio_codigo) ? null : 'exportar exige el rol administrador en este sitio');

  const abiertas = $derived(condiciones.filter((c) => c.cerrada_en === null));
  const ordenadas = $derived([...abiertas, ...condiciones.filter((c) => c.cerrada_en !== null)]);
  const estado = $derived(
    d === null ? null : estadoVisual({ estado: d.estado, en_linea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora) }, abiertas.map((c) => c.tipo)),
  );
  const canalActual = $derived(d?.canales.find((c) => c.id === canalElegido) ?? null);
  const canalMostrado = $derived(mostrada === null ? null : (d?.canales.find((c) => c.id === mostrada!.canal) ?? null));
  const resumen = $derived(historico === null ? null : resumenRango(historico.valores));
  const ventanaGrafico = $derived(mostrada === null ? null : { desde: mostrada.desde.getTime() / 1000, hasta: mostrada.hasta.getTime() / 1000 });
  // Reloj de pasarela desviado (punto 4): la condición abierta, en palabras, con su hace cuánto. Al cerrarse, el aviso `condicion`
  // vuelve a pedir las condiciones y desaparece sin recargar.
  const relojDesviado = $derived(abiertas.find((c) => c.tipo === 'reloj_desviado') ?? null);
  // Intervalo observado frente al esperado (punto 3): informa, no decide (la alarma de silencio usa solo el esperado).
  // Canales que callan con el equipo en línea (docs/19 §4): se recalculan con el reloj de la ficha y con cada lectura en vivo.
  const callados = $derived(
    d === null ? new Set<string>() : new Set(d.canales.filter((c) => canalCallado(c.ultima_medicion?.tiempo ?? null, d!.visto_por_ultima_vez, d!.intervalo_esperado_s, ahora)).map((c) => c.id)),
  );
  const avisoIntervalo = $derived.by(() => {
    if (d === null || d.intervalo_observado_s === null) return null;
    if (d.intervalo_observado_s < d.intervalo_esperado_s / 2) return 'más seguido de lo declarado: revisa el intervalo esperado';
    if (d.intervalo_observado_s > d.intervalo_esperado_s * 2) return 'más lento de lo declarado: revisa el intervalo esperado';
    return null;
  });
  // Rango vacío (punto 2): el menor rango que contiene la última medición del canal; null si tiene más de 30 días.
  const rangoConLaUltima = $derived(canalMostrado?.ultima_medicion ? rangoQueContiene(canalMostrado.ultima_medicion.tiempo, ahora) : null);
  // «Conectado, sin lecturas»: con el canal en vivo, más de 2 intervalos esperados sin una lectura del canal visible (contados con
  // el reloj del navegador desde que el canal está en vivo o desde la última lectura llegada, lo más reciente).
  const sinLecturas = $derived.by(() => {
    if (canal !== 'en_vivo' || pausado || d === null || enVivoDesde === null || canalElegido === null) return false;
    const desde = Math.max(enVivoDesde, llegadas[canalElegido] ?? 0);
    return ahora.getTime() - desde > d.intervalo_esperado_s * 2 * 1000;
  });

  // Las condiciones ABIERTAS se piden completas (hasta 500), aparte de las 50 más recientes: una sin_comunicacion vieja no
  // puede quedar fuera por 50 cierres y aperturas de umbral posteriores (12/10). Se unen sin repetir.
  async function cargarCondiciones(senal?: AbortSignal): Promise<Condicion[]> {
    const [abiertasTodas, recientes] = await Promise.all([
      obtener<Condicion[]>(`/condiciones?dispositivo=${encodeURIComponent(id)}&abiertas=true&limite=500`, senal),
      obtener<Condicion[]>(`/condiciones?dispositivo=${encodeURIComponent(id)}&limite=50`, senal),
    ]);
    const vistas = new Set(abiertasTodas.map((c) => c.id));
    return [...abiertasTodas, ...recientes.filter((c) => !vistas.has(c.id))];
  }
  const repedirCondiciones = antirrebote(() => cargarCondiciones().then((c) => (condiciones = c)).catch(() => undefined));
  // Las lecturas en vivo se aplican por lotes: un redibujo del gráfico cada 250 ms como mucho, no uno por lectura.
  const lecturas = porLotes<{ tiempo: string; valor: number }>((lote) => {
    let s = series;
    for (const l of lote) s = agregarLectura(s, l.tiempo, l.valor);
    series = s;
  });

  // Gana la última (docs/19 §6): la recarga al reconectar cancela la anterior; al salir de la ficha se cancela la que esté en vuelo.
  const carga = ultimaGana();
  async function cargar(): Promise<void> {
    const senal = carga.senal();
    try {
      const [ficha, conds, rech] = await Promise.all([
        obtener<DispositivoFicha>(`/dispositivos/${encodeURIComponent(id)}`, senal),
        cargarCondiciones(senal),
        obtener<TramaRechazada[]>(`/cuarentena?dispositivo=${encodeURIComponent(id)}&limite=20`, senal),
      ]);
      d = ficha;
      condiciones = conds;
      rechazadas = rech;
      // Un canal de la URL que no es de este dispositivo se ignora: rige el primero.
      if (canalElegido === null || !ficha.canales.some((c) => c.id === canalElegido)) canalElegido = ficha.canales[0]?.id ?? null;
      error = null;
      listo = true;
    } catch (e) {
      if (esCancelacion(e)) return;
      error = mensajeError(e);
    }
  }

  // Dos clics seguidos de rango o canal pueden responder en orden inverso: solo la última petición pedida escribe (12/10).
  let generacion = 0;
  let abortarHistorico: AbortController | null = null; // la petición anterior se cancela, no solo se ignora (revisión del 22/10)
  async function cargarHistorico(): Promise<void> {
    if (canalElegido === null) return;
    const pedido = { canal: canalElegido, rango: rangoElegido, res: resElegida };
    const v = ventana(pedido.rango, new Date(), pedido.res);
    const mia = ++generacion;
    abortarHistorico?.abort();
    const ctl = new AbortController();
    abortarHistorico = ctl;
    cargando = true;
    try {
      const h = await obtener<Historico>(urlHistorico(pedido.canal, v.desde, v.hasta, v.intervalo), ctl.signal);
      if (mia !== generacion) return;
      historico = h;
      series = seriesDesdeHistorico(h);
      mostrada = { ...pedido, desde: v.desde, hasta: v.hasta };
      errorHistorico = null;
    } catch (e) {
      if (mia !== generacion) return;
      errorHistorico = mensajeError(e); // la serie anterior se queda: el error se dice, no se dibuja como vacío
    } finally {
      if (mia === generacion) cargando = false;
    }
  }

  // Al reconectar se vuelve a pedir el histórico del rango visible: el canal no guarda cola (docs/19 F4).
  function alEstadoCanal(s: EstadoCanal, motivo?: string): void {
    canal = s;
    enVivoDesde = s === 'en_vivo' ? Date.now() : null;
    if (s === 'en_vivo' && motivo === RECONECTADO) void cargar().then(cargarHistorico);
  }

  function alEvento(e: EventoVivo): void {
    if (pausado || d === null) return;
    if (e.tipo !== 'latido' && e.dispositivo_id !== id) return; // el canal viene filtrado, pero no se confía en eso
    if (e.tipo === 'visto') {
      d = { ...d, visto_por_ultima_vez: e.tiempo };
    } else if (e.tipo === 'medicion') {
      d = { ...d, canales: d.canales.map((c) => (c.id === e.canal_id ? { ...c, ultima_medicion: { valor: e.valor, tiempo: e.tiempo, porcentaje: e.porcentaje ?? null } } : c)) };
      llegadas = { ...llegadas, [e.canal_id]: Date.now() };
      if (e.canal_id === mostrada?.canal) lecturas.agregar({ tiempo: e.tiempo, valor: e.valor }); // la serie es la del canal dibujado
    } else if (e.tipo === 'condicion') {
      repedirCondiciones.pedir();
    }
  }

  function elegirCanal(cid: string): void {
    canalElegido = cid;
    void cargarHistorico();
  }
  function elegirRango(r: ClaveRango): void {
    rangoElegido = r;
    resElegida = resolucionValida(r, resElegida); // la resolución elegida se conserva si sirve para el rango nuevo
    void cargarHistorico();
  }
  function elegirRes(r: ClaveResolucion | null): void {
    resElegida = resolucionValida(rangoElegido, r);
    void cargarHistorico();
  }

  // La vista va a la URL (punto 1) cuando cambia lo que el gráfico MUESTRA (incremento 2, punto 2: con error, la URL no se toca). Depende
  // solo de `mostrada` y de `listo`: ni de `d` (los eventos en vivo lo reescriben) ni de las props, que vienen de la URL; si dependiera
  // de ellas, un cambio externo del fragmento lo haría reescribir la vista anterior antes de que el efecto siguiente aplicara la nueva.
  $effect(() => {
    const m = mostrada;
    if (!listo || m === null) return;
    const f = fragmentoFicha(untrack(() => id), m.canal, m.rango, m.res);
    untrack(() => alCambiarVista(f));
  });
  // La URL cambió desde fuera (atrás, un enlace): se reaplica. Si coincide con lo que ya se muestra (la escribió esta misma
  // pantalla), no se hace nada.
  $effect(() => {
    const r = rangoInicial ?? RANGO_POR_DEFECTO;
    const c = canalInicial;
    const x = resolucionValida(r, resInicial);
    untrack(() => {
      if (!listo || d === null) return;
      const canalNuevo = c !== null && d.canales.some((k) => k.id === c) ? c : (d.canales[0]?.id ?? null);
      if (r === rangoElegido && canalNuevo === canalElegido && x === resElegida) return;
      rangoElegido = r;
      canalElegido = canalNuevo;
      resElegida = x;
      void cargarHistorico();
    });
  });

  // Descarga por fetch con la sesión y un Blob (lib/api.ts, `descargar`; docs/19 §6): nunca un enlace directo a la API, que con la
  // sesión vencida abriría el JSON del 401 en una pestaña. Un 401 lleva al inicio de sesión (manejo central); otro error, al aviso.
  async function exportar(ruta: string): Promise<void> {
    if (descargando) return;
    descargando = true;
    avisoDescarga = null;
    try {
      const r = await descargar(ruta, `${d?.id_fisico ?? 'dispositivo'}.csv`);
      avisoDescarga = { tipo: 'exito', texto: `Descargado ${r.nombre} (${r.bytes.toLocaleString('es-CL')} bytes).` };
    } catch (e) {
      avisoDescarga = avisoDeError(e);
    } finally {
      descargando = false;
    }
  }

  // La exportación por API alrededor de la última medición (P8; la pantalla es de la Etapa 4): la semana que la precede.
  function urlExportar(tiempo: string): string {
    const hasta = new Date(Date.parse(tiempo) + 1000);
    const q = new URLSearchParams({ formato: 'csv', desde: new Date(hasta.getTime() - 7 * 86_400_000).toISOString(), hasta: hasta.toISOString() });
    return `/dispositivos/${encodeURIComponent(id)}/exportar?${q.toString()}`;
  }
  // «Descargar CSV de este rango» (incremento 2, punto 6): la ventana que el gráfico muestra, tal cual. Es un enlace a la API, no la
  // pantalla P8 (Etapa 4).
  function urlExportarVentana(desde: Date, hasta: Date): string {
    const q = new URLSearchParams({ formato: 'csv', desde: desde.toISOString(), hasta: hasta.toISOString() });
    return `/dispositivos/${encodeURIComponent(id)}/exportar?${q.toString()}`;
  }
  // P3b con este dispositivo marcado y la magnitud del canal visible (incremento 2, punto 5).
  function irAComparar(): void {
    recordarMarcados([id]);
  }

  onMount(() => {
    void cargar().then(cargarHistorico);
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    const c = abrirCanal(`/eventos?dispositivo=${encodeURIComponent(id)}`, alEvento, alEstadoCanal);
    return () => {
      clearInterval(reloj);
      carga.cancelar();
      abortarHistorico?.abort();
      repedirCondiciones.cancelar();
      lecturas.cancelar();
      c.cerrar();
    };
  });
</script>

<p><a href="#/">← Inventario</a></p>
{#if error !== null}
  <p class="error" role="alert">{error}</p>
{:else if d === null || estado === null}
  <p class="vacio">Cargando…</p>
{:else}
  <header class="ficha-cabecera">
    <h2>{d.nombre} <span class="estado {estado}" data-estado={estado}>{ROTULO[estado]}</span></h2>
    <p class="vivo {canal}" data-canal={canal}>
      <span data-en-vivo>en vivo: {canal === 'en_vivo' ? (pausado ? 'en pausa' : sinLecturas ? 'conectado, sin lecturas' : 'conectado') : canal === 'conectando' ? 'conectando…' : 'reconectando'}</span>
      {#if canalActual !== null}
        <span data-ultima-lectura title={canalActual.ultima_medicion === null ? '' : horaLocal(canalActual.ultima_medicion.tiempo, d.zona_horaria)}>
          · última lectura {canalActual.ultima_medicion === null ? 'ninguna aún' : haceSegundos(canalActual.ultima_medicion.tiempo, ahora)}
        </span>
      {/if}
      <Boton etiqueta={pausado ? 'Reanudar' : 'Pausar'} presionado={pausado} ayuda="Congela las lecturas en vivo de esta ficha; el gráfico y las tarjetas dejan de moverse" onclick={() => (pausado = !pausado)} />
    </p>
    <p class="vivo" data-intervalo>
      {#if d.intervalo_observado_s === null}
        intervalo observado: sin datos suficientes (esperado {duracion(d.intervalo_esperado_s)})
      {:else}
        reporta cada ≈ {duracion(d.intervalo_observado_s)} (esperado {duracion(d.intervalo_esperado_s)}){#if avisoIntervalo !== null}; <strong data-aviso-intervalo>{avisoIntervalo}</strong>{/if}
      {/if}
    </p>
    {#if callados.size > 0}
      <p class="aviso" data-callados>{callados.size === 1 ? '1 canal callado' : `${callados.size} canales callados`}: el equipo reporta, pero sin lecturas de esa magnitud dentro de 2 × su intervalo esperado</p>
    {/if}
    <div class="zona-sitio"><ZonaSitio zona={d.zona_horaria} /></div>
    {#if relojDesviado !== null}
      <p class="error" role="status" data-reloj-desviado>
        Reloj de pasarela desviado: las mediciones se fechan al llegar · <span title={horaLocal(relojDesviado.abierta_en, d.zona_horaria)}>{haceCuanto(relojDesviado.abierta_en, ahora)}</span>
      </p>
    {/if}
  </header>
  <dl class="identidad">
    <div><dt>Identificador</dt><dd><code>{d.id_fisico}</code></dd></div>
    <div><dt>Vía · formato</dt><dd>{d.via} · {d.formato}</dd></div>
    <div><dt>Sitio · zona</dt><dd>{d.sitio} · {d.zona}</dd></div>
    <div><dt>Intervalo esperado</dt><dd>{duracion(d.intervalo_esperado_s)}</dd></div>
    <div><dt>Última trama</dt><dd title={d.visto_por_ultima_vez === null ? '' : horaLocal(d.visto_por_ultima_vez, d.zona_horaria)}>{haceCuanto(d.visto_por_ultima_vez, ahora)}</dd></div>
    <div><dt>Registrado</dt><dd title={horaLocal(d.creado_en, d.zona_horaria)}>{haceCuanto(d.creado_en, ahora)}</dd></div>
  </dl>

  <h3>Canales</h3>
  {#if d.canales.length === 0}
    <p class="vacio">Sin canales: este dispositivo no declara magnitudes todavía.</p>
  {:else}
    <ul class="canales">
      {#each d.canales as c (c.id)}
        <li>
          <button type="button" class="canal" class:callado={callados.has(c.id)} aria-pressed={c.id === canalElegido} onclick={() => elegirCanal(c.id)} data-canal-id={c.id}>
            <strong>{c.magnitud_nombre}{c.etiqueta === null ? '' : ` · ${c.etiqueta}`}</strong>
            <span class="lectura" data-ultima>{formatearValor(c.ultima_medicion?.valor ?? null, c.unidad)}</span>
            <!-- «es un número», no «no es null»: un evento sin el campo (un backend anterior) no debe romper la tarjeta -->
            {#if typeof c.ultima_medicion?.porcentaje === 'number'}
              <span class="porcentaje" data-porcentaje>{c.ultima_medicion.porcentaje.toLocaleString('es-CL')} % según su calibración</span>
            {/if}
            <span class="vivo">{c.ultima_medicion === null ? 'sin lecturas' : haceCuanto(c.ultima_medicion.tiempo, ahora)}{#if callados.has(c.id)}{' · '}<strong data-callado>callado</strong>{/if}</span>
            {#if c.reglas !== null && c.reglas.length > 0}
              <span class="reglas">umbrales: {c.reglas.map((r) => `${r.umbral_bajo ?? '—'} a ${r.umbral_alto ?? '—'} (histéresis ${r.histeresis ?? 0})`).join('; ')}</span>
            {:else}
              <span class="reglas">sin umbrales</span>
            {/if}
          </button>
        </li>
      {/each}
    </ul>
  {/if}

  {#if canalActual !== null}
    <!-- Rango y resolución (incremento 2, puntos 2 y 4): mientras llega el histórico, el grupo queda ocupado y el texto dice «cargando…» -->
    <div class="filtros" role="group" aria-label="Rango del gráfico" aria-busy={cargando} data-cargando={cargando}>
      <SelectorRango rango={rangoElegido} res={resElegida} alElegirRango={elegirRango} alElegirRes={elegirRes} />
      {#if cargando}
        <span class="vivo" data-cargando-texto>cargando…</span>
      {:else if historico !== null}
        <span class="vivo" data-historico>{historico.puntos} puntos, promedio por {rotuloIntervalo(historico.intervalo)}; en vivo, cada lectura aparte</span>
      {/if}
      <a href={fragmentoComparar([id], canalActual.magnitud, rangoElegido, resElegida)} onclick={irAComparar} data-ir-comparar>Comparar con otros dispositivos</a>
    </div>
    {#if errorHistorico !== null}
      <p class="error" role="alert">{errorHistorico} <Boton etiqueta="Reintentar" onclick={() => void cargarHistorico()} data-reintentar /></p>
    {/if}
    {#if canalMostrado !== null && mostrada !== null && historico !== null && historico.puntos === 0 && series[0].length === 0}
      {#if canalMostrado.ultima_medicion === null}
        <p class="vacio" data-rango-vacio>Sin mediciones en este rango.</p>
      {:else}
        <!-- Un rango sin datos lo dice y lleva al dato (incremento 1, punto 2); nunca se amplía solo: el rango cambia con el clic -->
        <p class="vacio" data-rango-vacio>
          Sin mediciones en este rango; la última es de {haceCuanto(canalMostrado.ultima_medicion.tiempo, ahora)}
          (<span title={horaLocal(canalMostrado.ultima_medicion.tiempo, d.zona_horaria)}>{fechaHora(canalMostrado.ultima_medicion.tiempo, d.zona_horaria)}</span>).
          {#if rangoConLaUltima === null}
            El panel no dibuja más de 30 días: para verla, exporta sus mediciones.
            <Boton etiqueta="Exportar la semana de la última medición" cargando={descargando} etiquetaCargando="Descargando…" motivoDesactivado={motivoExportar}
              onclick={() => canalMostrado?.ultima_medicion && void exportar(urlExportar(canalMostrado.ultima_medicion.tiempo))} data-exportar-ultima />
          {:else if rangoConLaUltima !== mostrada.rango}
            <Boton etiqueta="Ver la última medición" onclick={() => rangoConLaUltima !== null && elegirRango(rangoConLaUltima)} data-ver-ultima />
            <span class="vivo">({datosRango(rangoConLaUltima).rotulo})</span>
          {/if}
        </p>
      {/if}
    {/if}
    {#if canalMostrado !== null && mostrada !== null}
      <!-- {#key}: el gráfico se crea una vez por canal DIBUJADO; al llegar el histórico de otro canal se recrea con su título y unidad -->
      {#key canalMostrado.id}
        <Grafico {series} unidad={canalMostrado.unidad} zona={d.zona_horaria} titulo={`${canalMostrado.magnitud_nombre} (${canalMostrado.unidad})`} ventana={ventanaGrafico} />
      {/key}
      <!-- Lo que el rango ya sabe (incremento 2, punto 6): sobre los promedios recibidos, y así se nombra -->
      <p class="resumen-rango vivo">
        {#if resumen !== null}
          <span data-resumen-rango>en este rango: mín {formatearValor(resumen.min, canalMostrado.unidad)} · máx {formatearValor(resumen.max, canalMostrado.unidad)} · promedio de los {resumen.n} promedios dibujados {formatearValor(resumen.promedio, canalMostrado.unidad)}</span>
        {/if}
        <Boton etiqueta="Descargar CSV de este rango" etiquetaCargando="Descargando…" cargando={descargando} motivoDesactivado={motivoExportar}
          ayuda="Las mediciones crudas de la ventana que muestra el gráfico, en CSV (coma y punto decimal)"
          onclick={() => mostrada !== null && void exportar(urlExportarVentana(mostrada.desde, mostrada.hasta))} data-csv-rango />
      </p>
      {#if avisoDescarga !== null}<Aviso tipo={avisoDescarga.tipo} texto={avisoDescarga.texto} alCerrar={() => (avisoDescarga = null)} />{/if}
    {/if}
  {/if}

  <h3>Condiciones</h3>
  {#if condiciones.length === 0}
    <p class="vacio">Sin condiciones registradas.</p>
  {:else}
    <div class="tabla">
      <table>
        <thead><tr><th scope="col">Tipo</th><th scope="col">Magnitud</th><th scope="col">Abierta</th><th scope="col">Duración</th><th scope="col">Estado</th></tr></thead>
        <tbody>
          {#each ordenadas as c (c.id)}
            <tr data-condicion={c.cerrada_en === null ? 'abierta' : 'cerrada'}>
              <td>{rotuloCondicion(c.tipo)}</td>
              <td>{c.magnitud ?? '—'}</td>
              <td title={horaLocal(c.abierta_en, d.zona_horaria)}>{haceCuanto(c.abierta_en, ahora)}</td>
              <td>{Math.round(c.duracion_s / 60)} min</td>
              <td>{c.cerrada_en === null ? 'abierta' : 'cerrada'}</td>
            </tr>
          {/each}
        </tbody>
      </table>
    </div>
  {/if}

  <h3>Tramas rechazadas</h3>
  {#if rechazadas.length === 0}
    <p class="vacio">Ninguna trama de este dispositivo fue a cuarentena.</p>
  {:else}
    <ul class="rechazadas">
      {#each rechazadas as t (t.id)}
        <li>
          <span title={horaLocal(t.recibido_en, d.zona_horaria)}>{haceCuanto(t.recibido_en, ahora)}</span> · <strong>{t.motivo}</strong>
          {#if t.detalle !== null}· {t.detalle}{/if}
          {#if t.payload !== null}
            <details><summary>trama ({t.payload_formato ?? 'texto'})</summary><pre>{t.payload}</pre></details>
          {/if}
        </li>
      {/each}
    </ul>
  {/if}
{/if}
