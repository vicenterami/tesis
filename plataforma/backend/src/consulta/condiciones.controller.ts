import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsultaService } from './consulta.service.js';
import { ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CABECERA_X_SIGUIENTE, ISO_8601, fecha, limite, uuid } from './validacion.js';
import { leerCursor, siguiente } from './tablero.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

@ApiTags('condiciones')
@ApiCookieAuth('sesion')
@Controller('condiciones')
export class CondicionesController {
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService) {}

  // GET /condiciones?abiertas=true|false&limite=50&dispositivo=<uuid>  (sin `abiertas`: todas; sin `dispositivo`: de todos)
  @Get()
  @ApiOperation({ summary: 'Condiciones (estados anómalos) con duración', description: 'Cada condición con `duracion_s`, dispositivo, el nombre de su sitio (`sitio`) y regla que la disparó. `sin_comunicacion` la abre el supervisor periódico; `umbral`, el filtro de alertas con histéresis.' })
  @ApiQuery({ name: 'abiertas', required: false, enum: ['true', 'false'], description: 'Sin el parámetro: todas' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo sus condiciones (ficha del panel)' })
  @ApiQuery({ name: 'desde', required: false, description: `${ISO_8601} (Etapa 4): solo las que siguen abiertas o se cerraron desde este instante` })
  @ApiQuery({ name: 'hasta', required: false, description: `${ISO_8601} (Etapa 4): solo las abiertas antes de este instante` })
  @ApiQuery({ name: 'cursor', required: false, description: 'Página siguiente (Etapa 4): el de la cabecera X-Siguiente, tal cual (docs/10 §8.4 punto 58)' })
  @ApiOkResponse({ description: 'Lista de condiciones de los sitios del usuario, de la más reciente a la más antigua; X-Siguiente si hay otra página', headers: { ...CABECERA_X_SIGUIENTE } })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiNotFoundResponse({ description: 'El dispositivo del filtro no existe o es de otro sitio' })
  async listar(
    @Usuario() u: UsuarioSesion, @Res({ passthrough: true }) res: Response,
    @Query('abiertas') abiertas?: string, @Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string, @Query('cursor') cursor?: string,
    @Query('desde') desde?: string, @Query('hasta') hasta?: string,
  ) {
    const ventana = { desde: desde === undefined ? undefined : fecha(desde, new Date(), 'desde'), hasta: hasta === undefined ? undefined : fecha(hasta, new Date(), 'hasta') };
    const filtro = abiertas === undefined ? undefined : abiertas === 'true';
    const l = limite(lim);
    const c = leerCursor(cursor);
    const d = dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo');
    if (d !== undefined) await this.alcance.exigirDispositivo(u, 'leer', d);
    const filas = await this.consulta.condiciones(filtro, l, d, alcanceDeLectura(u), c, ventana);
    const sig = siguiente(filas, l, (f) => ({ t: f.clave_t, id: f.id }));
    if (sig !== null) res.setHeader('X-Siguiente', sig);
    return filas.map(({ clave_t: _clave, ...f }) => f);
  }
}
