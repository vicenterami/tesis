<script lang="ts">
  // P6 Configurar (docs/19 §4, tablero v2, E; flujo F2; HU-06, HU-13, RF-14): el dispositivo (nombre, estado, intervalo esperado, zona
  // dentro del sitio) y, por canal, la etiqueta y sus reglas (umbral alto, bajo, histéresis y retardo de activación). Reglas de la pantalla:
  //  - validación en vivo con la MISMA función que arma el cuerpo (lib/configurar.ts, espejo de la del servidor), el error junto al campo;
  //  - bloqueo optimista: cada guardado lleva el `actualizado_en` leído; un 409 dice «alguien lo cambió a las HH:MM: recarga» con el
  //    botón «Recargar» y no pisa nada (lo escrito queda en el formulario hasta recargar);
  //  - nunca optimista en pantalla: lo guardado se muestra cuando el servidor responde, con el botón en «Guardando…»;
  //  - los umbrales se escriben en la unidad en que se guardan (la del catálogo, escrita al lado): convertirlos a la preferencia de la
  //    persona sumaría un redondeo a cada guardado (decidido al implementar, 11/11/2026).
  import { onMount } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { ErrorApi, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    ESTADOS_CONFIGURABLES, MAX_REGLAS, REGLA_NUEVA, cuerpoDispositivo, cuerpoReglas, erroresDeDispositivo, erroresPorCampo, formularioDe,
    horaDelConflicto, motivoDe, reglasDe, validarReglas, type ErrorCampo, type FormularioDispositivo, type ReglaFormulario,
  } from './lib/configurar';
  import type { CanalFicha, DispositivoFicha, ReglaUmbral, Sitio } from './lib/modelo';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { simbolo } from './lib/unidades';
  import { fragmentoFicha } from './lib/vista';

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
    return () => carga.cancelar();
  });

  const zonas = $derived(sitios?.find((s) => s.codigo === d?.sitio_codigo)?.zonas ?? (d === null ? [] : [{ id: d.zona_id, nombre: d.zona }]));
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
