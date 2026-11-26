<script lang="ts" module>
  // Un equipo listo para cargar: lo que dio el alta. La clave vive solo en la memoria de la página (la de quien llama).
  export interface EquipoACargar {
    id: string; // el del dispositivo (UUID), para el canal en vivo de su primera trama
    id_fisico: string;
    sitio: string;
    clave: string;
  }
</script>

<script lang="ts">
  // «Cargar en el equipo» (docs/19 §4, bloque Z): la red Wi-Fi, el servidor y la credencial por USB, sin que la persona copie ni vea la
  // clave. Sirve al asistente (un equipo) y al resultado del alta masiva (los creados por MQTT, de a uno). El protocolo, en lib/serie.ts.
  // La red y su clave viven solo en el estado de este componente: nunca van al servidor ni al almacenamiento del navegador, y se olvidan
  // al salir de la pantalla.
  import { onMount } from 'svelte';
  import Boton from './Boton.svelte';
  import type { EventoVivo } from './lib/modelo';
  import { abrirCanal, type Canal } from './lib/vivo';
  import { TEXTO_CAMPO, cargarEnEquipo, serieDelNavegador, textoDeFalla, validarDatos, type PasoCarga, type SerieDelNavegador, type Tiempos } from './lib/serie';

  let { equipos, otros = 0, serie = serieDelNavegador(), seguro = globalThis.isSecureContext === true, tiempos = {} }: {
    equipos: EquipoACargar[];
    otros?: number; // los creados que no van por MQTT: no se cargan por USB
    serie?: SerieDelNavegador | null;
    seguro?: boolean; // contexto seguro (HTTPS o localhost): sin él, ningún navegador ofrece el puerto serie
    tiempos?: Partial<Tiempos>;
  } = $props();
  // La clave de la red, enmascarada sin ser un campo de contraseña (si el navegador sabe enmascarar un texto): un campo de contraseña
  // invita al gestor de contraseñas a guardarla para el sitio del panel. Sin probar en un Chrome real si lo ofrecería; es la forma prudente.
  const enmascara = typeof CSS !== 'undefined' && typeof CSS.supports === 'function' && CSS.supports('-webkit-text-security', 'disc');
  const uid = $props.id();

  type Paso = PasoCarga | 'trama';
  const PASOS: readonly { id: Paso; texto: string }[] = [
    { id: 'cargada', texto: 'Credencial cargada' },
    { id: 'red', texto: 'Conectó a la red' },
    { id: 'broker', texto: 'El broker la aceptó' },
    { id: 'trama', texto: 'Llegó la primera trama' },
  ];
  interface Avance { hechos: Paso[]; en: 'nada' | 'cargando' | 'hecho' | 'falla'; falla: string | null; sinSeguimiento: boolean }
  let abierto = $state(false);
  let red = $state({ nombre: '', clave: '', servidor: typeof window === 'undefined' ? '' : window.location.hostname, puerto: '8883' });
  let verClave = $state(false);
  let errorRed = $state<string | null>(null);
  let avances = $state<Record<string, Avance>>({});
  let enCurso = $state<string | null>(null);
  const canales = new Map<string, Canal>();
  let control: AbortController | null = null;
  // El equipo ya está cargado con OTRO identificador: se pide escribirlo para reemplazarlo (en el lote, un clic de más no basta).
  let pidiendo = $state<{ idf: string; actual: string; escrito: string } | null>(null);
  let responderPedido: ((si: boolean) => void) | null = null;
  function confirmarReemplazo(idf: string, actual: string): Promise<boolean> {
    return new Promise((res) => {
      pidiendo = { idf, actual, escrito: '' };
      responderPedido = (si) => { pidiendo = null; responderPedido = null; res(si); };
      control?.signal.addEventListener('abort', () => responderPedido?.(false), { once: true });
    });
  }

  const avance = (idf: string): Avance => avances[idf] ?? { hechos: [], en: 'nada', falla: null, sinSeguimiento: false };
  const hechos = $derived(equipos.filter((e) => avance(e.id_fisico).en === 'hecho').length);

  // La primera trama: el canal en vivo del dispositivo, el mismo del paso 5 del asistente (F1).
  function esperarTrama(e: EquipoACargar): void {
    if (canales.has(e.id)) return;
    const c = abrirCanal(`/eventos?dispositivo=${encodeURIComponent(e.id)}`, (ev: EventoVivo) => {
      if ((ev.tipo === 'visto' || ev.tipo === 'medicion') && ev.dispositivo_id === e.id) {
        marcar(e.id_fisico, 'trama');
        canales.get(e.id)?.cerrar();
        canales.delete(e.id);
      }
    }, () => {});
    canales.set(e.id, c);
  }
  function marcar(idf: string, p: Paso): void {
    const a = avance(idf);
    if (!a.hechos.includes(p)) avances[idf] = { ...a, hechos: [...a.hechos, p] };
  }

  async function conectarYCargar(e: EquipoACargar): Promise<void> {
    if (serie === null || enCurso !== null) return;
    errorRed = null;
    const datos = { red: red.nombre, clave_red: red.clave, servidor: red.servidor.trim(), puerto: Number(red.puerto), sitio: e.sitio, id: e.id_fisico, clave: e.clave };
    const malo = validarDatos(datos);
    // Lo de la red y el servidor se corrige arriba, una vez para todos; lo del equipo, en su fila.
    if (malo === 'red' || malo === 'clave_red' || malo === 'servidor' || malo === 'puerto') {
      errorRed = `Revisa ${TEXTO_CAMPO[malo]}.`;
      return;
    }
    if (malo !== null) {
      avances[e.id_fisico] = { ...avance(e.id_fisico), en: 'falla', falla: `Este equipo no se puede cargar por USB: revisa ${TEXTO_CAMPO[malo]}.` };
      return;
    }
    let puerto: Awaited<ReturnType<SerieDelNavegador['requestPort']>>;
    try {
      puerto = await serie.requestPort(); // el selector del navegador: la persona elige el puerto con este mismo clic
    } catch (x) {
      // NotFoundError: la persona cerró el selector. Otro (SecurityError, NotAllowedError): el navegador no dio permiso al sitio; decir «no elegiste»
      // sería falso (corrección del 25/11/2026).
      const cerro = x instanceof DOMException && x.name === 'NotFoundError';
      avances[e.id_fisico] = { ...avance(e.id_fisico), en: 'falla', falla: cerro ? 'No elegiste un puerto. Conecta el equipo por USB y vuelve a intentar.'
        : 'El navegador no dio permiso para usar el puerto serie: revisa los permisos de este sitio, o usa la ficha o el guion de terminal.' };
      return;
    }
    enCurso = e.id_fisico;
    avances[e.id_fisico] = { hechos: [], en: 'cargando', falla: null, sinSeguimiento: false };
    control = new AbortController();
    const r = await cargarEnEquipo(puerto, datos, (p) => {
      marcar(e.id_fisico, p);
      if (p === 'cargada') esperarTrama(e);
    }, { tiempos, senal: control.signal, confirmarReemplazo: (actual) => confirmarReemplazo(e.id_fisico, actual) });
    control = null;
    enCurso = null;
    const a = avance(e.id_fisico);
    avances[e.id_fisico] = r.falla === null
      ? { ...a, en: 'hecho', falla: null, sinSeguimiento: r.sinSeguimiento }
      : { ...a, en: 'falla', falla: textoDeFalla(r.falla) };
  }

  function textoDeFila(a: Avance): string {
    if (a.en === 'cargando') return 'Cargando…';
    if (a.en === 'hecho') return a.hechos.includes('trama') ? 'Listo: ya envía datos' : 'Cargado';
    if (a.en === 'falla') return a.hechos.includes('cargada') ? 'Cargado, sin conectar' : 'Sin cargar';
    return 'Sin cargar';
  }

  onMount(() => () => {
    control?.abort();
    responderPedido?.(false);
    for (const c of canales.values()) c.cerrar();
    canales.clear();
    red = { nombre: '', clave: '', servidor: '', puerto: '' }; // la clave de la red deja la memoria de la página
  });
</script>

<div class="carga-usb" data-carga-usb>
  {#if serie === null}
    <p class="vivo" data-sin-serie={seguro ? 'navegador' : 'inseguro'}>
      {#if seguro}
        <strong>Cargar en el equipo por USB no está disponible en este navegador</strong> (necesita Web Serial, el puerto serie del navegador: lo
        tienen Chrome, Edge y Opera, y Firefox de escritorio desde la versión 151; Safari, no).
      {:else}
        <strong>Cargar en el equipo por USB necesita que el panel se abra por HTTPS</strong> (o en <code>localhost</code>): en esta dirección el
        navegador no ofrece el puerto serie.
      {/if}
      Usa lo de siempre: {equipos.length > 1 ? 'el archivo de credenciales' : 'copia los datos o descarga la ficha'}, o
      carga el equipo desde una terminal con <code>python3 herramientas/cargar-equipo.py</code> (en <code>plataforma/firmware</code>).
    </p>
  {:else if !abierto}
    <span class="acciones">
      <Boton etiqueta="Cargar en el equipo" variante="principal" onclick={() => (abierto = true)} data-cargar-equipo />
    </span>
    <span class="ayuda-campo">Con el equipo conectado por USB a este computador, la credencial pasa directo al equipo: no hay que copiarla.</span>
  {:else}
    <fieldset class="formulario-configurar" data-red-carga>
      <legend>La red Wi-Fi del equipo y el servidor</legend>
      <div class="campo">
        <label for="{uid}-red">Nombre de la red Wi-Fi</label>
        <input id="{uid}-red" type="text" autocomplete="off" spellcheck="false" bind:value={red.nombre} data-campo-carga="red" />
      </div>
      <div class="campo">
        <label for="{uid}-clave-red">Clave de la red</label>
        <input id="{uid}-clave-red" type={verClave || enmascara ? 'text' : 'password'} class:enmascarada={enmascara && !verClave} autocomplete="off"
          autocapitalize="off" spellcheck="false" bind:value={red.clave} aria-describedby="{uid}-clave-red-ayuda" data-campo-carga="clave_red" />
        <Boton etiqueta={verClave ? 'Ocultar' : 'Mostrar'} variante="discreto" presionado={verClave} onclick={() => (verClave = !verClave)} data-ver-clave-red />
        <span class="ayuda-campo" id="{uid}-clave-red-ayuda">Vacía si la red es abierta. Se usa solo en esta página: no se guarda ni se envía al servidor.</span>
      </div>
      <div class="campo">
        <label for="{uid}-servidor">Servidor (como lo alcanza el equipo)</label>
        <input id="{uid}-servidor" type="text" autocomplete="off" spellcheck="false" bind:value={red.servidor} data-campo-carga="servidor" />
      </div>
      <div class="campo">
        <label for="{uid}-puerto">Puerto</label>
        <input id="{uid}-puerto" type="text" inputmode="numeric" bind:value={red.puerto} data-campo-carga="puerto" />
      </div>
      <span class="error-campo" role="alert" data-error-red-carga>{errorRed ?? ''}</span>
    </fieldset>
    {#if equipos.length > 1}
      <p data-resumen-carga>{hechos} de {equipos.length} cargados. Conecta cada equipo y pulsa «Conectar y cargar» en su fila.</p>
    {/if}
    {#if otros > 0}
      <p class="vivo" data-otros-carga>{otros === 1 ? '1 creado no va por MQTT' : `${otros} creados no van por MQTT`}: no se carga por USB (usa el archivo de credenciales).</p>
    {/if}
    <ul class="lista-carga" aria-label="Equipos para cargar">
      {#each equipos as e (e.id_fisico)}
        {@const a = avance(e.id_fisico)}
        {@const etiqueta = a.en === 'falla' ? 'Reintentar' : a.en === 'hecho' ? 'Cargar de nuevo' : 'Conectar y cargar'}
        <li class="fila-carga" data-equipo-carga={e.id_fisico} data-estado-carga={a.en}>
          <div class="fila-1"><code>{e.id_fisico}</code> <span data-texto-carga>{textoDeFila(a)}</span></div>
          {#if a.en !== 'nada'}
            <ol class="avance-carga" role="status" aria-label={`Avance de ${e.id_fisico}`}>
              {#each PASOS as p (p.id)}
                {@const listo = a.hechos.includes(p.id)}
                <li class:hecho={listo} data-paso-carga={p.id} data-hecho={listo}>
                  <span aria-hidden="true">{listo ? '✓' : '·'}</span> {p.texto}<span class="solo-lector">{listo ? ': hecho' : ': pendiente'}</span>
                </li>
              {/each}
            </ol>
          {/if}
          {#if a.sinSeguimiento}<p class="vivo" data-sin-seguimiento>El equipo cerró el puerto al reiniciarse: el avance sigue con la primera trama.</p>{/if}
          {#if pidiendo !== null && pidiendo.idf === e.id_fisico}
            <div class="reemplazo" role="alert" data-reemplazo={e.id_fisico}>
              <p>Este equipo ya está cargado como <code>{pidiendo.actual}</code>. Si lo cargas como <code>{e.id_fisico}</code>, <code>{pidiendo.actual}</code>
                deja de enviar datos. Para reemplazarlo, escribe <code>{pidiendo.actual}</code>:</p>
              <label for="{uid}-{e.id_fisico}-actual" class="solo-lector">Identificador actual del equipo</label>
              <input id="{uid}-{e.id_fisico}-actual" type="text" autocomplete="off" spellcheck="false" bind:value={pidiendo.escrito} data-confirmar-actual />
              <span class="acciones">
                <Boton etiqueta={`Reemplazar ${pidiendo.actual}`} variante="principal"
                  motivoDesactivado={pidiendo.escrito.trim() === pidiendo.actual ? null : 'escribe el identificador actual'}
                  onclick={() => responderPedido?.(true)} data-confirmar-reemplazo />
                <Boton etiqueta="No reemplazar" onclick={() => responderPedido?.(false)} data-no-reemplazar />
              </span>
            </div>
          {/if}
          {#if a.falla !== null}<p class="error" role="alert" data-falla-carga>{a.falla}</p>{/if}
          <Boton {etiqueta} etiquetaCargando="Cargando…"
            variante={a.en === 'nada' || a.en === 'falla' ? 'principal' : 'normal'} cargando={enCurso === e.id_fisico}
            motivoDesactivado={enCurso !== null && enCurso !== e.id_fisico ? 'hay otra carga en curso: de a un equipo' : null}
            aria-label={`${etiqueta} ${e.id_fisico}`}
            onclick={() => void conectarYCargar(e)} data-conectar-cargar={e.id_fisico} />
        </li>
      {/each}
    </ul>
  {/if}
</div>
