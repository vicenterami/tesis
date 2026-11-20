import { Controller, Get, Inject, Req } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Pool } from 'pg';
import { AltaService } from '../alta/alta.service.js';
import { EstadoBroker, MetricasBrokerService } from '../broker/metricas.service.js';
import { POOL } from '../db/db.module.js';
import { IdentificacionOpcional, Publica } from '../sesion/guardia.js';
import type { PeticionConUsuario } from '../sesion/guardia.js';
import { permitirGlobal } from '../sesion/permisos.js';

export interface SaludPublica { estado: string }
export interface SaludDetalle extends SaludPublica { base: string; tablas: number; broker: EstadoBroker; aprovisionamiento_en_curso: number }

// GET /salud → estado del backend, de su conexión a la base y, desde el 13/10/2026 (docs/10 §8.4 punto 43), lo último que
// se sabe del broker (cola, descartes, conexiones, condición abierta) y las operaciones de aprovisionamiento en curso. Lo usa
// el healthcheck del contenedor cada 15 s: `estado` sigue dependiendo solo de la base (un broker caído se reconecta solo y no
// debe reiniciar el backend); el resto es informativo y no toca la base.
// Pública (docs/20 §6, primera fila): la consultan sin sesión el chequeo del contenedor, el del proxy y el vigilante externo, que solo miran
// el código HTTP o `estado`. Desde el 20/11/2026 (docs/10 §6) el detalle va solo a quien tiene la acción `sistema` (la clave de
// administrador o la sesión de un administrador del sistema); a los demás, `{ estado }` con el mismo código. La base se consulta igual
// en los dos casos: con ella caída, la respuesta es 500 para todos, como antes.
@ApiTags('salud')
@Publica()
@IdentificacionOpcional()
@Controller('salud')
export class SaludController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly metricas: MetricasBrokerService,
    private readonly alta: AltaService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'Estado del servicio; con la acción «sistema», también la base, la cola del broker y el aprovisionamiento en curso',
    description: 'Pública. Sin credencial (o con la sesión de un perfil que no tiene la acción «sistema») responde solo `{ estado }`; con ' +
      '`X-Clave-Admin` o la sesión de un administrador del sistema, el detalle. El código HTTP no depende de quién pregunta: 200 con la base ' +
      'conectada, 500 si la consulta a la base falla. Una `X-Clave-Admin` equivocada responde 401, como en las demás rutas.',
  })
  @ApiOkResponse({ description: 'Sin la acción «sistema»: { estado }. Con ella: { estado, base, tablas, broker: { conectado, administracion, ultima_muestra, mensajes_descartados, mensajes_en_cola, bytes_en_cola, clientes_conectados, cola_tope, condicion_abierta }, aprovisionamiento_en_curso }' })
  async estado(@Req() req: PeticionConUsuario): Promise<SaludPublica | SaludDetalle> {
    const r = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    if (req.usuario === undefined || !permitirGlobal(req.usuario, 'sistema')) return { estado: 'ok' };
    return { estado: 'ok', base: 'conectada', tablas: Number(r.rows[0].n), broker: this.metricas.estado(), aprovisionamiento_en_curso: this.alta.operacionesEnCurso };
  }
}
