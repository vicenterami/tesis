// Piezas puras de la ficha v2 (docs/19 §4, tablero v2, D5 y D6), probadas sin DOM.
import { rotuloCondicion } from './estado-visual';
import type { EventoDispositivo, TramaRechazada } from './modelo';

// Tramas rechazadas agrupadas (D6): las filas iguales (mismo motivo y detalle) se muestran una vez con «× N» y la última fecha. La ficha
// listaba veinte filas idénticas. El orden: la de la última más reciente primero; dentro del grupo, la trama cruda de la última.
export interface GrupoRechazadas {
  clave: string;
  motivo: TramaRechazada['motivo'];
  detalle: string | null;
  n: number;
  ultima: TramaRechazada;
}
export function agruparRechazadas(filas: readonly TramaRechazada[]): GrupoRechazadas[] {
  const grupos = new Map<string, GrupoRechazadas>();
  for (const t of filas) {
    const clave = `${t.motivo}\u0000${t.detalle ?? ''}`;
    const g = grupos.get(clave);
    if (g === undefined) grupos.set(clave, { clave, motivo: t.motivo, detalle: t.detalle, n: 1, ultima: t });
    else {
      g.n++;
      if (Date.parse(t.recibido_en) > Date.parse(g.ultima.recibido_en)) g.ultima = t;
    }
  }
  return [...grupos.values()].sort((a, b) => Date.parse(b.ultima.recibido_en) - Date.parse(a.ultima.recibido_en));
}

// Lo que dice un motivo de cuarentena a una persona (docs/19 §6: ningún código interno a la vista).
export const ROTULO_MOTIVO: Readonly<Record<string, string>> = {
  no_registrado: 'No registrado', dado_de_baja: 'Dado de baja', malformada: 'Malformada', invalida: 'Inválida', tope: 'Tope superado',
};
export const rotuloMotivo = (m: string): string => ROTULO_MOTIVO[m] ?? m;

// Un evento del dispositivo en texto para personas (D5; HU-11): qué pasó y, si fue una persona, quién.
const ROTULO_EVENTO: Readonly<Record<string, string>> = {
  alta: 'Alta del dispositivo', baja: 'Baja del dispositivo', mantenimiento: 'Pasó a mantenimiento', reactivado: 'Volvió a activo',
  umbrales: 'Cambio de umbrales', reglas: 'Cambio de umbrales', configuracion: 'Cambio de configuración', calibracion: 'Cambio de calibración',
  credencial: 'Credencial nueva', mudanza: 'Mudanza de zona', condicion_abierta: 'Condición abierta', condicion_cerrada: 'Condición cerrada',
  // Los tipos que registra el backend del tablero v2 (registrarEvento, src/db/evento.ts):
  dispositivo_configurado: 'Cambio de configuración', reglas_cambiadas: 'Cambio de umbrales', canal_calibrado: 'Cambio de calibración', rotacion: 'Credencial nueva',
  canal_alta: 'Magnitud agregada', // desde el 25/11/2026 (docs/19 §4 AA)
};
// Qué pasó, sin quién. «Registrado por N» en el alta y «cambiado por N» en lo demás, SOLO cuando el servidor manda la persona (G1): a quien no
// administra el sitio le llega `usuario: null`, que no significa «lo hizo el sistema»; entonces no se dice nada de quién (11/11/2026).
export function textoEvento(e: EventoDispositivo): string {
  return ROTULO_EVENTO[e.tipo] ?? rotuloCondicion(e.tipo).replace(/_/g, ' ');
}
// «registrado» en el alta y «cambiado» en lo demás; null si no hay persona (a quien no administra el sitio le llega `usuario: null`). La persona
// misma, con su correo, la escribe Persona.svelte junto a este verbo (20/11/2026: homónimos).
export function verboAutor(e: EventoDispositivo): 'registrado' | 'cambiado' | null {
  return e.usuario === null ? null : e.tipo === 'alta' ? 'registrado' : 'cambiado';
}
