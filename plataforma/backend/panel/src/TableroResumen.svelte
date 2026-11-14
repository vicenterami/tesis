<script lang="ts">
  // Pestaña Resumen del tablero (docs/19 §4, bloque L, puntos 2 y 3): el presente. La franja de indicadores, «Ahora», «Requiere atención» y
  // las condiciones abiertas por tipo. Sin selector de rango: nada de lo que muestra depende de él (las tramas son las de las últimas 24
  // horas, y así se rotulan). Al entrar, dos pedidos: `GET /sitios/{id}/resumen` (24 horas) y `GET /sitios/{id}/ahora?tendencia=si`.
  // En vivo (L3c), sin pedir por cada trama: `medicion` y `visto` se aplican en memoria y lo dibujado se pone al día como mucho una vez
  // por segundo; solo un aviso `condicion` de un dispositivo del sitio repide «Ahora» (sin tendencia) y el resumen, con antirrebote; con
  // tramas llegando, el resumen se repide además una vez por minuto (los conteos de tramas). «Pausar» (en la fila del tablero) detiene
  // todo eso y «Reanudar» pide una vez lo que se muestra, como al reconectar (F4). Qué aviso es del sitio lo dice su `sitio_id`.
  import { onMount, untrack } from 'svelte';
  import Ahora from './Ahora.svelte';
  import Aviso from './Aviso.svelte';
  import BarrasOrdenadas from './BarrasOrdenadas.svelte';
  import Medidor from './Medidor.svelte';
  import { aplicarAvisos, conservarTendencia, esDelSitio } from './lib/ahora';
  import { antirrebote, porLotes } from './lib/antirrebote';
  import { esCancelacion, obtener } from './lib/api';
  import { avisoDeError } from './lib/avisos';
  import { ROTULO, rotuloCondicion } from './lib/estado-visual';
  import type { AhoraSitio, EventoVivo, ResumenSitio, Sitio } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import type { PreferenciaUnidades } from './lib/unidades';
  import { SIN_FILTROS, fragmentoAlta, fragmentoInventario, fragmentoTablero } from './lib/vista';
  import { RECONECTADO, abrirCanalCompartido } from './lib/vivo';

  let { sitio, unidades, pausado = false }: { sitio: Sitio; unidades: PreferenciaUnidades; pausado?: boolean } = $props();

  const LIMITE_AHORA = 24;
  const UN_MINUTO = 60_000;
  let resumen = $state<ResumenSitio | null>(null);
  let datosAhora = $state<AhoraSitio | null>(null);
  let error = $state<string | null>(null);
  let errorAhora = $state<string | null>(null);
  let ahora = $state(new Date());
  let recientes = $state<ReadonlySet<string>>(new Set());
  const zona = $derived(sitio.zona_horaria);
  const id = $derived(encodeURIComponent(sitio.id));

  // Las tramas del resumen son las de las últimas 24 horas (cubos de una hora: el resumen no las dibuja, solo las cuenta).
  const urlResumen = (): string => {
    const hasta = new Date();
    return `/sitios/${id}/resumen?${new URLSearchParams({ desde: new Date(hasta.getTime() - 86_400_000).toISOString(), hasta: hasta.toISOString(), intervalo: '1 hour' })}`;
  };
  let ctlResumen: AbortController | null = null;
  let ctlAhora: AbortController | null = null;
  let ultimoResumen = 0;
  // `automatico`: lo que el panel pide por su cuenta (un aviso, el minuto, una reconexión). En pausa no se pide y, si la pausa llegó con
  // el pedido en vuelo, su respuesta no se dibuja (L4a: «Pausar» detiene toda actualización automática); lo que pide la persona, siempre.
  async function cargarResumen(automatico = false): Promise<void> {
    if (automatico && pausado) return;
    ctlResumen?.abort();
    const ctl = new AbortController();
    ctlResumen = ctl;
    ultimoResumen = Date.now();
    try {
      const r = await obtener<ResumenSitio>(urlResumen(), ctl.signal);
      if (ctl.signal.aborted || (automatico && pausado)) return;
      resumen = r;
      error = null;
    } catch (e) {
      if (esCancelacion(e) || ctl.signal.aborted) return;
      error = avisoDeError(e).texto; // lo anterior se queda a la vista; el error se dice
    }
  }
  // La tendencia se pide UNA vez, al cargar la pantalla; si el servidor la omitió (`tendencia: false`), no se insiste (como mucho al
  // recargar). Las lecturas posteriores la conservan.
  async function cargarAhora(conTendencia: boolean, automatico = false): Promise<void> {
    if (automatico && pausado) return;
    ctlAhora?.abort();
    const ctl = new AbortController();
    ctlAhora = ctl;
    try {
      const q = new URLSearchParams({ limite: String(LIMITE_AHORA), ...(conTendencia ? { tendencia: 'si' } : {}) });
      const r = await obtener<AhoraSitio>(`/sitios/${id}/ahora?${q}`, ctl.signal);
      if (ctl.signal.aborted || (automatico && pausado)) return;
      // Las lecturas en vivo que esperan su lote NO se descartan: las que llegaron con el pedido en vuelo son posteriores a esta foto, y
      // `aplicarAvisos` deja fuera las más viejas (compara la hora de cada aviso con la que ya se muestra).
      datosAhora = conservarTendencia(r, untrack(() => datosAhora));
      errorAhora = null;
    } catch (e) {
      if (esCancelacion(e) || ctl.signal.aborted) return;
      errorAhora = avisoDeError(e).texto;
    }
  }
  const repedirResumen = antirrebote(() => cargarResumen(true), 2000);
  const repedirTodo = antirrebote(() => Promise.all([cargarResumen(true), cargarAhora(false, true)]), 2000);

  // Las lecturas en vivo se juntan y se dibujan como mucho una vez por segundo (L3c), con un resalte breve en las tarjetas que cambiaron.
  let quitarResalte: ReturnType<typeof setTimeout> | null = null;
  const lecturas = porLotes<EventoVivo>((lote) => {
    if (datosAhora === null) return;
    const r = aplicarAvisos(datosAhora, lote);
    if (r.cambiados.length === 0) return;
    datosAhora = r.datos;
    recientes = new Set(r.cambiados);
    if (quitarResalte !== null) clearTimeout(quitarResalte);
    quitarResalte = setTimeout(() => (recientes = new Set()), 600);
  }, 1000);

  // Los dispositivos que la pantalla muestra: con `sitio_id` nulo (o ausente), solo sus avisos cuentan.
  const visibles = $derived(new Set([...(datosAhora?.dispositivos ?? []).map((d) => d.id), ...(resumen?.atencion ?? []).map((a) => a.id)]));
  function alEvento(e: EventoVivo): void {
    if (pausado || e.tipo === 'latido' || !esDelSitio(e, sitio.id, visibles)) return;
    if (e.tipo === 'condicion') {
      repedirTodo.pedir();
      return;
    }
    lecturas.agregar(e);
    if (Date.now() - ultimoResumen >= UN_MINUTO) repedirResumen.pedir();
  }

  // «Reanudar» (y reconectar): una vez lo que se muestra; la tendencia se conserva. En pausa el reloj de los «hace N s» también se
  // detiene (la fila del tablero dice desde cuándo) y al reanudar se pone en hora.
  let pausaAnterior = untrack(() => pausado);
  $effect(() => {
    const p = pausado;
    untrack(() => {
      if (pausaAnterior && !p) {
        ahora = new Date();
        void Promise.all([cargarResumen(), cargarAhora(false)]);
      }
      if (p) lecturas.cancelar();
      pausaAnterior = p;
    });
  });

  onMount(() => {
    void cargarResumen();
    void cargarAhora(true);
    const reloj = setInterval(() => {
      if (!pausado) ahora = new Date();
    }, 1000);
    const c = abrirCanalCompartido('/eventos', alEvento, (estado, motivo) => {
      if (estado === 'en_vivo' && motivo === RECONECTADO && !pausado) void Promise.all([cargarResumen(true), cargarAhora(false, true)]);
    });
    return () => {
      clearInterval(reloj);
      if (quitarResalte !== null) clearTimeout(quitarResalte);
      ctlResumen?.abort();
      ctlAhora?.abort();
      repedirResumen.cancelar();
      repedirTodo.cancelar();
      lecturas.cancelar();
      c.cerrar();
    };
  });

  const inventario = (estado: 'normal' | 'alerta' | 'sin_senal' | 'inactivo' | null): string => fragmentoInventario({ ...SIN_FILTROS, sitio: sitio.codigo, estado });
  const sumaEstados = $derived(resumen === null ? 0 : resumen.dispositivos.normal + resumen.dispositivos.alerta + resumen.dispositivos.sin_senal + resumen.dispositivos.inactivo);
  const ESTADOS = ['normal', 'alerta', 'sin_senal', 'inactivo'] as const;
  const rotuloEstado = (e: (typeof ESTADOS)[number]): string => (e === 'inactivo' ? 'Inactivos' : ROTULO[e]);
</script>

{#if error !== null}
  <Aviso tipo="error" texto={`No se pudo leer el resumen: ${error}`} accion={{ etiqueta: 'Reintentar', alHacer: () => void cargarResumen() }} />
{/if}
{#if resumen === null}
  <!-- Mientras llega: huecos del tamaño que tendrán, sin texto que empuje la página -->
  {#if error === null}<div class="hueco hueco-indicadores" aria-busy="true" aria-label="Cargando el resumen" data-cargando-resumen></div>{/if}
{:else if resumen.dispositivos.total === 0}
  <!-- Vacíos con camino (B5) -->
  <div class="vacio" data-tablero-vacio>
    <p><strong>Este sitio aún no tiene dispositivos.</strong> Da de alta el primero con el asistente (la credencial se muestra una sola vez), o
      varios a la vez desde un archivo CSV.</p>
    <p class="acciones"><a href={fragmentoAlta('uno', '', sitio.codigo)} data-ir-alta>Da de alta el primero</a> <a href={fragmentoAlta('lote')} data-ir-alta-lote>Alta masiva por archivo</a>
      <a href="#/inventario">Ir al inventario</a></p>
  </div>
{:else}
  <!-- Franja de indicadores (L2a): el enlace de cada ficha es su rótulo con su cifra; el área activa cubre la ficha -->
  <ul class="indicadores-v3" aria-label="Indicadores del sitio" data-indicadores>
    <li class="indicador" data-indicador="total">
      <a class="enlace-extendido" href={inventario(null)}><span class="rotulo">Dispositivos</span><span class="solo-lector">:</span> <span class="cifra" data-valor>{resumen.dispositivos.total.toLocaleString('es-CL')}</span></a>
      {#if sumaEstados !== resumen.dispositivos.total}<span class="detalle" data-detalle>el desglose no suma el total: recarga</span>{/if}
    </li>
    {#each ESTADOS as e (e)}
      <li class="indicador" data-indicador={e}>
        <a class="enlace-extendido" href={inventario(e)}><span class="rotulo"><span class="estado {e}">{rotuloEstado(e)}</span></span><span class="solo-lector">:</span> <span class="cifra" data-valor>{resumen.dispositivos[e].toLocaleString('es-CL')}</span></a>
      </li>
    {/each}
    <li class="indicador" data-indicador="tramas">
      <a class="enlace-extendido" href={fragmentoTablero(sitio.codigo, 'red', '24h')}><span class="rotulo">Tramas (24 h)</span><span class="solo-lector">:</span> <span class="cifra" data-valor>{resumen.tramas.recibidas.toLocaleString('es-CL')}</span></a>
      <span class="detalle" data-detalle>{resumen.tramas.rechazadas.toLocaleString('es-CL')} {resumen.tramas.rechazadas === 1 ? 'rechazada' : 'rechazadas'}</span>
    </li>
    <li class="indicador ancho" data-indicador="salud">
      <a class="enlace-extendido" href={fragmentoInventario({ ...SIN_FILTROS, sitio: sitio.codigo })}><span class="rotulo">Salud del sitio</span><span class="solo-lector">:</span> <span class="cifra" data-valor>{resumen.salud.porcentaje === null ? '—' : `${Math.round(resumen.salud.porcentaje)} %`}</span></a>
      <Medidor porcentaje={resumen.salud.porcentaje} etiqueta="Salud del sitio" />
      <span class="detalle" title="En línea ÷ supervisados (sin los inactivos)" data-detalle>{resumen.salud.reportan} de {resumen.salud.supervisados} reportan</span>
    </li>
  </ul>

  {#if errorAhora !== null}
    <Aviso tipo="error" texto={`No se pudo leer «Ahora»: ${errorAhora}`} accion={{ etiqueta: 'Reintentar', alHacer: () => void cargarAhora(datosAhora === null) }} />
  {/if}
  {#if datosAhora !== null}
    <Ahora datos={datosAhora} {zona} {unidades} {ahora} sitioCodigo={sitio.codigo} {recientes} />
  {:else if errorAhora === null}
    <div class="hueco hueco-ahora" aria-busy="true" aria-label="Cargando «Ahora»" data-cargando-ahora></div>
  {/if}

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
              <a href={`#/dispositivos/${a.id}`} title={a.nombre}>{a.nombre}</a>
              <span class="vivo" title={a.visto_por_ultima_vez === null ? '' : horaLocal(a.visto_por_ultima_vez, zona)}>{haceCuanto(a.visto_por_ultima_vez, ahora)}{#if a.tipos.length > 0}{` · ${a.tipos.map(rotuloCondicion).join(', ')}`}{/if}</span>
            </li>
          {/each}
        </ul>
        <p class="ver-todos"><a href={fragmentoInventario({ ...SIN_FILTROS, sitio: sitio.codigo })} data-atencion-todos>Ver todos en el inventario</a></p>
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
{/if}
