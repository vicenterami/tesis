import { Body, Controller, Get, HttpCode, Param, Patch, Post, Query } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiQuery, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { Usuario } from '../sesion/guardia.js';
import { exigirGlobal, permitirGlobal } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { validarCambioMagnitud, validarMagnitudNueva, validarRangoPropuesto } from './magnitudes.dto.js';
import { Magnitud, MagnitudesService } from './magnitudes.service.js';
import { UNIDADES_CANONICAS } from './unidades.js';

// El catálogo de magnitudes (docs/19 §4, N4 y T; docs/20 §6). Leerlo: cualquier sesión (el alta de a uno y por lote lo necesitan; no es de
// ningún sitio). Escribirlo y medir el impacto de un rango: solo quien administra el sistema (la acción `sistema`), porque un cambio rige
// para todos los sitios (docs/10 §8.4 punto 69 i).
const PROPIEDADES = {
  nombre: { type: 'string', maxLength: 80 },
  rango_min: { type: 'number' }, rango_max: { type: 'number' },
  umbral_alto_sugerido: { type: 'number', nullable: true }, umbral_bajo_sugerido: { type: 'number', nullable: true },
  histeresis_sugerida: { type: 'number', minimum: 0 },
  alias: { type: 'array', maxItems: 32, items: { type: 'string', pattern: '^[a-z0-9_.-]{1,64}$' } },
};

@ApiTags('magnitudes')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('magnitudes')
export class MagnitudesController {
  constructor(private readonly catalogo: MagnitudesService) {}

  @Get()
  @ApiOperation({
    summary: 'Catálogo de magnitudes (Etapa 4)',
    description: 'Las magnitudes ordenadas por código: `codigo, nombre, unidad` (la unidad canónica, símbolo SenML), el rango válido, los umbrales y la histéresis sugeridos, los alias y `actualizado_en` (la marca para PATCH). Con cualquier sesión; `canales` (en cuántos canales se usa, en todos los sitios) solo para el administrador del sistema (docs/20 §6).',
  })
  @ApiOkResponse({ description: 'Lista de magnitudes' })
  listar(@Usuario() u: UsuarioSesion): Promise<Magnitud[]> {
    return this.catalogo.listar(permitirGlobal(u, 'sistema'));
  }

  @Get('unidades')
  @ApiOperation({ summary: 'Unidades canónicas admitidas (TT-12)', description: 'La lista cerrada con que se crea una magnitud: el registro de SenML (RFC 8428 §12.1) sin las «NOT RECOMMENDED», más hPa, dBm y ug/m3. Con cualquier sesión.' })
  @ApiOkResponse({ description: 'Lista de símbolos SenML' })
  unidades(): readonly string[] {
    return UNIDADES_CANONICAS;
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Crear una magnitud (TT-12; administrador del sistema)', description: 'El código y la unidad se eligen aquí y no cambian después; el rango, obligatorio; sugeridos y alias, opcionales. Deja un evento `catalogo_cambio`. 409 si el código ya existe o un alias ya es de otra magnitud.' })
  @ApiBody({ schema: { type: 'object', required: ['codigo', 'nombre', 'unidad', 'rango_min', 'rango_max'], properties: {
    codigo: { type: 'string', pattern: '^[a-z][a-z0-9_]{0,39}$' }, unidad: { type: 'string', enum: [...UNIDADES_CANONICAS] }, ...PROPIEDADES } } })
  @ApiOkResponse({ description: 'La magnitud creada' })
  @ApiBadRequestResponse({ description: 'Validación: lista `{campo, motivo}`' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  @ApiConflictResponse({ description: 'El código ya existe, o un alias ya es de otra magnitud' })
  crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<Magnitud> {
    exigirGlobal(u, 'sistema');
    return this.catalogo.crear(validarMagnitudNueva(cuerpo), u.id);
  }

  @Patch(':codigo')
  @ApiOperation({ summary: 'Cambiar una magnitud (TT-12; administrador del sistema)', description: 'Nombre, rango, sugeridos y alias (la lista reemplaza a la vigente), con bloqueo optimista por `actualizado_en`. El código y la unidad no cambian. 409 si otro la cambió, si un alias ya es de otra magnitud, o si el rango deja fuera una regla o una calibración existentes (`fuera`, hasta 50, y `total`). Deja un evento `catalogo_cambio`.' })
  @ApiParam({ name: 'codigo' })
  @ApiBody({ schema: { type: 'object', required: ['actualizado_en'], properties: { actualizado_en: { type: 'string', format: 'date-time' }, ...PROPIEDADES } } })
  @ApiOkResponse({ description: 'La magnitud como quedó' })
  @ApiBadRequestResponse({ description: 'Validación: lista `{campo, motivo}`' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  @ApiNotFoundResponse({ description: 'No existe esa magnitud' })
  @ApiConflictResponse({ description: 'Cambio concurrente, alias de otra magnitud, o rango que deja fuera reglas o calibraciones' })
  cambiar(@Usuario() u: UsuarioSesion, @Param('codigo') codigo: string, @Body() cuerpo: unknown): Promise<Magnitud> {
    exigirGlobal(u, 'sistema');
    return this.catalogo.cambiar(codigo, validarCambioMagnitud(cuerpo), u.id);
  }

  @Get(':codigo/impacto')
  @ApiOperation({ summary: 'Impacto de un rango propuesto (TT-12; administrador del sistema)', description: 'Cuántas mediciones de los últimos 7 días, y de cuántos canales, habrían quedado fuera de `[rango_min, rango_max]`. No guarda nada. Cuenta en todos los sitios.' })
  @ApiParam({ name: 'codigo' })
  @ApiQuery({ name: 'rango_min', required: true }) @ApiQuery({ name: 'rango_max', required: true })
  @ApiOkResponse({ description: '`{codigo, rango_min, rango_max, dias, mediciones, canales}`' })
  @ApiBadRequestResponse({ description: 'Rango no válido' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  @ApiNotFoundResponse({ description: 'No existe esa magnitud' })
  impacto(@Usuario() u: UsuarioSesion, @Param('codigo') codigo: string, @Query('rango_min') min?: string, @Query('rango_max') max?: string) {
    exigirGlobal(u, 'sistema');
    const r = validarRangoPropuesto(min, max);
    return this.catalogo.impacto(codigo, r.rango_min, r.rango_max);
  }
}
