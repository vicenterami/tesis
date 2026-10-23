// Los dispositivos marcados para comparar (docs/19 §4, incremento 2, punto 5), compartidos entre P2 y P3b mientras dura la sesión
// del navegador (no se guardan en ningún lado). Así el enlace «Comparar con otros dispositivos» de P3 abre P3b con ese dispositivo y,
// si falta otro, «Marca al menos dos dispositivos en el inventario» lleva a P2 con ese ya marcado; y al volver de P3b, P2 conserva
// las casillas. La fuente de verdad de P3b es su URL: este conjunto solo recuerda las casillas.
let marcados: string[] = [];

export function marcadosParaComparar(): string[] {
  return [...marcados];
}
export function recordarMarcados(ids: readonly string[]): void {
  marcados = [...new Set(ids)];
}
