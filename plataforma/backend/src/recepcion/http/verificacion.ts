import { Injectable, Logger } from '@nestjs/common';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { caminoDeCredencial, resumirSecreto, verificarCredencialDispositivo } from '../../alta/credenciales.js';
import type { CredencialHttp } from '../recepcion.service.js';
import { Cupo } from './topes.js';

// Filtro 1 de la vía HTTP (docs/10 §8.4 punto 52). Desde el 13/11/2026 (docs/11 §4) dos caminos, según la huella de la credencial activa:
//  - camino rápido, huella `sha256$…` (la de toda credencial creada desde ese día): un resumen y una comparación en tiempo constante, sin
//    cupo ni pool de hilos. Un dispositivo inexistente, sin credencial, de otra vía o dado de baja hace EL MISMO trabajo contra una huella
//    de relleno que nadie conoce: «no existe» y «token equivocado» cuestan lo mismo (una consulta, un resumen, una comparación).
//  - camino anterior, huella `scrypt$…` (credenciales creadas antes): scrypt dentro del cupo (d), con la caché de verificaciones (a): tras
//    un acierto se recuerda, por dispositivo, la huella contra la que se verificó y el resumen SHA-256 del token; en la trama siguiente, si
//    la huella activa es la misma y el resumen coincide, el token se da por verificado sin scrypt. Al PRIMER acierto la fila se convierte a
//    `sha256$…` (`convertir`, una sentencia condicionada a la huella verificada); si eso falla, se anota y la trama sigue.
export type ResultadoVerificacion = 'ok' | 'no' | 'saturado';
type Aceptable = CredencialHttp & { hash: string };
// Reemplaza la huella anterior por la nueva en la fila `credencialId`, solo si sigue siendo `anterior`; true si la cambió.
export type ConvertirCredencial = (credencialId: string, anterior: string, nueva: string) => Promise<boolean>;

const resumen = (token: string): Buffer => createHash('sha256').update(token).digest();

@Injectable()
export class VerificacionDeTokens {
  private readonly log = new Logger('recepcion-http');
  private readonly cache = new Map<string, { huella: string; resumen: Buffer }>();
  // Pista por identificador: el resumen del último token verificado para ese id_fisico. Sirve ANTES de consultar la base, para que una
  // dirección bloqueada (punto 52 (c)) no gaste ni una consulta salvo que presente el token que ya se le conoce a ese identificador.
  private readonly pistas = new Map<string, Buffer>();
  // Una huella válida de un secreto que nadie conoce (se genera al construir y no sale del proceso): verificar contra ella cuesta lo mismo
  // que contra una real.
  private readonly relleno = resumirSecreto(randomBytes(24).toString('base64url'));

  constructor(
    private readonly cupo = new Cupo(),
    private readonly maxEntradas = 10_000,
    private readonly convertir?: ConvertirCredencial,
  ) {}

  // Vía http, no dado de baja y con credencial activa: lo demás ni con el token correcto entra.
  private static aceptable(fila: CredencialHttp | undefined): fila is Aceptable {
    return fila !== undefined && fila.hash !== null && fila.via === 'http' && fila.estado !== 'baja';
  }

  // ¿Esta fila se verifica por el camino anterior (scrypt, con cupo)? Lo pregunta el controlador antes de verificar: con la dirección
  // bloqueada, solo el camino rápido sigue abierto (no gasta CPU que valga la pena acotar).
  caminoAnterior(fila: CredencialHttp | undefined): boolean {
    return VerificacionDeTokens.aceptable(fila) && caminoDeCredencial(fila.hash) === 'scrypt';
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

  // 'no' por cualquier motivo (la respuesta no dice cuál); 'saturado' solo en el camino anterior, con el cupo lleno.
  async verificar(fila: CredencialHttp | undefined, token: string, idFisico?: string): Promise<ResultadoVerificacion> {
    if (this.caminoAnterior(fila)) return this.verificarAnterior(fila as Aceptable, token, idFisico);
    // Camino rápido. La huella de la fila solo si es aceptable y `sha256$…`; si no, la de relleno, con la misma llamada: el mismo resumen
    // y la misma comparación en los dos casos.
    const propia = VerificacionDeTokens.aceptable(fila) && caminoDeCredencial(fila.hash) === 'sha256';
    const { valida } = await verificarCredencialDispositivo(token, propia ? fila.hash : this.relleno);
    if (!valida || !propia) return 'no';
    if (idFisico !== undefined) this.recordarPista(idFisico, token);
    return 'ok';
  }

  get entradas(): number {
    return this.cache.size;
  }

  // Camino anterior: scrypt dentro del cupo (d) y, al primer acierto, la conversión de la fila (fuera del cupo).
  private async verificarAnterior(fila: Aceptable, token: string, idFisico: string | undefined): Promise<ResultadoVerificacion> {
    if (!this.cupo.tomar()) return 'saturado';
    try {
      const { valida } = await verificarCredencialDispositivo(token, fila.hash);
      if (!valida) return 'no';
      this.recordar(fila.id, fila.hash, token);
      if (idFisico !== undefined) this.recordarPista(idFisico, token);
    } finally {
      this.cupo.soltar();
    }
    await this.convertirAnterior(fila, token);
    return 'ok';
  }

  // Un fallo aquí no pierde la trama: se anota sin token ni huella y la entrada de la caché sigue valiendo; se reintenta en la próxima
  // verificación con scrypt. Si la fila cambió, la caché de este dispositivo ya no sirve (la huella activa es otra) y se suelta.
  private async convertirAnterior(fila: Aceptable, token: string): Promise<void> {
    if (this.convertir === undefined || !fila.credencial_id) return;
    try {
      if (await this.convertir(fila.credencial_id, fila.hash, resumirSecreto(token))) this.cache.delete(fila.id);
    } catch (e) {
      const codigo = typeof e === 'object' && e !== null ? (e as { code?: unknown }).code : undefined; // un rechazo puede no traer objeto
      this.log.warn(`no se pudo convertir a SHA-256 la credencial anterior del dispositivo ${fila.id} (${typeof codigo === 'string' ? codigo : e instanceof Error ? e.name : 'error'}); la trama sigue y se reintenta en la próxima verificación con scrypt`);
    }
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
}
