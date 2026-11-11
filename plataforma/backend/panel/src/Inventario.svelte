<script lang="ts">
  // Pantalla P2 (docs/19 §4): inventario con semáforo (HU-19) y filtros (HU-20); v2 desde el 11/11/2026 (tablero v2, C): el servidor
  // filtra y pagina (`GET /dispositivos?sitio&zona&via&estado&q&limite&desplazamiento`, total en `X-Total`), 50 por página con «1–50 de
  // 132» y la página en la URL; cada fila trae `estado_visual` (la regla de §2 en SQL) y `entrega`; las fichas de conteo son totales del
  // servidor (una petición de una fila por estado, con los demás filtros); bajo 700 px la tabla se vuelve tarjetas (A5). En vivo, como
  // antes: cada `visto` mueve «hace cuánto» y el panel recalcula el estado con `estadoVisual()` (la misma regla) sin repedir la página; un
  // aviso de condición repide la página con antirrebote. Con un backend anterior (sin `X-Total`), filtra y pagina el panel: el mismo
  // resultado, sin depender de la versión.
  import { onMount, untrack } from 'svelte';
  import { LIMITE_ABIERTAS, URL_ABIERTAS, esCancelacion, mensajeError, obtener, obtenerPagina } from './lib/api';
  import { compararAtencion, conteoPorEstado, enLinea, estadoVisual, ORDEN_ATENCION, ROTULO, rotuloCondicion, type EstadoVisual } from './lib/estado-visual';
  import type { Condicion, DispositivoInventario, EventoVivo, Sitio, TipoCondicion } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import { RECONECTADO, abrirCanal, type EstadoCanal } from './lib/vivo';
  import { antirrebote, porLotes } from './lib/antirrebote';
  import { MAX_COMPARAR, SIN_FILTROS, fragmentoComparar, fragmentoInventario, type FiltrosInventario, type OrdenInventario } from './lib/vista';
  import { marcadosParaComparar, recordarMarcados } from './lib/comparar';
  import { seguirAngosto } from './lib/medios';
  import { POR_PAGINA, VIAS, compararEntrega, filtrarEnPanel, rotuloPagina, urlInventario } from './lib/inventario';
  import ZonaSitio from './ZonaSitio.svelte';
  import Boton from './Boton.svelte';

  // filtros: la vista inicial que trae la URL (docs/19 §4, incremento 1, punto 1); alCambiarVista la escribe (App.svelte). sitios: los
  // de la persona (`GET /sitios`, App), de donde salen las zonas de cada sitio; sin ellos, las zonas de la página visible.
  let {
    filtros = SIN_FILTROS,
    sitios = null,
    alCambiarVista = () => {},
  }: { filtros?: FiltrosInventario; sitios?: Sitio[] | null; alCambiarVista?: (fragmento: string) => void } = $props();

  let dispositivos = $state<DispositivoInventario[]>([]);
  let total = $state<number | null>(null); // `X-Total`; null = el servidor no pagina (backend anterior): pagina el panel
  let conteoServidor = $state<Record<EstadoVisual, number> | null>(null);
  let abiertas = $state<Condicion[]>([]);
  let cargado = $state(false);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let motivoCanal = $state<string | undefined>(undefined);
  let angosto = $state(false);
  let desplegadas = $state<Set<string>>(new Set());
  // Estado del servidor al cargar; desde el primer dato en vivo (un `visto` o el reloj), el del panel con la misma regla (§2).
  let recalcular = $state(false);
  // Estado inicial desde la URL (se lee una vez; los cambios posteriores los aplica el efecto de más abajo).
  const inicial = untrack(() => filtros);
  let filtroEstado = $state<EstadoVisual | null>(inicial.estado);
  let filtroSitio = $state(inicial.sitio); // código del sitio
  let filtroZona = $state(inicial.zona); // id de la zona
  let filtroVia = $state(inicial.via);
  let busqueda = $state(inicial.q);
  let pagina = $state(inicial.pagina);
  let orden = $state<OrdenInventario>(inicial.orden);
  // Casillas «comparar» (docs/19 §4, incremento 2, punto 5): las recordadas de esta sesión (lib/comparar.ts), en el orden marcado.
  let marcados = $state<string[]>(marcadosParaComparar());

  const tiposPorDispositivo = $derived.by(() => {
    const m = new Map<string, TipoCondicion[]>();
    for (const c of abiertas) m.set(c.dispositivo_id, [...(m.get(c.dispositivo_id) ?? []), c.tipo]);
    return m;
  });
  const filasSinOrden = $derived(
    dispositivos.map((d) => {
      const tipos = tiposPorDispositivo.get(d.id) ?? [];
      const delPanel = (): EstadoVisual => estadoVisual({ estado: d.estado, en_linea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora) }, tipos);
      return { d, tipos, nombre: d.nombre, estado: !recalcular && d.estado_visual !== undefined ? d.estado_visual : delPanel() };
    }),
  );
  // Por entrega, con un servidor que pagina, manda su orden (el de todas las páginas); si no, la página se ordena por atención.
  const filas = $derived(orden === 'entrega' && total !== null ? filasSinOrden : [...filasSinOrden].sort(compararAtencion));
  // Con un backend anterior, el panel filtra y pagina lo que recibió (todo el inventario); con uno nuevo, el filtro del panel no cambia
  // nada (el servidor ya filtró) salvo un estado recalculado en vivo.
  const filtrosActuales = $derived({ estado: filtroEstado, sitio: filtroSitio, zona: filtroZona, via: filtroVia, q: busqueda, pagina, orden });
  const coinciden = $derived(filtrarEnPanel(filas, filtrosActuales));
  const totalVisible = $derived(total ?? coinciden.length);
  const visibles = $derived.by(() => {
    if (total !== null) return coinciden; // el servidor ya filtró, ordenó y paginó
    // Backend anterior: el panel ordena todo lo que recibió (por entrega, como el servidor) y después pagina.
    const todas = orden === 'entrega' ? [...coinciden].sort((a, b) => compararEntrega(a, b) || compararAtencion(a, b)) : coinciden;
    return todas.slice((pagina - 1) * POR_PAGINA, pagina * POR_PAGINA);
  });
  const conteo = $derived(conteoServidor ?? conteoPorEstado(filtrarEnPanel(filas, { ...filtrosActuales, estado: null }).map((f) => f.estado)));
  const ultimaPagina = $derived(Math.max(1, Math.ceil(totalVisible / POR_PAGINA)));

  // Varios sitios (docs/19 P2): se filtra por el código del sitio y el id de la zona, nunca por el nombre (dos sedes pueden tener una
  // zona con el mismo nombre); la zona se elige dentro del sitio elegido. El sitio se elige en la cabecera (A1).
  const listaSitios = $derived(
    sitios !== null ? sitios.map((x) => ({ codigo: x.codigo, nombre: x.nombre, zonas: x.zonas }))
      : [...new Map(dispositivos.map((d) => [d.sitio_codigo, d.sitio])).entries()].map(([codigo, nombre]) => ({ codigo, nombre, zonas: dispositivos.filter((d) => d.sitio_codigo === codigo).map((d) => ({ id: d.zona_id, nombre: d.zona })) })),
  );
  const variosSitios = $derived(listaSitios.length > 1);
  // El id del sitio elegido, para la API (la URL del panel lleva el código): null mientras no llega `GET /sitios` o si el código no es
  // de la persona.
  const idSitio = $derived(sitios?.find((x) => x.codigo === filtroSitio)?.id ?? null);
  const esperandoSitios = $derived(filtroSitio !== '' && sitios === null);
  // Con un sitio en la URL se espera la lista de sitios antes de pedir: sin su id, la página llegaría sin filtrar.
  let enEspera = false;
  $effect(() => {
    if (sitios === null || !enEspera) return;
    enEspera = false;
    untrack(() => void cargar());
  });
  // El nombre de un sitio no es único (el código sí): si dos se llaman igual, se distinguen por su código (revisión del 16/10).
  const nombreRepetido = $derived(new Set(listaSitios.filter((x, i) => listaSitios.findIndex((y) => y.nombre === x.nombre) !== i).map((x) => x.nombre)));
  const rotuloSitio = (codigo: string, nombre: string): string => (nombreRepetido.has(nombre) ? `${nombre} (${codigo})` : nombre);
  const zonas = $derived(
    [...new Map(listaSitios.filter((x) => filtroSitio === '' || x.codigo === filtroSitio).flatMap((x) => x.zonas.map((z) => [z.id, { id: z.id, rotulo: variosSitios && filtroSitio === '' ? `${rotuloSitio(x.codigo, x.nombre)} · ${z.nombre}` : z.nombre }] as const))).values()]
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'es')),
  );
  const vias = $derived([...new Set([...VIAS, ...dispositivos.map((d) => d.via)])].sort());
  // Si la zona elegida no es del sitio elegido, vuelve a «todas» (solo con lo necesario cargado: antes, la lista está vacía).
  $effect(() => {
    if (!cargado) return;
    if (filtroZona !== '' && zonas.length > 0 && !zonas.some((z) => z.id === filtroZona)) filtroZona = '';
    if (filtroVia !== '' && !vias.includes(filtroVia)) filtroVia = '';
    if (filtroSitio !== '' && listaSitios.length > 0 && !listaSitios.some((x) => x.codigo === filtroSitio)) filtroSitio = '';
  });
  // Los filtros van a la URL con replaceState (App.svelte), una vez cargado el inventario.
  $effect(() => {
    const f = filtrosActuales;
    if (!cargado) return;
    untrack(() => alCambiarVista(fragmentoInventario(f)));
  });
  // La URL cambió desde fuera (atrás, un enlace, el selector de sitio de la cabecera): se reaplica.
  $effect(() => {
    const f = filtros;
    untrack(() => {
      if (filtroEstado !== f.estado) filtroEstado = f.estado;
      if (filtroSitio !== f.sitio) filtroSitio = f.sitio;
      if (filtroZona !== f.zona) filtroZona = f.zona;
      if (filtroVia !== f.via) filtroVia = f.via;
      if (busqueda !== f.q) busqueda = f.q;
      if (orden !== f.orden) orden = f.orden;
      if (pagina !== f.pagina) {
        pagina = f.pagina;
        if (cargado) void cargar(); // otra página («atrás»): se pide; un cambio de filtro lo pide el efecto de abajo
      }
    });
  });
  // Un filtro que cambia vuelve a la página 1 y pide al servidor (la búsqueda, con una pausa corta: no una petición por tecla).
  let filtrosPedidos = '';
  let pausaBusqueda: ReturnType<typeof setTimeout> | null = null;
  $effect(() => {
    const clave = JSON.stringify([filtroEstado, filtroSitio, filtroZona, filtroVia, orden]);
    const q = busqueda;
    untrack(() => {
      if (!cargado) return;
      const nueva = `${clave}|${q}`;
      if (nueva === filtrosPedidos) return;
      const soloTexto = filtrosPedidos.startsWith(`${clave}|`);
      filtrosPedidos = nueva;
      pagina = 1;
      if (pausaBusqueda !== null) clearTimeout(pausaBusqueda);
      pausaBusqueda = soloTexto ? setTimeout(() => void cargar(), 300) : null;
      if (!soloTexto) void cargar();
    });
  });
  function irAPagina(p: number): void {
    pagina = Math.min(Math.max(1, p), ultimaPagina);
    void cargar();
  }

  // Zonas horarias de las filas listadas (incremento 2, punto 3).
  const zonasListadas = $derived([...new Set(visibles.map((f) => f.d.zona_horaria))]);
  const marcadosVigentes = $derived(marcados);
  function alternarMarca(id: string): void {
    marcados = marcados.includes(id) ? marcados.filter((x) => x !== id) : [...marcados, id];
    recordarMarcados(marcados);
  }
  // «Marcar los visibles» (C4), con el tope de seis: suma los de la página en su orden hasta completar.
  const libres = $derived(MAX_COMPARAR - marcados.length);
  function marcarVisibles(): void {
    const nuevos = visibles.map((f) => f.d.id).filter((x) => !marcados.includes(x)).slice(0, Math.max(0, libres));
    marcados = [...marcados, ...nuevos];
    recordarMarcados(marcados);
  }
  function comparar(): void {
    window.location.hash = fragmentoComparar(marcadosVigentes, null, '24h'); // otra pantalla: entrada nueva en el historial
  }
  function alternarDesplegada(id: string): void {
    const s = new Set(desplegadas);
    if (s.has(id)) s.delete(id);
    else s.add(id);
    desplegadas = s;
  }

  // Las fichas de conteo, del servidor (C5): el total de cada estado con los demás filtros, sin traer las filas (una de cada estado,
  // `limite=1`, que solo se lee por su `X-Total`). null si el servidor no pagina: las cuenta el panel.
  async function contar(f: FiltrosInventario, senal?: AbortSignal): Promise<Record<EstadoVisual, number> | null> {
    const sid = untrack(() => idSitio);
    const n = await Promise.all(ORDEN_ATENCION.map((e) => obtenerPagina<DispositivoInventario>(urlInventario({ ...f, estado: e, pagina: 1, orden: 'atencion' }, 1, sid), senal).then((p) => p.total)));
    return n.every((x) => x !== null) ? (Object.fromEntries(ORDEN_ATENCION.map((e, i) => [e, n[i]!])) as Record<EstadoVisual, number>) : null;
  }

  // Gana la última (docs/19 §6): una recarga cancela la anterior; al salir de la pantalla se cancela la que esté en vuelo.
  let control: AbortController | null = null;
  async function cargar(): Promise<void> {
    if (untrack(() => esperandoSitios)) {
      enEspera = true; // lo pide el efecto de arriba cuando llegan los sitios
      return;
    }
    control?.abort();
    const ctl = new AbortController();
    control = ctl;
    const f = filtrosActuales;
    try {
      const [pag, c, conteos] = await Promise.all([
        obtenerPagina<DispositivoInventario>(urlInventario(f, POR_PAGINA, untrack(() => idSitio)), ctl.signal),
        obtener<Condicion[]>(URL_ABIERTAS, ctl.signal),
        contar(f, ctl.signal),
      ]);
      if (ctl.signal.aborted) return; // llegó tarde: ya se pidió otra (gana la última)
      dispositivos = pag.filas;
      total = pag.total;
      conteoServidor = conteos;
      abiertas = c;
      recalcular = false;
      error = null;
    } catch (e) {
      if (esCancelacion(e) || ctl.signal.aborted) return;
      error = mensajeError(e);
    } finally {
      if (control === ctl && !cargado) {
        filtrosPedidos = `${JSON.stringify([filtroEstado, filtroSitio, filtroZona, filtroVia, orden])}|${busqueda}`;
        cargado = true;
      }
    }
  }

  // Qué hace cada evento del canal (docs/19 F3): `visto` mueve «hace cuánto» y el estado se recalcula en el panel; `condicion` repide
  // las condiciones abiertas (el panel recalcula los estados de la página) y los conteos del servidor, nunca la página (§6, rendimiento),
  // con antirrebote: muchos avisos seguidos → una tanda cada 3 s, nunca dos en vuelo (corrección del 11/11/2026; antes, 1 s). Una tanda
  // son 5 peticiones (las abiertas y un conteo por estado) y no se recortan a «solo si cambió una fila visible»: un aviso de un
  // dispositivo de otra página también mueve los totales de las fichas, que son de todo el filtro. Tope medido en Inventario.test.ts:
  // 100 avisos en 3 s → 5 peticiones; como mucho 5 cada 3 s por pestaña (≈ 1,7 por segundo), de consultas que usan `limite=1`.
  const repedir = antirrebote(async () => {
    try {
      const [c, n] = await Promise.all([obtener<Condicion[]>(URL_ABIERTAS), contar(filtrosActuales)]);
      abiertas = c;
      conteoServidor = n;
      recalcular = true;
    } catch {
      /* el próximo aviso lo intenta otra vez */
    }
  }, 3000);
  const vistos = porLotes<{ id: string; tiempo: string }>((lote) => {
    const ultimo = new Map(lote.map((v) => [v.id, v.tiempo]));
    dispositivos = dispositivos.map((d) => (ultimo.has(d.id) ? { ...d, visto_por_ultima_vez: ultimo.get(d.id)! } : d));
    recalcular = true;
  });
  function alEvento(e: EventoVivo): void {
    if (e.tipo === 'visto') vistos.agregar({ id: e.dispositivo_id, tiempo: e.tiempo });
    else if (e.tipo === 'condicion') repedir.pedir();
  }

  onMount(() => {
    void cargar();
    const dejarDeSeguir = seguirAngosto((x) => (angosto = x));
    const reloj = setInterval(() => {
      ahora = new Date();
      recalcular = true;
    }, 10_000);
    // Al volver de una reconexión se vuelve a pedir todo (docs/19 F4): el canal no guarda cola y pudo perder visto o condicion.
    const c = abrirCanal('/eventos', alEvento, (estado, motivo) => {
      if (estado === 'en_vivo' && motivo === RECONECTADO) void cargar();
      canal = estado;
      motivoCanal = estado === 'en_vivo' ? undefined : motivo;
    });
    return () => {
      clearInterval(reloj);
      if (pausaBusqueda !== null) clearTimeout(pausaBusqueda);
      dejarDeSeguir();
      control?.abort();
      repedir.cancelar();
      vistos.cancelar();
      c.cerrar();
    };
  });

  function alternarFiltro(e: EstadoVisual): void {
    filtroEstado = filtroEstado === e ? null : e;
  }
  const relojPorDispositivo = $derived(new Map(abiertas.filter((c) => c.tipo === 'reloj_desviado').map((c) => [c.dispositivo_id, c])));
  const entregaTexto = (x: number | null | undefined): string => (x === null || x === undefined ? '—' : `${Math.round(x)} %`);
</script>

<h2>Inventario</h2>
<p class="vivo {canal}" data-canal={canal}>
  en vivo: {canal === 'en_vivo' ? 'conectado' : canal === 'conectando' ? 'conectando…' : `reconectando (${motivoCanal ?? ''})`}
</p>
{#if zonasListadas.length === 1}
  <ZonaSitio zona={zonasListadas[0]!} />
{:else if zonasListadas.length > 1}
  <p class="vivo" data-hora-sitio>{zonasListadas.length} zonas horarias: cada fila va en la de su sitio</p>
{/if}

<ul class="fichas" aria-label="Dispositivos por estado">
  {#each ORDEN_ATENCION as e (e)}
    <li>
      <button type="button" aria-pressed={filtroEstado === e} onclick={() => alternarFiltro(e)} data-conteo={e}>
        <span class="n">{conteo[e]}</span>
        <span class="estado {e}">{ROTULO[e]}</span>
      </button>
    </li>
  {/each}
</ul>

<div class="filtros">
  <label>Zona <select bind:value={filtroZona}><option value="">todas</option>{#each zonas as z (z.id)}<option value={z.id}>{z.rotulo}</option>{/each}</select></label>
  <label>Vía <select bind:value={filtroVia}><option value="">todas</option>{#each vias as v (v)}<option value={v}>{v}</option>{/each}</select></label>
  <label>Buscar <input type="search" bind:value={busqueda} placeholder="nombre o identificador" /></label>
  <span data-visibles>{visibles.length} de {totalVisible}</span>
  <Boton etiqueta="Marcar los visibles" ayuda={`Marca para comparar los dispositivos de esta página, hasta ${MAX_COMPARAR} en total`} onclick={marcarVisibles}
    motivoDesactivado={libres <= 0 ? `ya hay ${MAX_COMPARAR} marcados` : visibles.length === 0 ? 'no hay filas a la vista' : null} data-marcar-visibles />
  <Boton etiqueta={`Comparar (${marcadosVigentes.length})`} onclick={comparar} ayuda={`La misma magnitud de 2 a ${MAX_COMPARAR} dispositivos en un gráfico`}
    motivoDesactivado={marcadosVigentes.length < 2 ? `marca al menos 2 dispositivos (de 2 a ${MAX_COMPARAR})` : marcadosVigentes.length > MAX_COMPARAR ? `como mucho ${MAX_COMPARAR} dispositivos` : null} data-comparar />
</div>

{#if abiertas.length >= LIMITE_ABIERTAS}
  <p class="error" role="status">Hay {LIMITE_ABIERTAS} condiciones abiertas o más: el semáforo puede quedar incompleto para algunos dispositivos. Revisa la lista de condiciones.</p>
{/if}
{#if error !== null}
  <p class="error" role="alert">{error}</p>
{:else if !cargado}
  <p class="vacio">Cargando…</p>
{:else if totalVisible === 0 && filtroEstado === null && filtroZona === '' && filtroVia === '' && busqueda.trim() === '' && pagina === 1}
  <p class="vacio">Sin dispositivos registrados. El alta se hace por la API (docs/10 §8.4, punto 25); el primero aparecerá aquí al registrarse.</p>
{:else if visibles.length === 0}
  <p class="vacio">Ningún dispositivo coincide con el filtro.</p>
{:else if angosto}
  <!-- Bajo 700 px (A5): una tarjeta por fila con lo esencial a la vista y el resto plegado tras un botón con texto -->
  <ul class="tarjetas-inventario" data-tarjetas>
    {#each visibles as f (f.d.id)}
      {@const abierta = desplegadas.has(f.d.id)}
      <li class="tarjeta-inventario" data-estado={f.estado} data-id={f.d.id}>
        <div class="fila-1">
          <span class="estado {f.estado}">{ROTULO[f.estado]}</span>
          <a href={`#/dispositivos/${f.d.id}`}>{f.d.nombre}</a>
        </div>
        <span class="vivo" title={f.d.visto_por_ultima_vez === null ? '' : horaLocal(f.d.visto_por_ultima_vez, f.d.zona_horaria)}>
          última trama {haceCuanto(f.d.visto_por_ultima_vez, ahora)} · {f.tipos.length === 0 ? 'sin condiciones abiertas' : f.tipos.map(rotuloCondicion).join(', ')}
        </span>
        {#if relojPorDispositivo.has(f.d.id)}<span class="vivo" data-reloj-desviado>Reloj de pasarela desviado: las mediciones se fechan al llegar</span>{/if}
        <Boton etiqueta={abierta ? 'Menos datos' : 'Más datos'} variante="discreto" aria-expanded={abierta} onclick={() => alternarDesplegada(f.d.id)} data-desplegar={f.d.id} />
        {#if abierta}
          <dl data-desplegada>
            <dt>Identificador</dt><dd><code>{f.d.id_fisico}</code></dd>
            <dt>Vía</dt><dd>{f.d.via}</dd>
            {#if variosSitios}<dt>Sitio</dt><dd>{rotuloSitio(f.d.sitio_codigo, f.d.sitio)}</dd>{/if}
            <dt>Zona</dt><dd>{f.d.zona}</dd>
            <dt>Entrega (24 h)</dt><dd>{entregaTexto(f.d.entrega)}</dd>
          </dl>
          <label class="marcar"><input type="checkbox" checked={marcados.includes(f.d.id)} onchange={() => alternarMarca(f.d.id)} data-marcar={f.d.id} /> comparar</label>
        {/if}
      </li>
    {/each}
  </ul>
{:else}
  <div class="tabla">
    <table>
      <thead>
        <tr>
          <th scope="col">Comparar</th><th scope="col">Estado</th><th scope="col">Nombre</th><th scope="col">Identificador</th><th scope="col">Vía</th>
          {#if variosSitios}<th scope="col">Sitio</th>{/if}<th scope="col">Zona</th><th scope="col">Última trama</th><th scope="col">Condiciones abiertas</th>
          <th scope="col" aria-sort={orden === 'entrega' ? 'ascending' : 'none'}>
            <Boton etiqueta={orden === 'entrega' ? 'Entrega (24 h) ↑' : 'Entrega (24 h)'} variante="discreto" presionado={orden === 'entrega'}
              ayuda="Tramas recibidas ÷ esperadas según su intervalo en las últimas 24 h, en porcentaje (la del tablero es la del rango elegido); pulsa para ordenar todo el inventario de peor a mejor (otra vez, por atención)"
              onclick={() => (orden = orden === 'entrega' ? 'atencion' : 'entrega')} data-ordenar-entrega />
          </th>
        </tr>
      </thead>
      <tbody>
        {#each visibles as f (f.d.id)}
          <tr data-estado={f.estado} data-id={f.d.id}>
            <td class="marcar"><input type="checkbox" checked={marcados.includes(f.d.id)} onchange={() => alternarMarca(f.d.id)} aria-label={`comparar ${f.d.nombre}`} data-marcar={f.d.id} /></td>
            <td>
              <span class="estado {f.estado}">{ROTULO[f.estado]}</span>
              {#if relojPorDispositivo.has(f.d.id)}
                {@const r = relojPorDispositivo.get(f.d.id)!}
                <span class="vivo" data-reloj-desviado>Reloj de pasarela desviado: las mediciones se fechan al llegar · <span title={horaLocal(r.abierta_en, f.d.zona_horaria)}>{haceCuanto(r.abierta_en, ahora)}</span></span>
              {/if}
            </td>
            <td><a href={`#/dispositivos/${f.d.id}`}>{f.d.nombre}</a></td>
            <td><code>{f.d.id_fisico}</code></td>
            <td>{f.d.via}</td>
            {#if variosSitios}<td>{rotuloSitio(f.d.sitio_codigo, f.d.sitio)}</td>{/if}
            <td>{f.d.zona}</td>
            <td title={f.d.visto_por_ultima_vez === null ? '' : horaLocal(f.d.visto_por_ultima_vez, f.d.zona_horaria)}>
              {haceCuanto(f.d.visto_por_ultima_vez, ahora)}
            </td>
            <td>{f.tipos.length}</td>
            <td data-entrega>{entregaTexto(f.d.entrega)}</td>
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
{#if cargado && error === null && totalVisible > 0}
  <!-- Paginación con total (docs/19 §6): la posición va en la URL, «atrás» vuelve a la misma página -->
  <nav class="paginacion" aria-label="Páginas del inventario" data-paginacion>
    <span data-rotulo-pagina>{rotuloPagina(pagina, visibles.length, totalVisible)}</span>
    <Boton etiqueta="Anterior" onclick={() => irAPagina(pagina - 1)} motivoDesactivado={pagina <= 1 ? 'ya estás en la primera página' : null} data-pagina-anterior />
    <Boton etiqueta="Siguiente" onclick={() => irAPagina(pagina + 1)} motivoDesactivado={pagina >= ultimaPagina ? 'ya estás en la última página' : null} data-pagina-siguiente />
  </nav>
{/if}
