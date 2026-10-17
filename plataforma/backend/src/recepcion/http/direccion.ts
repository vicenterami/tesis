import { timingSafeEqual } from 'node:crypto';
import type { Request } from 'express';

// La dirección del cliente (docs/10 §8.4 punto 52). Detrás del proxy todas las peticiones llegan desde él, y la dirección real viene
// en X-Forwarded-For; pero esa cabecera la puede escribir cualquiera que alcance el backend sin pasar por el proxy. Se le cree solo
// si la petición trae además X-Proxy-Secreto con el secreto compartido (PROXY_SECRETO: el mismo en el proxy y en el backend). Sin
// secreto configurado, o si no coincide, cuenta la dirección del socket. Comparación en tiempo constante y de largo igual: la cabecera
// no sirve para adivinar el secreto letra por letra.
export const CABECERA_SECRETO = 'x-proxy-secreto';

// `forwardedIgnorado`: llegó X-Forwarded-For con el secreto configurado y no se le creyó (sin cabecera o con otro valor): así se nota una
// rotación a medias entre el proxy y el backend. Sin secreto configurado no se marca: eso ya se avisó al arrancar.
export interface DireccionCliente { direccion: string; forwardedIgnorado: boolean }

export function direccionDelCliente(req: Request, secreto: string | undefined): DireccionCliente {
  const socket = req.socket?.remoteAddress ?? 'desconocida';
  const xff = req.headers['x-forwarded-for'];
  const primera = (Array.isArray(xff) ? xff[0] : (xff ?? '')).split(',')[0].trim();
  if (secreto === undefined) return { direccion: socket, forwardedIgnorado: false };
  const presentado = req.headers[CABECERA_SECRETO];
  const coincide = typeof presentado === 'string' && Buffer.byteLength(presentado) === Buffer.byteLength(secreto)
    && timingSafeEqual(Buffer.from(presentado), Buffer.from(secreto));
  if (!coincide) return { direccion: socket, forwardedIgnorado: primera !== '' };
  return { direccion: primera || socket, forwardedIgnorado: false };
}
