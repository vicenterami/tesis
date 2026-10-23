<script lang="ts">
  // Rango y resolución del gráfico, los mismos en P3 y P3b (docs/19 §4, incremento 2, punto 4): «auto» es la resolución fija de
  // cada rango; las demás son las de la lista cerrada de la API que dan entre 2 y 2 500 puntos para el rango elegido, con cuántos.
  import { RANGOS, puntosDe, rango as datosRango, resolucion, resolucionesAdmisibles, rotuloIntervalo, type ClaveRango, type ClaveResolucion } from './lib/grafico';

  let {
    rango,
    res,
    alElegirRango,
    alElegirRes,
  }: { rango: ClaveRango; res: ClaveResolucion | null; alElegirRango: (r: ClaveRango) => void; alElegirRes: (r: ClaveResolucion | null) => void } = $props();
  const admisibles = $derived(resolucionesAdmisibles(rango));
</script>

{#each RANGOS as r (r.clave)}
  <button type="button" aria-pressed={rango === r.clave} onclick={() => alElegirRango(r.clave)} data-rango={r.clave}>{r.rotulo}</button>
{/each}
<label>
  resolución
  <select data-resolucion value={res ?? 'auto'} onchange={(e) => { const v = e.currentTarget.value; alElegirRes(v === 'auto' ? null : (v as ClaveResolucion)); }}>
    <option value="auto">auto ({rotuloIntervalo(datosRango(rango).intervalo)})</option>
    {#each admisibles as a (a)}
      <option value={a}>{resolucion(a).rotulo} ({puntosDe(rango, a).toLocaleString('es-CL')} puntos)</option>
    {/each}
  </select>
</label>
