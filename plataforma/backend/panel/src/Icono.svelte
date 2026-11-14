<script lang="ts" module>
  // Iconos propios (docs/19 §4, bloque L, punto 1f): trazos SVG dibujados para este proyecto, en una cuadrícula de 24 px, sin biblioteca
  // de terceros ni fuente de iconos (la CSP no admite recursos externos y no se suma una licencia). Solo líneas rectas, arcos y círculos;
  // el color es el del texto (`currentColor`) y el icono queda oculto al lector de pantalla: el nombre es el del control que lo lleva.
  export type NombreIcono = 'tablero' | 'inventario' | 'actividad' | 'usuarios' | 'alta' | 'legal' | 'menu' | 'luna' | 'sol' | 'cuenta' | 'pausa' | 'reanudar' | 'cerrar';
  const TRAZOS: Readonly<Record<NombreIcono, string>> = {
    // cuatro paneles de distinto alto, como un tablero
    tablero: 'M4 4h7v8H4z M13 4h7v5h-7z M13 11h7v9h-7z M4 14h7v6H4z',
    // tres renglones con su viñeta
    inventario: 'M9 6h11 M9 12h11 M9 18h11 M4.5 6h1 M4.5 12h1 M4.5 18h1',
    // un pulso
    actividad: 'M3 12h4l2.5-6 5 12 2.5-6h4',
    // dos personas
    usuarios: 'M9 11a3.5 3.5 0 1 0 0-7a3.5 3.5 0 1 0 0 7z M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6 M16 4.6a3.5 3.5 0 0 1 0 6.8 M18 14.4c2 .8 3.5 2.8 3.5 5.6',
    // un círculo con un más
    alta: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 8v8 M8 12h8',
    // una hoja con renglones
    legal: 'M6 3h8l4 4v14H6z M14 3v4h4 M9 11h6 M9 14.5h6 M9 18h4',
    // tres líneas
    menu: 'M4 6h16 M4 12h16 M4 18h16',
    // una luna creciente
    luna: 'M20 14.5A8.5 8.5 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
    // un sol: círculo y ocho rayos
    sol: 'M12 8a4 4 0 1 0 0 8a4 4 0 1 0 0-8z M12 2v2.5 M12 19.5V22 M2 12h2.5 M19.5 12H22 M4.9 4.9l1.8 1.8 M17.3 17.3l1.8 1.8 M4.9 19.1l1.8-1.8 M17.3 6.7l1.8-1.8',
    // una persona en un círculo
    cuenta: 'M12 3a9 9 0 1 0 0 18a9 9 0 1 0 0-18z M12 7.5a3 3 0 1 0 0 6a3 3 0 1 0 0-6z M6.5 18c1.2-2 3.2-3 5.5-3s4.3 1 5.5 3',
    // dos barras
    pausa: 'M8 5v14 M16 5v14',
    // un triángulo
    reanudar: 'M7 5l12 7-12 7z',
    // un aspa
    cerrar: 'M7 7l10 10 M17 7L7 17',
  };
  export const NOMBRES_ICONO = Object.keys(TRAZOS) as NombreIcono[];
</script>

<script lang="ts">
  let { nombre, tamano = 20 }: { nombre: NombreIcono; tamano?: number } = $props();
</script>

<svg class="icono" width={tamano} height={tamano} viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8"
  stroke-linecap="round" stroke-linejoin="round" aria-hidden="true" focusable="false" data-icono={nombre}><path d={TRAZOS[nombre]} /></svg>
