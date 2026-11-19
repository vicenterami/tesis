import { HttpException, HttpStatus, Injectable } from '@nestjs/common';

// Consultas pesadas simultáneas admitidas por proceso: cada una ocupa una conexión a la base mientras dura. Desde el 19/11/2026
// (docs/19 §4, bloque R, punto 3) el cupo es UNO para GET /dispositivos/{id}/exportar, GET /sitios/{id}/exportar y
// GET /sitios/{id}/exportar/estimacion: el pool tiene 5 conexiones (db/db.module.ts) y lo comparte la recepción, así que entre
// exportaciones y estimaciones se toman a lo más 2 y quedan 3 para la recepción. La estimación entra porque cancelarla en el panel no
// cancela su consulta en la base: sin cupo, unas cuantas estimaciones seguidas, más dos exportaciones, agotaban el pool (revisión del
// mismo día). Un proveedor del módulo (una sola instancia).
export const MAX_EXPORTACIONES = 2;
export const CODIGO_CUPO = 'exportaciones_en_curso';
export const MENSAJE_CUPO = `hay ${MAX_EXPORTACIONES} exportaciones o estimaciones en curso; inténtalo en un momento`;

@Injectable()
export class CupoExportaciones {
  private enCurso = 0;

  // Toma un lugar o responde 429 con `codigo` (como los 409 con código del proyecto) al tercero. Quien lo toma lo suelta en un `finally`.
  tomar(): void {
    if (this.enCurso >= MAX_EXPORTACIONES) {
      throw new HttpException({ statusCode: 429, error: 'Too Many Requests', codigo: CODIGO_CUPO, message: MENSAJE_CUPO }, HttpStatus.TOO_MANY_REQUESTS);
    }
    this.enCurso++;
  }
  soltar(): void {
    this.enCurso = Math.max(0, this.enCurso - 1);
  }
  get ocupados(): number {
    return this.enCurso;
  }
}
