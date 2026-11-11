<script lang="ts">
  // Barras horizontales ordenadas, de un solo matiz, en SVG en línea (docs/19 §4, tablero v2, B2 y B4c): condiciones abiertas por tipo y
  // entrega por dispositivo. Cada fila lleva su rótulo encima y su valor escrito al final: la barra nunca es la única forma de leerlo.
  // `orden`: «desc» (de más a menos: las condiciones) o «asc» (de peor a mejor: la entrega).
  // Accesible como lista (WCAG 1.1.1 y 1.3.1; corrección del 11/11/2026): un `role="img"` en el <svg> volvía presentacionales los
  // <text> de cada barra y el lector de pantalla oía solo el título. El dibujo queda oculto al lector y, al lado, una lista visualmente
  // oculta dice «etiqueta: valor» por fila. La clave de cada fila es el id (el nombre de un dispositivo no es único: solo `id_fisico`
  // lo es), y sin id, la posición.
  export interface Barra {
    id?: string;
    etiqueta: string;
    valor: number;
    texto: string; // el valor escrito, con su unidad («87 %», «3»)
  }
  let { barras, maximo = null, orden = 'desc', titulo, limite = 10 }: { barras: Barra[]; maximo?: number | null; orden?: 'desc' | 'asc'; titulo: string; limite?: number } = $props();
  const FILA = 34;
  const visibles = $derived([...barras].sort((a, b) => (orden === 'desc' ? b.valor - a.valor : a.valor - b.valor) || a.etiqueta.localeCompare(b.etiqueta, 'es')).slice(0, limite));
  const tope = $derived(maximo ?? Math.max(1, ...visibles.map((b) => b.valor)));
</script>

<div class="barras-figura" data-barras={visibles.length}>
  <svg class="barras" viewBox="0 0 320 {visibles.length * FILA}" aria-hidden="true" style:max-width="40rem">
    <title>{titulo}</title>
    {#each visibles as b, i (b.id ?? i)}
      <g transform="translate(0 {i * FILA})" data-barra={b.etiqueta}>
        <text x="0" y="12">{b.etiqueta.length > 46 ? `${b.etiqueta.slice(0, 45)}…` : b.etiqueta}</text>
        <rect class="pista" x="0" y="16" width="270" height="12" rx="2" />
        <rect class="barra" x="0" y="16" width={Math.max(0, Math.min(1, b.valor / tope)) * 270} height="12" rx="2" />
        <text x="320" y="27" text-anchor="end" data-barra-texto>{b.texto}</text>
      </g>
    {/each}
  </svg>
  <ul class="solo-lector" aria-label={titulo} data-barras-lista>
    {#each visibles as b, i (b.id ?? i)}<li>{b.etiqueta}: {b.texto}</li>{/each}
  </ul>
</div>
