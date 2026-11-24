import { Body, Controller, Get, HttpCode, Param, Post } from '@nestjs/common';
import {
  ApiBadRequestResponse, ApiBody, ApiConflictResponse, ApiCookieAuth, ApiForbiddenResponse, ApiNotFoundResponse, ApiOkResponse, ApiOperation,
  ApiParam, ApiTags, ApiUnauthorizedResponse,
} from '@nestjs/swagger';
import { TIPOS_CAMPO } from '../recepcion/adaptadores/receta.js';
import { Usuario } from '../sesion/guardia.js';
import { exigirGlobal, permitirGlobal } from '../sesion/permisos.js';
import type { UsuarioSesion } from '../sesion/permisos.js';
import { validarPrueba, validarReemplazo, validarRecetaNueva } from './recetas.dto.js';
import { Receta, RecetasService } from './recetas.service.js';

// Recetas de decodificación (TT-12, bloque 5; docs/19 §4, T; docs/20 §6). Leerlas: cualquier sesión (el alta de a uno y por lote las
// necesitan). Crear, probar y reemplazar: solo quien administra el sistema, porque una receta rige para todos los sitios.
const RECETA = {
  type: 'object', required: ['codigo', 'largo_bytes', 'campos'], properties: {
    codigo: { type: 'string', pattern: '^[a-z0-9][a-z0-9-]{2,62}$' }, nombre: { type: 'string', maxLength: 120 },
    largo_bytes: { type: 'integer', minimum: 1, maximum: 255 },
    campos: { type: 'array', minItems: 1, maxItems: 32, items: { type: 'object', required: ['magnitud', 'desplazamiento', 'tipo'], properties: {
      magnitud: { type: 'string' }, desplazamiento: { type: 'integer', minimum: 0 }, tipo: { type: 'string', enum: [...TIPOS_CAMPO] },
      sumar_antes: { type: 'integer', minimum: -1000000, maximum: 1000000, default: 0 },
      multiplicar_por: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 }, dividir_por: { type: 'integer', minimum: 1, maximum: 1000000, default: 1 },
    } } },
  },
};

@ApiTags('recetas-decodificacion')
@ApiCookieAuth('sesion')
@ApiUnauthorizedResponse({ description: 'sesión requerida' })
@Controller('recetas-decodificacion')
export class RecetasController {
  constructor(private readonly recetas: RecetasService) {}

  @Get()
  @ApiOperation({ summary: 'Recetas de decodificación (TT-12)', description: 'Las recetas por código, con sus campos (cada uno con la unidad de su magnitud). Con cualquier sesión; `equipos` (en cuántos se usa, en todos los sitios) solo para el administrador del sistema (docs/20 §6).' })
  @ApiOkResponse({ description: 'Lista de recetas' })
  listar(@Usuario() u: UsuarioSesion): Promise<Receta[]> {
    return this.recetas.listar(permitirGlobal(u, 'sistema'));
  }

  @Post()
  @HttpCode(200)
  @ApiOperation({ summary: 'Crear una receta (TT-12; administrador del sistema)', description: 'La receta y sus campos, juntos y una sola vez (fn_crear_receta). Escritura única: no se edita ni se borra; para corregirla, crear otra y usar «reemplazar». Deja un evento `catalogo_cambio`. 409 si el código ya existe.' })
  @ApiBody({ schema: { ...RECETA, required: ['codigo', 'nombre', 'largo_bytes', 'campos'] } })
  @ApiOkResponse({ description: 'La receta creada' })
  @ApiBadRequestResponse({ description: 'Validación: lista `{campo, motivo}`' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  @ApiConflictResponse({ description: 'El código ya existe' })
  crear(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown): Promise<Receta> {
    exigirGlobal(u, 'sistema');
    return this.recetas.crear(validarRecetaNueva(cuerpo), u.id);
  }

  @Post('probar')
  @HttpCode(200)
  @ApiOperation({ summary: 'Probar una receta sin guardarla (TT-12; administrador del sistema)', description: 'Decodifica unos bytes (hexadecimal, con espacios entre bytes, o base64; `codificacion` lo dice) con una receta escrita y no guardada, validada como al crearla. No escribe nada. `{ok: true, lecturas}` o `{ok: false, motivo}` si la trama no se entiende con esa receta.' })
  @ApiBody({ schema: { type: 'object', required: ['receta', 'bytes', 'codificacion'], properties: { receta: RECETA, bytes: { type: 'string', maxLength: 1024 }, codificacion: { type: 'string', enum: ['hex', 'base64'] } } } })
  @ApiOkResponse({ description: 'Las lecturas o el motivo' })
  @ApiBadRequestResponse({ description: 'Receta o bytes no válidos' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  probar(@Usuario() u: UsuarioSesion, @Body() cuerpo: unknown) {
    exigirGlobal(u, 'sistema');
    return this.recetas.probar(validarPrueba(cuerpo));
  }

  @Post(':codigo/reemplazar')
  @HttpCode(200)
  @ApiOperation({ summary: '«Reemplazar por» (TT-12; administrador del sistema)', description: 'Todos los equipos de la receta `codigo` pasan a la receta `por`, en una transacción, con un evento por equipo y uno del catálogo. Las tramas ya guardadas no cambian.' })
  @ApiParam({ name: 'codigo' })
  @ApiBody({ schema: { type: 'object', required: ['por'], properties: { por: { type: 'string' } } } })
  @ApiOkResponse({ description: '`{codigo, por, dispositivos, avisos}`: los dados de baja no se mueven; `avisos`, si la receta nueva tiene otro largo o lee magnitudes que la anterior no leía' })
  @ApiBadRequestResponse({ description: '`por` no es otra receta del catálogo' })
  @ApiForbiddenResponse({ description: 'No eres administrador del sistema' })
  @ApiNotFoundResponse({ description: 'No existe esa receta' })
  reemplazar(@Usuario() u: UsuarioSesion, @Param('codigo') codigo: string, @Body() cuerpo: unknown) {
    exigirGlobal(u, 'sistema');
    return this.recetas.reemplazar(codigo, validarReemplazo(codigo, cuerpo), u.id);
  }
}
