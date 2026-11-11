import { Controller, Get, Query, Res } from '@nestjs/common';
import type { Response } from 'express';
import { ConsultaService } from './consulta.service.js';
import { ApiCookieAuth, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiTags, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { CABECERA_X_SIGUIENTE, limite, uuid } from './validacion.js';
import { leerCursor, siguiente } from './tablero.js';
import { TableroService } from './tablero.service.js';
import { exigir, exigirEnAlguno, permitir } from '../sesion/permisos.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { alcanceDeLectura } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';

@ApiTags('cuarentena')
@ApiCookieAuth('sesion')
@Controller('cuarentena')
export class CuarentenaController {
  constructor(private readonly consulta: ConsultaService, private readonly alcance: AlcanceService, private readonly tablero: TableroService) {}

  // GET /cuarentena?limite=50&dispositivo=<uuid> — últimas tramas rechazadas con su motivo (diagnóstico, RF-13).
  @Get()
  @ApiOperation({ summary: 'Últimas tramas rechazadas', description: 'Motivo (`no_registrado`, `dado_de_baja`, `malformada`, `invalida`), detalle concreto del rechazo, dispositivo si se identificó, tópico y la carga cruda acotada (texto UTF-8 o, si es binaria, hexadecimal: ver `payload_formato`). Lo que no trae credencial no aparece aquí: lo corta el broker. Para diagnosticar por qué un sensor no aparece.' })
  @ApiQuery({ name: 'limite', required: false, description: '1–500, por defecto 50' })
  @ApiQuery({ name: 'dispositivo', required: false, description: 'UUID del dispositivo: solo lo rechazado que se le atribuyó (ficha del panel)' })
  @ApiQuery({ name: 'cursor', required: false, description: 'Página siguiente (Etapa 4): el de la cabecera X-Siguiente, tal cual (docs/10 §8.4 punto 58)' })
  @ApiOkResponse({ description: 'Lista de tramas en cuarentena de los sitios del usuario (por el dispositivo o, si no se identificó, por el sitio del tópico); X-Siguiente si hay otra página', headers: { ...CABECERA_X_SIGUIENTE } })
  @ApiUnauthorizedResponse({ description: 'sesión requerida' })
  @ApiNotFoundResponse({ description: 'El dispositivo del filtro no existe o es de otro sitio' })
  async listar(
    @Usuario() u: UsuarioSesion, @Res({ passthrough: true }) res: Response,
    @Query('limite') lim?: string, @Query('dispositivo') dispositivo?: string, @Query('cursor') cursor?: string,
  ) {
    const l = limite(lim);
    const c = leerCursor(cursor);
    const d = dispositivo === undefined ? undefined : uuid(dispositivo, 'dispositivo');
    if (d !== undefined) await this.alcance.exigirDispositivo(u, 'leer', d);
    const filas = await this.consulta.cuarentena(l, d, alcanceDeLectura(u), c);
    const sig = siguiente(filas, l, (f) => ({ t: f.clave_t, id: f.id }));
    if (sig !== null) res.setHeader('X-Siguiente', sig);
    return filas.map(({ clave_t: _clave, ...f }) => f);
  }

  // GET /cuarentena/detectados?sitio — la bandeja de detectados (docs/19 §4, F3): lo que ya habla y no está dado de alta. Es la entrada
  // del alta: la ve quien puede dar de alta en ese sitio (hoy, administrador de sitio; el operador técnico, cuando exista el perfil).
  @Get('detectados')
  @ApiOperation({
    summary: 'Emisores no registrados de los últimos 7 días (Etapa 4)',
    description:
      'Tramas en cuarentena por `no_registrado` sin dispositivo, agrupadas por sitio y emisor (el identificador del tópico directo o el DevEUI tras una pasarela; si el ' +
      'tópico no tiene esa forma, el tópico): `sitio_codigo` (nulo si el tópico no nombra un sitio: solo lo ve el usuario del sistema), `emisor, topico` (el más reciente), `tramas` y `ultima`. Del sitio pedido o, sin `sitio`, de todos donde la persona puede dar de alta.',
  })
  @ApiQuery({ name: 'sitio', required: false, description: 'UUID del sitio' })
  @ApiOkResponse({ description: 'Hasta 200 emisores, el más reciente primero' })
  @ApiNotFoundResponse({ description: 'El sitio no existe o es de otro' })
  async detectados(@Usuario() u: UsuarioSesion, @Query('sitio') sitio?: string) {
    exigirEnAlguno(u, 'escribir');
    if (sitio !== undefined) {
      const s = uuid(sitio, 'sitio');
      exigir(u, 'escribir', await this.alcance.sitioExistente(s), 'sitio no encontrado');
      return this.tablero.detectados([s]);
    }
    if (u.todos) return this.tablero.detectados(null);
    return this.tablero.detectados([...u.sitios.keys()].filter((id) => permitir(u, 'escribir', id) === 'permitido'));
  }
}
