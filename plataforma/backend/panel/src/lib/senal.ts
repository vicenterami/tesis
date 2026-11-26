// La señal del enlace en el panel (docs/19 §4 AA; docs/10 §8.4 punto 71): las magnitudes del enlace, el orden de «Tendencias» y la línea de
// «Red → Calidad del enlace». Lo puro, aquí; los componentes solo dibujan.
import type { ResumenSitio } from './modelo';
import { haceCuanto } from './tiempo';

// Las magnitudes del enlace que el alta propone para un nodo LoRaWAN (la misma lista cerrada que MAGNITUDES_ENLACE del backend,
// recepcion/lectura.ts), con su nombre para personas.
export const MAGNITUDES_ENLACE = [
  { codigo: 'rssi', nombre: 'Intensidad de la señal (rssi, dBm)' },
  { codigo: 'snr', nombre: 'Relación señal/ruido (snr, dB)' },
] as const;

// «Tendencias»: primero lo que se mide y al final la salud del equipo (`salud` del resumen), antes de cortar en seis; dentro de cada grupo,
// la más extendida primero (más canales) y después por nombre. Sin `salud` (un servidor anterior), todo cuenta como medida.
export function ordenTendencias<T extends { canales: number; nombre: string; salud?: boolean }>(ms: readonly T[]): T[] {
  return [...ms].sort((a, b) => Number(a.salud === true) - Number(b.salud === true) || b.canales - a.canales || a.nombre.localeCompare(b.nombre, 'es'));
}

const numero = (v: number): string => v.toLocaleString('es-CL', { maximumFractionDigits: 1 });
// La línea de un equipo en «Calidad del enlace»: «−87 dBm · SNR 7,5 dB · hace 3 min» (la hora, la de la lectura más reciente de las dos);
// sin ninguna lectura, «sin lecturas de señal». El signo menos tipográfico, como el resto del panel.
export function lineaSenal(e: NonNullable<ResumenSitio['enlace']>[number], ahora: Date): string {
  if (e.rssi === null && e.snr === null) return 'sin lecturas de señal';
  const partes: string[] = [];
  if (e.rssi !== null) partes.push(`${numero(e.rssi.valor).replace('-', '−')} dBm`);
  if (e.snr !== null) partes.push(`SNR ${numero(e.snr.valor).replace('-', '−')} dB`);
  const tiempos = [e.rssi?.tiempo, e.snr?.tiempo].filter((t): t is string => t !== undefined).sort();
  partes.push(haceCuanto(tiempos.at(-1) ?? null, ahora));
  return partes.join(' · ');
}
