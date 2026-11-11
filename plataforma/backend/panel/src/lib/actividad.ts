// P14 Actividad (docs/19 §4, tablero v2, G2; RF-46, HU-11, HU-26): lo que hicieron las personas en un sitio (`evento` con quién) y sus
// entradas, salidas y bloqueos (`acceso`), por cursor. Solo para quien administra el sitio (el del sistema, en todos): lo decide el
// servidor; el panel oculta el menú a los demás según `GET /sesion`. El texto para personas lo arma el servidor (`texto`).
import type { FiltrosActividad } from './vista';

export interface FilaActividad {
  instante: string;
  clase: 'evento' | 'acceso';
  tipo: string;
  texto: string;
  usuario: { id: string; nombre: string } | null;
  dispositivo: { id: string; nombre: string } | null;
}

export const POR_PAGINA_ACTIVIDAD = 50;

// `GET /sitios/{id}/actividad?desde&hasta&tipo&usuario&cursor&limite`: el sitio por su id (la URL del panel lleva el código).
export function urlActividad(sitioId: string, f: FiltrosActividad, cursor: string | null = null): string {
  const q = new URLSearchParams();
  if (f.fija !== null) {
    q.set('desde', f.fija.desde.toISOString());
    q.set('hasta', f.fija.hasta.toISOString());
  }
  if (f.tipo !== '') q.set('tipo', f.tipo);
  if (f.usuario !== '') q.set('usuario', f.usuario);
  if (cursor !== null) q.set('cursor', cursor);
  q.set('limite', String(POR_PAGINA_ACTIVIDAD));
  return `/sitios/${encodeURIComponent(sitioId)}/actividad?${q.toString()}`;
}

// El tipo para personas, en el selector de filtro (el servidor admite el código; lo que no está aquí se muestra con sus palabras). Los
// códigos son los que escribe el servidor (corrección del 11/11/2026: había códigos inventados): los `evento.tipo` que deja el backend
// (alta/alta.service.ts, configurar, reglas, calibración, pasarelas, usuarios, términos) y los resultados de `acceso` (ck_acceso_resultado).
export const ROTULO_TIPO_ACTIVIDAD: Readonly<Record<string, string>> = {
  alta: 'Altas de dispositivos',
  baja: 'Bajas de dispositivos',
  rotacion: 'Credenciales rotadas',
  dispositivo_configurado: 'Configuración de dispositivos',
  reglas_cambiadas: 'Cambios de umbrales',
  canal_calibrado: 'Calibraciones',
  condicion_abierta: 'Condiciones abiertas',
  condicion_cerrada: 'Condiciones cerradas',
  pasarela_alta: 'Altas de pasarelas',
  pasarela_baja: 'Bajas de pasarelas',
  pasarela_rotacion: 'Credenciales de pasarelas rotadas',
  usuario_alta: 'Altas de cuentas',
  usuario_cambio: 'Cambios de cuentas',
  usuario_baja: 'Bajas de cuentas',
  usuario_clave: 'Cambios de clave',
  terminos_aceptados: 'Términos aceptados',
  ok: 'Entradas',
  cierre: 'Salidas',
  bloqueado: 'Bloqueos por intentos',
  clave_incorrecta: 'Claves incorrectas',
  inactivo: 'Intentos con la cuenta desactivada',
};
export const rotuloTipoActividad = (t: string): string => ROTULO_TIPO_ACTIVIDAD[t] ?? t.replace(/_/g, ' ');
