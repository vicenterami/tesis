<script lang="ts">
  // Pantalla P3b (docs/19 §4, incremento 2, punto 5): la misma magnitud de 2 a 6 dispositivos en un gráfico. El gráfico es
  // HISTORIA (promedios por cubo; se vuelve a pedir al cambiar magnitud, rango o resolución y con «Actualizar»; en vivo no recibe puntos) y
  // la tabla de abajo es el TIEMPO REAL (última lectura, hace cuánto y estado visual por dispositivo, con el canal en vivo): la
  // separación historia / tiempo real que justifica docs/19 §4 (incremento 2, punto 5), hecha explícita en pantalla. Datos: GET /dispositivos/{id} por dispositivo
  // (6 como mucho), GET /condiciones?abiertas=true, GET /canales/{id}/historico por serie con la MISMA ventana e intervalo, y una sola
  // conexión a GET /eventos sin filtro, filtrada aquí por el conjunto marcado (el proxy acota las conexiones a ese canal).
  import { onMount, untrack } from 'svelte';
  import Grafico from './Grafico.svelte';
  import SelectorRango from './SelectorRango.svelte';
  import ZonaSitio from './ZonaSitio.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, URL_ABIERTAS, mensajeError, obtener } from './lib/api';
  import { antirrebote, porLotes } from './lib/antirrebote';
  import { recordarMarcados } from './lib/comparar';
  import { enLinea, estadoVisual, ROTULO } from './lib/estado-visual';
  import { coloresSeries, temaVivo } from './lib/tema';
  import { RANGO_POR_DEFECTO, alinearSeries, formatearValor, resolucionValida, rotuloIntervalo, urlHistorico, ventana, type ClaveRango, type ClaveResolucion } from './lib/grafico';
  import type { CanalFicha, Condicion, DispositivoFicha, EventoVivo, Historico } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import { fragmentoComparar } from './lib/vista';
  import { RECONECTADO, abrirCanalCompartido, type EstadoCanal } from './lib/vivo';

  let {
    dispositivos,
    magnitud: magnitudInicial = null,
    rango: rangoInicial = null,
    res: resInicial = null,
    alCambiarVista = () => {},
  }: { dispositivos: string[]; magnitud?: string | null; rango?: ClaveRango | null; res?: ClaveResolucion | null; alCambiarVista?: (fragmento: string) => void } = $props();

  const ids = untrack(() => dispositivos); // otro conjunto es otra pantalla (App.svelte la monta de nuevo con {#key})
  let fichas = $state<Record<string, DispositivoFicha | 'no_existe'>>({});
  let abiertas = $state<Condicion[]>([]);
  let cargado = $state(false);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let magnitudElegida = $state<string | null>(untrack(() => magnitudInicial));
  let rangoElegido = $state<ClaveRango>(untrack(() => rangoInicial) ?? RANGO_POR_DEFECTO);
  let resElegida = $state<ClaveResolucion | null>(untrack(() => resolucionValida(rangoInicial ?? RANGO_POR_DEFECTO, resInicial)));
  // Como en la ficha (punto 2): lo elegido es lo pedido; `mostrada`, lo dibujado. Mientras llega, se conserva lo anterior.
  type Dibujada = { id: string; nombre: string; serie: number }; // el color sale de `serie` y del tema vigente (colores, abajo)
  const colores = $derived(coloresSeries($temaVivo));
  let mostrada = $state<{ magnitud: string; nombre: string; unidad: string; rango: ClaveRango; res: ClaveResolucion | null; intervalo: string; desde: Date; hasta: Date; dibujadas: Dibujada[] } | null>(null);
  let series = $state<(number | null)[][]>([[]]);
  let cargando = $state(false);
  let errorGrafico = $state<string | null>(null);

  // Magnitudes de los marcados, la más común primero (a igual cuenta, por nombre): el selector y el valor por defecto.
  const magnitudes = $derived.by(() => {
    const m = new Map<string, { codigo: string; nombre: string; cuantos: number }>();
    for (const id of ids) {
      const f = fichas[id];
      if (f === undefined || f === 'no_existe') continue;
      for (const c of new Map(f.canales.map((k) => [k.magnitud, k])).values()) {
        const x = m.get(c.magnitud) ?? { codigo: c.magnitud, nombre: c.magnitud_nombre, cuantos: 0 };
        x.cuantos++;
        m.set(c.magnitud, x);
      }
    }
    return [...m.values()].sort((a, b) => b.cuantos - a.cuantos || a.nombre.localeCompare(b.nombre, 'es'));
  });
  const magnitud = $derived(magnitudElegida ?? magnitudes[0]?.codigo ?? null);
  const nombreMagnitud = $derived(magnitudes.find((m) => m.codigo === magnitud)?.nombre ?? magnitud ?? '');
  // Una fila por dispositivo marcado, en el orden de la URL: ninguno se omite en silencio (sin canal, otra unidad, ya no existe).
  const filas = $derived.by(() => {
    let unidadEje: string | null = null;
    return ids.map((id, i) => {
      const f = fichas[id];
      if (f === undefined) return { id, i, ficha: null, canal: null, motivo: 'cargando…' };
      if (f === 'no_existe') return { id, i, ficha: null, canal: null, motivo: 'ya no existe' };
      const c: CanalFicha | null = f.canales.find((k) => k.magnitud === magnitud) ?? null; // si mide la magnitud en dos canales, el primero
      if (c === null) return { id, i, ficha: f, canal: null, motivo: `sin canal de ${nombreMagnitud}` };
      unidadEje ??= c.unidad; // la unidad de la primera serie manda en el eje
      if (c.unidad !== unidadEje) return { id, i, ficha: f, canal: c, motivo: `unidad distinta (${c.unidad}): no se dibuja` };
      return { id, i, ficha: f, canal: c, motivo: null };
    });
  });
  const aDibujar = $derived(filas.filter((f) => f.motivo === null && f.canal !== null && f.ficha !== null));
  const zonas = $derived([...new Set(filas.flatMap((f) => (f.ficha === null ? [] : [f.ficha.zona_horaria])))]);
  const tiposPorDispositivo = $derived.by(() => {
    const m = new Map<string, Condicion['tipo'][]>();
    for (const c of abiertas) m.set(c.dispositivo_id, [...(m.get(c.dispositivo_id) ?? []), c.tipo]);
    return m;
  });
  // Nombres repetidos en la leyenda: se distinguen por el identificador físico.
  const rotulo = (f: DispositivoFicha): string => (filas.filter((x) => x.ficha?.nombre === f.nombre).length > 1 ? `${f.nombre} (${f.id_fisico})` : f.nombre);

  async function cargarFichas(): Promise<void> {
    try {
      const [res, c] = await Promise.all([
        Promise.allSettled(ids.map((id) => obtener<DispositivoFicha>(`/dispositivos/${encodeURIComponent(id)}`))),
        obtener<Condicion[]>(URL_ABIERTAS),
      ]);
      const nuevas: Record<string, DispositivoFicha | 'no_existe'> = {};
      // 404 → «ya no existe» en su fila; cualquier otro error es de la pantalla entera (no se disfraza de dispositivo borrado).
      res.forEach((r, i) => {
        if (r.status === 'fulfilled') nuevas[ids[i]!] = r.value;
        else if (r.reason instanceof ErrorApi && r.reason.codigo === 404) nuevas[ids[i]!] = 'no_existe';
        else throw r.reason;
      });
      fichas = nuevas;
      abiertas = c;
      error = null;
    } catch (e) {
      error = mensajeError(e);
    } finally {
      cargado = true;
    }
  }

  let generacion = 0;
  let abortarGrafico: AbortController | null = null; // la petición anterior se cancela, no solo se ignora (revisión del 22/10)
  async function cargarGrafico(): Promise<void> {
    const mag = magnitud;
    const lista = aDibujar;
    if (mag === null || lista.length === 0) return;
    const pedido = { rango: rangoElegido, res: resElegida };
    const v = ventana(pedido.rango, new Date(), pedido.res); // la misma ventana e intervalo para todas: cubos alineados
    const mia = ++generacion;
    abortarGrafico?.abort();
    const ctl = new AbortController();
    abortarGrafico = ctl;
    cargando = true;
    try {
      const hs = await Promise.all(lista.map((f) => obtener<Historico>(urlHistorico(f.canal!.id, v.desde, v.hasta, v.intervalo), ctl.signal)));
      if (mia !== generacion) return;
      series = alinearSeries(hs);
      mostrada = {
        magnitud: mag, nombre: nombreMagnitud, unidad: lista[0]!.canal!.unidad, ...pedido, intervalo: v.intervalo, desde: v.desde, hasta: v.hasta,
        dibujadas: lista.map((f) => ({ id: f.id, nombre: rotulo(f.ficha!), serie: (f.i % 6) + 1 })),
      };
      errorGrafico = null;
    } catch (e) {
      if (mia !== generacion) return;
      errorGrafico = mensajeError(e);
    } finally {
      if (mia === generacion) cargando = false;
    }
  }

  function elegirRango(r: ClaveRango): void {
    rangoElegido = r;
    resElegida = resolucionValida(r, resElegida);
    void cargarGrafico();
  }
  function elegirRes(r: ClaveResolucion | null): void {
    resElegida = resolucionValida(rangoElegido, r);
    void cargarGrafico();
  }
  function elegirMagnitud(m: string): void {
    magnitudElegida = m;
    void cargarGrafico();
  }

  // La URL dice lo que el gráfico muestra (como en la ficha); los ids no cambian en esta pantalla.
  $effect(() => {
    const m = mostrada;
    if (m === null) return;
    untrack(() => alCambiarVista(fragmentoComparar(ids, m.magnitud, m.rango, m.res)));
  });
  // La URL cambió desde fuera (atrás, un enlace) con el mismo conjunto: se reaplica si difiere de lo pedido.
  $effect(() => {
    const r = rangoInicial ?? RANGO_POR_DEFECTO;
    const x = resolucionValida(r, resInicial);
    const m = magnitudInicial;
    untrack(() => {
      if (!cargado) return;
      if (r === rangoElegido && x === resElegida && (m ?? magnitud) === magnitud) return;
      rangoElegido = r;
      resElegida = x;
      if (m !== null) magnitudElegida = m;
      void cargarGrafico();
    });
  });

  // Tiempo real: un solo canal sin filtro, filtrado aquí. Lecturas y «visto» se aplican por lotes (docs/19 §6: nada se repite por cada
  // evento); un aviso de condición vuelve a pedir las abiertas con antirrebote.
  const marcados = new Set(ids);
  const repedirAbiertas = antirrebote(() => obtener<Condicion[]>(URL_ABIERTAS).then((c) => (abiertas = c)).catch(() => undefined));
  const cambios = porLotes<EventoVivo>((lote) => {
    const nuevas = { ...fichas };
    for (const e of lote) {
      if (e.tipo === 'latido') continue;
      const f = nuevas[e.dispositivo_id];
      if (f === undefined || f === 'no_existe') continue;
      if (e.tipo === 'visto') nuevas[e.dispositivo_id] = { ...f, visto_por_ultima_vez: e.tiempo };
      else if (e.tipo === 'medicion') {
        nuevas[e.dispositivo_id] = { ...f, canales: f.canales.map((c) => (c.id === e.canal_id ? { ...c, ultima_medicion: { valor: e.valor, tiempo: e.tiempo, porcentaje: e.porcentaje ?? null } } : c)) };
      }
    }
    fichas = nuevas;
  });
  function alEvento(e: EventoVivo): void {
    if (e.tipo === 'latido' || !marcados.has(e.dispositivo_id)) return;
    if (e.tipo === 'condicion') repedirAbiertas.pedir();
    else cambios.agregar(e);
  }

  onMount(() => {
    recordarMarcados(ids); // al volver al inventario, sus casillas siguen marcadas
    if (ids.length < 2) return; // sin dos dispositivos no hay nada que cargar ni que escuchar: ni fichas, ni reloj, ni canal (revisión del 22/10)
    void cargarFichas().then(cargarGrafico);
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    const c = abrirCanalCompartido('/eventos', alEvento, (estado, motivo) => {
      canal = estado;
      // Al volver de una caída se repite lo que la pantalla muestra (docs/19 F4): el canal no guarda cola.
      if (estado === 'en_vivo' && motivo === RECONECTADO) void cargarFichas().then(cargarGrafico);
    });
    return () => {
      clearInterval(reloj);
      abortarGrafico?.abort();
      repedirAbiertas.cancelar();
      cambios.cancelar();
      c.cerrar();
    };
  });
</script>

<p><a href="#/inventario">← Inventario</a></p>
<h2>Comparar dispositivos</h2>
{#if ids.length < 2}
  <p class="vacio" data-comparar-vacio>Marca al menos dos dispositivos en el inventario. <a href="#/inventario">Ir al inventario</a></p>
{:else if error !== null}
  <p class="error" role="alert">{error}</p>
{:else if !cargado}
  <p class="vacio">Cargando…</p>
{:else}
  {#if zonas.length === 1}
    <ZonaSitio zona={zonas[0]!} />
  {:else if zonas.length > 1}
    <p class="vivo" data-hora-sitio>{zonas.length} zonas horarias: cada fila va en la de su sitio</p>
  {/if}
  <div class="filtros">
    <label>
      Magnitud
      <select data-magnitud value={magnitud ?? ''} onchange={(e) => elegirMagnitud(e.currentTarget.value)}>
        {#if magnitud !== null && !magnitudes.some((m) => m.codigo === magnitud)}<option value={magnitud}>{magnitud} (ninguno la mide)</option>{/if}
        {#each magnitudes as m (m.codigo)}<option value={m.codigo}>{m.nombre} ({m.cuantos} de {ids.length})</option>{/each}
      </select>
    </label>
  </div>

  <h3>Historia: promedios por cubo de tiempo</h3>
  {#if aDibujar.length === 0}
    <p class="vacio" data-comparar-sin-magnitud>Ninguno de los marcados mide {nombreMagnitud}.</p>
  {:else}
    <div class="filtros" role="group" aria-label="Rango del gráfico" aria-busy={cargando} data-cargando={cargando}>
      <SelectorRango rango={rangoElegido} res={resElegida} alElegirRango={elegirRango} alElegirRes={elegirRes} />
      <Boton etiqueta="Actualizar" ayuda="Vuelve a pedir la historia de todos los dispositivos con el rango y la resolución elegidos" onclick={() => void cargarGrafico()} data-actualizar />
      {#if cargando}
        <span class="vivo" data-cargando-texto>cargando…</span>
      {:else if mostrada !== null}
        <span class="vivo" data-historico>{mostrada.dibujadas.length} series, {series[0]?.length ?? 0} instantes, promedio por {rotuloIntervalo(mostrada.intervalo)}; sin lecturas en vivo (están en la tabla)</span>
      {/if}
    </div>
    {#if errorGrafico !== null}
      <p class="error" role="alert">{errorGrafico} <Boton etiqueta="Reintentar" onclick={() => void cargarGrafico()} data-reintentar /></p>
    {/if}
    {#if mostrada !== null}
      {#if (series[0]?.length ?? 0) === 0}
        <p class="vacio" data-rango-vacio>Ninguno de los dibujados tiene mediciones de {mostrada.nombre} en este rango.</p>
      {/if}
      {#key `${mostrada.magnitud}|${mostrada.dibujadas.map((x) => x.id).join(',')}`}
        <Grafico
          {series}
          unidad={mostrada.unidad}
          zona={zonas[0] ?? 'UTC'}
          titulo={`${mostrada.nombre} (${mostrada.unidad})`}
          lineas={mostrada.dibujadas.map((x) => ({ label: x.nombre, stroke: colores[x.serie - 1]!, width: 2 }))}
          ventana={{ desde: mostrada.desde.getTime() / 1000, hasta: mostrada.hasta.getTime() / 1000 }}
        />
      {/key}
    {/if}
  {/if}

  <h3>Tiempo real</h3>
  <p class="vivo {canal}" data-canal={canal}>en vivo: {canal === 'en_vivo' ? 'conectado' : canal === 'conectando' ? 'conectando…' : 'reconectando'}</p>
  <div class="tabla">
    <table>
      <thead><tr><th scope="col">Dispositivo</th><th scope="col">Última lectura de {nombreMagnitud}</th><th scope="col">Hace cuánto</th><th scope="col">Estado</th></tr></thead>
      <tbody>
        {#each filas as f (f.id)}
          {@const dibujada = mostrada?.dibujadas.find((x) => x.id === f.id)}
          <tr data-fila-comparar={f.id}>
            <td>
              {#if dibujada}<span class="muestra serie-{dibujada.serie}" aria-hidden="true"></span>{/if}
              {#if f.ficha !== null}<a href={`#/dispositivos/${f.id}`}>{rotulo(f.ficha)}</a>{:else}<code>{f.id}</code>{/if}
              {#if f.motivo !== null}<span class="vivo" data-motivo> · {f.motivo}</span>{/if}
            </td>
            {#if f.ficha !== null}
              {@const e = estadoVisual({ estado: f.ficha.estado, en_linea: enLinea(f.ficha.visto_por_ultima_vez, f.ficha.intervalo_esperado_s, ahora) }, tiposPorDispositivo.get(f.id) ?? [])}
              <td data-ultima>{f.canal === null ? '—' : formatearValor(f.canal.ultima_medicion?.valor ?? null, f.canal.unidad)}</td>
              <td title={f.canal?.ultima_medicion ? horaLocal(f.canal.ultima_medicion.tiempo, f.ficha.zona_horaria) : ''}>{f.canal?.ultima_medicion ? haceCuanto(f.canal.ultima_medicion.tiempo, ahora) : 'sin lecturas'}</td>
              <td><span class="estado {e}" data-estado={e}>{ROTULO[e]}</span></td>
            {:else}
              <td>—</td><td>—</td><td>—</td>
            {/if}
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
