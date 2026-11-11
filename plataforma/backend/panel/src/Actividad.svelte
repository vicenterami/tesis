<script lang="ts">
  // P14 Actividad (docs/19 §4, tablero v2, G2; RF-46, HU-11, HU-26): lo que hicieron las personas en un sitio y sus entradas, salidas y
  // bloqueos, en texto para personas, por cursor (`X-Siguiente`, «Más antiguos»), con filtros por persona, tipo y rango que viven en la
  // URL. Solo para quien administra el sitio: el servidor decide (403/404 a los demás) y App oculta el menú según `GET /sesion`. Bajo
  // 700 px, tarjetas en vez de tabla (A5).
  import { onMount, untrack } from 'svelte';
  import Boton from './Boton.svelte';
  import { esCancelacion, obtener, obtenerPagina, ultimaGana } from './lib/api';
  import { avisoDeError } from './lib/avisos';
  import { rotuloTipoActividad, urlActividad, type FilaActividad } from './lib/actividad';
  import { seguirAngosto } from './lib/medios';
  import type { Sitio } from './lib/modelo';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { fechaHora, horaLocal, instanteDesdeLocal, localDesdeInstante } from './lib/tiempo';
  import { fragmentoActividad, fragmentoFicha, type FiltrosActividad } from './lib/vista';

  let {
    filtros,
    sesion = null,
    sitios = null,
    alCambiarVista = () => {},
  }: { filtros: FiltrosActividad; sesion?: Sesion | null; sitios?: Sitio[] | null; alCambiarVista?: (f: string) => void } = $props();
  const uid = $props.id();

  // Los sitios donde la matriz del servidor le da «auditoria» (administrador de sitio; el del sistema, en todos).
  const misSitios = $derived((sitios ?? []).filter((s) => sesion?.administrador_sistema === true || puedeEn(sesion, 'auditoria', s.codigo)));
  const sitio = $derived(misSitios.find((s) => s.codigo === filtros.sitio) ?? misSitios[0] ?? null);
  const zona = $derived(sitio?.zona_horaria ?? 'UTC');

  let filas = $state<FilaActividad[]>([]);
  let siguiente = $state<string | null>(null);
  let cargando = $state(false);
  let cargado = $state(false);
  let error = $state<string | null>(null);
  let angosto = $state(false);
  let personas = $state<{ id: string; nombre: string }[]>([]);
  // Los tipos vistos (el filtro ofrece los que aparecieron más el elegido): el servidor admite el código; aquí no se inventa un catálogo.
  let tiposVistos = $state<string[]>([]);
  const carga = ultimaGana();

  async function cargar(desdeElPrincipio: boolean): Promise<void> {
    if (sitio === null) return;
    cargando = true;
    try {
      const p = await obtenerPagina<FilaActividad>(urlActividad(sitio.id, filtros, desdeElPrincipio ? null : siguiente), carga.senal());
      filas = desdeElPrincipio ? p.filas : [...filas, ...p.filas];
      siguiente = p.siguiente;
      tiposVistos = [...new Set([...tiposVistos, ...p.filas.map((f) => f.tipo)])].sort();
      error = null;
      cargado = true;
    } catch (e) {
      if (esCancelacion(e)) return;
      error = avisoDeError(e).texto;
    } finally {
      cargando = false;
    }
  }
  // Otro filtro u otro sitio: desde el principio.
  $effect(() => {
    void JSON.stringify([sitio?.id, filtros.tipo, filtros.usuario, filtros.fija?.desde.getTime(), filtros.fija?.hasta.getTime()]);
    untrack(() => void cargar(true));
  });
  // Las personas del filtro: las de la pantalla de usuarios (quien administra puede listarlas).
  $effect(() => {
    if (sitio === null) return;
    const id = sitio.id;
    untrack(() => {
      void obtener<{ id: string; nombre: string; sitios: { sitio_id: string }[] }[]>('/usuarios')
        .then((l) => (personas = l.filter((u) => u.sitios.some((s) => s.sitio_id === id)).map((u) => ({ id: u.id, nombre: u.nombre }))))
        .catch(() => (personas = []));
    });
  });
  onMount(() => {
    const dejar = seguirAngosto((x) => (angosto = x));
    return () => {
      dejar();
      carga.cancelar();
    };
  });

  const cambiar = (c: Partial<FiltrosActividad>): void => alCambiarVista(fragmentoActividad({ ...filtros, sitio: sitio?.codigo ?? '', ...c }));
  let desdeTexto = $state('');
  let hastaTexto = $state('');
  $effect(() => {
    const f = filtros.fija;
    const z = zona;
    untrack(() => {
      desdeTexto = f === null ? '' : localDesdeInstante(f.desde, z);
      hastaTexto = f === null ? '' : localDesdeInstante(f.hasta, z);
    });
  });
  const ventanaPedida = $derived.by(() => {
    if (desdeTexto === '' && hastaTexto === '') return { fija: null, motivo: null };
    const d = instanteDesdeLocal(desdeTexto, zona);
    const h = instanteDesdeLocal(hastaTexto, zona);
    if (d === null || h === null) return { fija: null, motivo: 'faltan las dos fechas' };
    if (h.getTime() <= d.getTime()) return { fija: null, motivo: '«hasta» debe ser después de «desde»' };
    return { fija: { desde: d, hasta: h }, motivo: null };
  });
  const quien = (f: FilaActividad): string => f.usuario?.nombre ?? (f.clase === 'evento' ? 'el sistema' : 'persona sin nombre');
</script>

<div class="actividad" data-actividad>
  <h2>Actividad</h2>
  {#if sitios !== null && misSitios.length === 0}
    <p class="vacio" data-sin-actividad>La actividad la ve quien administra un sitio: tu perfil no administra ninguno. <a href="#/">Volver al tablero</a></p>
  {:else if sitio !== null}
    <form class="filtros" onsubmit={(e) => e.preventDefault()} data-filtros-actividad>
      {#if misSitios.length > 1}
        <label>Sitio <select value={sitio.codigo} onchange={(e) => cambiar({ sitio: e.currentTarget.value, usuario: '' })} data-filtro-sitio>
          {#each misSitios as s (s.id)}<option value={s.codigo}>{s.nombre}</option>{/each}
        </select></label>
      {/if}
      <label>Persona <select value={filtros.usuario} onchange={(e) => cambiar({ usuario: e.currentTarget.value })} data-filtro-persona>
        <option value="">todas</option>
        {#each personas as u (u.id)}<option value={u.id}>{u.nombre}</option>{/each}
      </select></label>
      <label>Tipo <select value={filtros.tipo} onchange={(e) => cambiar({ tipo: e.currentTarget.value })} data-filtro-tipo>
        <option value="">todos</option>
        {#each [...new Set([...tiposVistos, ...(filtros.tipo === '' ? [] : [filtros.tipo])])] as t (t)}<option value={t}>{rotuloTipoActividad(t)}</option>{/each}
      </select></label>
      <label>Desde <input type="datetime-local" bind:value={desdeTexto} data-filtro-desde /></label>
      <label>Hasta <input type="datetime-local" bind:value={hastaTexto} data-filtro-hasta /></label>
      <Boton etiqueta="Aplicar el rango" motivoDesactivado={ventanaPedida.motivo} onclick={() => cambiar({ fija: ventanaPedida.fija })} data-aplicar-rango />
      {#if filtros.fija !== null || filtros.tipo !== '' || filtros.usuario !== ''}<Boton etiqueta="Quitar los filtros" variante="discreto" onclick={() => cambiar({ tipo: '', usuario: '', fija: null })} />{/if}
      <span class="vivo" id="{uid}-zona">Horas en la zona del sitio ({zona}).</span>
    </form>

    {#if error !== null}
      <p class="error" role="alert" data-error-actividad>{error} <Boton etiqueta="Reintentar" onclick={() => void cargar(true)} /></p>
    {:else if !cargado}
      <p class="vacio">Cargando…</p>
    {:else if filas.length === 0}
      <p class="vacio" data-actividad-vacia>Nada en {filtros.fija === null && filtros.tipo === '' && filtros.usuario === '' ? 'este sitio todavía' : 'este filtro'}: aquí aparecen las altas, los cambios de configuración y las entradas y salidas de las personas.</p>
    {:else if angosto}
      <ul class="lista-actividad" data-tarjetas-actividad>
        {#each filas as f, i (`${f.instante}-${i}`)}
          <li data-fila-actividad>
            <strong>{quien(f)}</strong> {f.texto}<br />
            <span class="vivo" title={horaLocal(f.instante, zona)}>{fechaHora(f.instante, zona)}</span>
            {#if f.dispositivo !== null} · <a href={fragmentoFicha(f.dispositivo.id, null, '24h')}>{f.dispositivo.nombre}</a>{/if}
          </li>
        {/each}
      </ul>
    {:else}
      <div class="tabla">
        <table data-tabla-actividad>
          <thead><tr><th scope="col">Cuándo</th><th scope="col">Quién</th><th scope="col">Qué</th><th scope="col">Dispositivo</th></tr></thead>
          <tbody>
            {#each filas as f, i (`${f.instante}-${i}`)}
              <tr data-fila-actividad>
                <td title={horaLocal(f.instante, zona)}>{fechaHora(f.instante, zona)}</td>
                <td>{quien(f)}</td>
                <td>{f.texto}</td>
                <td>{#if f.dispositivo !== null}<a href={fragmentoFicha(f.dispositivo.id, null, '24h')}>{f.dispositivo.nombre}</a>{/if}</td>
              </tr>
            {/each}
          </tbody>
        </table>
      </div>
    {/if}
    {#if siguiente !== null && error === null}
      <Boton etiqueta="Más antiguos" etiquetaCargando="Cargando…" cargando={cargando} onclick={() => void cargar(false)} data-actividad-mas />
    {/if}
  {:else}
    <p class="vacio">Cargando tus sitios…</p>
  {/if}
</div>
