<script lang="ts">
  // Barras horizontales ordenadas, de un solo matiz (docs/19 §4, tablero v2, B2 y B4c): condiciones abiertas por tipo y entrega por
  // dispositivo. Cada fila lleva su rótulo y su valor escritos: la barra nunca es la única forma de leerlo. `orden`: «desc» (de más a
  // menos: las condiciones) o «asc» (de peor a mejor: la entrega).
  // Desde el tablero v3 (bloque L, punto 2c) son HTML y no un SVG escalado: el texto tiene el tamaño del cuerpo a cualquier ancho (el SVG
  // agrandaba la letra con la pantalla). Es una lista con nombre: el lector de pantalla oye «etiqueta: valor» por fila (WCAG 1.1.1 y
  // 1.3.1) y la barra queda oculta. Un nombre largo ocupa una línea con puntos suspensivos y se lee entero en su `title` (L2b). La clave
  // de cada fila es el id (el nombre de un dispositivo no es único: solo `id_fisico` lo es), y sin id, la posición.
  export interface Barra {
    id?: string;
    etiqueta: string;
    valor: number;
    texto: string; // el valor escrito, con su unidad («87 %», «3»)
  }
  let { barras, maximo = null, orden = 'desc', titulo, limite = 10 }: { barras: Barra[]; maximo?: number | null; orden?: 'desc' | 'asc'; titulo: string; limite?: number } = $props();
  const visibles = $derived([...barras].sort((a, b) => (orden === 'desc' ? b.valor - a.valor : a.valor - b.valor) || a.etiqueta.localeCompare(b.etiqueta, 'es')).slice(0, limite));
  const tope = $derived(maximo ?? Math.max(1, ...visibles.map((b) => b.valor)));
</script>

<ul class="barras" aria-label={titulo} data-barras={visibles.length} data-barras-lista>
  {#each visibles as b, i (b.id ?? i)}
    <!-- en una sola línea: un salto entre los <span> sería parte del texto que oye el lector; «: » va como expresión (Svelte recorta el espacio final de un elemento) -->
    <li data-barra={b.etiqueta}><span class="rotulo" title={b.etiqueta}>{b.etiqueta}</span><span class="solo-lector">{': '}</span><span class="pista" aria-hidden="true"><span class="relleno" style:width="{Math.max(0, Math.min(1, b.valor / tope)) * 100}%"></span></span><span class="cifra" data-barra-texto>{b.texto}</span></li>
  {/each}
</ul>
