<script lang="ts">
  // Pantalla P2 (docs/19 §4): inventario con semáforo (HU-19) y filtros (HU-20). Datos: GET /dispositivos y
  // GET /condiciones?abiertas=true; se actualiza con el canal en vivo sin repedir el inventario.
  import { onMount, untrack } from 'svelte';
  import { LIMITE_ABIERTAS, URL_ABIERTAS, mensajeError, obtener } from './lib/api';
  import { compararAtencion, conteoPorEstado, enLinea, estadoVisual, ORDEN_ATENCION, ROTULO, type EstadoVisual } from './lib/estado-visual';
  import type { Condicion, DispositivoInventario, EventoVivo, TipoCondicion } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import { RECONECTADO, abrirCanal, type EstadoCanal } from './lib/vivo';
  import { antirrebote, porLotes } from './lib/antirrebote';
  import { SIN_FILTROS, fragmentoInventario, type FiltrosInventario } from './lib/vista';

  // filtros: la vista inicial que trae la URL (docs/19 §4, incremento 1, punto 1); alCambiarVista la escribe (App.svelte).
  let { filtros = SIN_FILTROS, alCambiarVista = () => {} }: { filtros?: FiltrosInventario; alCambiarVista?: (fragmento: string) => void } = $props();

  let dispositivos = $state<DispositivoInventario[]>([]);
  let abiertas = $state<Condicion[]>([]);
  let cargado = $state(false);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let motivoCanal = $state<string | undefined>(undefined);
  // Estado inicial desde la URL (se lee una vez; los cambios posteriores los aplica el efecto de más abajo).
  const inicial = untrack(() => filtros);
  let filtroEstado = $state<EstadoVisual | null>(inicial.estado);
  let filtroSitio = $state(inicial.sitio); // código del sitio
  let filtroZona = $state(inicial.zona); // id de la zona
  let filtroVia = $state(inicial.via);
  let busqueda = $state(inicial.q);

  const tiposPorDispositivo = $derived.by(() => {
    const m = new Map<string, TipoCondicion[]>();
    for (const c of abiertas) m.set(c.dispositivo_id, [...(m.get(c.dispositivo_id) ?? []), c.tipo]);
    return m;
  });
  const filas = $derived(
    dispositivos
      .map((d) => {
        const tipos = tiposPorDispositivo.get(d.id) ?? [];
        return { d, tipos, nombre: d.nombre, estado: estadoVisual({ estado: d.estado, en_linea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora) }, tipos) };
      })
      .sort(compararAtencion),
  );
  const conteo = $derived(conteoPorEstado(filas.map((f) => f.estado)));
  // Varios sitios (docs/19 P2): se filtra por el código del sitio y el id de la zona, nunca por el nombre (dos sedes pueden tener una
  // zona con el mismo nombre); la zona se elige dentro del sitio elegido. Con un solo sitio, ni el filtro ni la columna aparecen.
  const sitios = $derived(
    [...new Map(dispositivos.map((d) => [d.sitio_codigo, d.sitio])).entries()].map(([codigo, nombre]) => ({ codigo, nombre })).sort((a, b) => a.nombre.localeCompare(b.nombre, 'es')),
  );
  // El nombre de un sitio no es único (el código sí): si dos se llaman igual, se distinguen por su código (revisión del 16/10).
  const nombreRepetido = $derived(new Set(sitios.filter((s, i) => sitios.findIndex((t) => t.nombre === s.nombre) !== i).map((s) => s.nombre)));
  const rotuloSitio = (codigo: string, nombre: string): string => (nombreRepetido.has(nombre) ? `${nombre} (${codigo})` : nombre);
  const variosSitios = $derived(sitios.length > 1);
  const zonas = $derived(
    [...new Map(dispositivos.filter((d) => filtroSitio === '' || d.sitio_codigo === filtroSitio).map((d) => [d.zona_id, { id: d.zona_id, nombre: d.zona, sitio: rotuloSitio(d.sitio_codigo, d.sitio) }])).values()]
      .map((z) => ({ id: z.id, rotulo: variosSitios && filtroSitio === '' ? `${z.sitio} · ${z.nombre}` : z.nombre }))
      .sort((a, b) => a.rotulo.localeCompare(b.rotulo, 'es')),
  );
  // Si se cambia de sitio y la zona elegida no es de ese sitio, la zona vuelve a «todas»; y si el sitio elegido ya no está en el
  // inventario (se recargó al reconectar), el sitio también: un filtro sin su control a la vista ocultaría filas sin aviso.
  // Solo con el inventario cargado: antes, la lista de sitios está vacía y borraría el sitio o la zona que trae la URL.
  $effect(() => {
    if (!cargado) return;
    if (filtroSitio !== '' && !sitios.some((s) => s.codigo === filtroSitio)) filtroSitio = '';
    if (filtroZona !== '' && !zonas.some((z) => z.id === filtroZona)) filtroZona = '';
    if (filtroVia !== '' && !vias.includes(filtroVia)) filtroVia = ''; // una vía que no está en el inventario (URL ajena) tampoco se queda sin su control a la vista
  });
  // Los filtros van a la URL con replaceState (App.svelte), una vez cargado (y depurado) el inventario.
  $effect(() => {
    const f = { estado: filtroEstado, sitio: filtroSitio, zona: filtroZona, via: filtroVia, q: busqueda };
    if (!cargado) return;
    untrack(() => alCambiarVista(fragmentoInventario(f))); // sin depender de las props (vienen de la URL); ver Ficha.svelte
  });
  // La URL cambió desde fuera (atrás, un enlace): se reaplica; si es la que escribió esta pantalla, no cambia nada.
  $effect(() => {
    const f = filtros;
    untrack(() => {
      if (filtroEstado !== f.estado) filtroEstado = f.estado;
      if (filtroSitio !== f.sitio) filtroSitio = f.sitio;
      if (filtroZona !== f.zona) filtroZona = f.zona;
      if (filtroVia !== f.via) filtroVia = f.via;
      if (busqueda !== f.q) busqueda = f.q;
    });
  });
  // Reloj de pasarela desviado (punto 4): la condición abierta de cada dispositivo, para decirlo en palabras en su fila.
  const relojPorDispositivo = $derived(new Map(abiertas.filter((c) => c.tipo === 'reloj_desviado').map((c) => [c.dispositivo_id, c])));
  const vias = $derived([...new Set(dispositivos.map((d) => d.via))].sort());
  const visibles = $derived(
    filas.filter((f) => {
      if (filtroEstado !== null && f.estado !== filtroEstado) return false;
      if (filtroSitio !== '' && f.d.sitio_codigo !== filtroSitio) return false;
      if (filtroZona !== '' && f.d.zona_id !== filtroZona) return false;
      if (filtroVia !== '' && f.d.via !== filtroVia) return false;
      const q = busqueda.trim().toLowerCase();
      return q === '' || f.d.nombre.toLowerCase().includes(q) || f.d.id_fisico.toLowerCase().includes(q);
    }),
  );

  async function cargar(): Promise<void> {
    try {
      const [d, c] = await Promise.all([
        obtener<DispositivoInventario[]>('/dispositivos'),
        obtener<Condicion[]>(URL_ABIERTAS),
      ]);
      dispositivos = d;
      abiertas = c;
      error = null;
    } catch (e) {
      error = mensajeError(e);
    } finally {
      cargado = true;
    }
  }

  // Qué hace cada evento del canal (docs/19 F3): `visto` mueve «hace cuánto» y recalcula en línea; `condicion` repide solo
  // las condiciones abiertas (una consulta chica), nunca el inventario entero; `medicion` no cambia esta pantalla.
  // Las condiciones se repiden con antirrebote: muchos avisos seguidos → una consulta por segundo, nunca dos en vuelo.
  const repedirAbiertas = antirrebote(() =>
    obtener<Condicion[]>(URL_ABIERTAS)
      .then((c) => (abiertas = c))
      .catch(() => undefined),
  );
  // Los «visto» llegan con cada trama: se aplican por lotes (un recorrido del inventario cada 250 ms como mucho).
  const vistos = porLotes<{ id: string; tiempo: string }>((lote) => {
    const ultimo = new Map(lote.map((v) => [v.id, v.tiempo]));
    dispositivos = dispositivos.map((d) => (ultimo.has(d.id) ? { ...d, visto_por_ultima_vez: ultimo.get(d.id)! } : d));
  });
  function alEvento(e: EventoVivo): void {
    if (e.tipo === 'visto') {
      vistos.agregar({ id: e.dispositivo_id, tiempo: e.tiempo });
    } else if (e.tipo === 'condicion') {
      repedirAbiertas.pedir();
    }
  }

  onMount(() => {
    void cargar();
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    // Al volver de una reconexión se repide todo (docs/19 F4): el canal no guarda cola y pudo perder visto o condicion.
    const c = abrirCanal('/eventos', alEvento, (estado, motivo) => {
      if (estado === 'en_vivo' && motivo === RECONECTADO) void cargar();
      canal = estado;
      motivoCanal = estado === 'en_vivo' ? undefined : motivo;
    });
    return () => {
      clearInterval(reloj);
      repedirAbiertas.cancelar();
      vistos.cancelar();
      c.cerrar();
    };
  });

  function alternarFiltro(e: EstadoVisual): void {
    filtroEstado = filtroEstado === e ? null : e;
  }
</script>

<h2>Inventario</h2>
<p class="vivo {canal}" data-canal={canal}>
  en vivo: {canal === 'en_vivo' ? 'conectado' : canal === 'conectando' ? 'conectando…' : `reconectando (${motivoCanal ?? ''})`}
</p>

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
  {#if variosSitios}
    <label>Sitio <select bind:value={filtroSitio}><option value="">todos</option>{#each sitios as s (s.codigo)}<option value={s.codigo}>{rotuloSitio(s.codigo, s.nombre)}</option>{/each}</select></label>
  {/if}
  <label>Zona <select bind:value={filtroZona}><option value="">todas</option>{#each zonas as z (z.id)}<option value={z.id}>{z.rotulo}</option>{/each}</select></label>
  <label>Vía <select bind:value={filtroVia}><option value="">todas</option>{#each vias as v (v)}<option value={v}>{v}</option>{/each}</select></label>
  <label>Buscar <input type="search" bind:value={busqueda} placeholder="nombre o identificador" /></label>
  <span data-visibles>{visibles.length} de {filas.length}</span>
</div>

{#if abiertas.length >= LIMITE_ABIERTAS}
  <p class="error" role="status">Hay {LIMITE_ABIERTAS} condiciones abiertas o más: el semáforo puede quedar incompleto para algunos dispositivos. Revisa la lista de condiciones.</p>
{/if}
{#if error !== null}
  <p class="error" role="alert">{error}</p>
{:else if !cargado}
  <p class="vacio">Cargando…</p>
{:else if filas.length === 0}
  <p class="vacio">Sin dispositivos registrados. El alta se hace por la API (docs/10 §8.4, punto 25); el primero aparecerá aquí al registrarse.</p>
{:else if visibles.length === 0}
  <p class="vacio">Ningún dispositivo coincide con el filtro.</p>
{:else}
  <div class="tabla">
    <table>
      <thead>
        <tr>
          <th scope="col">Estado</th><th scope="col">Nombre</th><th scope="col">Identificador</th><th scope="col">Vía</th>
          {#if variosSitios}<th scope="col">Sitio</th>{/if}<th scope="col">Zona</th><th scope="col">Última trama</th><th scope="col">Condiciones abiertas</th>
        </tr>
      </thead>
      <tbody>
        {#each visibles as f (f.d.id)}
          <tr data-estado={f.estado} data-id={f.d.id}>
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
          </tr>
        {/each}
      </tbody>
    </table>
  </div>
{/if}
