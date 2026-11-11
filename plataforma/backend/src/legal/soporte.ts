// Límite de tasa del formulario de soporte por persona (RF-61, HU-31; docs/19 §4, P11): como mucho MAX_MENSAJES en VENTANA_MS. En memoria
// (un solo proceso, como los bloqueos de sesión: docs/20 §10) y con un tope de personas para que no crezca sin fin. El proxy además limita
// por dirección. Puro: el reloj entra como función, así se prueba sin esperar.
export const MAX_TEXTO_SOPORTE = 2000;
export const MAX_MENSAJES = 5;
export const VENTANA_MS = 60 * 60_000;
const MAX_PERSONAS = 10_000;

export class TasaSoporte {
  private readonly envios = new Map<string, number[]>();
  constructor(private readonly ahora: () => number = () => Date.now()) {}

  // Milisegundos que faltan para poder enviar otro (0 = puede). No registra nada.
  espera(persona: string): number {
    const t = this.ahora();
    const previos = (this.envios.get(persona) ?? []).filter((x) => t - x < VENTANA_MS);
    if (previos.length < MAX_MENSAJES) return 0;
    return VENTANA_MS - (t - previos[0]);
  }

  // Comprueba y reserva el cupo en una sola operación síncrona (revisión del 11/11/2026): antes se miraba `espera()` antes del INSERT y
  // se anotaba después, y una ráfaga de peticiones simultáneas pasaba entera mientras la primera esperaba a la base. Devuelve 0 si
  // reservó (quien llama debe `devolver()` si el envío falla después) o los milisegundos que faltan.
  intentar(persona: string): number {
    const falta = this.espera(persona);
    if (falta > 0) return falta;
    const t = this.ahora();
    if (!this.envios.has(persona) && this.envios.size >= MAX_PERSONAS) {
      for (const [k, v] of this.envios) if (v.every((x) => t - x >= VENTANA_MS)) this.envios.delete(k);
    }
    const previos = (this.envios.get(persona) ?? []).filter((x) => t - x < VENTANA_MS);
    previos.push(t);
    this.envios.set(persona, previos);
    return 0;
  }

  // Devuelve el último cupo reservado (el INSERT falló: no se envió nada).
  devolver(persona: string): void {
    this.envios.get(persona)?.pop();
  }
}

// El texto del mensaje: obligatorio, 1 a 2 000 caracteres tras quitar los espacios de los bordes. Devuelve el texto o la lista de motivos.
export function textoDeSoporte(cuerpo: unknown): { texto: string } | { motivos: string[] } {
  if (typeof cuerpo !== 'object' || cuerpo === null || Array.isArray(cuerpo)) return { motivos: ['el cuerpo debe ser un objeto JSON con texto'] };
  const c = cuerpo as Record<string, unknown>;
  const motivos: string[] = [];
  for (const k of Object.keys(c)) if (k !== 'texto') motivos.push(`campo no admitido: ${k.slice(0, 40)}`);
  const t = typeof c.texto === 'string' ? c.texto.trim() : '';
  if (t.length < 1 || t.length > MAX_TEXTO_SOPORTE) motivos.push(`texto debe tener entre 1 y ${MAX_TEXTO_SOPORTE} caracteres`);
  return motivos.length > 0 ? { motivos } : { texto: t };
}
