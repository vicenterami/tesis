<script lang="ts">
  // P6 Configurar (docs/19 §4, tablero v2, E; flujo F2; HU-06, HU-13, RF-14): el dispositivo (nombre, estado, intervalo esperado, zona
  // dentro del sitio) y, por canal, la etiqueta y sus reglas (umbral alto, bajo, histéresis y retardo de activación). Reglas de la pantalla:
  //  - validación en vivo con la MISMA función que arma el cuerpo (lib/configurar.ts, espejo de la del servidor), el error junto al campo;
  //  - bloqueo optimista: cada guardado lleva el `actualizado_en` leído; un 409 dice «alguien lo cambió a las HH:MM: recarga» con el
  //    botón «Recargar» y no pisa nada (lo escrito queda en el formulario hasta recargar);
  //  - nunca optimista en pantalla: lo guardado se muestra cuando el servidor responde, con el botón en «Guardando…»;
  //  - «Agregar una magnitud» (docs/19 §4 AA, punto 3): un canal más del catálogo, sin tocar lo que se edita en los demás canales;
  //  - los umbrales se escriben en la unidad en que se guardan (la del catálogo, escrita al lado): convertirlos a la preferencia de la
  //    persona sumaría un redondeo a cada guardado (decidido al implementar, 11/11/2026).
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import TramaSinGuardar from './TramaSinGuardar.svelte';
  import { ErrorApi, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    ESTADOS_CONFIGURABLES, MAX_REGLAS, REGLA_NUEVA, reglaSugerida, cuerpoDispositivo, cuerpoReglas, erroresDeDispositivo, erroresPorCampo, formularioDe,
    horaDelConflicto, motivoDe, reglasDe, validarReglas, type ErrorCampo, type FormularioDispositivo, type ReglaFormulario,
  } from './lib/configurar';
  import type { CanalFicha, DispositivoFicha, ReglaUmbral, Sitio } from './lib/modelo';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { simbolo } from './lib/unidades';
  import { fragmentoFicha } from './lib/vista';
  import { textoSugerido, type Magnitud } from './lib/catalogo';

  let { id, sesion = null, sitios = null }: { id: string; sesion?: Sesion | null; sitios?: Sitio[] | null } = $props();
  const uid = $props.id();

  let d = $state<DispositivoFicha | null>(null);
  let error = $state<string | null>(null);
  let form = $state<FormularioDispositivo>({ nombre: '', estado: 'activo', intervalo: '', zona_id: '' });
  let erroresServidor = $state<ErrorCampo[]>([]);
  let guardando = $state(false);
  let aviso = $state<DatosAviso | null>(null);
  // Por canal: la etiqueta y las reglas que se editan, los errores del servidor y el aviso propio.
  let canales = $state<Record<string, { etiqueta: string; reglas: ReglaFormulario[]; servidor: ErrorCampo[]; guardando: boolean; aviso: DatosAviso | null }>>({});
  const carga = ultimaGana();
  // El catálogo de magnitudes, solo para «Usar el sugerido» (docs/19 §4, T, punto 8): cualquier sesión puede leerlo; si falla, el botón no aparece.
  let catalogo = $state<Magnitud[]>([]);
  const cargaCatalogo = ultimaGana();
  const sugeridaDe = (magnitud: string): Magnitud | null => {
    const m = catalogo.find((x) => x.codigo === magnitud);
    return m !== undefined && reglaSugerida(m) !== null ? m : null;
  };

  async function cargar(): Promise<void> {
    try {
      const x = await obtener<DispositivoFicha>(`/dispositivos/${encodeURIComponent(id)}`, carga.senal());
      d = x;
      error = null;
      form = formularioDe(x);
      erroresServidor = [];
      canales = Object.fromEntries(x.canales.map((c) => [c.id, { etiqueta: c.etiqueta ?? '', reglas: reglasDe(c), servidor: [], guardando: false, aviso: null }]));
    } catch (e) {
      if (esCancelacion(e)) return;
      error = avisoDeError(e).texto;
    }
  }
  onMount(() => {
    void cargar();
    obtener<Magnitud[]>('/magnitudes', cargaCatalogo.senal()).then((m) => (catalogo = m), () => undefined);
    return () => { carga.cancelar(); cargaCatalogo.cancelar(); };
  });

  // Una zona retirada no recibe dispositivos (migración 28); la actual se sigue mostrando aunque lo esté.
  const zonas = $derived((sitios?.find((s) => s.codigo === d?.sitio_codigo)?.zonas ?? (d === null ? [] : [{ id: d.zona_id, nombre: d.zona }]))
    .filter((z) => z.activo !== false || z.id === d?.zona_id));
  const motivoPermiso = $derived(d === null || puedeEn(sesion, 'configurar', d.sitio_codigo) ? null : 'configurar exige el perfil de operador técnico o de administrador en este sitio');
  const erroresVivos = $derived(erroresDeDispositivo(form));
  const errores = $derived([...erroresVivos, ...erroresServidor]);
  const cuerpo = $derived(d === null || d.actualizado_en === undefined ? null : cuerpoDispositivo(d as DispositivoFicha & { actualizado_en: string }, form));
  const motivoGuardar = $derived(motivoPermiso ?? (d?.estado === 'baja' ? 'está dado de baja: no se configura' : erroresVivos[0] ? `${erroresVivos[0].campo}: ${erroresVivos[0].motivo}` : cuerpo === null ? 'sin cambios' : null));

  // 409 (bloqueo optimista) y 400 (por campo), iguales en las dos partes del formulario.
  function avisoDeGuardado(e: unknown, zona: string): DatosAviso {
    if (e instanceof ErrorApi && e.codigo === 409) {
      const hora = horaDelConflicto(e, zona);
      return { tipo: 'conflicto', texto: `Alguien lo cambió${hora === null ? '' : ` a las ${hora}`} entretanto: recarga para ver el valor nuevo. No se guardó nada de lo tuyo.` };
    }
    return avisoDeError(e);
  }

  async function guardarDispositivo(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    if (d === null || cuerpo === null || motivoGuardar !== null || guardando) return;
    guardando = true;
    aviso = null;
    erroresServidor = [];
    try {
      const x = await pedir<DispositivoFicha>('PATCH', `/dispositivos/${encodeURIComponent(id)}`, { cuerpo });
      // Lo guardado llega del servidor (nunca optimista): la ficha nueva, con su actualizado_en; las reglas en edición no se tocan.
      d = { ...x, canales: d.canales.map((c) => x.canales.find((k) => k.id === c.id) ?? c) };
      form = formularioDe(x);
      aviso = { tipo: 'exito', texto: 'Dispositivo guardado.' };
    } catch (e) {
      erroresServidor = erroresPorCampo(e);
      aviso = avisoDeGuardado(e, d.zona_horaria);
    } finally {
      guardando = false;
    }
  }

  function validacionCanal(c: CanalFicha) {
    const k = canales[c.id];
    return k === undefined ? { errores: [] as ErrorCampo[] } : validarReglas(k.etiqueta, k.reglas);
  }
  async function guardarReglas(c: CanalFicha): Promise<void> {
    const k = canales[c.id];
    if (k === undefined || d === null || c.actualizado_en === undefined || k.guardando) return;
    const { cuerpo: cr, errores: ec } = cuerpoReglas(c.actualizado_en, k.etiqueta, k.reglas);
    if (cr === null || ec.length > 0) return;
    k.guardando = true;
    k.aviso = null;
    k.servidor = [];
    try {
      const r = await pedir<{ id: string; etiqueta: string | null; actualizado_en: string; reglas: ReglaUmbral[] }>('PUT', `/canales/${encodeURIComponent(c.id)}/reglas`, { cuerpo: cr });
      // Las reglas vigentes que devuelve el servidor, con sus ids: la próxima edición las empareja por id.
      d = { ...d, canales: d.canales.map((x) => (x.id === c.id ? { ...x, etiqueta: r.etiqueta, reglas: r.reglas, actualizado_en: r.actualizado_en } : x)) };
      const nuevo = d.canales.find((x) => x.id === c.id)!;
      canales[c.id] = { etiqueta: nuevo.etiqueta ?? '', reglas: reglasDe(nuevo), servidor: [], guardando: false, aviso: { tipo: 'exito', texto: 'Reglas guardadas: rigen desde la próxima trama.' } };
    } catch (e) {
      k.servidor = erroresPorCampo(e);
      k.aviso = avisoDeGuardado(e, d.zona_horaria);
      k.guardando = false;
    }
  }
  const quitarRegla = (cid: string, i: number): void => {
    canales[cid]!.reglas = canales[cid]!.reglas.filter((_, j) => j !== i);
  };
  const agregarRegla = (cid: string): void => {
    canales[cid]!.reglas = [...canales[cid]!.reglas, { ...REGLA_NUEVA }];
  };
  const usarSugerido = (cid: string, m: Magnitud): void => {
    const r = reglaSugerida(m);
    if (r !== null) canales[cid]!.reglas = [...canales[cid]!.reglas, r];
  };
  // «Agregar una magnitud» (docs/19 §4 AA, punto 3; acción `escribir`): las del catálogo que el equipo aún no tiene. Lo guardado llega del
  // servidor; la ficha se relee y solo se suman los canales nuevos al formulario (lo que se edita en los demás no se pierde).
  let nuevaMagnitud = $state('');
  let agregando = $state(false);
  let avisoMagnitud = $state<DatosAviso | null>(null);
  const disponibles = $derived(d === null ? [] : catalogo.filter((m) => !d!.canales.some((c) => c.magnitud === m.codigo)));
  const motivoEscribir = $derived(d === null || puedeEn(sesion, 'escribir', d.sitio_codigo) ? null : 'agregar una magnitud exige el perfil de operador técnico o de administrador en este sitio');
  const motivoAgregar = $derived(motivoEscribir ?? (d?.estado === 'baja' ? 'está dado de baja' : nuevaMagnitud === '' ? 'elige la magnitud' : null));
  // Relee la ficha y suma solo los canales nuevos al formulario (también tras «Agregar» desde «Lo que la trama trae y no se guarda»).
  // Con su propia señal (corrección del 25/11/2026): con `carga.senal()` cancelaba una carga principal en vuelo, y su falla no es la del POST.
  async function sumarCanalesNuevos(): Promise<void> {
    const x = await obtener<DispositivoFicha>(`/dispositivos/${encodeURIComponent(id)}`, new AbortController().signal);
    if (d === null) return;
    for (const c of x.canales) if (canales[c.id] === undefined) canales[c.id] = { etiqueta: c.etiqueta ?? '', reglas: reglasDe(c), servidor: [], guardando: false, aviso: null };
    d = { ...d, canales: x.canales.map((c) => d!.canales.find((k) => k.id === c.id) ?? c) };
  }
  const administraCatalogo = $derived(sesion !== null && (sesion.sistema || sesion.administrador_sistema === true));
  async function agregarMagnitud(ev: SubmitEvent): Promise<void> {
    ev.preventDefault();
    if (d === null || agregando || motivoAgregar !== null) return;
    agregando = true;
    avisoMagnitud = null;
    const magnitud = nuevaMagnitud;
    let r: { agregada: boolean };
    try {
      r = await pedir<{ agregada: boolean }>('POST', `/dispositivos/${encodeURIComponent(id)}/canales`, { cuerpo: { magnitud } });
    } catch (e) {
      if (!esCancelacion(e)) avisoMagnitud = avisoDeError(e);
      agregando = false;
      return;
    }
    // El canal ya quedó (o ya estaba): lo que falle después es la relectura, y se dice como tal (no invita a reintentar el POST).
    const nombre = catalogo.find((m) => m.codigo === magnitud)?.nombre ?? magnitud;
    const hecho = r.agregada ? `${nombre}: agregada. Se guarda desde la próxima trama; lo que llegó antes no se rellena.` : `${nombre}: el equipo ya la tenía.`;
    nuevaMagnitud = '';
    try {
      await sumarCanalesNuevos();
      avisoMagnitud = { tipo: r.agregada ? 'exito' : 'info', texto: hecho };
    } catch {
      avisoMagnitud = { tipo: 'info', texto: `${hecho} No se pudo releer el equipo: recarga la pantalla para ver su editor de reglas.` };
    } finally {
      agregando = false;
    }
  }

  const recargar = (): void => {
    aviso = null;
    void cargar();
  };
</script>

{#if error !== null}
  <p class="error" role="alert" data-error-configurar>No se pudo leer el dispositivo: {error} <Boton etiqueta="Reintentar" onclick={() => void cargar()} /></p>
{:else if d === null}
  <p class="vacio">Cargando…</p>
{:else}
  {@const dd = d}
  <div class="configurar" data-configurar>
    <h2>Configurar: {dd.nombre}</h2>
    <p><a href={fragmentoFicha(dd.id, null, '24h')} data-volver-ficha>Volver a la ficha</a></p>
    {#if motivoPermiso !== null}<p class="vivo" data-sin-permiso>{motivoPermiso}: puedes ver la configuración, no cambiarla.</p>{/if}
    {#if aviso !== null}
      <Aviso tipo={aviso.tipo} texto={aviso.texto} accion={aviso.tipo === 'conflicto' ? { etiqueta: 'Recargar', alHacer: recargar } : undefined} alCerrar={() => (aviso = null)} />
    {/if}

    <section class="panel-seccion" aria-labelledby="{uid}-titulo-disp">
      <h3 id="{uid}-titulo-disp">Dispositivo</h3>
      <form class="formulario-configurar" onsubmit={guardarDispositivo} novalidate data-form-dispositivo>
        <div class="campo">
          <label for="{uid}-nombre">Nombre</label>
          <input id="{uid}-nombre" type="text" maxlength="80" bind:value={form.nombre} aria-invalid={motivoDe(errores, 'nombre') !== null} aria-describedby="{uid}-nombre-error" data-campo="nombre" />
          <span class="error-campo" id="{uid}-nombre-error" data-error-campo="nombre">{motivoDe(errores, 'nombre') ?? ''}</span>
        </div>
        <div class="campo">
          <label for="{uid}-estado">Estado</label>
          <select id="{uid}-estado" bind:value={form.estado} aria-describedby="{uid}-estado-ayuda" data-campo="estado">
            {#each ESTADOS_CONFIGURABLES as e (e)}<option value={e}>{e === 'activo' ? 'Activo' : 'En mantenimiento'}</option>{/each}
          </select>
          <span class="ayuda-campo" id="{uid}-estado-ayuda">En mantenimiento no genera alertas ni se espera de él (RF-22); la baja es otra acción.</span>
        </div>
        <div class="campo">
          <label for="{uid}-intervalo">Intervalo esperado (segundos)</label>
          <input id="{uid}-intervalo" type="text" inputmode="numeric" bind:value={form.intervalo} aria-invalid={motivoDe(errores, 'intervalo_esperado_s') !== null}
            aria-describedby="{uid}-intervalo-ayuda {uid}-intervalo-error" data-campo="intervalo" />
          <span class="ayuda-campo" id="{uid}-intervalo-ayuda">Cada cuánto debe reportar; sin trama en dos intervalos, pasa a «Sin señal».</span>
          <span class="error-campo" id="{uid}-intervalo-error" data-error-campo="intervalo_esperado_s">{motivoDe(errores, 'intervalo_esperado_s') ?? ''}</span>
        </div>
        <div class="campo">
          <label for="{uid}-zona">Zona</label>
          <select id="{uid}-zona" bind:value={form.zona_id} aria-describedby="{uid}-zona-ayuda {uid}-zona-error" data-campo="zona">
            {#each zonas as z (z.id)}<option value={z.id}>{z.nombre}</option>{/each}
          </select>
          <span class="ayuda-campo" id="{uid}-zona-ayuda">Solo zonas de su mismo sitio ({dd.sitio}).</span>
          <span class="error-campo" id="{uid}-zona-error" data-error-campo="zona_id">{motivoDe(errores, 'zona_id') ?? ''}</span>
        </div>
        <Boton tipo="submit" variante="principal" etiqueta="Guardar el dispositivo" etiquetaCargando="Guardando…" cargando={guardando}
          motivoDesactivado={guardando ? null : motivoGuardar} data-guardar-dispositivo />
      </form>
    </section>

    <section class="panel-seccion" aria-labelledby="{uid}-titulo-magnitudes" data-magnitudes-equipo>
      <h3 id="{uid}-titulo-magnitudes">Magnitudes que guarda</h3>
      <p class="vivo" data-magnitudes-actuales>{dd.canales.map((c) => c.magnitud_nombre).join(', ')}.</p>
      {#if avisoMagnitud !== null}<Aviso tipo={avisoMagnitud.tipo} texto={avisoMagnitud.texto} alCerrar={() => (avisoMagnitud = null)} />{/if}
      {#if disponibles.length > 0}
        <form class="formulario-configurar" onsubmit={agregarMagnitud} novalidate data-form-magnitud>
          <div class="campo">
            <label for="{uid}-nueva-magnitud">Magnitud del catálogo</label>
            <select id="{uid}-nueva-magnitud" bind:value={nuevaMagnitud} aria-describedby="{uid}-nueva-magnitud-ayuda" data-campo="nueva-magnitud">
              <option value="">Elige una…</option>
              {#each disponibles as m (m.codigo)}<option value={m.codigo}>{m.nombre} ({m.codigo}, {simbolo(m.unidad)})</option>{/each}
            </select>
            <span class="ayuda-campo" id="{uid}-nueva-magnitud-ayuda">En un nodo LoRaWAN, «rssi» y «snr» guardan la señal de cada trama. Lo que llegó antes no se rellena.</span>
          </div>
          <Boton tipo="submit" etiqueta="Agregar una magnitud" etiquetaCargando="Agregando…" cargando={agregando}
            motivoDesactivado={agregando ? null : motivoAgregar} data-agregar-magnitud />
        </form>
      {:else if catalogo.length > 0}
        <p class="vivo" data-sin-disponibles>Ya guarda todas las magnitudes del catálogo.</p>
      {/if}
    </section>
    <TramaSinGuardar dispositivoId={dd.id} sitioCodigo={dd.sitio_codigo} {sesion} {administraCatalogo} alAgregar={() => void sumarCanalesNuevos().catch(() => undefined)} />

    {#each dd.canales as c (c.id)}
      {@const k = canales[c.id]}
      {#if k !== undefined}
        {@const v = validacionCanal(c)}
        {@const errs = [...v.errores, ...k.servidor]}
        {@const u = simbolo(c.unidad)}
        <section class="panel-seccion" aria-labelledby="{uid}-canal-{c.id}" data-config-canal={c.id}>
          <h3 id="{uid}-canal-{c.id}">{c.magnitud_nombre} <span class="vivo">({u})</span></h3>
          {#if k.aviso !== null}
            <Aviso tipo={k.aviso.tipo} texto={k.aviso.texto} accion={k.aviso.tipo === 'conflicto' ? { etiqueta: 'Recargar', alHacer: recargar } : undefined} alCerrar={() => (k.aviso = null)} />
          {/if}
          <form class="formulario-configurar" onsubmit={(ev) => { ev.preventDefault(); void guardarReglas(c); }} novalidate>
            <div class="campo">
              <label for="{uid}-{c.id}-etiqueta">Etiqueta</label>
              <input id="{uid}-{c.id}-etiqueta" type="text" maxlength="40" bind:value={k.etiqueta} aria-describedby="{uid}-{c.id}-etiqueta-error" data-campo="etiqueta" />
              <span class="error-campo" id="{uid}-{c.id}-etiqueta-error">{motivoDe(errs, 'etiqueta') ?? ''}</span>
            </div>
            {#if k.reglas.length === 0}<p class="vacio" data-sin-reglas>Sin reglas de umbral: este canal no abre condiciones. Agrega una para que avise.</p>{/if}
            {#each k.reglas as r, i (i)}
              <fieldset class="regla" data-regla={i}>
                <legend>Regla {i + 1}{r.id === undefined ? ' (nueva)' : ''}</legend>
                {#each [['umbral_alto', `Umbral alto (${u})`, 'Sobre este valor se abre la condición'], ['umbral_bajo', `Umbral bajo (${u})`, 'Bajo este valor se abre la condición'], ['histeresis', `Histéresis (${u})`, 'Cuánto debe volver dentro de la banda para cerrarla; menos que la mitad de la banda'], ['retardo_s', 'Retardo de activación (segundos)', 'La condición se abre si la medición sigue fuera de la banda al menos este tiempo (0: de inmediato)']] as const as [campo, rotulo, ayuda] (campo)}
                  {@const nombreCampo = `reglas[${i}].${campo}`}
                  <div class="campo">
                    <label for="{uid}-{c.id}-{i}-{campo}">{rotulo}</label>
                    <input id="{uid}-{c.id}-{i}-{campo}" type="text" inputmode="decimal" bind:value={r[campo]} aria-invalid={motivoDe(errs, nombreCampo) !== null}
                      aria-describedby="{uid}-{c.id}-{i}-{campo}-ayuda {uid}-{c.id}-{i}-{campo}-error" data-campo={campo} />
                    <span class="ayuda-campo" id="{uid}-{c.id}-{i}-{campo}-ayuda">{ayuda}</span>
                    <span class="error-campo" id="{uid}-{c.id}-{i}-{campo}-error" data-error-campo={nombreCampo}>{motivoDe(errs, nombreCampo) ?? ''}</span>
                  </div>
                {/each}
                <span class="error-campo" data-error-campo="reglas[{i}]">{motivoDe(errs, `reglas[${i}]`) ?? ''}</span>
                <Boton etiqueta="Quitar esta regla" variante="discreto" onclick={() => quitarRegla(c.id, i)} />
              </fieldset>
            {/each}
            <span class="acciones">
              <Boton etiqueta="Agregar una regla" motivoDesactivado={k.reglas.length >= MAX_REGLAS ? `como mucho ${MAX_REGLAS} reglas por canal` : null} onclick={() => agregarRegla(c.id)} />
              {#if sugeridaDe(c.magnitud) !== null}
                {@const ms = sugeridaDe(c.magnitud)!}
                <Boton etiqueta={`Usar el sugerido (${textoSugerido(ms)})`} motivoDesactivado={k.reglas.length >= MAX_REGLAS ? `el canal ya tiene ${MAX_REGLAS} reglas` : null}
                  ayuda="Llena una regla nueva con el umbral sugerido del catálogo; revísala y guarda" onclick={() => usarSugerido(c.id, ms)} data-usar-sugerido={c.id} />
              {/if}
              <Boton tipo="submit" variante="principal" etiqueta="Guardar las reglas" etiquetaCargando="Guardando…" cargando={k.guardando}
                motivoDesactivado={k.guardando ? null : motivoPermiso ?? (c.actualizado_en === undefined ? 'el servidor no entregó la marca de este canal: recarga' : v.errores[0] ? `${v.errores[0].campo}: ${v.errores[0].motivo}` : null)}
                ayuda="Reemplaza las reglas de este canal; las que quitaste dejan de regir" data-guardar-reglas />
            </span>
            {#if motivoDe(errs, '(formulario)') !== null}<p class="error-campo">{motivoDe(errs, '(formulario)')}</p>{/if}
          </form>
        </section>
      {/if}
    {/each}
  </div>
{/if}
