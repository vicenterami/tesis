<script lang="ts">
  // P8, «Exportar datos» (docs/19 §4, R, punto 6; HU-08, RF-34, RF-31, RF-41): `#/exportar?sitio=<código>`, para quien tiene la acción
  // `exportar` en el sitio (administrador de sitio y del sistema, investigador; docs/20 §6). Tres decisiones en una columna:
  //  · el rango: 24 horas, 7 días, 30 días, todo el historial (desde el año 2000) o entre fechas (días completos en la zona del sitio);
  //  · el formato, con su línea de para qué sirve;
  //  · la estimación (`GET /sitios/{id}/exportar/estimacion`), pedida 300 ms después del último cambio de sitio, rango o días: una a la vez
  //    (la anterior se cancela al cambiar) y la respuesta de un sitio o un rango anterior se descarta; con la línea de la retención de las
  //    tramas. Comparte el cupo de exportaciones del servidor: ante su 429, un solo reintento solo a los 1,5 s; si se repite, o con un 503,
  //    un aviso en llano con «Reintentar».
  // «Descargar» usa `descargar()` (docs/19 §6) con «Cancelar» mientras baja; sobre 250 MB estimados pide confirmar antes. La estimación y la
  // descarga tienen cada una su cancelación, y las dos se cortan al cambiar de sitio o al salir de la pantalla.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import { descargar, esCancelacion, obtener, ultimaGana } from './lib/api';
  import type { DatosAviso } from './lib/avisos';
  import {
    DATOS_FORMATO, ESPERA_ESTIMACION_MS, FORMATOS, PRIMER_DIA, RANGOS_EXPORTACION, RANGO_POR_OMISION, REINTENTO_ESTIMACION_MS, avisoDeEstimacion,
    avisoDeExportacion, claveDeEstimacion, diasPorOmision, errorDeDias, esCupoLleno,
    hoyEnSitio, lineaRetencion, nombrePorOmision, pideConfirmar, rutaEstimacion, rutaExportar, sitiosQueExporta, textoConfirmar, textoDescargado,
    textoEstimacion, textoSinExportar, ventanaExportacion,
    type DiasElegidos, type Estimacion, type FormatoExportacion, type RangoExportacion,
  } from './lib/exportar';
  import type { Sitio } from './lib/modelo';
  import type { Sesion } from './lib/sesion';
  import { desfase } from './lib/tiempo';
  import { fragmentoExportar } from './lib/vista';

  let { sitio: codigoPedido, sesion, sitios, alCambiarVista }: { sitio: string; sesion: Sesion; sitios: Sitio[] | null; alCambiarVista: (f: string) => void } = $props();

  const mios = $derived(sitios === null ? [] : sitiosQueExporta(sesion, sitios));
  const sitio = $derived(mios.find((x) => x.codigo === codigoPedido) ?? mios[0] ?? null);
  const zona = $derived(sitio?.zona_horaria ?? 'UTC');

  // ── Lo elegido ──────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let rango = $state<RangoExportacion>(RANGO_POR_OMISION);
  let formato = $state<FormatoExportacion>('csv');
  let dias = $state<DiasElegidos>({ desde: '', hasta: '' });
  const hoy = $derived(hoyEnSitio(new Date(), zona));
  const errorFechas = $derived(rango === 'fechas' ? errorDeDias(dias, hoy) : null);
  function elegirRango(r: RangoExportacion): void {
    // «Entre fechas» abre con la última semana en la zona del sitio; lo escrito se conserva al volver a elegirlo.
    if (r === 'fechas' && dias.desde === '' && dias.hasta === '') dias = diasPorOmision(new Date(), zona);
    rango = r;
  }

  // ── La estimación ───────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let estimacion = $state<Estimacion | null>(null);
  let avisoEstimacion = $state<DatosAviso | null>(null);
  const cargaEstimacion = ultimaGana();
  const clave = $derived(sitio === null ? null : claveDeEstimacion(sitio.id, rango, dias));

  // Una sola espera a la vez: la pausa tras un cambio o el reintento tras un 429 del cupo.
  let espera: ReturnType<typeof setTimeout> | null = null;
  function sinEspera(): void {
    if (espera !== null) clearTimeout(espera);
    espera = null;
  }
  // Cambió el sitio, el rango o un día: lo que estaba en vuelo ya no sirve (se cancela ya) y la nueva se pide tras la pausa, contada desde el
  // último cambio: escribir una fecha no es una petición por tecla. Con días que no sirven, nada.
  function estimarPronto(): void {
    sinEspera();
    cargaEstimacion.cancelar();
    estimacion = null;
    avisoEstimacion = null;
    if (sitio === null || ventanaExportacion(rango, new Date(), zona, dias).error !== null) return;
    espera = setTimeout(() => void pedirEstimacion(1), ESPERA_ESTIMACION_MS);
  }
  async function pedirEstimacion(intento: 1 | 2): Promise<void> {
    sinEspera();
    estimacion = null;
    avisoEstimacion = null;
    if (sitio === null) return;
    const v = ventanaExportacion(rango, new Date(), zona, dias);
    if (v.error !== null) {
      cargaEstimacion.cancelar();
      return;
    }
    const pedida = claveDeEstimacion(sitio.id, rango, dias);
    try {
      const e = await obtener<Estimacion>(rutaEstimacion(sitio.id, v), cargaEstimacion.senal());
      if (pedida !== clave) return; // de un sitio o un rango anterior: se descarta
      estimacion = e;
    } catch (x) {
      if (esCancelacion(x) || pedida !== clave) return;
      // El cupo lleno suele durar poco (otra exportación que termina): un solo reintento solo; el segundo 429 se dice.
      if (intento === 1 && esCupoLleno(x)) espera = setTimeout(() => void pedirEstimacion(2), REINTENTO_ESTIMACION_MS);
      else avisoEstimacion = avisoDeEstimacion(x);
    }
  }

  // ── La descarga ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let descargando = $state(false);
  let confirmando = $state(false);
  let avisoDescarga = $state<DatosAviso | null>(null);
  const cargaDescarga = ultimaGana();
  // Sin estimación no se sabe si pasa de 250 MB: «Descargar» la espera desactivado y con su motivo (y, si falló, pide reintentarla: al
  // llegar la estimación por «Reintentar», se activa).
  const motivoDescargar = $derived(
    errorFechas !== null ? 'elige un rango válido'
      : avisoEstimacion !== null ? 'no se pudo calcular el tamaño: reinténtalo arriba'
        : estimacion === null ? 'espera a que se calcule el tamaño' : null,
  );

  function alPedirDescarga(e: SubmitEvent): void {
    e.preventDefault();
    if (descargando || motivoDescargar !== null || estimacion === null) return;
    avisoDescarga = null;
    if (pideConfirmar(estimacion, formato)) confirmando = true;
    else void bajar();
  }
  async function bajar(): Promise<void> {
    confirmando = false;
    if (sitio === null || descargando) return;
    // El rango se calcula al pulsar: «Últimas 24 horas» son las de ahora, no las de cuando se estimó.
    const v = ventanaExportacion(rango, new Date(), zona, dias);
    if (v.error !== null) return;
    const deSitio = sitio.id;
    descargando = true;
    avisoDescarga = null;
    try {
      const r = await descargar(rutaExportar(deSitio, formato, v), nombrePorOmision(sitio.codigo, formato), cargaDescarga.senal());
      avisoDescarga = { tipo: 'exito', texto: textoDescargado(r.nombre, r.bytes) };
    } catch (x) {
      if (sitio?.id === deSitio) avisoDescarga = avisoDeExportacion(x); // cancelada al cambiar de sitio: nada que decir en el otro
    } finally {
      descargando = false;
    }
  }

  // Otro sitio o otro rango: otra estimación (y la confirmación abierta y el aviso de la descarga anterior ya no valen). Otro formato: la
  // estimación sirve (trae los tres tamaños), pero la confirmación se vuelve a decidir.
  $effect(() => {
    void clave;
    untrack(() => {
      confirmando = false;
      if (!descargando) avisoDescarga = null;
      estimarPronto();
    });
  });
  $effect(() => {
    void formato;
    untrack(() => (confirmando = false));
  });
  // Otro sitio: la descarga en curso (si el menú o «Atrás» lo cambiaron) se corta y su aviso no pasa al sitio nuevo.
  const idSitio = $derived(sitio?.id ?? null);
  $effect(() => {
    void idSitio;
    untrack(() => {
      cargaDescarga.cancelar();
      avisoDescarga = null;
    });
  });
  onMount(() => () => {
    sinEspera();
    cargaEstimacion.cancelar();
    cargaDescarga.cancelar();
  });
  const uid = $props.id();
</script>

<h2 data-exportar>Exportar datos</h2>
<p class="intro-publicar">Descarga en un archivo las mediciones, las tramas originales y los eventos de todos los equipos de un sitio, para
  analizarlos fuera del sistema. El archivo no trae datos de personas.</p>

{#if sitios === null}
  <p class="vacio" aria-busy="true">Cargando tus sitios…</p>
{:else if sitio === null}
  <p class="vacio" data-sin-exportar>{textoSinExportar(sesion.permisos)} <a href="#/">Volver al tablero</a></p>
{:else}
  {#if mios.length > 1}
    <label class="selector-publicar">Sitio
      <select value={sitio.codigo} disabled={descargando} aria-describedby={descargando ? `${uid}-sitio-motivo` : undefined}
        onchange={(e) => alCambiarVista(fragmentoExportar(e.currentTarget.value))} data-sitio-exportar>
        {#each mios as x (x.id)}<option value={x.codigo}>{x.nombre}</option>{/each}
      </select>
    </label>
    {#if descargando}<span class="motivo-desactivado" id="{uid}-sitio-motivo">espera a que termine la descarga o cancélala</span>{/if}
  {:else}
    <p class="vivo" data-sitio-exportar-nombre>Sitio: <strong>{sitio.nombre}</strong></p>
  {/if}

  <form class="formulario-exportar" onsubmit={alPedirDescarga} novalidate data-formulario-exportar>
    <fieldset disabled={descargando} data-rangos-exportar>
      <legend>Rango</legend>
      <div class="opciones-exportar">
        {#each RANGOS_EXPORTACION as r (r.clave)}
          <label class="casilla"><input type="radio" name="{uid}-rango" value={r.clave} checked={rango === r.clave} onchange={() => elegirRango(r.clave)} data-rango-exportar={r.clave} /> {r.rotulo}</label>
        {/each}
      </div>
      {#if rango === 'fechas'}
        <div class="fila-campos dias-exportar" data-entre-fechas>
          <label>Primer día
            <input type="date" min={PRIMER_DIA} max={hoy} bind:value={dias.desde} aria-describedby="{uid}-dias-ayuda {uid}-dias-error"
              aria-invalid={errorFechas !== null || undefined} data-dia-desde />
          </label>
          <label>Último día (incluido)
            <input type="date" min={PRIMER_DIA} max={hoy} bind:value={dias.hasta} aria-describedby="{uid}-dias-ayuda {uid}-dias-error"
              aria-invalid={errorFechas !== null || undefined} data-dia-hasta />
          </label>
        </div>
        <p class="vivo" id="{uid}-dias-ayuda">Días completos, de 00:00 a 24:00 en la hora del sitio ({desfase(zona, new Date())}).</p>
        <p class="error-campo" id="{uid}-dias-error" data-error-dias>{errorFechas ?? ''}</p>
      {/if}
    </fieldset>

    <fieldset disabled={descargando} data-formatos-exportar>
      <legend>Formato</legend>
      <div class="formatos-exportar">
        {#each FORMATOS as f (f)}
          <div class="formato-exportar">
            <label class="casilla"><input type="radio" name="{uid}-formato" value={f} bind:group={formato} aria-describedby="{uid}-para-{f}" data-formato-exportar={f} /> {DATOS_FORMATO[f].rotulo}</label>
            <p class="vivo" id="{uid}-para-{f}">{DATOS_FORMATO[f].paraQue}</p>
          </div>
        {/each}
      </div>
    </fieldset>

    <section class="estimacion-exportar" aria-labelledby="{uid}-estimacion" aria-live="polite" data-estimacion>
      <h3 id="{uid}-estimacion">Lo que trae el archivo</h3>
      {#if errorFechas !== null}
        <p class="vivo">Elige los días para ver lo que trae.</p>
      {:else if avisoEstimacion !== null}
        <Aviso tipo={avisoEstimacion.tipo} texto={avisoEstimacion.texto} accion={{ etiqueta: 'Reintentar', alHacer: () => void pedirEstimacion(1) }} />
      {:else if estimacion === null}
        <p class="vivo" aria-busy="true" data-estimacion-cargando>Contando lo que trae este rango…</p>
      {:else}
        <p class="cifra-estimacion" data-estimacion-texto>{textoEstimacion(estimacion, formato)}</p>
        <p class="vivo" data-retencion>{lineaRetencion(estimacion, new Date(), zona)}</p>
      {/if}
    </section>

    {#if confirmando && estimacion !== null}
      <div class="confirmacion" role="alert" data-confirmar-exportar>
        <p>{textoConfirmar(estimacion, formato)}</p>
        <span class="acciones">
          <Boton etiqueta="Descargar igual" variante="principal" onclick={() => void bajar()} data-descargar-igual />
          <Boton etiqueta="Cancelar" onclick={() => (confirmando = false)} data-no-descargar />
        </span>
      </div>
    {/if}

    {#if avisoDescarga !== null}<Aviso tipo={avisoDescarga.tipo} texto={avisoDescarga.texto} alCerrar={() => (avisoDescarga = null)} />{/if}
    <!-- Sin ayuda emergente: bajo 700 px la ayuda se fija al pie de la pantalla y tapaba el propio botón cuando quedaba abajo (lo encontró el
         navegador real, 19/11/2026); lo que el botón hace lo dicen la estimación y la confirmación -->
    <span class="acciones">
      <Boton tipo="submit" variante="principal" etiqueta="Descargar" etiquetaCargando="Descargando…" cargando={descargando}
        motivoDesactivado={descargando || confirmando ? null : motivoDescargar} data-descargar-exportar />
      {#if descargando}<Boton etiqueta="Cancelar" onclick={() => cargaDescarga.cancelar()} data-cancelar-exportar />{/if}
    </span>
  </form>
{/if}
