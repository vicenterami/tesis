import { Injectable } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { hashScrypt, verificarScrypt } from '../../alta/credenciales';
import type { CredencialHttp } from '../recepcion.service';
import { Cupo } from './topes';

// Filtro 1 de la vía HTTP (docs/10 §8.4 punto 52): el token contra la huella scrypt de la credencial activa, con la caché de
// verificaciones (a). Tras una verificación correcta se recuerda, por dispositivo, la huella contra la que se verificó y el resumen
// SHA-256 del token: en la trama siguiente, si la huella activa en la base es la misma y el resumen coincide, el token se da por
// verificado sin scrypt. Una rotación cambia la huella (la entrada deja de servir sola); una baja o un cambio de vía se ven en la
// fila, antes; un token equivocado nunca entra y cuesta scrypt igual que antes, así que el tiempo de un fallo no cambia.
export type ResultadoVerificacion = 'ok' | 'no' | 'saturado';
type Aceptable = CredencialHttp & { hash: string };

const resumen = (token: string): Buffer => createHash('sha256').update(token).digest();

@Injectable()
export class VerificacionDeTokens {
  private readonly cache = new Map<string, { huella: string; resumen: Buffer }>();
  // Pista por identificador: el resumen del último token verificado para ese id_fisico. Sirve ANTES de consultar la base, para que una
  // dirección bloqueada (punto 52 (c)) no gaste ni una consulta salvo que presente el token que ya se le conoce a ese identificador.
  private readonly pistas = new Map<string, Buffer>();
  private rellenoHuella: Promise<string> | null = null;

  constructor(
    private readonly cupo = new Cupo(),
    private readonly maxEntradas = 10_000,
  ) {}

  // Vía http, no dado de baja y con credencial activa: lo demás ni con el token correcto entra.
  private static aceptable(fila: CredencialHttp | undefined): fila is Aceptable {
    return fila !== undefined && fila.hash !== null && fila.via === 'http' && fila.estado !== 'baja';
  }

  // (a) Sin scrypt: true solo si ya se verificó este mismo token contra esta misma huella.
  enCache(fila: CredencialHttp | undefined, token: string): boolean {
    if (!VerificacionDeTokens.aceptable(fila)) return false;
    const entrada = this.cache.get(fila.id);
    if (entrada === undefined || entrada.huella !== fila.hash) return false;
    const r = resumen(token);
    return r.length === entrada.resumen.length && timingSafeEqual(r, entrada.resumen);
  }

  // ¿Es el último token verificado para este identificador? No reemplaza a la caché (no mira la huella de la base): solo decide si
  // vale la pena consultar. Comparación en tiempo constante.
  pista(idFisico: string, token: string): boolean {
    const r = this.pistas.get(idFisico);
    if (r === undefined) return false;
    const t = resumen(token);
    return t.length === r.length && timingSafeEqual(t, r);
  }

  // Con scrypt, dentro del cupo (d). Si el dispositivo no existe se verifica igual contra una huella de relleno: el tiempo de
  // respuesta no revela cuáles existen. 'no' por cualquier motivo (la respuesta no dice cuál).
  async verificar(fila: CredencialHttp | undefined, token: string, idFisico?: string): Promise<ResultadoVerificacion> {
    if (!this.cupo.tomar()) return 'saturado';
    try {
      const valida = await verificarScrypt(token, fila?.hash ?? (await this.huellaDeRelleno()));
      if (!valida || !VerificacionDeTokens.aceptable(fila)) return 'no';
      this.recordar(fila.id, fila.hash, token);
      if (idFisico !== undefined) this.recordarPista(idFisico, token);
      return 'ok';
    } finally {
      this.cupo.soltar();
    }
  }

  get entradas(): number {
    return this.cache.size;
  }

  // A lo más una entrada por dispositivo que haya autenticado; sobre el tope se suelta la más antigua (un Map conserva el orden de
  // inserción y la entrada se reinserta al refrescarse).
  private recordar(id: string, huella: string, token: string): void {
    this.cache.delete(id);
    if (this.cache.size >= this.maxEntradas) {
      const masAntigua = this.cache.keys().next().value;
      if (masAntigua !== undefined) this.cache.delete(masAntigua);
    }
    this.cache.set(id, { huella, resumen: resumen(token) });
  }

  private recordarPista(idFisico: string, token: string): void {
    this.pistas.delete(idFisico);
    if (this.pistas.size >= this.maxEntradas) {
      const masAntigua = this.pistas.keys().next().value;
      if (masAntigua !== undefined) this.pistas.delete(masAntigua);
    }
    this.pistas.set(idFisico, resumen(token));
  }

  // Una huella válida de un secreto que nadie conoce: verificar contra ella cuesta lo mismo que contra una real. Si calcularla falla,
  // no se guarda el fallo: la próxima vez se intenta de nuevo (si no, todo desconocido daría 500 hasta reiniciar).
  private huellaDeRelleno(): Promise<string> {
    this.rellenoHuella ??= hashScrypt(randomBytes(24).toString('base64url')).catch((e: unknown) => {
      this.rellenoHuella = null;
      throw e;
    });
    return this.rellenoHuella;
  }
}
