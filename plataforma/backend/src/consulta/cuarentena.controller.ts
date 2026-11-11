import { Controller, Get, Query } from '@nestjs/common';
import { ConsultaService } from './consulta.service.js';
import { ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { limite, uuid } from './validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

@ApiTags('cuarentena')
@ApiCookieAuth('sesion')
@Controller('cuarentena')
export class CuarentenaController {
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService) {}

  // GET /cuarentena?limite=50&dispositivo=<uuid> — últimas tramas rechazadas con su motivo (diagnóstico, RF-13).
  @Get()
  @ApiOperation({ summary: 'Últimas tramas rechazadas', description: 'Motivo (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle concreto del rechazo, dispositivo si se identificó, tópico y la carga cruda acotada (texto UTF-8 o, si es binaria, hexadecimal: ver `payload_formato`). Lo que no trae credencial no aparece aquí: lo corta el broker. Para diagnosticar por qué un sensor no aparece.' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo lo rechazado que se le atribuyó (ficha del panel)' })
  @ApiOkResponse({ description: 'Lista de tramas en cuarentena de los sitios del usuario (por el dispositivo o, si no se identificó, por el sitio del tópico)' })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiNotFoundResponse({ description: 'El dispositivo del filtro no existe o es de otro sitio' })
  async listar(@Usuario() u: UsuarioSesion, @Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string) {
    const l = limite(lim);
    const d = dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo');
    if (d !== undefined) await this.alcance.exigirDispositivo(u, 'leer', d);
    return this.consulta.cuarentena(l, d, alcanceDeLectura(u));
  }
}
