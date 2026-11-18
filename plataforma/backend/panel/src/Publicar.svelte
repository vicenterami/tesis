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
  //  · El k del sitio («afecta a todos los enlaces públicos de este sitio» y lo que un visitante podría deducir; bajarlo pide confirmar) y el
  //    tope de enlaces vivos.
  import { onMount, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import VistaPublicaCuerpo from './VistaPublicaCuerpo.svelte';
  import { esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import {
    AVISO_NOMBRES_PUBLICOS, AVISO_TEXTO_PUBLICO, AVISO_TODOS_LOS_ENLACES, FORMULARIO_VACIO, MAX_DESCRIPCION, MAX_TITULO, PLAZOS, RETENCION, ROTULO_ESTADO,
    ROTULO_PLAZO, SIN_MAGNITUDES, TOKEN_UNA_VEZ, acortaDe, avisoDeEnlace, avisosSinDatos, cuerpoPrevia, cuerpoVista, deduciblePorK, direccionCompleta,
    AVISO_ORIGEN_LOCAL, faltaParaPublicar, firmaDeSeleccion, minimoQueRige, motivoPorPrevia, origenLocal, quePublica, sitiosQuePublica, textoAcorta, tituloDe,
    ventanaPreviaValida,
    type EnlaceCreado, type EnlaceListado, type FormularioVista, type MagnitudCatalogo, type MinimoSitio, type TopeEnlaces, type VistaPrevia,
  } from './lib/enlaces';
  import type { Sitio } from './lib/modelo';
  import { ROTULO_VENTANA, VENTANAS, type VentanaPublica } from './lib/publico';
  import type { Sesion } from './lib/sesion';
  import { fechaHora } from './lib/tiempo';
  import { simbolo } from './lib/unidades';
  import { fragmentoPublicar } from './lib/vista';

  let { sitio: codigoPedido, sesion, sitios, alCambiarVista }: { sitio: string; sesion: Sesion; sitios: Sitio[] | null; alCambiarVista: (f: string) => void } = $props();

  const mios = $derived(sitios === null ? [] : sitiosQuePublica(sesion, sitios));
  const sitio = $derived(mios.find((x) => x.codigo === codigoPedido) ?? mios[0] ?? null);
  const zona = $derived(sitio?.zona_horaria ?? 'UTC');

  // ── Datos del sitio ─────────────────────────────────────────────────────────────────────────────────────────────────────────────
  let catalogo = $state<MagnitudCatalogo[]>([]);
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
  async function cargarAjustes(): Promise<void> {
    if (sitio === null) return;
    const s = cargaSitio.senal();
    try {
      const id = encodeURIComponent(sitio.id);
      const [m, tp] = await Promise.all([obtener<MinimoSitio>(`/sitios/${id}/enlaces/minimo`, s), obtener<TopeEnlaces>(`/sitios/${id}/enlaces/tope`, s)]);
      // Si el k que rige cambió (otra persona), una confirmación abierta hablaba del de antes: se cierra.
      if (minimo !== null && m.minimo_dispositivos !== minimo.minimo_dispositivos) confirmarK = false;
      [minimo, tope] = [m, tp];
      kElegido = m.minimo_dispositivos;
      topeElegido = tp.max_enlaces;
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
  let guardandoK = $state(false); // el PUT del k en vuelo (aquí arriba: «Publicar» también lo espera)
  let esperandoPrevia = $state(false);
  const firmaActual = $derived(firmaDeSeleccion(f));
  const previaVigente = $derived(previa !== null && !cargandoPrevia && !esperandoPrevia && firmaPrevia === firmaActual);
  const falta = $derived(faltaParaPublicar(f) ?? motivoPorPrevia({ hayPrevia: previa !== null, firmaActual, firmaPrevia, esperando: esperandoPrevia, cargando: cargandoPrevia, fallo: avisoPrevia !== null, guardandoMinimo: guardandoK }));
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
      await Promise.all([cargarLista(), cargarAjustes()]);
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
      await Promise.all([cargarLista(), cargarAjustes()]);
    } catch (x) {
      avisoFila = { id: e.id, aviso: avisoDeEnlace(x) };
    } finally {
      ocupado = null;
    }
  }

  // ── El k del sitio y el tope ────────────────────────────────────────────────────────────────────────────────────────────────────
  let kElegido = $state(3);
  let confirmarK = $state(false);
  let avisosK = $state<string[]>([]);
  let topeElegido = $state(50);
  let guardandoTope = $state(false);
  let avisoAjustes = $state<DatosAviso | null>(null);
  const kInvalido = $derived(minimo === null || !Number.isInteger(kElegido) || kElegido < minimo.piso || kElegido > minimo.maximo
    ? `elige un número entero entre ${minimo?.piso ?? 1} y ${minimo?.maximo ?? 20}` : kElegido === minimo.minimo_dispositivos ? 'es el que ya rige' : null);
  const topeInvalido = $derived(tope === null || !Number.isInteger(topeElegido) || topeElegido < 1 || topeElegido > tope.techo
    ? `elige un número entero entre 1 y ${tope?.techo ?? 200}` : topeElegido === tope.max_enlaces ? 'es el que ya rige' : null);

  function pedirGuardarK(): void {
    if (minimo === null || kInvalido !== null) return;
    if (kElegido < minimo.minimo_dispositivos) confirmarK = true; // bajarlo expone más: se confirma sabiendo lo que implica
    else void guardarK();
  }
  async function guardarK(): Promise<void> {
    if (sitio === null || guardandoK) return;
    const deSitio = sitio.id;
    guardandoK = true;
    avisoAjustes = null;
    const pedido = kElegido;
    try {
      // `anterior`: el k que esta pantalla leyó; si otra persona lo cambió entretanto, el servidor responde 409 sin cambiar nada.
      const cuerpo = minimo === null ? { minimo_dispositivos: pedido } : { minimo_dispositivos: pedido, anterior: minimo.minimo_dispositivos };
      const r = await pedir<MinimoSitio>('PUT', `/sitios/${encodeURIComponent(deSitio)}/enlaces/minimo`, { cuerpo });
      // Si mientras tanto se eligió otro sitio, la respuesta es del anterior: no se escribe en la pantalla del nuevo.
      if (sitio?.id !== deSitio) return;
      minimo = r;
      kElegido = r.minimo_dispositivos;
      avisosK = r.avisos ?? [];
      confirmarK = false;
      if (f.magnitudes.length > 0) void pedirPrevia(); // la vista previa aplica el k nuevo
    } catch (x) {
      if (sitio?.id !== deSitio) return;
      const rige = minimoQueRige(x);
      if (rige === null) avisoAjustes = avisoDeError(x);
      else {
        // Se relee y se vuelve a decidir con el k de ahora: si lo pedido lo baja, se confirma otra vez.
        confirmarK = false;
        await cargarAjustes();
        if (sitio?.id !== deSitio) return; // durante la relectura se eligió otro sitio
        kElegido = pedido;
        avisoAjustes = { tipo: 'conflicto', texto: avisoDeEnlace(x).texto };
        if (minimo !== null && pedido < minimo.minimo_dispositivos) confirmarK = true;
      }
    } finally {
      if (sitio?.id === deSitio) guardandoK = false; // el otro sitio puede tener su propio guardado en vuelo
    }
  }
  async function guardarTope(): Promise<void> {
    if (sitio === null || guardandoTope || topeInvalido !== null) return;
    const deSitio = sitio.id;
    guardandoTope = true;
    avisoAjustes = null;
    try {
      const r = await pedir<TopeEnlaces>('PUT', `/sitios/${encodeURIComponent(deSitio)}/enlaces/tope`, { cuerpo: { max_enlaces: topeElegido } });
      if (sitio?.id !== deSitio) return; // la respuesta es del sitio anterior
      tope = r;
      topeElegido = r.max_enlaces;
      avisoAjustes = { tipo: 'exito', texto: `El tope de enlaces vivos de este sitio es ahora ${r.max_enlaces}.` };
    } catch (x) {
      if (sitio?.id !== deSitio) return;
      avisoAjustes = avisoDeError(x);
    } finally {
      if (sitio?.id === deSitio) guardandoTope = false;
    }
  }

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
      avisosK = [];
      confirmarK = false;
      avisoCrear = null;
      avisoAjustes = null;
      avisoLista = null;
      copiada = 'no';
      ventanaPrevia = '24h';
      guardandoK = false;
      guardandoTope = false;
      renovando = acorta = null;
      revocando = null;
      f = { ...FORMULARIO_VACIO, magnitudes: [], zonas: [] };
      void cargarLista();
      void cargarAjustes();
    });
  });
  onMount(() => {
    // Su propia cancelación: con la de los ajustes del sitio, pedir uno cancelaba el otro.
    const cargaCatalogo = new AbortController();
    void obtener<MagnitudCatalogo[]>('/magnitudes', cargaCatalogo.signal).then((m) => (catalogo = m)).catch((e: unknown) => {
      if (!esCancelacion(e)) avisoPrevia = avisoDeError(e);
    });
    // «Atrás» puede devolver la página desde la caché de ida y vuelta del navegador: la dirección con el token se olvida cuando la página
    // entra a esa caché (`persisted`). No siempre: en un teléfono, pasar a otra aplicación para pegarla también puede disparar `pagehide`.
    const alSalir = (e: PageTransitionEvent): void => { if (e.persisted) creado = null; };
    window.addEventListener('pagehide', alSalir);
    return () => {
      window.removeEventListener('pagehide', alSalir);
      cargaCatalogo.abort();
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
        {#if catalogo.length === 0}<p class="vivo">Cargando el catálogo…</p>{/if}
        <div class="casillas">
          {#each catalogo as m (m.codigo)}
            <label class="casilla"><input type="checkbox" checked={f.magnitudes.includes(m.codigo)} onchange={(e) => alternar('magnitudes', m.codigo, e.currentTarget.checked)} data-magnitud-enlace={m.codigo} /> {m.nombre} ({simbolo(m.unidad)})</label>
          {/each}
        </div>
        {#if f.magnitudes.length === 0}<p class="vivo" data-sin-magnitudes>{SIN_MAGNITUDES}</p>{/if}
      </fieldset>

      <fieldset>
        <legend>Desglose por zona (opcional)</legend>
        {#if sitio.zonas.length === 0}
          <p class="vivo">Este sitio no tiene zonas: la vista muestra solo el promedio del sitio.</p>
        {:else}
          <div class="casillas">
            {#each sitio.zonas as z (z.id)}
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
              <div><dt>Creado por</dt><dd>{e.creado_por?.nombre ?? 'alguien que ya no está'}, el {fechaHora(e.creado_en, zona)}</dd></div>
              {#if e.revocado_en !== null}
                <div><dt>Revocado</dt><dd>el {fechaHora(e.revocado_en, zona)}{e.revocado_por !== null ? `, por ${e.revocado_por.nombre}` : ''}</dd></div>
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

  <section aria-labelledby="{uid}-ajustes" class="ajustes-publico">
    <h3 id="{uid}-ajustes">Protección y límites de este sitio</h3>
    {#if avisoAjustes !== null}<Aviso tipo={avisoAjustes.tipo} texto={avisoAjustes.texto} alCerrar={() => (avisoAjustes = null)} />{/if}
    {#if minimo === null || tope === null}
      <p class="vacio" aria-busy="true">Cargando…</p>
    {:else}
      <div class="ajuste" data-ajuste-minimo>
        <h4>Mínimo de dispositivos por valor (k)</h4>
        <p>Rige <strong data-minimo-actual>k = {minimo.minimo_dispositivos}</strong>{minimo.fijado ? ', fijado para este sitio' : `, el de omisión de esta instalación (${minimo.por_omision})`}.
          Un promedio que aportan menos de k dispositivos sale en blanco, igual que un tramo sin datos.</p>
        <p class="aviso-publico" data-aviso-todos>{AVISO_TODOS_LOS_ENLACES}</p>
        <div class="fila-campos">
          <label>k, de {minimo.piso} a {minimo.maximo}
            <input type="number" min={minimo.piso} max={minimo.maximo} step="1" bind:value={kElegido} oninput={() => (confirmarK = false)} data-minimo-campo />
          </label>
          <Boton etiqueta="Guardar el mínimo" cargando={guardandoK} etiquetaCargando="Guardando…" motivoDesactivado={guardandoK || confirmarK ? null : kInvalido} onclick={pedirGuardarK} data-guardar-minimo />
        </div>
        {#if confirmarK}
          <div class="confirmacion" role="alert" data-confirmar-minimo-aviso>
            <p>Vas a bajar k de {minimo.minimo_dispositivos} a {kElegido}. {AVISO_TODOS_LOS_ENLACES} {deduciblePorK(kElegido)}</p>
            <span class="acciones">
              <Boton etiqueta={`Bajar a ${kElegido}`} variante="peligro" cargando={guardandoK} etiquetaCargando="Guardando…" onclick={() => void guardarK()} data-confirmar-minimo />
              <Boton etiqueta="Cancelar" onclick={() => { confirmarK = false; kElegido = minimo?.minimo_dispositivos ?? kElegido; }} />
            </span>
          </div>
        {/if}
        {#if avisosK.length > 0}
          <div role="status" data-avisos-minimo>
            <p>Guardado: rige desde la próxima visita de cada enlace. Lo que un visitante podría deducir ahora:</p>
            <ul class="avisos-publicar">{#each avisosK as a (a)}<li data-aviso-minimo>{a}</li>{/each}</ul>
          </div>
        {/if}
      </div>
      <div class="ajuste" data-ajuste-tope>
        <h4>Tope de enlaces vivos</h4>
        <p>Hay <strong data-vivos>{tope.vivos}</strong> de <strong data-tope-actual>{tope.max_enlaces}</strong>{tope.fijado ? ', fijado para este sitio' : ` (el de omisión, ${tope.por_omision})`}.
          Bajarlo no revoca nada: impide crear otro hasta que haya lugar.</p>
        <div class="fila-campos">
          <label>Tope, de 1 a {tope.techo}
            <input type="number" min="1" max={tope.techo} step="1" bind:value={topeElegido} data-tope-campo />
          </label>
          <Boton etiqueta="Guardar el tope" cargando={guardandoTope} etiquetaCargando="Guardando…" motivoDesactivado={guardandoTope ? null : topeInvalido} onclick={() => void guardarTope()} data-guardar-tope />
        </div>
      </div>
    {/if}
  </section>
{/if}
