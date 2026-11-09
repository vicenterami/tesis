import { igualesEnTiempoConstante } from './credenciales';

export const CABECERA_CLAVE_ADMIN = 'x-clave-admin';
export type RechazoClaveAdmin = 'sin_configurar' | 'ausente' | 'distinta';

// Por qué se rechaza una petición a una ruta que escribe, o null si pasa (docs/10 §8.4 punto 41). Node une una cabecera repetida
// en un solo texto separado por «, » (solo Set-Cookie llega como lista), así que una repetida no coincide y cae en «distinta»;
// la rama de lista existe por el tipo de Express. La comparación es de tiempo constante sobre hashes: ni el largo se filtra.
export function rechazoDeClaveAdmin(cabecera: string | string[] | undefined, configurada: string | undefined): RechazoClaveAdmin | null {
  if (configurada === undefined) return 'sin_configurar';
  if (typeof cabecera !== 'string' || cabecera === '') return 'ausente';
  return igualesEnTiempoConstante(cabecera, configurada) ? null : 'distinta';
}

// Desde el 08/11/2026 la comprueba el guardia central de la sesión (sesion/guardia.ts, docs/20 §5): si la cabecera viene y coincide, la
// petición la hace el «usuario del sistema», con rol de administrador en todos los sitios, hasta que la variable se retire del .env.
