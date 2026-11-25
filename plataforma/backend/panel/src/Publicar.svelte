<script lang="ts">
  // P9, la pantalla de quien publica (docs/19 §4, O, puntos 2, 3, 4, 10 y 11; HU-32, RF-62): `#/publicar?sitio=<código>`, para quien
  // tiene la acción `enlaces` en el sitio (administrador de sitio y del sistema; docs/20 §6). De arriba abajo:
  //  · «Publicar una vista»: título y descripción (con el aviso de que los verá cualquiera), magnitudes, ventana máxima, desglose por zona
  //    (con el aviso de los nombres), vencimiento y retención del texto; la VISTA PREVIA con los datos reales (`POST …/vista-previa`, la
  //    misma respuesta que verá el visitante, dibujada con el mismo componente) y sus `avisos` por magnitud, más «sin datos de…», ANTES del
  //    botón «Publicar». El título y la descripción de la vista previa se escriben desde el formulario (el servidor los devuelve tal cual,
  //    recortados): así escribir no repite la consulta, que solo se pide al cambiar magnitudes, zonas o ventanas.
  //  · Al crear, la dirección (con el token en el fragmento) UNA sola vez, con «Copiar»; nunca se vuelve a ver.
  //  · La lista de enlaces vivos (con «Ver todos», `?incluir=todos`), con «Renovar» (plazo; el 409 `acorta` pide confirmar con las dos
  //    fechas) y «Revocar» (con confirmación; no se deshace).
  //  · Una línea con el k del sitio y el tope de enlaces vivos (solo lectura) y, para quien tiene la acción, «Cambiar en Ajustes del sitio»:
  //    desde el 18/11/2026 el k y el tope se cambian en P15 (AjustesSitio.svelte, docs/19 §4, Q), no aquí.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import Persona from './Persona.svelte';
  import VistaPublicaCuerpo from './VistaPublicaCuerpo.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    AVISO_NOMBRES_PUBLICOS, AVISO_TEXTO_PUBLICO, FORMULARIO_VACIO, MAX_DESCRIPCION, MAX_TITULO, PLAZOS, RETENCION, ROTULO_ESTADO,
    ROTULO_PLAZO, SIN_MAGNITUDES, TOKEN_UNA_VEZ, acortaDe, avisoDeEnlace, avisosSinDatos, cuerpoPrevia, cuerpoVista, direccionCompleta,
    AVISO_ORIGEN_LOCAL, FALLO_CATALOGO, faltaParaPublicar, firmaDeSeleccion, motivoPorPrevia, origenLocal, quePublica, sitiosQuePublica, textoAcorta, tituloDe,
    ventanaPreviaValida,
    type EnlaceCreado, type EnlaceListado, type FormularioVista, type MagnitudCatalogo, type MinimoSitio, type TopeEnlaces, type VistaPrevia,
  } from './lib/enlaces';
  import type { Sitio } from './lib/modelo';
  import { ROTULO_VENTANA, VENTANAS, type VentanaPublica } from './lib/publico';
  import type { Sesion } from './lib/sesion';
  import { fechaHora } from './lib/tiempo';
  import { simbolo } from './lib/unidades';
  import { puedeEnSitio } from './lib/ajustes';
  import { fragmentoAjustes, fragmentoPublicar } from './lib/vista';

  let { sitio: codigoPedido, sesion, sitios, alCambiarVista }: { sitio: string; sesion: Sesion; sitios: Sitio[] | null; alCambiarVista: (f: string) => void } = $props();

  const mios = $derived(sitios === null ? [] : sitiosQuePublica(sesion, sitios));
  const sitio = $derived(mios.find((x) => x.codigo === codigoPedido) ?? mios[0] ?? null);
  const zona = $derived(sitio?.zona_horaria ?? 'UTC');

  // ── Datos del sitio ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let catalogo = $state<MagnitudCatalogo[]>([]);
  let avisoCatalogo = $state<DatosAviso | null>(null); // el catálogo de magnitudes tiene su propio aviso: «Reintentar» pide `/magnitudes`, no la vista previa
  const cargaCatalogo = ultimaGana(); // su propia cancelación: con la de la lectura de los ajustes del sitio, pedir uno cancelaba el otro
  let enlaces = $state<EnlaceListado[] | null>(null);
  let todos = $state(false);
  let minimo = $state<MinimoSitio | null>(null);
  let tope = $state<TopeEnlaces | null>(null);
  let avisoLista = $state<DatosAviso | null>(null);
  const cargaLista = ultimaGana();
  const cargaSitio = ultimaGana();

  async function cargarLista(): Promise<void> {
    if (sitio === null) return;
    try {
      enlaces = await obtener<EnlaceListado[]>(`/sitios/${encodeURIComponent(sitio.id)}/enlaces${todos ? '?incluir=todos' : ''}`, cargaLista.senal());
      avisoLista = null;
    } catch (e) {
      if (!esCancelacion(e)) avisoLista = avisoDeEnlace(e);
    }
  }
  async function cargarCatalogo(): Promise<void> {
    try {
      catalogo = await obtener<MagnitudCatalogo[]>('/magnitudes', cargaCatalogo.senal());
      avisoCatalogo = null;
    } catch (e) {
      if (esCancelacion(e)) return;
      avisoCatalogo = avisoDeError(e);
    }
  }
  // Solo lectura: el k y el tope que rigen, para la línea de arriba (se cambian en P15). Un fallo se dice junto a la línea.
  async function cargarAjustes(): Promise<void> {
    if (sitio === null) return;
    const s = cargaSitio.senal();
    const deSitio = sitio.id;
    try {
      const id = encodeURIComponent(deSitio);
      const [m, tp] = await Promise.all([obtener<MinimoSitio>(`/sitios/${id}/enlaces/minimo`, s), obtener<TopeEnlaces>(`/sitios/${id}/enlaces/tope`, s)]);
      if (sitio?.id !== deSitio) return;
      [minimo, tope] = [m, tp];
      avisoAjustes = null;
    } catch (e) {
      if (!esCancelacion(e)) avisoAjustes = avisoDeError(e);
    }
  }

  // ── El formulario y la vista previa ─────────────────────────────────────────────────────────────────────────────────────────────
  let f = $state<FormularioVista>({ ...FORMULARIO_VACIO, magnitudes: [], zonas: [] });
  let ventanaPrevia = $state<VentanaPublica>('24h');
  let previa = $state<VistaPrevia | null>(null);
  let cargandoPrevia = $state(false);
  let avisoPrevia = $state<DatosAviso | null>(null);
  let avisoCrear = $state<DatosAviso | null>(null);
  let creando = $state(false);
  let creado = $state<EnlaceCreado | null>(null);
  let copiada = $state<'no' | 'si' | 'manual'>('no');
  // «Publicar» espera la vista previa de ESTA selección (docs/19 §4, O, «Decidido al implementar las pantallas»): la firma de lo que la
  // produjo, y si hay una pausa, una petición en vuelo o un fallo, el botón se desactiva con su motivo.
  let firmaPrevia = $state<string | null>(null);
  let esperandoPrevia = $state(false);
  const firmaActual = $derived(firmaDeSeleccion(f));
  const previaVigente = $derived(previa !== null && !cargandoPrevia && !esperandoPrevia && firmaPrevia === firmaActual);
  const falta = $derived((avisoCatalogo !== null ? FALLO_CATALOGO : null) ?? faltaParaPublicar(f) ?? motivoPorPrevia({ hayPrevia: previa !== null, firmaActual, firmaPrevia, esperando: esperandoPrevia, cargando: cargandoPrevia, fallo: avisoPrevia !== null }));
  const sinDatos = $derived(previa === null ? [] : avisosSinDatos(previa));
  // El nombre con que entró quien publica solo sirve en su equipo o su red: se le avisa junto a la dirección.
  const nombreLocal = origenLocal(window.location.hostname);
  // La vista previa dibuja el título y la descripción que se están escribiendo (recortados, como los devolverá el servidor).
  const previaConTexto = $derived(previa === null ? null : { ...previa, titulo: f.titulo.trim(), descripcion: f.descripcion.trim() === '' ? null : f.descripcion.trim() });
  const cargaPrevia = ultimaGana();
  let esperaPrevia: ReturnType<typeof setTimeout> | null = null;

  async function pedirPrevia(): Promise<void> {
    if (sitio === null) return;
    if (f.magnitudes.length === 0) {
      cargaPrevia.cancelar();
      previa = null;
      firmaPrevia = null;
      cargandoPrevia = false;
      avisoPrevia = null;
      return;
    }
    const v = ventanaPreviaValida(ventanaPrevia, f.ventana_maxima);
    ventanaPrevia = v;
    const firma = firmaDeSeleccion(f);
    cargandoPrevia = true;
    try {
      previa = await pedir<VistaPrevia>('POST', `/sitios/${encodeURIComponent(sitio.id)}/enlaces/vista-previa`, { cuerpo: cuerpoPrevia(f, v), abortar: cargaPrevia.senal() });
      firmaPrevia = firma;
      avisoPrevia = null;
      cargandoPrevia = false;
    } catch (e) {
      if (esCancelacion(e)) return;
      firmaPrevia = null;
      avisoPrevia = avisoDeEnlace(e);
      cargandoPrevia = false;
    }
  }
  // Cambian magnitudes, zonas o ventanas: la vista previa se pide otra vez, una sola tras una pausa breve (marcar tres casillas seguidas
  // no son tres consultas; la ruta tiene su cupo y la zona de administración del proxy).
  function previaPronto(): void {
    if (esperaPrevia !== null) clearTimeout(esperaPrevia);
    esperandoPrevia = true;
    esperaPrevia = setTimeout(() => {
      esperaPrevia = null;
      esperandoPrevia = false;
      void pedirPrevia();
    }, 400);
  }
  // Ninguna vista previa vieja (de otro sitio, o de antes de publicar) llega tarde a pisar la pantalla.
  function cancelarPrevia(): void {
    if (esperaPrevia !== null) clearTimeout(esperaPrevia);
    esperaPrevia = null;
    esperandoPrevia = false;
    cargaPrevia.cancelar();
    cargandoPrevia = false;
  }
  function alternar(lista: 'magnitudes' | 'zonas', valor: string, marcado: boolean): void {
    const actual = f[lista];
    f[lista] = marcado ? [...actual.filter((x) => x !== valor), valor] : actual.filter((x) => x !== valor);
    previaPronto();
  }
  function alCambiarVentanaMaxima(v: VentanaPublica): void {
    f.ventana_maxima = v;
    ventanaPrevia = ventanaPreviaValida(ventanaPrevia, v);
    previaPronto();
  }
  function alCambiarVentanaPrevia(v: VentanaPublica): void {
    ventanaPrevia = v;
    void pedirPrevia();
  }

  async function crear(e: SubmitEvent): Promise<void> {
    e.preventDefault();
    if (creando || falta !== null || sitio === null) return;
    const deSitio = sitio.id;
    cancelarPrevia();
    creando = true;
    avisoCrear = null;
    try {
      const r = await pedir<EnlaceCreado>('POST', `/sitios/${encodeURIComponent(deSitio)}/enlaces`, { cuerpo: cuerpoVista(f) });
      // Red de seguridad: el selector de sitio está desactivado mientras se publica, pero el menú o «Atrás» pueden cambiarlo igual; entonces la
      // dirección no se muestra en la pantalla del otro sitio (el enlace queda en la lista del suyo, donde se puede revocar).
      if (sitio?.id !== deSitio) return;
      creado = r;
      copiada = 'no';
      f = { ...FORMULARIO_VACIO, magnitudes: [], zonas: [] };
      previa = null;
      firmaPrevia = null;
      await cargarLista();
      queueMicrotask(() => document.querySelector<HTMLElement>('[data-enlace-una-vez] h3')?.focus());
    } catch (x) {
      avisoCrear = avisoDeEnlace(x);
    } finally {
      creando = false;
    }
  }
  async function copiar(): Promise<void> {
    if (creado === null) return;
    try {
      await navigator.clipboard.writeText(direccionCompleta(window.location.origin, creado.direccion));
      copiada = 'si';
    } catch {
      // Sin portapapeles (una dirección que el navegador no trata como segura): se selecciona para copiarla a mano.
      const el = document.querySelector('[data-direccion-enlace]');
      const sel = window.getSelection();
      if (el !== null && sel !== null) {
        const r = document.createRange();
        r.selectNodeContents(el);
        sel.removeAllRanges();
        sel.addRange(r);
      }
      copiada = 'manual';
    }
  }

  // ── Renovar y revocar ───────────────────────────────────────────────────────────────────────────────────────────────────────────
  let renovando = $state<{ id: string; plazo: number } | null>(null);
  let acorta = $state<{ id: string; plazo: number; actual: string; nueva: string } | null>(null);
  let revocando = $state<string | null>(null);
  let ocupado = $state<string | null>(null);
  let avisoFila = $state<{ id: string; aviso: DatosAviso } | null>(null);

  async function renovar(e: EnlaceListado, plazo: number, acortar: boolean): Promise<void> {
    if (ocupado !== null || sitio === null) return;
    ocupado = e.id;
    avisoFila = null;
    try {
      const r = await pedir<EnlaceListado & { expira_en_anterior: string; acorta: boolean }>('POST', `/sitios/${encodeURIComponent(sitio.id)}/enlaces/${encodeURIComponent(e.id)}/renovar`, { cuerpo: acortar ? { plazo_dias: plazo, acortar: true } : { plazo_dias: plazo } });
      renovando = null;
      acorta = null;
      avisoFila = { id: e.id, aviso: { tipo: 'exito', texto: `Renovado: vence el ${fechaHora(r.expira_en, zona)}. La dirección no cambia.` } };
      await cargarLista();
    } catch (x) {
      const a = acortaDe(x);
      if (a !== null) {
        acorta = { id: e.id, plazo, ...a };
        renovando = null;
      } else avisoFila = { id: e.id, aviso: avisoDeEnlace(x) };
    } finally {
      ocupado = null;
    }
  }
  async function revocar(e: EnlaceListado): Promise<void> {
    if (ocupado !== null || sitio === null) return;
    ocupado = e.id;
    avisoFila = null;
    try {
      await pedir('DELETE', `/sitios/${encodeURIComponent(sitio.id)}/enlaces/${encodeURIComponent(e.id)}`);
      revocando = null;
      avisoFila = { id: e.id, aviso: { tipo: 'exito', texto: 'Revocado: quien tenga el enlace ya no ve la vista.' } };
      await cargarLista();
    } catch (x) {
      avisoFila = { id: e.id, aviso: avisoDeEnlace(x) };
    } finally {
      ocupado = null;
    }
  }

  // La lectura del k y del tope (docs/19 §4, Q, punto 4); se cambian en P15.
  let avisoAjustes = $state<DatosAviso | null>(null);

  // Otro sitio es otra pantalla: se olvida lo escrito, lo creado y lo cargado, y se pide lo suyo.
  const idSitio = $derived(sitio?.id ?? null);
  $effect(() => {
    void idSitio;
    untrack(() => {
      cancelarPrevia();
      firmaPrevia = null;
      avisoPrevia = null;
      creado = null;
      previa = null;
      enlaces = null;
      minimo = null;
      tope = null;
      avisoCrear = null;
      avisoAjustes = null;
      avisoLista = null;
      copiada = 'no';
      ventanaPrevia = '24h';
      renovando = acorta = null;
      revocando = null;
      f = { ...FORMULARIO_VACIO, magnitudes: [], zonas: [] };
      void cargarLista();
      void cargarAjustes();
    });
  });
  onMount(() => {
    void cargarCatalogo();
    // «Atrás» puede devolver la página desde la caché de ida y vuelta del navegador: la dirección con el token se olvida cuando la página
    // entra a esa caché (`persisted`). No siempre: en un teléfono, pasar a otra aplicación para pegarla también puede disparar `pagehide`.
    const alSalir = (e: PageTransitionEvent): void => { if (e.persisted) creado = null; };
    window.addEventListener('pagehide', alSalir);
    return () => {
      window.removeEventListener('pagehide', alSalir);
      cargaCatalogo.cancelar();
      cargaLista.cancelar();
      cargaSitio.cancelar();
      cargaPrevia.cancelar();
      if (esperaPrevia !== null) clearTimeout(esperaPrevia);
      creado = null; // la dirección con el token no sobrevive a la pantalla
    };
  });
  const uid = $props.id();
</script>

<h2 data-publicar>Vista pública</h2>
<p class="intro-publicar">Publica una vista de solo lectura para quien no tiene cuenta: solo los promedios de lo que elijas, con vencimiento, y un
  valor sale solo si lo aportan al menos k dispositivos.</p>

{#if sitios === null}
  <p class="vacio" aria-busy="true">Cargando tus sitios…</p>
{:else if sitio === null}
  <p class="vacio" data-sin-publicar>No administras ningún sitio donde publicar vistas. <a href="#/">Volver al tablero</a></p>
{:else}
  {#if mios.length > 1}
    <label class="selector-publicar">Sitio
      <select value={sitio.codigo} disabled={creando} aria-describedby={creando ? `${uid}-sitio-motivo` : undefined}
        onchange={(e) => alCambiarVista(fragmentoPublicar(e.currentTarget.value))} data-sitio-publicar>
        {#each mios as x (x.id)}<option value={x.codigo}>{x.nombre}</option>{/each}
      </select>
    </label>
    {#if creando}<span class="motivo-desactivado" id="{uid}-sitio-motivo" data-motivo-sitio>espera a que termine de publicarse: su dirección se muestra aquí</span>{/if}
  {:else}
    <p class="vivo" data-sitio-publicar-nombre>Sitio: <strong>{sitio.nombre}</strong></p>
  {/if}

  {#if creado !== null}
    <section class="enlace-una-vez" aria-labelledby="{uid}-creado" data-enlace-una-vez>
      <h3 id="{uid}-creado" tabindex="-1">Enlace creado: «{creado.titulo}»</h3>
      <p role="status">{TOKEN_UNA_VEZ} Vence el {fechaHora(creado.expira_en, zona)}.</p>
      <code class="direccion" translate="no" data-direccion-enlace>{direccionCompleta(window.location.origin, creado.direccion)}</code>
      <span class="acciones">
        <Boton etiqueta={copiada === 'si' ? 'Copiada' : 'Copiar'} variante="principal" ayuda="Copia la dirección al portapapeles" onclick={() => void copiar()} data-copiar-direccion />
        <Boton etiqueta="Ya la guardé: ocultar" onclick={() => (creado = null)} data-ocultar-direccion />
      </span>
      {#if nombreLocal}<p class="aviso-publico" data-aviso-origen>{AVISO_ORIGEN_LOCAL}</p>{/if}
      {#if copiada === 'manual'}<p class="vivo">El navegador no deja copiar desde esta dirección: quedó seleccionada; cópiala con Ctrl+C.</p>{/if}
      {#if creado.avisos.length > 0}
        <p class="vivo">Lo que se te avisó al publicar:</p>
        <ul class="avisos-publicar">{#each creado.avisos as a (a)}<li>{a}</li>{/each}</ul>
      {/if}
    </section>
  {/if}

  <section aria-labelledby="{uid}-nueva" class="publicar-nueva">
    <h3 id="{uid}-nueva">Publicar una vista</h3>
    <form class="formulario-publicar" onsubmit={crear} novalidate data-formulario-publicar>
      <div class="campo">
        <label for="{uid}-titulo">Título</label>
        <input id="{uid}-titulo" type="text" maxlength={MAX_TITULO} autocomplete="off" bind:value={f.titulo} aria-describedby="{uid}-aviso-texto" data-titulo-enlace />
      </div>
      <div class="campo">
        <label for="{uid}-descripcion">Descripción (opcional)</label>
        <textarea id="{uid}-descripcion" rows="2" maxlength={MAX_DESCRIPCION} bind:value={f.descripcion} aria-describedby="{uid}-aviso-texto" data-descripcion-enlace></textarea>
      </div>
      <p class="aviso-publico" id="{uid}-aviso-texto" data-aviso-texto-publico>{AVISO_TEXTO_PUBLICO}</p>

      <fieldset>
        <legend>Magnitudes</legend>
        {#if avisoCatalogo !== null}<Aviso tipo={avisoCatalogo.tipo} texto={`No se pudo cargar el catálogo de magnitudes. ${avisoCatalogo.texto}`} accion={{ etiqueta: 'Reintentar', alHacer: () => void cargarCatalogo() }} />
        {:else if catalogo.length === 0}<p class="vivo" data-catalogo-cargando>Cargando el catálogo…</p>{/if}
        <div class="casillas">
          {#each catalogo as m (m.codigo)}
            <label class="casilla"><input type="checkbox" checked={f.magnitudes.includes(m.codigo)} onchange={(e) => alternar('magnitudes', m.codigo, e.currentTarget.checked)} data-magnitud-enlace={m.codigo} /> {m.nombre} ({simbolo(m.unidad)})</label>
          {/each}
        </div>
        {#if f.magnitudes.length === 0 && avisoCatalogo === null}<p class="vivo" data-sin-magnitudes>{SIN_MAGNITUDES}</p>{/if}
      </fieldset>

      <fieldset>
        <legend>Desglose por zona (opcional)</legend>
        {#if sitio.zonas.every((x) => x.activo === false && !f.zonas.includes(x.id))}
          <p class="vivo">Este sitio no tiene zonas para publicar: la vista muestra solo el promedio del sitio.</p>
        {:else}
          <div class="casillas">
            {#each sitio.zonas.filter((x) => x.activo !== false || f.zonas.includes(x.id)) as z (z.id)}
              <label class="casilla"><input type="checkbox" checked={f.zonas.includes(z.id)} onchange={(e) => alternar('zonas', z.id, e.currentTarget.checked)} aria-describedby="{uid}-aviso-nombres" data-zona-enlace={z.nombre} /> {z.nombre}</label>
            {/each}
          </div>
        {/if}
        <p class="aviso-publico" id="{uid}-aviso-nombres" data-aviso-nombres-publicos>{AVISO_NOMBRES_PUBLICOS} Una zona creada después no aparece, y una renombrada conserva el nombre de hoy.</p>
      </fieldset>

      <div class="fila-campos">
        <label>Ventana más larga que podrá ver
          <select value={f.ventana_maxima} onchange={(e) => alCambiarVentanaMaxima(e.currentTarget.value as VentanaPublica)} data-ventana-maxima>
            {#each VENTANAS as v (v)}<option value={v}>{ROTULO_VENTANA[v]}</option>{/each}
          </select>
        </label>
        <label>Vence en
          <select bind:value={f.plazo_dias} data-plazo-enlace>
            {#each PLAZOS as p (p)}<option value={p}>{ROTULO_PLAZO[p]}</option>{/each}
          </select>
        </label>
        <label>Conservar el texto, después de que deje de valer (días)
          <input type="number" min={RETENCION.minimo} max={RETENCION.maximo} step="1" bind:value={f.retencion_dias} data-retencion-enlace />
        </label>
      </div>

      <section class="vista-previa" aria-labelledby="{uid}-previa" data-vista-previa>
        <h4 id="{uid}-previa">Vista previa: así la verá quien visite</h4>
        {#if avisoPrevia !== null}<Aviso tipo={avisoPrevia.tipo} texto={avisoPrevia.texto} accion={{ etiqueta: 'Reintentar', alHacer: () => void pedirPrevia() }} />{/if}
        {#if f.magnitudes.length === 0}
          <p class="vacio">{SIN_MAGNITUDES} La vista previa aparece aquí.</p>
        {:else if previaConTexto !== null}
          <div class="marco-previa"><VistaPublicaCuerpo vista={previaConTexto} ahora={new Date()} cargando={cargandoPrevia} previa alCambiarVentana={alCambiarVentanaPrevia} /></div>
        {:else}
          <p class="vacio" aria-busy="true" data-previa-cargando>Preparando la vista previa…</p>
        {/if}
      </section>

      {#if previa !== null && previaVigente && (previa.avisos.length > 0 || sinDatos.length > 0)}
        <div class="avisos-antes" role="status" data-avisos-publicar>
          <p><strong>Antes de publicar, lo que un visitante podría deducir o no verá:</strong></p>
          <ul class="avisos-publicar">
            {#each [...previa.avisos, ...sinDatos] as a (a)}<li data-aviso-publicar>{a}</li>{/each}
          </ul>
          <p class="vivo">Puedes quitar esa magnitud o zona, o publicar igual sabiéndolo.</p>
        </div>
      {/if}

      {#if avisoCrear !== null}<Aviso tipo={avisoCrear.tipo} texto={avisoCrear.texto} alCerrar={() => (avisoCrear = null)} />{/if}
      <Boton tipo="submit" variante="principal" etiqueta="Publicar" etiquetaCargando="Publicando…" cargando={creando} motivoDesactivado={creando ? null : falta}
        ayuda="Crea el enlace; su dirección se muestra una sola vez" data-publicar-crear />
    </form>
  </section>

  <section aria-labelledby="{uid}-lista" class="lista-enlaces">
    <h3 id="{uid}-lista">{todos ? 'Todos los enlaces de este sitio' : 'Enlaces vivos de este sitio'}</h3>
    <Boton etiqueta={todos ? 'Ver solo los vivos' : 'Ver todos'} variante="discreto" presionado={todos}
      ayuda="Los revocados y los vencidos hace más de 30 días ya no vuelven; sus filas quedan para la actividad" onclick={() => { todos = !todos; void cargarLista(); }} data-ver-todos />
    {#if avisoLista !== null}<Aviso tipo={avisoLista.tipo} texto={avisoLista.texto} accion={{ etiqueta: 'Recargar', alHacer: () => void cargarLista() }} />{/if}
    {#if enlaces === null}
      <p class="vacio" aria-busy="true">Cargando los enlaces…</p>
    {:else if enlaces.length === 0}
      <p class="vacio" data-sin-enlaces>{todos ? 'Este sitio no tiene enlaces.' : 'Este sitio no tiene enlaces vivos: publica una vista con el formulario de arriba.'}</p>
    {:else}
      <ul class="enlaces" data-lista-enlaces>
        {#each enlaces as e (e.id)}
          <li class="enlace" aria-busy={ocupado === e.id || undefined} data-enlace={e.id}>
            <div class="enlace-cabeza">
              <strong data-titulo-de-enlace>{tituloDe(e)}</strong>
              <span class="estado-enlace {e.estado}" data-estado-enlace={e.estado}>{ROTULO_ESTADO[e.estado]}</span>
            </div>
            <p class="vivo" data-que-publica>{quePublica(e)}</p>
            <dl class="datos-enlace">
              <div><dt>Creado por</dt><dd><Persona persona={e.creado_por} vacio="alguien que ya no está" />, el {fechaHora(e.creado_en, zona)}</dd></div>
              {#if e.revocado_en !== null}
                <div><dt>Revocado</dt><dd>el {fechaHora(e.revocado_en, zona)}{#if e.revocado_por !== null}, por <Persona persona={e.revocado_por} />{/if}</dd></div>
              {:else}
                <div><dt>{e.estado === 'vencido' ? 'Venció' : 'Vence'}</dt><dd data-vence-enlace>el {fechaHora(e.expira_en, zona)}</dd></div>
              {/if}
              <div><dt>Visitas, últimos 7 días</dt><dd data-accesos-enlace>{e.accesos_7d}</dd></div>
            </dl>
            {#if avisoFila !== null && avisoFila.id === e.id}<Aviso tipo={avisoFila.aviso.tipo} texto={avisoFila.aviso.texto} alCerrar={() => (avisoFila = null)} />{/if}
            {#if e.estado !== 'revocado'}
              <span class="acciones">
                <Boton etiqueta="Renovar" motivoDesactivado={e.renovable ? null : 'ya no se puede renovar: crea uno nuevo'} cargando={ocupado === e.id && renovando?.id === e.id}
                  ayuda="Fija un vencimiento nuevo desde hoy; la dirección no cambia" onclick={() => { renovando = { id: e.id, plazo: 30 }; acorta = null; revocando = null; }} data-renovar={e.id} />
                <Boton etiqueta="Revocar" variante="peligro" ayuda="Corta el enlace de inmediato; no se deshace"
                  onclick={() => { revocando = e.id; renovando = null; acorta = null; }} data-revocar={e.id} />
              </span>
            {/if}
            {#if renovando !== null && renovando.id === e.id}
              <div class="confirmacion" data-confirmar-renovacion>
                <label>Plazo nuevo, desde hoy
                  <select bind:value={renovando.plazo} data-plazo-renovar>{#each PLAZOS as p (p)}<option value={p}>{ROTULO_PLAZO[p]}</option>{/each}</select>
                </label>
                <span class="acciones">
                  <Boton etiqueta="Confirmar la renovación" variante="principal" cargando={ocupado === e.id} etiquetaCargando="Renovando…" onclick={() => renovando !== null && void renovar(e, renovando.plazo, false)} data-confirmar-renovar />
                  <Boton etiqueta="Cancelar" onclick={() => (renovando = null)} />
                </span>
              </div>
            {/if}
            {#if acorta !== null && acorta.id === e.id}
              <div class="confirmacion" role="alert" data-acorta>
                <p>{textoAcorta(acorta.actual, acorta.nueva, zona)}</p>
                <span class="acciones">
                  <Boton etiqueta="Renovar igual" variante="peligro" cargando={ocupado === e.id} etiquetaCargando="Renovando…" onclick={() => acorta !== null && void renovar(e, acorta.plazo, true)} data-renovar-igual />
                  <Boton etiqueta="Elegir otro plazo" onclick={() => { renovando = { id: e.id, plazo: acorta?.plazo ?? 30 }; acorta = null; }} data-otro-plazo />
                </span>
              </div>
            {/if}
            {#if revocando === e.id}
              <div class="confirmacion" role="alert" data-confirmar-revocacion>
                <p>Quien tenga este enlace dejará de ver la vista de inmediato. Revocar no se deshace: para volver a publicar, crea otro enlace.</p>
                <span class="acciones">
                  <Boton etiqueta="Confirmar la revocación" variante="peligro" cargando={ocupado === e.id} etiquetaCargando="Revocando…" onclick={() => void revocar(e)} data-confirmar-revocar />
                  <Boton etiqueta="Cancelar" onclick={() => (revocando = null)} />
                </span>
              </div>
            {/if}
          </li>
        {/each}
      </ul>
    {/if}
  </section>

  <section aria-labelledby="{uid}-ajustes" class="ajustes-publico" data-ajustes-lectura>
    <h3 id="{uid}-ajustes">Límites de la vista pública de este sitio</h3>
    {#if avisoAjustes !== null}<Aviso tipo={avisoAjustes.tipo} texto={avisoAjustes.texto} alCerrar={() => (avisoAjustes = null)} />{/if}
    {#if minimo === null || tope === null}
      <p class="vacio" aria-busy="true">Cargando…</p>
    {:else}
      <p class="vivo" data-lectura-ajustes>Mínimo de dispositivos por valor publicado: <strong data-minimo-actual>{minimo.minimo_dispositivos}</strong> · Tope de enlaces vivos: <strong data-tope-actual>{tope.max_enlaces}</strong>
        {#if puedeEnSitio(sesion, sitio, 'enlaces')}· <a href={fragmentoAjustes(sitio.codigo)} data-cambiar-en-ajustes>Cambiar en Ajustes del sitio</a>{/if}</p>
    {/if}
  </section>
{/if}
