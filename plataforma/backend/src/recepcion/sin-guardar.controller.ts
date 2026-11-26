import { Controller, Get, NotFoundException, Param } from '@nestjs/common';
import { ApiBadRequestResponse, ApiCookieAuth, ApiForbiddenResponse, ApiHeader, ApiNotFoundResponse, ApiOkResponse, ApiOperation, ApiParam, ApiServiceUnavailableResponse, ApiTags, ApiTooManyRequestsResponse, ApiUnauthorizedResponse } from '@nestjs/swagger';
import { uuid } from '../consulta/validacion.js';
import { AlcanceService } from '../sesion/alcance.service.js';
import { Usuario } from '../sesion/guardia.js';
import { exigirEnAlguno } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { RecepcionService } from './recepcion.service.js';
import { ESPERA_SIN_GUARDAR_MS, MAX_CLAVES_SIN_GUARDAR, MAX_SIN_GUARDAR_EN_CURSO, MAX_TRAMAS_SIN_GUARDAR, TOPE_SIN_GUARDAR_MS } from './sin-guardar.js';

// «Lo que la trama trae y no se guarda» (docs/19 §4 AA, punto 6; docs/10 §8.4 punto 72 i). Vive con la recepción porque relee las tramas
// con sus adaptadores. Lee cargas crudas, que no son públicas (docs/10 §8.4 punto 6): exige `escribir`, quien puede agregar el canal.
@ApiTags('dispositivos')
@ApiCookieAuth('sesion')
@Controller('dispositivos')
export class SinGuardarController {
  constructor(private readonly recepcion: RecepcionService, private readonly alcance: AlcanceService) {}

  @Get(':id/sin-guardar')
  @ApiOperation({
    summary: 'Lo que las tramas del equipo traen y no se guarda (Etapa 4)',
    description:
      `Relee las ${MAX_TRAMAS_SIN_GUARDAR} tramas más recientes del equipo (aceptadas y en cuarentena, dentro de su retención) con el adaptador de su formato, sin ` +
      'escribir nada, y responde `revisadas` y `claves[{clave, magnitud, valor, unidad, visto, origen}]`: lo que traen y el equipo no tiene como canal. ' +
      '`magnitud`: la del catálogo que la recibiría (se agrega con POST /dispositivos/{id}/canales), o null si no hay magnitud ni alias para esa clave; ' +
      '`valor`: el último valor numérico visto (un texto no se muestra); `origen`: `carga` o `enlace` (la señal de una trama LoRaWAN). ' +
      `Hasta ${MAX_CLAVES_SIN_GUARDAR} claves, la más reciente primero, cada una recortada a 32 caracteres. Lee cargas crudas: exige la acción \`escribir\` (docs/20 §6). ` +
      `Topes: una relectura a la vez por proceso, una cada ${ESPERA_SIN_GUARDAR_MS / 1000} s por persona y equipo, y ${TOPE_SIN_GUARDAR_MS / 1000} s como máximo en la base (docs/10 §8.4 punto 72 i).`,
  })
  @ApiHeader({ name: 'X-Clave-Admin', required: false, description: 'Sin sesión: la clave de administrador (HTTP_CLAVE_ADMIN), como usuario del sistema (docs/20 §5)' })
  @ApiParam({ name: 'id', description: 'UUID del dispositivo' })
  @ApiOkResponse({ description: '`{revisadas, claves[{clave, magnitud, valor, unidad, visto, origen}]}`' })
  @ApiBadRequestResponse({ description: 'UUID inválido' })
  @ApiUnauthorizedResponse({ description: 'Sin sesión ni X-Clave-Admin' })
  @ApiForbiddenResponse({ description: 'Un perfil sin la acción escribir en ese sitio (docs/20 §6)' })
  @ApiTooManyRequestsResponse({ description: `\`codigo: sin_guardar_ocupado\` (ya hay ${MAX_SIN_GUARDAR_EN_CURSO} relectura en curso) o \`sin_guardar_espera\` (la misma persona revisó este equipo hace menos de ${ESPERA_SIN_GUARDAR_MS / 1000} s); \`reintentar_en_s\` dice cuánto esperar` })
  @ApiServiceUnavailableResponse({ description: `\`codigo: sin_guardar_tiempo\`: la relectura pasó de ${TOPE_SIN_GUARDAR_MS / 1000} s y la base la canceló` })
  @ApiNotFoundResponse({ description: 'No existe, o es de otro sitio' })
  async sinGuardar(@Usuario() u: UsuarioSesion, @Param('id') id: string) {
    exigirEnAlguno(u, 'escribir');
    const dispositivoId = uuid(id, 'dispositivo');
    await this.alcance.exigirDispositivo(u, 'escribir', dispositivoId);
    const r = await this.recepcion.sinGuardar(dispositivoId, u.id ?? 'sistema');
    if (r === undefined) throw new NotFoundException('dispositivo no encontrado');
    return r;
  }
}
