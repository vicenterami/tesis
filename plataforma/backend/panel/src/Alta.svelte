<script lang="ts">
  // P7 Alta (docs/19 §4, tablero v2, F; HU-22, RF-50, HU-11; punto 25): tres caminos en una pantalla.
  //  - Asistente de cinco pasos: identidad y zona · vía, formato e intervalo (pasarela si LoRaWAN) · canales · credencial mostrada UNA
  //    vez con «Copiar» · «esperando la primera trama» en vivo (`GET /eventos?dispositivo=`, F1).
  //  - Alta masiva: AltaLote.svelte (tres pasos: origen, revisión y resultado; docs/19 §4, bloque N).
  //  - Bandeja de detectados (`GET /cuarentena/detectados`): lo que ya habla sin estar dado de alta; cada fila abre el asistente con el
  //    identificador ya escrito.
  // Nada de esto es optimista: muestra secretos una vez y crea filas (docs/19 §6).
  import { onMount, tick, untrack } from 'svelte';
  import Aviso from './Aviso.svelte';
  import Boton from './Boton.svelte';
  import AltaLote from './AltaLote.svelte';
  import { ErrorApi, alPerderSesion, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError, type DatosAviso } from './lib/avisos';
  import type { EventoVivo, Sitio } from './lib/modelo';
  import { puedeEn, type Sesion } from './lib/sesion';
  import { puedeEnSitio } from './lib/ajustes';
  import { textoDeError } from './lib/estructura';
  import { fechaHora, horaLocal } from './lib/tiempo';
  import { abrirCanal, type Canal } from './lib/vivo';
  import { fragmentoAlta, fragmentoFicha, type ModoAlta } from './lib/vista';

  // `sitioActivo`: el sitio que nombra la cabecera del panel (App.svelte, `sitioNombrado`); el alta masiva ofrece crear ahí las zonas que falten (con `ajustes` en más de un sitio, también en otro de los suyos).
  let { modo = 'uno', idFisico = '', sitio = '', sesion = null, sitios = null, sitioActivo = null }: { modo?: ModoAlta; idFisico?: string; sitio?: string; sesion?: Sesion | null; sitios?: Sitio[] | null; sitioActivo?: Sitio | null } = $props();
  const uid = $props.id();

  // Solo los sitios donde la persona puede dar de alta (el servidor decide igual: un 403 se muestra).
  const misSitios = $derived((sitios ?? []).filter((s) => puedeEn(sesion, 'escribir', s.codigo)));

  // ── Asistente ─────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const PASOS = ['Identidad y zona', 'Vía y formato', 'Canales', 'Credencial', 'Primera trama'] as const;
  let paso = $state(1);
  const inicial = untrack(() => ({ idFisico, sitio }));
  let a = $state({ id_fisico: inicial.idFisico, nombre: '', sitio: inicial.sitio, zona_id: '', via: 'mqtt', formato: 'senml', pasarela_id: '', intervalo: '300' });
  let canalesAlta = $state<string[]>(['']);
  let pasarelas = $state<{ id: string; id_fisico: string; nombre: string; sitio_codigo: string; activo: boolean }[] | null>(null);
  let creando = $state(false);
  let avisoAlta = $state<DatosAviso | null>(null);
  let creado = $state<{ id: string; id_fisico: string; nombre: string; conexion: Record<string, unknown> } | null>(null);
  let copiado = $state<string | null>(null);
  let primeraTrama = $state<string | null>(null);
  let canalVivo: Canal | null = null;

  // El sitio por defecto: el que trae la URL (un detectado) si es de la persona; si no, el primero donde puede dar de alta.
  $effect(() => {
    if (misSitios.length > 0 && !misSitios.some((s) => s.codigo === a.sitio)) untrack(() => (a.sitio = misSitios[0]!.codigo));
  });
  // Las zonas retiradas no se ofrecen (migración 28; docs/19 §4 U); las creadas aquí con «+ Nueva zona…» se suman sin esperar a recargar.
  let zonasCreadas = $state<{ id: string; nombre: string; sitio: string }[]>([]);
  const sitioElegido = $derived(misSitios.find((s) => s.codigo === a.sitio) ?? null);
  const zonasDelSitio = $derived([
    ...(sitioElegido?.zonas ?? []).filter((z) => z.activo !== false),
    ...zonasCreadas.filter((z) => z.sitio === a.sitio && !(sitioElegido?.zonas ?? []).some((y) => y.id === z.id)),
  ]);
  const creaZonas = $derived(sesion !== null && sitioElegido !== null && puedeEnSitio(sesion, sitioElegido, 'ajustes'));
  let nuevaZona = $state<string | null>(null); // con texto (aunque vacío), el campo de «+ Nueva zona…» está abierto
  let errorNuevaZona = $state<string | null>(null);
  let creandoZona = $state(false);
  async function crearZona(): Promise<void> {
    if (nuevaZona === null || sitioElegido === null || creandoZona) return;
    const nombre = nuevaZona.trim();
    if (nombre === '') { errorNuevaZona = 'Escribe el nombre de la zona.'; return; }
    // El sitio se fija ANTES de esperar: `sitioElegido` es derivado y, leído después del `await`, atribuiría la zona al sitio que la persona
    // eligiera con la petición en vuelo (el selector de sitio, además, se desactiva mientras tanto).
    const destino = sitioElegido;
    creandoZona = true;
    errorNuevaZona = null;
    try {
      const z = await pedir<{ id: string; nombre: string }>('POST', `/sitios/${encodeURIComponent(destino.id)}/zonas`, { cuerpo: { nombre } });
      zonasCreadas = [...zonasCreadas, { id: z.id, nombre: z.nombre, sitio: destino.codigo }];
      if (a.sitio === destino.codigo) a.zona_id = z.id;
      nuevaZona = null;
    } catch (e) {
      errorNuevaZona = textoDeError(e);
    } finally {
      creandoZona = false;
    }
  }
  $effect(() => {
    if (zonasDelSitio.length > 0 && !zonasDelSitio.some((z) => z.id === a.zona_id)) untrack(() => (a.zona_id = zonasDelSitio[0]!.id));
  });
  const pasarelasDelSitio = $derived((pasarelas ?? []).filter((p) => p.sitio_codigo === a.sitio && p.activo));

  // El foco va al encabezado de cada paso al cambiar de paso (revisión del 11/11/2026; WCAG 2.4.3): un lector de pantalla dice en qué paso
  // está, y en el de la credencial lee después su aviso. No al cargar la pantalla: ahí el foco es de quien llega.
  let encabezadoPaso = $state<HTMLHeadingElement | null>(null);
  let pasoAnterior = untrack(() => paso);
  $effect(() => {
    const p = paso;
    if (p === pasoAnterior) return;
    pasoAnterior = p;
    void tick().then(() => encabezadoPaso?.focus());
  });

  // Errores por campo del paso 1, ligados a cada campo (aria-describedby a su «…-error»; WCAG 3.3.1), como en Configurar. Se muestran
  // cuando el campo ya se tocó, para no recibir a la persona con tres errores en rojo.
  let tocados = $state<Record<string, boolean>>({});
  const errorCampo = $derived.by((): Record<'id_fisico' | 'nombre' | 'sitio' | 'zona', string | null> => ({
    id_fisico: FORMA_ID.test(a.id_fisico.trim().toLowerCase()) ? null : 'Minúsculas, dígitos y guion, de 3 a 63 caracteres.',
    nombre: a.nombre.trim().length >= 1 && a.nombre.trim().length <= 80 ? null : 'Escribe un nombre de 1 a 80 caracteres.',
    sitio: misSitios.some((s) => s.codigo === a.sitio) ? null : 'Elige el sitio.',
    zona: a.zona_id !== '' ? null : zonasDelSitio.length === 0 ? 'Este sitio no tiene zonas: crea una primero.' : 'Elige la zona.',
  }));
  const visible = (c: 'id_fisico' | 'nombre' | 'sitio' | 'zona'): string | null => (tocados[c] === true ? errorCampo[c] : null);

  // Lo mismo que exige el servidor (alta.dto.ts, validarAlta), por paso, para escribir el motivo junto al botón «Siguiente».
  const FORMA_ID = /^[a-z0-9][a-z0-9-]{2,62}$/;
  const faltaPaso = $derived.by((): string | null => {
    if (paso === 1) {
      if (!FORMA_ID.test(a.id_fisico.trim().toLowerCase())) return 'el identificador: minúsculas, dígitos y guion, de 3 a 63';
      if (a.nombre.trim().length < 1 || a.nombre.trim().length > 80) return 'el nombre (1 a 80 caracteres)';
      if (a.zona_id === '') return 'la zona';
    }
    if (paso === 2) {
      const i = /^\d+$/.test(a.intervalo.trim()) ? Number(a.intervalo) : NaN;
      if (!(i >= 5 && i <= 86_400)) return 'el intervalo: entero entre 5 y 86400 segundos';
      if (a.via === 'lorawan' && a.pasarela_id === '') return 'la pasarela (un nodo LoRaWAN llega por una)';
    }
    if (paso === 3) {
      const c = canalesAlta.map((x) => x.trim().toLowerCase()).filter((x) => x !== '');
      if (c.length === 0) return 'al menos un canal (la magnitud del catálogo)';
      if (new Set(c).size !== c.length) return 'una magnitud repetida';
    }
    return null;
  });

  async function cargarPasarelas(): Promise<void> {
    try {
      pasarelas = await obtener('/pasarelas');
    } catch (e) {
      if (!esCancelacion(e)) pasarelas = [];
    }
  }
  $effect(() => {
    if (a.via === 'lorawan' && pasarelas === null) untrack(() => void cargarPasarelas());
  });

  async function crear(): Promise<void> {
    if (creando) return;
    creando = true;
    avisoAlta = null;
    const cuerpo: Record<string, unknown> = {
      id_fisico: a.id_fisico.trim().toLowerCase(), nombre: a.nombre.trim(), zona_id: a.zona_id, via: a.via, intervalo_esperado_s: Number(a.intervalo),
      canales: canalesAlta.map((x) => x.trim().toLowerCase()).filter((x) => x !== '').map((magnitud) => ({ magnitud })),
    };
    if (a.via === 'lorawan') cuerpo.pasarela_id = a.pasarela_id;
    else cuerpo.formato = a.formato;
    try {
      const r = await pedir<{ id: string; id_fisico: string; nombre: string; conexion: Record<string, unknown> }>('POST', '/dispositivos', { cuerpo });
      creado = r;
      paso = 4;
    } catch (e) {
      avisoAlta = e instanceof ErrorApi && e.codigo === 409
        ? { tipo: 'conflicto', texto: `${e.motivos[0] ?? 'Ese identificador ya existe'}. Si está en mantenimiento o dado de baja, ábrelo desde el inventario en vez de crear un duplicado.` }
        : avisoDeError(e);
    } finally {
      creando = false;
    }
  }

  async function copiar(valor: string, que: string): Promise<void> {
    try {
      await navigator.clipboard.writeText(valor);
      copiado = que;
    } catch {
      copiado = 'manual';
    }
  }

  // Paso 5: el canal en vivo del dispositivo nuevo; la primera `visto` o `medicion` cierra la espera (F1).
  function esperarPrimeraTrama(): void {
    if (creado === null) return;
    paso = 5;
    const id = creado.id;
    canalVivo?.cerrar();
    canalVivo = abrirCanal(`/eventos?dispositivo=${encodeURIComponent(id)}`, (e: EventoVivo) => {
      if ((e.tipo === 'visto' || e.tipo === 'medicion') && e.dispositivo_id === id && primeraTrama === null) {
        primeraTrama = e.tiempo;
        canalVivo?.cerrar();
        canalVivo = null;
      }
    }, () => {});
  }
  function otroMas(): void {
    canalVivo?.cerrar();
    canalVivo = null;
    creado = null; // la credencial deja la memoria de la página
    primeraTrama = null;
    copiado = null;
    a = { ...a, id_fisico: '', nombre: '' };
    canalesAlta = [''];
    paso = 1;
  }

  // ── Detectados ────────────────────────────────────────────────────────────────────────────────────────────────────────────────
  const carga = ultimaGana();
  let detectados = $state<{ sitio_codigo: string | null; emisor: string; topico: string | null; tramas: number; ultima: string }[] | null>(null);
  let errorDetectados = $state<string | null>(null);
  async function cargarDetectados(): Promise<void> {
    try {
      detectados = await obtener('/cuarentena/detectados', carga.senal());
      errorDetectados = null;
    } catch (e) {
      if (!esCancelacion(e)) errorDetectados = avisoDeError(e).texto;
    }
  }
  $effect(() => {
    if (modo === 'detectados' && detectados === null) untrack(() => void cargarDetectados());
  });
  // Un enlace desde la bandeja trae otro identificador: el asistente vuelve al paso 1 con él.
  $effect(() => {
    const idf = idFisico;
    const s = sitio;
    untrack(() => {
      if (idf !== '' && idf !== a.id_fisico && creado === null) a = { ...a, id_fisico: idf, sitio: s || a.sitio };
      if (idf !== '') paso = paso > 3 ? paso : 1;
    });
  });
  const zonaSitio = $derived(misSitios[0]?.zona_horaria ?? 'UTC');

  // La credencial del asistente solo vive en memoria hasta pasar al paso siguiente: se olvida al salir de la pantalla y al perder la sesión
  // (revisión del 11/11/2026). Las del alta masiva, con su aviso al cerrar la pestaña, las cuida AltaLote.
  onMount(() => {
    const dejar = alPerderSesion((m) => { if (m === 'sin_sesion') creado = null; });
    return () => {
      canalVivo?.cerrar();
      carga.cancelar();
      dejar();
      creado = null;
    };
  });
</script>

<div class="alta" data-alta>
  <h2>Dar de alta dispositivos</h2>
  <nav aria-label="Formas de dar de alta" class="acciones">
    <a href={fragmentoAlta('uno')} aria-current={modo === 'uno' ? 'page' : undefined} data-ir-asistente>Uno por uno</a>
    <a href={fragmentoAlta('lote')} aria-current={modo === 'lote' ? 'page' : undefined} data-ir-lote>Alta masiva por archivo</a>
    <a href={fragmentoAlta('detectados')} aria-current={modo === 'detectados' ? 'page' : undefined} data-ir-detectados>Detectados sin alta</a>
  </nav>
  {#if sitios !== null && misSitios.length === 0}
    <p class="vacio" data-sin-sitios-alta>No puedes dar de alta en ningún sitio: hace falta el perfil de administrador (u operador técnico) del sitio.</p>
  {:else if modo === 'uno'}
    <section aria-labelledby="{uid}-asistente" data-asistente>
      <h3 id="{uid}-asistente">Asistente</h3>
      <ol class="pasos" data-pasos>
        {#each PASOS as p, i (p)}<li aria-current={paso === i + 1 ? 'step' : undefined}>{i + 1}. {p}</li>{/each}
      </ol>
      <h4 class="titulo-paso" tabindex="-1" bind:this={encabezadoPaso} data-titulo-paso>Paso {paso} de {PASOS.length}: {PASOS[paso - 1]}</h4>
      {#if avisoAlta !== null}<Aviso tipo={avisoAlta.tipo} texto={avisoAlta.texto} alCerrar={() => (avisoAlta = null)} />{/if}
      {#if paso === 1}
        <div class="formulario-configurar" data-paso="1">
          <div class="campo">
            <label for="{uid}-idf">Identificador físico</label>
            <input id="{uid}-idf" type="text" maxlength="63" autocomplete="off" bind:value={a.id_fisico} onblur={() => (tocados.id_fisico = true)}
              aria-invalid={visible('id_fisico') !== null} aria-describedby="{uid}-idf-ayuda {uid}-idf-error" data-campo="id_fisico" />
            <span class="ayuda-campo" id="{uid}-idf-ayuda">Minúsculas, dígitos y guion (3 a 63): es también el usuario del broker y va en el tópico.</span>
            <span class="error-campo" id="{uid}-idf-error" data-error-campo="id_fisico">{visible('id_fisico') ?? ''}</span>
          </div>
          <div class="campo">
            <label for="{uid}-nombre">Nombre</label>
            <input id="{uid}-nombre" type="text" maxlength="80" bind:value={a.nombre} onblur={() => (tocados.nombre = true)}
              aria-invalid={visible('nombre') !== null} aria-describedby="{uid}-nombre-error" data-campo="nombre" />
            <span class="error-campo" id="{uid}-nombre-error" data-error-campo="nombre">{visible('nombre') ?? ''}</span>
          </div>
          <div class="campo">
            <label for="{uid}-sitio">Sitio</label>
            <select id="{uid}-sitio" bind:value={a.sitio} onblur={() => (tocados.sitio = true)} aria-invalid={visible('sitio') !== null}
              disabled={creandoZona} aria-describedby="{uid}-sitio-error" data-campo="sitio">
              {#each misSitios as s (s.id)}<option value={s.codigo}>{s.nombre}</option>{/each}
            </select>
            <span class="error-campo" id="{uid}-sitio-error" data-error-campo="sitio">{visible('sitio') ?? ''}</span>
          </div>
          <div class="campo">
            <label for="{uid}-zona">Zona</label>
            <select id="{uid}-zona" bind:value={a.zona_id} onblur={() => (tocados.zona = true)} aria-invalid={visible('zona') !== null}
              aria-describedby="{uid}-zona-error" data-campo="zona">
              {#each zonasDelSitio as z (z.id)}<option value={z.id}>{z.nombre}</option>{/each}
            </select>
            <span class="error-campo" id="{uid}-zona-error" data-error-campo="zona">{visible('zona') ?? ''}</span>
            {#if creaZonas}
              {#if nuevaZona === null}
                <Boton etiqueta="+ Nueva zona…" variante="discreto" onclick={() => { nuevaZona = ''; errorNuevaZona = null; }} data-nueva-zona />
              {:else}
                <div class="nueva-zona" data-campo-nueva-zona>
                  <label for="{uid}-nueva-zona">Nombre de la zona nueva</label>
                  <input id="{uid}-nueva-zona" bind:value={nuevaZona} maxlength="80" aria-invalid={errorNuevaZona !== null} aria-describedby="{uid}-nueva-zona-error"
                    onkeydown={(e) => { if (e.key === 'Enter') { e.preventDefault(); void crearZona(); } }} />
                  <Boton etiqueta="Crear zona" cargando={creandoZona} onclick={() => void crearZona()} data-crear-zona />
                  <Boton etiqueta="Cancelar" variante="discreto" onclick={() => { nuevaZona = null; errorNuevaZona = null; }} />
                  <span class="error-campo" id="{uid}-nueva-zona-error" role="alert" data-error-nueva-zona>{errorNuevaZona ?? ''}</span>
                </div>
              {/if}
            {/if}
          </div>
        </div>
      {:else if paso === 2}
        <div class="formulario-configurar" data-paso="2">
          <div class="campo">
            <label for="{uid}-via">Vía de envío</label>
            <select id="{uid}-via" bind:value={a.via} aria-describedby="{uid}-via-ayuda" data-campo="via">
              <option value="mqtt">MQTT (directo al broker)</option><option value="http">HTTP</option><option value="lorawan">LoRaWAN (por una pasarela)</option>
            </select>
            <span class="ayuda-campo" id="{uid}-via-ayuda">La credencial depende de la vía: MQTT, usuario y clave; HTTP, un token; LoRaWAN, la de su pasarela.</span>
          </div>
          {#if a.via === 'lorawan'}
            <div class="campo">
              <label for="{uid}-pasarela">Pasarela</label>
              <select id="{uid}-pasarela" bind:value={a.pasarela_id} data-campo="pasarela">
                <option value="">— elige —</option>
                {#each pasarelasDelSitio as p (p.id)}<option value={p.id}>{p.nombre} ({p.id_fisico})</option>{/each}
              </select>
              {#if pasarelas !== null && pasarelasDelSitio.length === 0}<span class="ayuda-campo" data-sin-pasarelas>Este sitio no tiene pasarelas activas: da de alta una primero.</span>{/if}
            </div>
          {:else}
            <div class="campo">
              <label for="{uid}-formato">Formato</label>
              <select id="{uid}-formato" bind:value={a.formato} data-campo="formato"><option value="senml">SenML (recomendado)</option><option value="plano">Plano</option></select>
            </div>
          {/if}
          <div class="campo">
            <label for="{uid}-intervalo">Intervalo esperado (segundos)</label>
            <input id="{uid}-intervalo" type="text" inputmode="numeric" bind:value={a.intervalo} data-campo="intervalo" />
          </div>
        </div>
      {:else if paso === 3}
        <div class="formulario-configurar" data-paso="3">
          {#each canalesAlta as _, i (i)}
            <div class="campo">
              <label for="{uid}-canal-{i}">Magnitud del canal {i + 1}</label>
              <input id="{uid}-canal-{i}" type="text" maxlength="40" autocomplete="off" bind:value={canalesAlta[i]} aria-describedby="{uid}-canal-ayuda" data-campo="canal" />
              {#if canalesAlta.length > 1}<Boton etiqueta="Quitar este canal" variante="discreto" onclick={() => (canalesAlta = canalesAlta.filter((_, j) => j !== i))} />{/if}
            </div>
          {/each}
          <span class="ayuda-campo" id="{uid}-canal-ayuda">El código de la magnitud del catálogo (temperatura, humedad, presion…); la unidad la fija el catálogo.</span>
          <span class="acciones"><Boton etiqueta="Agregar un canal" motivoDesactivado={canalesAlta.length >= 20 ? 'como mucho 20 canales' : null} onclick={() => (canalesAlta = [...canalesAlta, ''])} /></span>
        </div>
      {:else if paso === 4 && creado !== null}
        {@const cx = creado.conexion}
        <div class="clave-una-vez" data-credencial-una-vez>
          <p role="status"><strong>{creado.nombre}</strong> quedó dado de alta. <strong>La credencial no se vuelve a mostrar</strong>: cópiala ahora y
            guárdala en el nodo. Si se pierde, se reemplaza desde la ficha (rotar), nunca se recupera.</p>
          {#if cx.via === 'mqtt'}
            <p>Usuario: <code data-usuario-mqtt>{String(cx.usuario)}</code> · Tópico: <code data-topico>{String(cx.topico)}</code></p>
            <code data-credencial>{String(cx.credencial)}</code>
            <span class="acciones">
              <Boton etiqueta={copiado === 'credencial' ? 'Copiada' : 'Copiar la credencial'} onclick={() => void copiar(String(cx.credencial), 'credencial')} />
              <Boton etiqueta={copiado === 'topico' ? 'Copiado' : 'Copiar el tópico'} onclick={() => void copiar(String(cx.topico), 'topico')} />
            </span>
          {:else if cx.via === 'http'}
            <code data-credencial>{String(cx.token)}</code>
            <p class="vivo">{String(cx.nota ?? '')}</p>
            <Boton etiqueta={copiado === 'credencial' ? 'Copiado' : 'Copiar el token'} onclick={() => void copiar(String(cx.token), 'credencial')} />
          {:else}
            <p class="vivo" data-sin-credencial>{String(cx.nota ?? 'Un nodo LoRaWAN no tiene credencial propia: la autentica su pasarela.')}</p>
          {/if}
          {#if copiado === 'manual'}<p class="vivo">El navegador no deja copiar desde esta dirección: selecciónala y cópiala con Ctrl+C.</p>{/if}
        </div>
      {:else if paso === 5 && creado !== null}
        <div data-paso="5">
          {#if primeraTrama === null}
            <p role="status" data-esperando>Esperando la primera trama de <strong>{creado.nombre}</strong>… Configura el nodo con la credencial; esta pantalla se
              actualiza sola cuando llegue.</p>
          {:else}
            <p role="status" data-primera-trama>Llegó la primera trama ({fechaHora(primeraTrama, zonaSitio)}). <a href={fragmentoFicha(creado.id, null, '1h')}>Abrir la ficha</a></p>
          {/if}
        </div>
      {/if}
      <span class="acciones">
        {#if paso > 1 && paso < 4}<Boton etiqueta="Anterior" variante="discreto" onclick={() => (paso -= 1)} />{/if}
        {#if paso < 3}<Boton etiqueta="Siguiente" variante="principal" motivoDesactivado={faltaPaso === null ? null : `falta ${faltaPaso}`} onclick={() => (paso += 1)} data-siguiente />{/if}
        {#if paso === 3}<Boton etiqueta="Crear el dispositivo" etiquetaCargando="Creando…" variante="principal" cargando={creando}
          motivoDesactivado={creando ? null : faltaPaso === null ? null : `falta ${faltaPaso}`} onclick={() => void crear()} data-crear />{/if}
        {#if paso === 4}<Boton etiqueta="Ya la guardé: esperar la primera trama" variante="principal" onclick={esperarPrimeraTrama} data-esperar />{/if}
        {#if paso === 5}<Boton etiqueta="Dar de alta otro" onclick={otroMas} />{/if}
      </span>
    </section>
  {:else if modo === 'lote'}
    <AltaLote persona={sesion === null ? null : sesion.sistema ? 'sistema' : sesion.usuario.id}
      zonasEn={sesion === null ? [] : misSitios.filter((x) => puedeEnSitio(sesion, x, 'ajustes')).map((x) => ({ id: x.id, nombre: x.nombre }))}
      sitioActivo={sitioActivo?.id ?? null} />
  {:else}
    <section aria-labelledby="{uid}-detectados" data-detectados>
      <h3 id="{uid}-detectados">Detectados sin alta (últimos 7 días)</h3>
      {#if errorDetectados !== null}
        <p class="error" role="alert">{errorDetectados} <Boton etiqueta="Reintentar" onclick={() => void cargarDetectados()} /></p>
      {:else if detectados === null}
        <p class="vacio">Cargando…</p>
      {:else if detectados.length === 0}
        <p class="vacio" data-sin-detectados>Ningún emisor desconocido en los últimos 7 días: todo lo que habla está dado de alta.</p>
      {:else}
        <div class="tabla">
          <table>
            <thead><tr><th scope="col">Emisor</th><th scope="col">Sitio</th><th scope="col">Tramas</th><th scope="col">Última</th><th scope="col">Acción</th></tr></thead>
            <tbody>
              {#each detectados as x (`${x.sitio_codigo}|${x.emisor}`)}
                <tr data-detectado={x.emisor}>
                  <td>{x.emisor}{#if x.topico !== null}<br /><span class="vivo">{x.topico}</span>{/if}</td>
                  <td>{x.sitio_codigo ?? 'sin sitio'}</td><td class="num">{x.tramas}</td>
                  <td title={horaLocal(x.ultima, zonaSitio)}>{fechaHora(x.ultima, zonaSitio)}</td>
                  <td><Boton etiqueta="Dar de alta" onclick={() => (window.location.hash = fragmentoAlta('uno', x.emisor, x.sitio_codigo ?? ''))} data-alta-detectado={x.emisor} /></td>
                </tr>
              {/each}
            </tbody>
          </table>
        </div>
      {/if}
    </section>
  {/if}
</div>
