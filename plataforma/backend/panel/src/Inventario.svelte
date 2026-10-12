<script lang="ts">
  // Pantalla P2 (docs/19 §4): inventario con semáforo (HU-19) y filtros (HU-20). Datos: GET /dispositivos y
  // GET /condiciones?abiertas=true; se actualiza con el canal en vivo sin repedir el inventario.
  import { onMount } from 'svelte';
  import { ErrorApi, obtener } from './lib/api';
  import { compararAtencion, conteoPorEstado, enLinea, estadoVisual, ORDEN_ATENCION, ROTULO, type EstadoVisual } from './lib/estado-visual';
  import type { Condicion, DispositivoInventario, EventoVivo, TipoCondicion } from './lib/modelo';
  import { haceCuanto, horaLocal } from './lib/tiempo';
  import { abrirCanal, type EstadoCanal } from './lib/vivo';

  let dispositivos = $state<DispositivoInventario[]>([]);
  let abiertas = $state<Condicion[]>([]);
  let cargado = $state(false);
  let error = $state<string | null>(null);
  let ahora = $state(new Date());
  let canal = $state<EstadoCanal>('conectando');
  let motivoCanal = $state<string | undefined>(undefined);
  let filtroEstado = $state<EstadoVisual | null>(null);
  let filtroZona = $state('');
  let filtroVia = $state('');
  let busqueda = $state('');

  const tiposPorDispositivo = $derived.by(() => {
    const m = new Map<string, TipoCondicion[]>();
    for (const c of abiertas) m.set(c.dispositivo_id, [...(m.get(c.dispositivo_id) ?? []), c.tipo]);
    return m;
  });
  const filas = $derived(
    dispositivos
      .map((d) => ({
        d,
        enLinea: enLinea(d.visto_por_ultima_vez, d.intervalo_esperado_s, ahora),
        tipos: tiposPorDispositivo.get(d.id) ?? [],
      }))
      .map((f) => ({ ...f, estado: estadoVisual({ estado: f.d.estado, en_linea: f.enLinea }, f.tipos), nombre: f.d.nombre }))
      .sort(compararAtencion),
  );
  const conteo = $derived(conteoPorEstado(filas.map((f) => f.estado)));
  const zonas = $derived([...new Set(dispositivos.map((d) => d.zona))].sort());
  const vias = $derived([...new Set(dispositivos.map((d) => d.via))].sort());
  const visibles = $derived(
    filas.filter((f) => {
      if (filtroEstado !== null && f.estado !== filtroEstado) return false;
      if (filtroZona !== '' && f.d.zona !== filtroZona) return false;
      if (filtroVia !== '' && f.d.via !== filtroVia) return false;
      const q = busqueda.trim().toLowerCase();
      return q === '' || f.d.nombre.toLowerCase().includes(q) || f.d.id_fisico.toLowerCase().includes(q);
    }),
  );

  async function cargar(): Promise<void> {
    try {
      const [d, c] = await Promise.all([
        obtener<DispositivoInventario[]>('/dispositivos'),
        obtener<Condicion[]>('/condiciones?abiertas=true&limite=500'),
      ]);
      dispositivos = d;
      abiertas = c;
      error = null;
    } catch (e) {
      error = e instanceof ErrorApi ? `${e.message}: ${e.accion}` : 'sin conexión con el servicio; se reintenta al recargar';
    } finally {
      cargado = true;
    }
  }

  // Qué hace cada evento del canal (docs/19 F3): `visto` mueve «hace cuánto» y recalcula en línea; `condicion` repide solo
  // las condiciones abiertas (una consulta chica), nunca el inventario entero; `medicion` no cambia esta pantalla.
  function alEvento(e: EventoVivo): void {
    if (e.tipo === 'visto') {
      dispositivos = dispositivos.map((d) => (d.id === e.dispositivo_id ? { ...d, visto_por_ultima_vez: e.tiempo } : d));
    } else if (e.tipo === 'condicion') {
      void obtener<Condicion[]>('/condiciones?abiertas=true&limite=500')
        .then((c) => (abiertas = c))
        .catch(() => undefined);
    }
  }

  onMount(() => {
    void cargar();
    const reloj = setInterval(() => (ahora = new Date()), 10_000);
    // Al volver de una reconexión se repide todo (docs/19 F4): el canal no guarda cola y pudo perder visto o condicion.
    const c = abrirCanal('/eventos', alEvento, (estado, motivo) => {
      if (canal === 'reconectando' && estado === 'en_vivo') void cargar();
      canal = estado;
      motivoCanal = motivo;
    });
    return () => {
      clearInterval(reloj);
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
  <label>Zona <select bind:value={filtroZona}><option value="">todas</option>{#each zonas as z (z)}<option value={z}>{z}</option>{/each}</select></label>
  <label>Vía <select bind:value={filtroVia}><option value="">todas</option>{#each vias as v (v)}<option value={v}>{v}</option>{/each}</select></label>
  <label>Buscar <input type="search" bind:value={busqueda} placeholder="nombre o identificador" /></label>
  <span data-visibles>{visibles.length} de {filas.length}</span>
</div>

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
          <th scope="col">Zona</th><th scope="col">Última trama</th><th scope="col">Condiciones abiertas</th>
        </tr>
      </thead>
      <tbody>
        {#each visibles as f (f.d.id)}
          <tr data-estado={f.estado} data-id={f.d.id}>
            <td><span class="estado {f.estado}">{ROTULO[f.estado]}</span></td>
            <td><a href={`#/dispositivos/${f.d.id}`}>{f.d.nombre}</a></td>
            <td><code>{f.d.id_fisico}</code></td>
            <td>{f.d.via}</td>
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
