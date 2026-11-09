import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service';
import { ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { limite, uuid } from './validacion';
import { AlcanceService } from '../sesion/alcance.service';
import { Usuario } from '../sesion/guardia';
import { alcanceDeLectura } from '../sesion/permisos';
import type { UsuarioSesion } from '../sesion/permisos';

@ApiTags('condiciones')
@ApiCookieAuth('sesion')
@Controller('condiciones')
export class CondicionesController {
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService) {}

  // GET /condiciones?abiertas=true|false&limite=50&dispositivo=<uuid>  (sin `abiertas`: todas; sin `dispositivo`: de todos)
  @Get()
  @ApiOperation({ summary: 'Condiciones (estados anómalos) con duración', description: 'Cada condición con `duracion_s`, dispositivo y regla que la disparó. `sin_comunicacion` la abre el supervisor periódico; `umbral`, el filtro de alertas con histéresis.' })
  @ApiQuery({ name: 'abiertas', required: false, enum: ['true', 'false'], description: 'Sin el parámetro: todas' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo sus condiciones (ficha del panel)' })
  @ApiOkResponse({ description: 'Lista de condiciones de los sitios del usuario' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiNotFoundResponse({ description: 'El dispositivo del filtro no existe o es de otro sitio' })
  async listar(@Usuario() u: UsuarioSesion, @Query('abiertas') abiertas?: string, @Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string) {
    const filtro = abiertas === undefined ? undefined : abiertas === 'true';
    const l = limite(lim);
    const d = dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo');
    if (d !== undefined) await this.alcance.exigirDispositivo(u, 'leer', d);
    return this.consulta.condiciones(filtro, l, d, alcanceDeLectura(u));
  }
}
