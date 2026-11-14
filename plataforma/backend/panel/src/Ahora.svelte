<script lang="ts">
  // «Ahora»: lo que se mide en este momento (docs/19 §4, bloque L, punto 3). (a) Por magnitud: el promedio, el mínimo y el máximo de la
  // última lectura vigente de los dispositivos que reportan, con cuántos aportan; las de salud del equipo (batería, señal) al final. (b) Por
  // dispositivo: una tarjeta por dispositivo que reporta (Normal o Alerta), alerta primero; hasta tres canales con su último valor en
  // grande y su unidad para personas (D7), y la línea de tendencia de 24 horas al lado (decorativa: el dato es el número). Un canal cuya
  // última lectura tiene más de dos intervalos esperados se atenúa y dice su antigüedad; un dispositivo que aún no envía nada dice
  // «esperando la primera trama». Los sin señal no se repiten aquí: están en «Requiere atención» y una línea lo dice.
  // Los datos llegan de quien la monta (TableroResumen.svelte): aquí no se pide nada.
  import { cifraAhora, lecturaVieja, trazosChispa } from './lib/ahora';
  import { ROTULO } from './lib/estado-visual';
  import type { AhoraSitio } from './lib/modelo';
  import { haceCuanto, haceSegundos, horaLocal } from './lib/tiempo';
  import { conversion, type PreferenciaUnidades } from './lib/unidades';
  import { SIN_FILTROS, fragmentoInventario } from './lib/vista';

  let {
    datos,
    zona,
    unidades,
    ahora,
    sitioCodigo,
    recientes = new Set<string>(),
  }: { datos: AhoraSitio; zona: string; unidades: PreferenciaUnidades; ahora: Date; sitioCodigo: string; recientes?: ReadonlySet<string> } = $props();

  const EN_TELEFONO = 8; // L2d: en teléfono, ocho tarjetas y «ver todos»
  const valor = (v: number, unidad: string, magnitud: string): { cifra: string; simbolo: string } => {
    const c = conversion(unidad, unidades, magnitud);
    return { cifra: cifraAhora(c.desdeBase(v)), simbolo: c.simbolo };
  };
  const enInventario = $derived(fragmentoInventario({ ...SIN_FILTROS, sitio: sitioCodigo }));
  const ANCHO = 64;
  const ALTO = 22;
</script>

<section class="ahora" aria-labelledby="titulo-ahora" data-ahora>
  <div class="seccion-cabecera">
    <h3 id="titulo-ahora">Ahora</h3>
    <p class="vivo" data-ahora-conteo>
      {datos.reportan.toLocaleString('es-CL')} {datos.reportan === 1 ? 'dispositivo reporta' : 'dispositivos reportan'}{#if datos.sin_senal > 0}{` · ${datos.sin_senal.toLocaleString('es-CL')} sin señal, en «Requiere atención»`}{/if}
    </p>
  </div>

  {#if datos.por_magnitud.length > 0}
    <ul class="ahora-magnitudes" aria-label="Por magnitud" data-ahora-magnitudes>
      {#each datos.por_magnitud as m (m.codigo)}
        {@const p = valor(m.promedio, m.unidad, m.codigo)}
        {@const a = valor(m.minimo, m.unidad, m.codigo)}
        {@const b = valor(m.maximo, m.unidad, m.codigo)}
        <li class="ahora-magnitud" class:salud={m.salud} data-ahora-magnitud={m.codigo}>
          <span class="rotulo">{m.nombre}</span>
          <span class="cifra">{p.cifra}<span class="unidad">{p.simbolo}</span></span>
          <span class="detalle">{m.canales === 1 ? '1 dispositivo' : `entre ${a.cifra} y ${b.cifra} · ${m.canales.toLocaleString('es-CL')} dispositivos`}</span>
        </li>
      {/each}
    </ul>
  {/if}

  {#if datos.dispositivos.length === 0}
    <p class="vacio" data-ahora-vacio>Ningún dispositivo está reportando en este momento{datos.sin_senal > 0 ? ': los que callaron están en «Requiere atención»' : ''}.</p>
  {:else}
    <ul class="ahora-dispositivos" aria-label="Por dispositivo" data-ahora-dispositivos>
      {#each datos.dispositivos as d (d.id)}
        <li class="tarjeta-ahora" class:reciente={recientes.has(d.id)} data-ahora-dispositivo={d.id}>
          <div class="cabeza">
            <a class="enlace-extendido" href={`#/dispositivos/${d.id}`} title={d.nombre}>{d.nombre}</a>
            <span class="estado {d.estado_visual}">{ROTULO[d.estado_visual]}</span>
          </div>
          <p class="sub" title={d.visto_por_ultima_vez === null ? '' : horaLocal(d.visto_por_ultima_vez, zona)}>
            <span class="zona">{d.zona}</span> · <span data-ahora-hace>{d.visto_por_ultima_vez === null ? 'esperando la primera trama' : haceSegundos(d.visto_por_ultima_vez, ahora)}</span>
          </p>
          {#if d.visto_por_ultima_vez !== null}
            <ul class="canales-ahora">
              {#each d.canales as c (c.id)}
                {@const vieja = c.ultima !== null && lecturaVieja(c.ultima.tiempo, d.intervalo_esperado_s, ahora)}
                <li class:vieja class:salud={c.salud} data-ahora-canal={c.id}>
                  <span class="rotulo">{c.magnitud_nombre}{#if vieja}<span class="antiguedad">{` · ${haceCuanto(c.ultima!.tiempo, ahora)}`}</span>{/if}</span>
                  {#if c.ultima === null}
                    <span class="cifra sin-dato">—</span>
                  {:else}
                    {@const v = valor(c.ultima.valor, c.unidad, c.magnitud)}
                    <span class="cifra" data-ahora-valor>{v.cifra}<span class="unidad">{v.simbolo}</span></span>
                  {/if}
                  {#if c.chispa !== undefined}
                    <svg class="chispa" viewBox="0 0 {ANCHO} {ALTO}" width={ANCHO} height={ALTO} aria-hidden="true" focusable="false" data-chispa>
                      {#each trazosChispa(c.chispa, ANCHO, ALTO) as t, k (k)}<path d={t} />{/each}
                    </svg>
                  {/if}
                </li>
              {/each}
            </ul>
            {#if d.canales_total > d.canales.length}<p class="mas" data-ahora-mas>+{d.canales_total - d.canales.length} {d.canales_total - d.canales.length === 1 ? 'canal' : 'canales'} en su ficha</p>{/if}
          {/if}
        </li>
      {/each}
    </ul>
    {#if datos.reportan > datos.dispositivos.length || datos.dispositivos.length > EN_TELEFONO}
      <!-- Con más de las que caben (24; en teléfono, 8), al inventario del sitio por orden de atención -->
      <p class="ver-todos" class:solo-telefono={datos.reportan <= datos.dispositivos.length} data-ahora-todos>
        <a href={enInventario}>Ver los {datos.reportan.toLocaleString('es-CL')} en el inventario</a>
      </p>
    {/if}
  {/if}
</section>
