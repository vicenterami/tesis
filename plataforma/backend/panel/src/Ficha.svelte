<script lang="ts">
  // Pantalla P3 (docs/19 §4): identidad, estado visual, una tarjeta por canal, gráfico histórico que sigue en vivo,
  // condiciones del dispositivo y sus tramas rechazadas. Datos: GET /dispositivos/{id}, /canales/{id}/historico,
  // /condiciones?dispositivo=, /cuarentena?dispositivo= y el canal en vivo filtrado por dispositivo.
  import { onMount } from 'svelte';
  import Grafico from './Grafico.svelte';
  import { mensajeError, obtener } from './lib/api';
  import { enLinea, estadoVisual, ROTULO, rotuloCondicion } from './lib/estado-visual';
  import { RANGOS, RANGO_POR_DEFECTO, agregarLectura, formatearValor, rotuloIntervalo, seriesDesdeHistorico, urlHistorico, ventana, type ClaveRango, type Series } from './lib/grafico';
  import type { Condicion, DispositivoFicha, EventoVivo, Historico, TramaRechazada } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import { RECONECTADO, abrirCanal, type EstadoCanal } from './lib/vivo';
  import { antirrebote, porLotes } from './lib/antirrebote';

  let { id }: { id: string } = $props();

  let d = $state<DispositivoFicha | null>(null);
  let condiciones = $state<Condicion[]>([]);
  let rechazadas = $state<TramaRechazada[]>([]);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let pausado = $state(false);
  let canalElegido = $state<string | null>(null);
  let rangoElegido = $state<ClaveRango>(RANGO_POR_DEFECTO);
  let series = $state<Series>([[], [], []]);
  let historico = $state<Historico | null>(null);
  let errorHistorico = $state<string | null>(null);

  const abiertas = $derived(condiciones.filter((c) => c.cerrada_en === null));
  const ordenadas = $derived([...abiertas, ...condiciones.filter((c) => c.cerrada_en !== null)]);
  const estado = $derived(
    d === null ? null : estadoVisual({ estado: d.estado, en_linea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora) }, abiertas.map((c) => c.tipo)),
  );
  const canalActual = $derived(d?.canales.find((c) => c.id === canalElegido) ?? null);

  // Las condiciones ABIERTAS se piden completas (hasta 500), aparte de las 50 más recientes: una sin_comunicacion vieja no
  // puede quedar fuera por 50 cierres y aperturas de umbral posteriores (12/10). Se unen sin repetir.
  async function cargarCondiciones(): Promise<Condicion[]> {
    const [abiertasTodas, recientes] = await Promise.all([
      obtener<Condicion[]>(`/condiciones?dispositivo=${encodeURIComponent(id)}&abiertas=true&limite=500`),
      obtener<Condicion[]>(`/condiciones?dispositivo=${encodeURIComponent(id)}&limite=50`),
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

  async function cargar(): Promise<void> {
    try {
      const [ficha, conds, rech] = await Promise.all([
        obtener<DispositivoFicha>(`/dispositivos/${encodeURIComponent(id)}`),
        cargarCondiciones(),
        obtener<TramaRechazada[]>(`/cuarentena?dispositivo=${encodeURIComponent(id)}&limite=20`),
      ]);
      d = ficha;
      condiciones = conds;
      rechazadas = rech;
      canalElegido ??= ficha.canales[0]?.id ?? null;
      error = null;
    } catch (e) {
      error = mensajeError(e);
    }
  }

  // Dos clics seguidos de rango o canal pueden responder en orden inverso: solo la última petición pedida escribe (12/10).
  let generacion = 0;
  async function cargarHistorico(): Promise<void> {
    if (canalElegido === null) return;
    const v = ventana(rangoElegido, new Date());
    const mia = ++generacion;
    try {
      const h = await obtener<Historico>(urlHistorico(canalElegido, v.desde, v.hasta, v.intervalo));
      if (mia !== generacion) return;
      historico = h;
      series = seriesDesdeHistorico(h);
      errorHistorico = null;
    } catch (e) {
      if (mia !== generacion) return;
      errorHistorico = mensajeError(e);
    }
  }

  // Al reconectar se repide el histórico del rango visible: el canal no guarda cola (docs/19 F4).
  function alEstadoCanal(s: EstadoCanal, motivo?: string): void {
    canal = s;
    if (s === 'en_vivo' && motivo === RECONECTADO) void cargar().then(cargarHistorico);
  }

  function alEvento(e: EventoVivo): void {
    if (pausado || d === null) return;
    if (e.tipo !== 'latido' && e.dispositivo_id !== id) return; // el canal viene filtrado, pero no se confía en eso
    if (e.tipo === 'visto') {
      d = { ...d, visto_por_ultima_vez: e.tiempo };
    } else if (e.tipo === 'medicion') {
      d = { ...d, canales: d.canales.map((c) => (c.id === e.canal_id ? { ...c, ultima_medicion: { valor: e.valor, tiempo: e.tiempo, porcentaje: e.porcentaje ?? null } } : c)) };
      if (e.canal_id === canalElegido) lecturas.agregar({ tiempo: e.tiempo, valor: e.valor });
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
    void cargarHistorico();
  }

  onMount(() => {
    void cargar().then(cargarHistorico);
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    const c = abrirCanal(`/eventos?dispositivo=${encodeURIComponent(id)}`, alEvento, alEstadoCanal);
    return () => {
      clearInterval(reloj);
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
      en vivo: {canal === 'en_vivo' ? (pausado ? 'en pausa' : 'conectado') : canal === 'conectando' ? 'conectando…' : 'reconectando'}
      <button type="button" onclick={() => (pausado = !pausado)} aria-pressed={pausado}>{pausado ? 'Reanudar' : 'Pausar'}</button>
    </p>
  </header>
  <dl class="identidad">
    <div><dt>Identificador</dt><dd><code>{d.id_fisico}</code></dd></div>
    <div><dt>Vía · formato</dt><dd>{d.via} · {d.formato}</dd></div>
    <div><dt>Sitio · zona</dt><dd>{d.sitio} · {d.zona}</dd></div>
    <div><dt>Intervalo esperado</dt><dd>{d.intervalo_esperado_s} s</dd></div>
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
          <button type="button" class="canal" aria-pressed={c.id === canalElegido} onclick={() => elegirCanal(c.id)} data-canal-id={c.id}>
            <strong>{c.magnitud_nombre}{c.etiqueta === null ? '' : ` · ${c.etiqueta}`}</strong>
            <span class="lectura" data-ultima>{formatearValor(c.ultima_medicion?.valor ?? null, c.unidad)}</span>
            <!-- «es un número», no «no es null»: un evento sin el campo (un backend anterior) no debe romper la tarjeta -->
            {#if typeof c.ultima_medicion?.porcentaje === 'number'}
              <span class="porcentaje" data-porcentaje>{c.ultima_medicion.porcentaje.toLocaleString('es-CL')} % según su calibración</span>
            {/if}
            <span class="vivo">{c.ultima_medicion === null ? 'sin lecturas' : haceCuanto(c.ultima_medicion.tiempo, ahora)}</span>
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
    <div class="filtros" role="group" aria-label="Rango del gráfico">
      {#each RANGOS as r (r.clave)}
        <button type="button" aria-pressed={rangoElegido === r.clave} onclick={() => elegirRango(r.clave)}>{r.rotulo}</button>
      {/each}
      {#if historico !== null}
        <span class="vivo" data-historico>{historico.puntos} puntos, promedio por {rotuloIntervalo(historico.intervalo)}; en vivo, cada lectura aparte</span>
      {/if}
    </div>
    {#if errorHistorico !== null}
      <p class="error" role="alert">{errorHistorico}</p>
    {:else if historico !== null && historico.puntos === 0 && series[0].length === 0}
      <p class="vacio">Sin mediciones en este rango.</p>
    {/if}
    <!-- {#key}: el gráfico se crea una vez por canal; al cambiar de canal se recrea con su título y su unidad -->
    {#key canalActual.id}
      <Grafico {series} unidad={canalActual.unidad} zona={d.zona_horaria} titulo={`${canalActual.magnitud_nombre} (${canalActual.unidad})`} />
    {/key}
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
