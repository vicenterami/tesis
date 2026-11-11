import type uPlot from 'uplot';

// Una sola importación de uPlot para toda la página (import dinámico: lo que no dibuja no descarga sus 51 KB). El tablero monta siete
// gráficos a la vez: siete `import()` simultáneos del mismo módulo son siete promesas, y en las pruebas el doble de uPlot perdía contra
// el real en las seis últimas (medido el 11/11/2026). Con una promesa compartida, la primera carga sirve a todas.
let promesa: Promise<typeof uPlot> | null = null;
export function cargarUplot(): Promise<typeof uPlot> {
  promesa ??= import('uplot').then((m) => m.default);
  return promesa;
}
