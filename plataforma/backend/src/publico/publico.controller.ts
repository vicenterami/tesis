import { Controller, Get, Query, Req } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiQuery, ApiResponse, ApiServiceUnavailableResponse, ApiTags,
} from '@nestjs/swagger';
import type { Request } from 'express';
import { Publica } from '../sesion/guardia.js';
import { CABECERA_ENLACE, K_MAXIMO, NO_DISPONIBLE, PUBLICO, VENTANAS_PUBLICAS, VistaPublica } from './publico.js';
import { VistaPublicaService } from './vista-publica.service.js';

// La respuesta de GET /publico y de la vista previa (la misma función, docs/19 §4, O, punto 3), declarada en el OpenAPI.
export const ESQUEMA_VISTA = {
  type: 'object',
  required: ['titulo', 'descripcion', 'sitio', 'zona_horaria', 'minimo_dispositivos', 'ventana', 'ventanas', 'intervalo', 'desde', 'hasta', 'ultimo_dato', 'tiempos', 'magnitudes'],
  properties: {
    titulo: { type: 'string' }, descripcion: { type: 'string', nullable: true }, sitio: { type: 'string', description: 'Nombre del sitio' },
    zona_horaria: { type: 'string' }, minimo_dispositivos: { type: 'integer', minimum: 1, maximum: K_MAXIMO, description: 'k que rige: el del sitio (todos sus enlaces ocultan lo mismo), nunca menos que el piso del despliegue' },
    ventana: { type: 'string', enum: [...VENTANAS_PUBLICAS] }, ventanas: { type: 'array', items: { type: 'string', enum: [...VENTANAS_PUBLICAS] } },
    intervalo: { type: 'string' }, desde: { type: 'string', format: 'date-time' }, hasta: { type: 'string', format: 'date-time' },
    ultimo_dato: { type: 'string', format: 'date-time', nullable: true, description: 'Inicio del tramo de la lectura más reciente de lo publicado' },
    tiempos: { type: 'array', items: { type: 'integer' }, description: 'Segundos Unix, comunes a todas las series; solo los tramos que publican algún valor' },
    magnitudes: {
      type: 'array',
      items: {
        type: 'object',
        required: ['codigo', 'nombre', 'unidad', 'ahora', 'serie', 'protegido', 'zonas'],
        properties: {
          codigo: { type: 'string' }, nombre: { type: 'string' }, unidad: { type: 'string' }, ahora: { type: 'number', nullable: true },
          serie: { type: 'array', items: { type: 'number', nullable: true }, description: 'Un valor por cada uno de `tiempos`' },
          protegido: { type: 'boolean', description: 'true si k > 1: algún tramo puede ocultarse para proteger a equipos individuales (depende solo de la configuración)' },
          zonas: { type: 'array', items: { type: 'object', required: ['nombre', 'ahora', 'serie'], properties: { nombre: { type: 'string' }, ahora: { type: 'number', nullable: true }, serie: { type: 'array', items: { type: 'number', nullable: true } } } } },
        },
      },
    },
  },
};

// GET /publico: la vista pública por enlace (RF-62, HU-32; docs/19 §4, O, puntos 5 a 9). Sin sesión: la guardia central no corre aquí
// (@Publica) y no lee la cabecera del token; ESTE es el único lugar del backend que la lee (docs/20 §5; aislamiento.spec.ts lo comprueba).
// El token no va en la ruta ni en la consulta: el proxy registra la ruta, no las cabeceras. Fuera de la matriz de docs/20 §6.
@ApiTags('publico')
@Controller('publico')
export class PublicoController {
  constructor(private readonly vista: VistaPublicaService) {}

  @Get()
  @Publica()
  @ApiOperation({
    summary: 'Vista pública por enlace (RF-62)',
    description:
      'Sin sesión: el token del enlace en la cabecera `X-Enlace-Publico` (nunca en la ruta ni en la consulta). SOLO promedios: cada valor es el promedio ' +
      'de los dispositivos que aportan (docs/19 §4, M) y es null cuando no hay datos o cuando lo aportan menos de k dispositivos —los dos casos se ven ' +
      'igual, a propósito—; `protegido` (si k > 1) avisa que algún tramo puede ocultarse. El total del sitio se publica solo si los dispositivos de las ' +
      'zonas del sitio con menos de k (el k es del sitio: todos sus enlaces ocultan lo mismo) suman 0 o al menos k (no se despeja por resta). Cada lectura cuenta en la zona donde estaba el equipo cuando se tomó. Nunca mínimo, máximo, lecturas sueltas, identificadores, nombres de ' +
      'dispositivos ni cuántos aportan. Un token inexistente, vencido, revocado, con forma inválida o de un sitio inactivo recibe la misma 404. Con ' +
      '`carga=si` la petición cuenta como una carga de la pantalla (los refrescos no la llevan). Los datos se guardan ' +
      `${PUBLICO.guardadaMs / 1000} s por enlace y ventana (también un cálculo que pasó el tiempo máximo, como 503); la vigencia del enlace se lee en cada petición.`,
  })
  @ApiHeader({ name: 'X-Enlace-Publico', required: true, description: 'El token del enlace: 43 caracteres base64url (el fragmento de la dirección …/panel/#/v/<token>)' })
  @ApiQuery({ name: 'ventana', required: false, enum: VENTANAS_PUBLICAS, description: 'Por defecto 24h; hasta la ventana máxima del enlace' })
  @ApiQuery({ name: 'carga', required: false, enum: ['si'], description: '`si` en la primera petición de la pantalla: cuenta un acceso; los refrescos no la llevan' })
  @ApiOkResponse({
    description: 'La vista: solo promedios de lo publicado; lo oculto, como un valor sin datos',
    schema: ESQUEMA_VISTA,
  })
  @ApiBadRequestResponse({ description: 'ventana fuera de la lista o más larga que la máxima del enlace (solo con un token vigente)' })
  @ApiNotFoundResponse({ description: `«${NO_DISPONIBLE}»: inexistente, vencido, revocado o mal formado; la misma respuesta en todos los casos` })
  @ApiResponse({ status: 429, description: 'Demasiadas peticiones desde la misma dirección (zona `publico` del proxy), en JSON' })
  @ApiServiceUnavailableResponse({ description: `Los datos tardaron más de ${PUBLICO.tiempoMaximoMs / 1000} s o hay demasiadas vistas calculándose: la pantalla reintenta en un minuto` })
  // `Cache-Control: no-store` y `X-Robots-Tag: noindex` los pone cabecerasDeLaApi (arranque.ts) a toda respuesta de esta ruta, también a la 404.
  ver(@Req() req: Request, @Query('ventana') ventana?: unknown, @Query('carga') carga?: unknown): Promise<VistaPublica> {
    return this.vista.servir(req.headers[CABECERA_ENLACE], ventana, carga === 'si');
  }
}
