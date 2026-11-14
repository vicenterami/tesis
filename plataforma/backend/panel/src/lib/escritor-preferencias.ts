// Un solo escritor de preferencias en el panel (docs/19 §4, bloque L, punto 5; H). P13 y el botón de tema de la barra superior guardan
// por aquí: los `PUT /preferencias` van en fila (cada uno espera al anterior y usa el `actualizado_en` que dejó), así nunca hay dos en
// vuelo ni un 409 contra el propio panel. El cambio se ve al instante (renderizado optimista, docs/19 §6) y, si el servidor lo rechaza,
// vuelve SOLO lo que ese guardado cambió y nadie cambió después (otro posterior pudo cambiar otra cosa, o el mismo campo) y quien
// llamó recibe el error para decirlo. Si el rechazo es un 409 (la misma persona guardó antes desde otra pestaña u otro equipo), se
// releen las preferencias vigentes: sin eso, la marca `actualizado_en` quedaba vieja y cada guardado posterior repetía el 409.
// Sin preferencias leídas (sin sesión, o el usuario del sistema) no se guarda nada: el cambio vale para esa visita.
import { ErrorApi, obtener, pedir } from './api';
import type { Preferencias } from './modelo';
import { cambiar, cuerpoPreferencias } from './preferencias';

type Oyente = (p: Preferencias) => void;
export type ResultadoGuardado = { ok: true; guardado: boolean } | { ok: false; error: unknown };

let actuales: Preferencias | null = null;
let cola: Promise<unknown> = Promise.resolve();
// Los cambios que esperan su turno en la fila (ya se ven, aún no se enviaron): al releer tras un 409 se conservan encima de lo leído.
const enEspera: Partial<Preferencias>[] = [];
const oyentes = new Set<Oyente>();

function avisar(): void {
  if (actuales === null) return;
  const p = actuales;
  for (const f of [...oyentes]) f(p);
}

// Las preferencias leídas (de `GET /sesion` o de `GET /preferencias`): pasan a ser las vigentes y se avisa a quien escucha.
export function fijarPreferencias(p: Preferencias | null | undefined): void {
  actuales = p === null || p === undefined ? null : { ...p };
  avisar();
}
export const preferenciasActuales = (): Preferencias | null => actuales;
export function suscribirPreferencias(f: Oyente): () => void {
  oyentes.add(f);
  return () => oyentes.delete(f);
}
// Al salir o al darse de baja: la persona siguiente no hereda las preferencias ni la fila de la anterior.
export function olvidarPreferencias(): void {
  actuales = null;
  cola = Promise.resolve();
  enEspera.length = 0;
}

export function guardarPreferencias(cambio: Partial<Preferencias>): Promise<ResultadoGuardado> {
  if (actuales === null) return Promise.resolve({ ok: true, guardado: false });
  const { nuevas, anteriores } = cambiar(actuales, cambio);
  actuales = nuevas; // optimista: se ve ya
  avisar();
  enEspera.push(cambio);
  const tarea = cola.then(async (): Promise<ResultadoGuardado> => {
    const turno = enEspera.indexOf(cambio);
    if (turno >= 0) enEspera.splice(turno, 1); // le tocó: ya no espera
    if (actuales === null) return { ok: true, guardado: false }; // salió mientras esperaba en la fila
    try {
      // Sin la marca del bloqueo optimista (unas preferencias armadas a mano), se lee primero la vigente y se le suma lo pendiente.
      if (actuales.actualizado_en === undefined) {
        const leidas = await obtener<Preferencias>('/preferencias');
        actuales = { ...leidas, ...actuales, actualizado_en: leidas.actualizado_en ?? null };
      }
      const r = await pedir<Preferencias>('PUT', '/preferencias', { cuerpo: cuerpoPreferencias(actuales) });
      if (actuales !== null) {
        actuales = { ...actuales, actualizado_en: r.actualizado_en };
        avisar();
      }
      return { ok: true, guardado: true };
    } catch (error) {
      if (actuales !== null) {
        const revertido: Preferencias = { ...actuales };
        // Solo lo que sigue como lo dejó este guardado: si otro posterior ya cambió el mismo campo, manda el posterior.
        for (const k of Object.keys(cambio) as (keyof Preferencias)[]) {
          if (Object.is(actuales[k], nuevas[k])) (revertido as Record<string, unknown>)[k] = anteriores[k];
        }
        actuales = revertido;
        if (error instanceof ErrorApi && error.codigo === 409) {
          // Lo vigente es lo del servidor; lo que otros guardados en fila cambiaron después se conserva encima.
          try {
            const leidas = await obtener<Preferencias>('/preferencias');
            if (actuales !== null) actuales = Object.assign({ ...leidas }, ...enEspera);
          } catch {
            // sin poder releer queda lo revertido; el próximo guardado volverá a decirlo
          }
        }
        avisar();
      }
      return { ok: false, error };
    }
  });
  cola = tarea.catch(() => undefined);
  return tarea;
}
