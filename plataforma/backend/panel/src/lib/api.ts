// Un solo cliente HTTP para el panel (docs/19 §6): mismo origen (el backend sirve el panel; en desarrollo, Vite
// reenvía), cada código de error con su acción, y nunca texto del usuario interpolado en una ruta.
export class ErrorApi extends Error {
  constructor(
    public readonly codigo: number,
    public readonly accion: string,
    mensaje: string,
  ) {
    super(mensaje);
    this.name = 'ErrorApi';
  }
}

const ACCIONES: Readonly<Record<number, string>> = {
  400: 'revisa el filtro o la fecha',
  404: 'ya no existe; vuelve al inventario',
  409: 'alguien lo cambió entretanto; recarga para ver el valor nuevo',
  421: 'el servicio no atiende esta dirección; entra por el nombre del servidor',
  503: 'el servicio está saturado; se reintenta solo',
};

export function accionPara(codigo: number): string {
  return ACCIONES[codigo] ?? 'inténtalo de nuevo en un momento';
}

export async function obtener<T>(ruta: string, abortar?: AbortSignal): Promise<T> {
  const r = await fetch(ruta, { headers: { accept: 'application/json' }, signal: abortar });
  if (!r.ok) throw new ErrorApi(r.status, accionPara(r.status), `HTTP ${r.status} en ${ruta}`);
  return (await r.json()) as T;
}
