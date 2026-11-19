<script lang="ts">
  // P7 Alta masiva en tres pasos (docs/19 §4, bloque N, puntos 6 a 9):
  //  1. Origen: un archivo CSV, JSON o un libro .xlsx (su primera hoja, con el lector propio de lib/xlsx-lector.ts, que se descarga solo al
  //     elegir uno: bloque N, punto 6), o lo pegado desde la planilla. Se lee en el navegador (lib/lote.ts) con las columnas y los límites de
  //     `GET /dispositivos/lote/plantilla`: el panel no guarda copia de ellos.
  //  2. Revisión: lo que el servidor haría con cada fila (`modo=validar`, no crea nada), con cinco filtros, el detalle campo por campo y, si
  //     la persona confirma, UNA petición `modo=crear`, todo o nada, con la huella del plan que vio y una llave de reintento.
  //  3. Resultado: cuántos se crearon y sus credenciales, que se descargan UNA sola vez.
  // Nada de esto es optimista: muestra secretos una vez y crea filas (docs/19 §6). El bloque S (docs/19 §4) le quitó fricción: una fila mal
  // formada no frena a las demás (1), avisos que distinguen y la zona por nombre dicha una vez (3), las palabras del servidor (4), «Ya existe»
  // en ámbar con «Abrir su ficha» (5), los botones y las ayudas esenciales a la vista sobre la lista (6), las credenciales que sobreviven a
  // «atrás» (7), el foco tras «Mostrar 100 más» y «Ya las guardé» (8), el libro de Excel reconocido (9; desde el 19/11/2026, leído) y la lectura que descarta la anterior (10).
  import { onMount, tick, untrack } from 'svelte';
  import Boton from './Boton.svelte';
  import Icono from './Icono.svelte';
  import { ErrorApi, alPerderSesion, descargarTexto, esCancelacion, obtener, pedir, ultimaGana } from './lib/api';
  import { avisoDeError } from './lib/avisos';
  import {
    ACCION_DE, FalloDeCreacion, ROTULO_ACCION, TEXTO_SESION_RETOMADA, baseDeDescarga, borradorLote, crearConReintento, credencialesLote, csvCredenciales, csvPlantilla, csvRechazadas,
    excedeBytes, explicarError, filaQueNoEntra, leerArchivoLote, leerOrigen, megas, mezclarPlan, nuevaLlave, olvidarCredencialesLote, retomarLoteDe, textoPesado, type AccionLote, type ErrorExplicado, type FilaInforme,
    type FilaLote, type FilaNoEntra, type InformeLote, type LecturaCsv, type PlantillaLote, type Problema, type ZonaPorNombre,
  } from './lib/lote';
  import { seguirAngosto } from './lib/medios';
  import { DE_A, FILTROS, camposDeFila, coincide, conAvisoQueSeCrean, contar, filtroInicial, fraseDeFila, resumenDeFila, resumenRevision, type FiltroLote } from './lib/revision';

  // `persona`: quién está dentro (su id, o «sistema»). Lo que guarda la memoria de la pestaña se retoma solo si lo leyó ella.
  let { persona = null }: { persona?: string | null } = $props();
  retomarLoteDe(untrack(() => persona));
  const uid = $props.id();
  const PASOS = ['Origen', 'Revisión', 'Resultado'] as const;
  const ORIGEN_PEGADO = 'Lo pegado';
  // Con credenciales sin descargar en la memoria del módulo (bloque S, punto 7), la pantalla reabre en el paso 3 con ellas.
  let paso = $state<1 | 2 | 3>(credencialesLote.filas.length > 0 ? 3 : 1);
  let angosto = $state(false);

  // El origen leído se retoma del borrador de la pestaña (lib/lote.ts): si la sesión venció, la aplicación mostró «Entrar» y, al volver, la
  // persona no tiene que elegirlo de nuevo (docs/19 §4, N8b).
  let archivo = $state<string | null>(borradorLote.archivo);
  let filasArchivo = $state<FilaLote[]>(borradorLote.filas);
  // Las filas mal formadas del origen (bloque S, punto 1): no se envían; la revisión las muestra como «No entra» con su motivo.
  let noEntranArchivo = $state<FilaNoEntra[]>(borradorLote.noEntran);
  let erroresArchivo = $state<Problema[]>([]);
  // Mientras se lee un archivo nuevo, el anterior ya no cuenta y «Revisar las filas» espera (bloque S, punto 10).
  let leyendo = $state(false);
  let zonasPorNombre = $state<ZonaPorNombre[]>([]);
  let pegado = $state('');
  let informe = $state<FilaInforme[] | null>(null);
  let huella = $state<string | null>(null);
  let filtro = $state<FiltroLote>('leidas');
  let mostrar = $state(DE_A);
  let abiertas = $state<ReadonlySet<number>>(new Set());
  let validando = $state(false);
  let creandoLote = $state(false);
  let creadas = $state(credencialesLote.creadas);
  // Un error del alta masiva, ya traducido (qué pasó, por qué y el botón del remedio: docs/19 §4, N8b). El foco va al aviso.
  let errorLote = $state<ErrorExplicado | null>(untrack(() => borradorLote.aviso));
  borradorLote.aviso = null;
  let cajaError = $state<HTMLDivElement | null>(null);
  let cajaArchivo = $state<HTMLDivElement | null>(null);
  let campoArchivo = $state<HTMLInputElement | null>(null);
  let campoPegado = $state<HTMLTextAreaElement | null>(null);
  let zonaInforme = $state<HTMLDivElement | null>(null);
  let encabezadoPaso = $state<HTMLHeadingElement | null>(null);
  // Las credenciales de las creadas: solo en memoria hasta que la persona las descarga y pulsa «olvidar». Viven también en la memoria del
  // módulo (credencialesLote), para que «atrás» y un enlace del panel no las pierdan (bloque S, punto 7); nunca se dibujan.
  let credenciales = $state<FilaInforme[]>(credencialesLote.filas);
  let descargadas = $state(credencialesLote.descargadas);
  let parrafoMostrando = $state<HTMLParagraphElement | null>(null);
  let parrafoSinCredenciales = $state<HTMLParagraphElement | null>(null);
  const carga = ultimaGana();

  $effect(() => {
    if (errorLote !== null) void tick().then(() => cajaError?.focus());
  });
  // Los errores de lectura del origen también reciben el foco (docs/19 §4, N8b: todo error se muestra en un aviso que lo recibe).
  $effect(() => {
    if (erroresArchivo.length > 0) void tick().then(() => cajaArchivo?.focus());
  });
  // El foco va al encabezado de cada paso al cambiar de paso (WCAG 2.4.3); al cargar la pantalla, no.
  let pasoAnterior = untrack(() => paso);
  $effect(() => {
    const p = paso;
    if (p === pasoAnterior) return;
    pasoAnterior = p;
    void tick().then(() => encabezadoPaso?.focus());
  });
  function mostrarError(x: ErrorExplicado): void {
    errorLote = x;
    // La aplicación cambia a «Entrar»: al volver, el aviso dice que el origen se conservó y ofrece revisarlo de nuevo.
    if (x.caso === 'sesion_vencida') borradorLote.aviso = { ...x, texto: TEXTO_SESION_RETOMADA, accion: 'reintentar' };
  }

  // La plantilla del servidor: columnas, obligatorias, topes y límites (docs/19 §4, N4). Sin ella no se lee el origen.
  let plantilla = $state<PlantillaLote | null>(null);
  let errorPlantilla = $state<string | null>(null);
  async function cargarPlantilla(): Promise<void> {
    try {
      plantilla = await obtener<PlantillaLote>('/dispositivos/lote/plantilla');
      errorPlantilla = null;
    } catch (e) {
      if (!esCancelacion(e)) errorPlantilla = avisoDeError(e).texto;
    }
  }
  $effect(() => {
    if (plantilla === null) untrack(() => void cargarPlantilla());
  });
  const columnas = $derived((plantilla?.columnas ?? []).map((c) => c.nombre));
  // El nombre de cada columna para las personas (bloque S, punto 4), de la plantilla del servidor.
  const rotulos = $derived(Object.fromEntries((plantilla?.columnas ?? []).map((c) => [c.nombre, c.rotulo ?? c.nombre])));
  const rotuloSeparador = (s: string): string => (s === '\t' ? 'tabulador' : `«${s}»`);

  // ── Paso 1: el origen ─────────────────────────────────────────────────────────────────────────────────────────────────────────
  function aplicarLectura(nombre: string, l: LecturaCsv): void {
    archivo = nombre;
    filasArchivo = l.filas;
    noEntranArchivo = l.noEntran ?? [];
    erroresArchivo = l.errores;
    borradorLote.persona = persona;
    borradorLote.archivo = nombre;
    borradorLote.filas = l.filas;
    borradorLote.noEntran = noEntranArchivo;
  }
  function olvidarRevision(): void {
    informe = null;
    huella = null;
    zonasPorNombre = [];
    errorLote = null;
  }
  // Cada cambio de origen (archivo o pegado) es una generación nueva: cancela la revisión en vuelo y descarta lo que una lectura o una
  // respuesta más vieja traiga después, para que la revisión de un origen nunca se abra con las filas de otro (revisión del 16/11/2026).
  let generacion = 0;
  function nuevoOrigen(): number {
    generacion++;
    carga.cancelar();
    validando = false;
    olvidarRevision();
    return generacion;
  }
  async function leerArchivo(ev: Event): Promise<void> {
    const entrada = ev.currentTarget as HTMLInputElement;
    const f = entrada.files?.[0];
    // Sin archivo (se canceló la ventana de elegir), nada cambia: el origen y la revisión anteriores siguen (bloque S, decidido, 10).
    if (f === undefined || plantilla === null) return;
    const mia = nuevoOrigen();
    entrada.value = ''; // elegir de nuevo el mismo archivo, ya corregido, vuelve a disparar `change`
    // El tamaño ANTES de leerlo: un archivo de cientos de MB no se carga entero en la memoria de la pestaña. El tope es el del cuerpo del
    // lote (`max_bytes`): un origen que lo pasa tampoco cabría como JSON.
    if (f.size > plantilla.max_bytes) {
      aplicarLectura(f.name, { filas: [], errores: [{ caso: 'archivo_pesado', texto: textoPesado(f.size, plantilla.max_bytes) }] });
      return;
    }
    // Leer un archivo nuevo descarta el anterior (bloque S, punto 10): hasta terminar, no hay filas que revisar.
    aplicarLectura(f.name, { filas: [], errores: [] });
    leyendo = true;
    try {
      // Los bytes: por su firma, un libro .xlsx va al lector propio (cargado recién ahora); lo demás se lee como texto UTF-8.
      const lectura = await leerArchivoLote(new Uint8Array(await f.arrayBuffer()), plantilla);
      if (mia === generacion) aplicarLectura(f.name, lectura); // una lectura que termina después de otra más nueva se descarta
    } finally {
      if (mia === generacion) leyendo = false;
    }
  }
  function leerPegado(): void {
    nuevoOrigen();
    leyendo = false;
    if (plantilla !== null) aplicarLectura(ORIGEN_PEGADO, leerOrigen(pegado, plantilla));
  }

  // El botón del remedio de cada caso (la tabla de N8b): lo que hace no depende de dónde se mostró el error.
  function remedio(a: AccionLote): void {
    errorLote = null;
    if (a === 'otro_archivo') {
      paso = 1;
      void tick().then(() => campoArchivo?.focus());
    } else if (a === 'pegar') {
      // Donde el navegador no puede abrir un libro, la pantalla ofrece pegar las celdas (bloque N, punto 6).
      paso = 1;
      void tick().then(() => campoPegado?.focus());
    } else if (a === 'plantilla' && plantilla !== null) descargarTexto(csvPlantilla(plantilla), 'plantilla-alta-masiva.csv');
    else if (a === 'revisar') {
      paso = informe === null ? 1 : 2;
      void tick().then(() => (zonaInforme ?? campoArchivo)?.focus());
    } else if (a === 'reintentar') void (paso === 2 && huella !== null && validas.length > 0 ? crearValidas(validas) : revisar());
    else if (a === 'inventario') window.location.hash = '#/inventario';
    else if (a === 'sesion') window.location.reload();
  }

  // ── Paso 2: la revisión ───────────────────────────────────────────────────────────────────────────────────────────────────────
  function abrirRevision(filas: FilaInforme[]): void {
    informe = filas;
    filtro = filtroInicial(filas); // si hay filas que no entran, la revisión abre con ese filtro
    mostrar = DE_A;
    abiertas = new Set();
    paso = 2;
  }
  // Las filas mal formadas del origen, como filas del plan (bloque S, punto 1).
  const locales = (): FilaInforme[] => noEntranArchivo.map(filaQueNoEntra);
  async function revisar(): Promise<void> {
    if (validando || leyendo || (filasArchivo.length === 0 && noEntranArchivo.length === 0) || plantilla === null) return;
    // Si ninguna fila está bien formada, no hay nada que preguntar al servidor: la revisión muestra las que no entran y por qué.
    if (filasArchivo.length === 0) {
      errorLote = null;
      huella = null;
      zonasPorNombre = [];
      abrirRevision(locales());
      return;
    }
    const cuerpo = { filas: filasArchivo };
    errorLote = null;
    if (excedeBytes(cuerpo, plantilla)) {
      mostrarError({ caso: 'archivo_pesado', texto: textoPesado(new TextEncoder().encode(JSON.stringify(cuerpo)).length, plantilla.max_bytes), accion: ACCION_DE.archivo_pesado, detalles: [] });
      return;
    }
    validando = true;
    const mia = generacion;
    try {
      // modo=validar va completo: no crea nada. Cada fila lleva su `n` y el servidor lo devuelve tal cual.
      const r = await pedir<InformeLote>('POST', '/dispositivos/lote?modo=validar', { cuerpo, abortar: carga.senal() });
      if (mia !== generacion) return; // el origen cambió mientras tanto: esta respuesta es de otro
      huella = r.huella;
      zonasPorNombre = r.zonas_por_nombre ?? [];
      abrirRevision(mezclarPlan(r.filas, locales()));
    } catch (e) {
      if (!esCancelacion(e) && mia === generacion) mostrarError(explicarError(e, { operacion: 'validar' }));
    } finally {
      if (mia === generacion) validando = false;
    }
  }
  function volver(): void {
    if (creandoLote) return;
    olvidarRevision();
    paso = 1;
  }

  const conteo = $derived(contar(informe ?? []));
  const filtradas = $derived((informe ?? []).filter((f) => coincide(f, filtro)));
  const dibujadas = $derived(filtradas.slice(0, mostrar));
  const validas = $derived((informe ?? []).filter((f) => f.resultado === 'valida').map((f) => f.n));
  // Lo que la persona escribió, también en las filas mal formadas (el detalle y el CSV de las que no entran lo usan).
  const original = $derived([...filasArchivo, ...noEntranArchivo.map((x) => x.fila)]);
  const origenPorN = $derived(new Map(original.map((f) => [f.n, f])));
  const leidasDelOrigen = $derived(filasArchivo.length + noEntranArchivo.length);
  function elegirFiltro(f: FiltroLote): void {
    filtro = f;
    mostrar = DE_A;
  }
  // «Mostrar 100 más»: cuando ya se ven todas, el botón desaparece y el foco va al texto «Se ven N de N» (bloque S, punto 8), no a `body`.
  async function mostrarMas(): Promise<void> {
    mostrar += DE_A;
    if (mostrar >= filtradas.length) {
      await tick();
      parrafoMostrando?.focus();
    }
  }
  // «Abrir su ficha» de una fila «Ya existe» (bloque S, punto 5): el plan trae su `id` solo si el equipo es de un sitio de la persona (RF-41).
  const abrirFicha = (id: string): void => {
    window.location.hash = `#/dispositivos/${id}`;
  };
  function alternarDetalle(n: number): void {
    const s = new Set(abiertas);
    if (!s.delete(n)) s.add(n);
    abiertas = s;
  }

  // Crea las válidas en UNA petición, todo o nada (docs/19 §4, N8): las filas confirmadas, la huella del plan que se ve y una llave de
  // reintento nueva; si la respuesta se pierde, se repite con la misma llave y el servidor devuelve la misma. Si el plan cambió desde la
  // revisión (409 `plan_cambio`), no se creó ninguna: la revisión pasa al plan nuevo, con su huella, y el aviso lista lo que cambió.
  async function crearValidas(filas: number[]): Promise<void> {
    if (creandoLote || filas.length === 0 || huella === null) return;
    const pedidas = new Set(filas);
    const cuerpo = { filas: filasArchivo.filter((f) => pedidas.has(f.n)), huella };
    creandoLote = true;
    errorLote = null;
    try {
      const r = await crearConReintento(
        (llave) => pedir<InformeLote>('POST', '/dispositivos/lote?modo=crear', { cuerpo, cabeceras: { 'Idempotency-Key': llave } }),
        nuevaLlave(),
      );
      // El informe se pone al día con lo que respondió el servidor; la credencial no queda en él: solo en `credenciales`.
      const porFila = new Map(r.filas.map((f) => [f.n, f]));
      informe = (informe ?? []).map((f) => {
        const nueva = porFila.get(f.n);
        return nueva === undefined ? f : { ...nueva, credencial: null };
      });
      const nuevas = r.filas.filter((f) => f.resultado === 'creada');
      credenciales = [...credenciales, ...nuevas];
      if (credenciales.length > 0) descargadas = false;
      creadas = nuevas.length;
      Object.assign(credencialesLote, { filas: credenciales, creadas, descargadas });
      paso = 3;
    } catch (e) {
      const visto = informe ?? [];
      const x = explicarError(e, { operacion: 'crear', visto });
      const causa = e instanceof FalloDeCreacion ? e.causa : e;
      const plan = x.caso === 'plan_cambio' && causa instanceof ErrorApi ? (causa.cuerpo.plan as InformeLote | undefined) : undefined;
      if (plan !== undefined) {
        const porFila = new Map(plan.filas.map((f) => [f.n, f]));
        huella = plan.huella;
        zonasPorNombre = plan.zonas_por_nombre ?? zonasPorNombre;
        abrirRevision(visto.map((f) => porFila.get(f.n) ?? f));
      }
      mostrarError(x);
    } finally {
      creandoLote = false;
    }
  }

  // ── Lo que se descarga y el paso 3 ────────────────────────────────────────────────────────────────────────────────────────────
  const bajarCredenciales = (): void => {
    descargarTexto(csvCredenciales(credenciales), `credenciales-${new Date().toISOString().slice(0, 10)}.csv`);
    descargadas = true;
    credencialesLote.descargadas = true;
  };
  // «Ya las guardé: olvidarlas»: fuera de la pantalla y de la memoria del módulo; el foco va al párrafo que lo confirma (bloque S, punto 8).
  async function olvidarCredenciales(): Promise<void> {
    credenciales = [];
    olvidarCredencialesLote();
    await tick();
    parrafoSinCredenciales?.focus();
  }
  const bajarLasQueNoEntran = (): void => {
    descargarTexto(csvRechazadas(columnas, original, informe ?? []), `no-entran-${archivo === ORIGEN_PEGADO ? 'lote' : baseDeDescarga(archivo)}.csv`);
  };
  const hayCredencialesSinDescargar = (): boolean => credenciales.length > 0 && !descargadas;
  // Qué se pierde si se cierra la pestaña ahora: las credenciales sin descargar y una creación en vuelo (su respuesta trae las credenciales).
  const hayAlgoQueSePierde = (): boolean => hayCredencialesSinDescargar() || creandoLote;
  // Desde el bloque S (punto 7) salir de la pantalla ya no las pierde (quedan en la pestaña), pero se sigue pidiendo confirmar: descargarlas es
  // lo único que las guarda de verdad.
  const AVISO_AL_SALIR = 'Tienes credenciales sin descargar. Quedan en esta pestaña hasta que cierres la sesión o la pestaña: vuelve al alta masiva para descargarlas. ¿Salir de esta pantalla?';
  // Un enlace del panel (el menú, el logotipo) lleva a otra pantalla y esta se cierra: con credenciales sin descargar, se pide confirmar. Se
  // intercepta el clic en los enlaces de fragmento sin tocar el enrutado de la aplicación; el botón «atrás» y la barra de direcciones cambian
  // el fragmento sin pasar por un clic y no se pueden detener desde aquí: por eso las credenciales viven en la memoria del módulo.
  function alPulsarEnlace(e: MouseEvent): void {
    if (!hayCredencialesSinDescargar()) return;
    const a = (e.target as Element | null)?.closest?.('a[href^="#"]');
    if (a === null || a === undefined || a.getAttribute('href') === window.location.hash) return;
    if (!window.confirm(AVISO_AL_SALIR)) {
      e.preventDefault();
      e.stopPropagation();
    }
  }
  function otroLote(): void {
    credenciales = [];
    olvidarCredencialesLote();
    archivo = null;
    filasArchivo = [];
    noEntranArchivo = [];
    erroresArchivo = [];
    pegado = '';
    creadas = 0;
    olvidarRevision();
    borradorLote.archivo = null;
    borradorLote.filas = [];
    borradorLote.noEntran = [];
    paso = 1;
  }

  onMount(() => {
    const dejarDeSeguir = seguirAngosto((x) => (angosto = x));
    // Las credenciales solo viven en memoria hasta descargarlas: se olvidan al perder la sesión y, ya descargadas, al salir de la pantalla;
    // sin descargar, salir de la pantalla no las olvida (bloque S, punto 7). Cerrar la pestaña con credenciales sin descargar pide
    // confirmación (revisión del 11/11/2026).
    const dejar = alPerderSesion((m) => {
      if (m !== 'sin_sesion') return;
      credenciales = [];
      olvidarCredencialesLote();
    });
    const alSalir = (e: BeforeUnloadEvent): void => {
      if (!hayAlgoQueSePierde()) return;
      e.preventDefault();
      e.returnValue = ''; // los navegadores muestran su propio texto: «¿salir del sitio? puede que no se guarden los cambios»
    };
    window.addEventListener('beforeunload', alSalir);
    document.addEventListener('click', alPulsarEnlace, true);
    return () => {
      dejarDeSeguir();
      carga.cancelar();
      dejar();
      window.removeEventListener('beforeunload', alSalir);
      document.removeEventListener('click', alPulsarEnlace, true);
      // Al salir de la pantalla, las ya descargadas se olvidan; las que no, siguen en la memoria del módulo (bloque S, punto 7).
      if (credencialesLote.descargadas) olvidarCredencialesLote();
    };
  });
</script>

{#snippet queSePasa(f: FilaInforme)}
  {@const frase = fraseDeFila(f)}
  {@const avisos = (f.avisos ?? []).length}
  <span class="frase-lote {frase.tono}" data-que-pasa><Icono nombre={frase.icono} tamano={16} /><span>{frase.texto}</span></span>
  {#if avisos > 0}<span class="frase-lote alerta" data-con-aviso><Icono nombre="aviso" tamano={16} /><span>{avisos === 1 ? 'Con 1 aviso' : `Con ${avisos} avisos`}</span></span>{/if}
  {#if f.resultado === 'existe' && f.id !== null}<Boton etiqueta="Abrir su ficha" variante="discreto" aria-label={`Abrir la ficha de ${f.id_fisico}`} onclick={() => abrirFicha(f.id!)} data-abrir-ficha={f.id} />{/if}
{/snippet}

{#snippet detalle(f: FilaInforme)}
  {@const r = camposDeFila(f, origenPorN.get(f.n), columnas, rotulos)}
  {@const ya = f.resultado === 'existe'}
  <dl class="detalle-lote" data-detalle-lote={f.n}>
    {#each r.campos as c (c.campo)}
      <dt>{c.rotulo}</dt>
      <dd data-campo-lote={c.campo}>
        {#if c.valor !== ''}<code>{c.valor}</code>{:else}<span class="vivo">vacío</span>{/if}
        {#if c.porOmision}<span class="marca-omision" data-por-omision>por omisión</span>{/if}
        {#each c.avisos as a, i (i)}<span class="nota-lote alerta" data-aviso-campo><Icono nombre="aviso" tamano={16} /><span>{a}</span></span>{/each}
        <!-- «Ya existe» no es un error: en ámbar y con su icono, no con la cruz roja (bloque S, punto 5). -->
        {#each c.motivos as m, i (i)}<span class="nota-lote {ya ? 'alerta' : 'sin_senal'}" data-motivo-campo><Icono nombre={ya ? 'existe' : 'cerrar'} tamano={16} /><span>{m}</span></span>{/each}
      </dd>
    {/each}
  </dl>
  {#if r.sueltas.length > 0}
    <ul class="detalle-sueltas">
      {#each r.sueltas as s, i (i)}<li><span class="nota-lote {s.tipo === 'aviso' ? 'alerta' : 'sin_senal'}" data-motivo-fila><Icono nombre={s.tipo === 'aviso' ? 'aviso' : 'cerrar'} tamano={16} /><span>{s.texto}</span></span></li>{/each}
    </ul>
  {/if}
{/snippet}

{#snippet botonDetalle(f: FilaInforme)}
  {@const abierta = abiertas.has(f.n)}
  <Boton etiqueta={abierta ? 'Ocultar el detalle' : 'Ver el detalle'} aria-label={`${abierta ? 'Ocultar' : 'Ver'} el detalle de la fila ${f.n}`} variante="discreto"
    aria-expanded={abierta} onclick={() => alternarDetalle(f.n)} data-detalle-fila={f.n} />
{/snippet}

<!-- «Volver» y «Crear N dispositivos», sobre la lista y debajo de ella (bloque S, punto 6): en un teléfono no hay que bajar por 100 tarjetas.
     Sin ayuda emergente: lo esencial de cada uno va escrito a la vista. -->
{#snippet accionesRevision(donde: 'arriba' | 'abajo')}
  <span class="acciones" data-acciones-revision={donde}>
    <Boton etiqueta="Volver" motivoDesactivado={creandoLote ? 'se está creando: espera la respuesta' : null} onclick={volver} data-volver={donde} />
    <Boton etiqueta={validas.length === 1 ? 'Crear 1 dispositivo' : `Crear ${validas.length} dispositivos`} etiquetaCargando="Creando…" variante="principal" cargando={creandoLote}
      motivoDesactivado={validas.length === 0 ? 'ninguna fila se crearía' : null} onclick={() => void crearValidas(validas)} data-crear-lote={donde} />
  </span>
{/snippet}

<section aria-labelledby="{uid}-lote" data-lote>
  <h3 id="{uid}-lote">Alta masiva</h3>
  <ol class="pasos" data-pasos-lote>
    {#each PASOS as p, i (p)}<li aria-current={paso === i + 1 ? 'step' : undefined}>{i + 1}. {p}</li>{/each}
  </ol>
  <h4 class="titulo-paso" tabindex="-1" bind:this={encabezadoPaso} data-titulo-paso-lote>Paso {paso} de {PASOS.length}: {PASOS[paso - 1]}</h4>

  {#if errorLote !== null}
    {@const x = errorLote}
    <div class="aviso-caja error" role="alert" tabindex="-1" bind:this={cajaError} data-error-lote={x.caso}>
      <p class="aviso-texto">{x.texto}</p>
      {#if x.detalles.length > 0}<ul data-detalles-error>{#each x.detalles as d, i (i)}<li>{d}</li>{/each}</ul>{/if}
      <span class="acciones">
        <Boton etiqueta={ROTULO_ACCION[x.accion]} variante="principal" onclick={() => remedio(x.accion)} data-remedio={x.accion} />
        <Boton etiqueta="Cerrar aviso" variante="discreto" onclick={() => (errorLote = null)} />
      </span>
    </div>
  {/if}

  {#if paso === 1}
    <div data-paso-lote="1">
      {#if errorPlantilla !== null}
        <p class="error" role="alert">{errorPlantilla} <Boton etiqueta="Reintentar" onclick={() => void cargarPlantilla()} /></p>
      {:else if plantilla === null}
        <p class="vacio">Cargando…</p>
      {:else}
        {@const p = plantilla}
        <p data-plantilla-lote>Hasta {p.max_filas} filas y {megas(p.max_bytes)} MB por lote. Elige un archivo CSV, JSON o un libro de Excel (.xlsx, del que se lee la primera
          hoja), o pega las filas desde tu planilla, con la fila de cabecera. Columnas obligatorias: {p.columnas.filter((c) => c.obligatoria).map((c) => c.nombre).join(', ')}. Separadores de columnas: {p.separadores.columnas.map(rotuloSeparador).join(', ')};
          entre canales, {p.separadores.canales.map(rotuloSeparador).join(' o ')}. Primero se revisa lo que se haría con cada fila (no crea nada); después confirmas.
          <Boton etiqueta="Descargar la plantilla (CSV)" variante="discreto" onclick={() => descargarTexto(csvPlantilla(p), 'plantilla-alta-masiva.csv')} data-plantilla /></p>
        <details class="datos-grafico" data-columnas>
          <summary>Qué lleva cada columna</summary>
          <dl class="detalle-lote">
            {#each p.columnas as c (c.nombre)}<dt>{c.nombre}{c.obligatoria ? ' (obligatoria)' : ''}</dt><dd>{c.ayuda}</dd>{/each}
          </dl>
        </details>
        <div class="formulario-configurar">
          <div class="campo">
            <label for="{uid}-archivo">Archivo CSV, JSON o Excel (.xlsx)</label>
            <input id="{uid}-archivo" type="file" accept=".csv,.tsv,.txt,.json,.xlsx,text/csv,application/json,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" onchange={(e) => void leerArchivo(e)} bind:this={campoArchivo} data-archivo />
          </div>
          <div class="campo">
            <label for="{uid}-pegado">O pega las filas desde tu planilla</label>
            <textarea id="{uid}-pegado" rows="6" spellcheck="false" bind:value={pegado} bind:this={campoPegado} data-pegado></textarea>
            <span class="ayuda-campo">Copia las celdas con su fila de cabecera y pégalas aquí.</span>
            <span class="acciones"><Boton etiqueta="Leer lo pegado" motivoDesactivado={pegado.trim() === '' ? 'pega primero las filas' : null} onclick={leerPegado} data-leer-pegado /></span>
          </div>
        </div>
      {/if}
      {#if erroresArchivo.length > 0}
        {@const accion = ACCION_DE[erroresArchivo[0]!.caso]}
        <div class="aviso-caja error" role="alert" tabindex="-1" bind:this={cajaArchivo} data-error-archivo={erroresArchivo[0]!.caso}>
          <p class="aviso-texto">Lo que elegiste no se puede usar todavía{archivo === null ? '' : ` (${archivo})`}:</p>
          <ul>{#each erroresArchivo as x, i (i)}<li>{x.texto}</li>{/each}</ul>
          <Boton etiqueta={ROTULO_ACCION[accion]} onclick={() => remedio(accion)} data-remedio={accion} />
        </div>
      {:else if archivo !== null}
        {#if leyendo}
          <p data-filas-leidas data-leyendo>Leyendo {archivo}…</p>
        {:else}
          {@const k = noEntranArchivo.length}
          <p data-filas-leidas>{archivo}: {leidasDelOrigen} filas leídas.{#if k > 0}{' '}<span data-no-entran-al-leer>{k === 1 ? '1 está mal escrita y no entra' : `${k} están mal escritas y no entran`}: la revisión dice por qué.</span>{/if}</p>
        {/if}
        <Boton etiqueta="Revisar las filas" etiquetaCargando="Revisando…" variante="principal" cargando={validando}
          motivoDesactivado={leyendo ? 'se está leyendo el archivo' : null} onclick={() => void revisar()} data-revisar />
      {/if}
    </div>
  {:else if paso === 2 && informe !== null}
    {@const avisadas = conAvisoQueSeCrean(informe)}
    <div data-paso-lote="2">
      {#if avisadas > 0}
        <p data-avisos-lote>{avisadas === 1 ? '1 fila que se crea trae avisos' : `${avisadas} filas que se crean traen avisos`}:
          <Boton etiqueta="Ver las filas con aviso" variante="discreto" onclick={() => elegirFiltro('aviso')} data-ver-avisos /></p>
      {/if}
      {#if zonasPorNombre.length > 0}
        <!-- La zona escrita por su nombre se dice una vez, no como aviso en cada fila (bloque S, punto 3). -->
        <ul class="zonas-lote" aria-label="Zonas escritas por su nombre" data-zonas-lote>
          {#each zonasPorNombre as z, i (i)}<li>Zona «{z.zona}» → sitio «{z.sitio}»: {z.filas === 1 ? '1 fila' : `${z.filas} filas`}</li>{/each}
        </ul>
      {/if}
      <p data-resumen-lote><strong>{resumenRevision(conteo)}</strong></p>
      {@render accionesRevision('arriba')}
      <p class="ayuda-campo" data-ayuda-crear>«Crear» los crea todos en una sola petición, o ninguno, y las credenciales se muestran una sola vez; «Volver» conserva lo que leíste.</p>
      <ul class="fichas" aria-label="Filas por resultado">
        {#each FILTROS as x (x.id)}
          <li>
            <Boton etiqueta={x.rotulo} cifra={conteo[x.id]} presionado={filtro === x.id} onclick={() => elegirFiltro(x.id)} data-filtro-lote={x.id} />
          </li>
        {/each}
      </ul>
      {#if conteo.rechazada > 0}
        <p data-remedio-no-entran>{conteo.rechazada === 1 ? 'Una fila no entra' : `${conteo.rechazada} filas no entran`}: corrígelas y vuelve a subirlas. El archivo trae cada una con una columna «motivo», que se ignora al subirlo de nuevo.
          <Boton etiqueta="Descargar las que no entran (CSV)" onclick={bajarLasQueNoEntran} data-descargar-no-entran /></p>
      {/if}
      <div tabindex="-1" bind:this={zonaInforme} data-informe-lote>
        {#if filtradas.length === 0}
          <p class="vacio" data-sin-filas>Ninguna fila coincide con este filtro.</p>
        {:else if angosto}
          <ul class="tarjetas-lote" data-tarjetas-lote>
            {#each dibujadas as f (f.n)}
              <li class="tarjeta-lote" data-fila-lote={f.n} data-resultado={f.resultado}>
                <div class="fila-1"><span class="num">Fila {f.n}</span><code>{f.id_fisico}</code></div>
                <div class="que-pasa">{@render queSePasa(f)}</div>
                {#if resumenDeFila(f) !== ''}<span class="vivo" data-resumen-fila>{resumenDeFila(f)}</span>{/if}
                {@render botonDetalle(f)}
                {#if abiertas.has(f.n)}{@render detalle(f)}{/if}
              </li>
            {/each}
          </ul>
        {:else}
          <div class="tabla">
            <table data-tabla-lote>
              <thead><tr><th scope="col">Fila</th><th scope="col">Identificador</th><th scope="col">Qué pasa</th><th scope="col">Detalle</th></tr></thead>
              <tbody>
                {#each dibujadas as f (f.n)}
                  <tr data-fila-lote={f.n} data-resultado={f.resultado}>
                    <td class="num">{f.n}</td>
                    <td><code>{f.id_fisico}</code></td>
                    <td><div class="que-pasa">{@render queSePasa(f)}</div></td>
                    <td>{#if resumenDeFila(f) !== ''}<span class="vivo" data-resumen-fila>{resumenDeFila(f)}</span><br />{/if}{@render botonDetalle(f)}</td>
                  </tr>
                  {#if abiertas.has(f.n)}<tr class="fila-detalle" data-detalle-de={f.n}><td colspan="4">{@render detalle(f)}</td></tr>{/if}
                {/each}
              </tbody>
            </table>
          </div>
        {/if}
      </div>
      {#if filtradas.length > 0}
        <p class="paginacion" tabindex="-1" bind:this={parrafoMostrando} data-mostrando>Se ven {dibujadas.length} de {filtradas.length}.
          {#if filtradas.length > mostrar}<Boton etiqueta={`Mostrar ${DE_A} más`} onclick={() => void mostrarMas()} data-mostrar-mas />{/if}</p>
      {/if}
      {@render accionesRevision('abajo')}
      {#if creandoLote}<span role="status" data-creando-lote>Creando: no cierres ni recargues la pestaña; si la respuesta se pierde, las credenciales no se pueden recuperar.</span>{/if}
    </div>
  {:else if paso === 3}
    <div data-paso-lote="3">
      <p role="status" data-resultado-lote><strong>{creadas === 1 ? 'Se creó 1 dispositivo' : `Se crearon ${creadas} dispositivos`}.</strong></p>
      {#if credenciales.length > 0}
        <div class="clave-una-vez" data-credenciales-lote>
          <p><strong>{credenciales.length} credenciales</strong> de los creados. <strong>No se vuelven a mostrar</strong>: descárgalas ahora y
            guárdalas en un lugar seguro.</p>
          <p class="vivo" data-nota-credenciales>El archivo es para cargarlo en los equipos o abrirlo con un editor de texto: una planilla puede alterar las credenciales que empiezan con «-».</p>
          <span class="acciones">
            <Boton etiqueta="Descargar credenciales (CSV)" variante="principal" onclick={bajarCredenciales} data-descargar-credenciales />
            <Boton etiqueta="Ya las guardé: olvidarlas" motivoDesactivado={descargadas ? null : 'descárgalas primero'} onclick={() => void olvidarCredenciales()} data-olvidar-credenciales />
          </span>
        </div>
      {:else}
        <p class="vivo" tabindex="-1" bind:this={parrafoSinCredenciales} data-sin-credenciales>Las credenciales ya no están en esta página: no se pueden volver a mostrar. Si perdiste alguna, rótala desde la ficha del dispositivo.</p>
      {/if}
      <span class="acciones">
        <Boton etiqueta="Ir al inventario" motivoDesactivado={hayCredencialesSinDescargar() ? 'descarga primero las credenciales' : null} onclick={() => (window.location.hash = '#/inventario')} data-ir-inventario />
        <Boton etiqueta="Dar de alta otro lote" motivoDesactivado={hayCredencialesSinDescargar() ? 'descarga primero las credenciales' : null} onclick={otroLote} data-otro-lote />
      </span>
    </div>
  {/if}
</section>
