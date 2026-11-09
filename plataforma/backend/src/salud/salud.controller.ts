import { Controller, Get, Inject } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Pool } from 'pg';
import { AltaService } from '../alta/alta.service';
import { EstadoBroker, MetricasBrokerService } from '../broker/metricas.service';
import { POOL } from '../db/db.module';
import { Publica } from '../sesion/guardia';

// GET /salud → estado del backend, de su conexión a la base y, desde el 13/10/2026 (docs/10 §8.4 punto 43), lo último que
// se sabe del broker (cola, descartes, conexiones, condición abierta) y las operaciones de aprovisionamiento en curso. Lo usa
// el healthcheck del contenedor cada 15 s: `estado` sigue dependiendo solo de la base (un broker caído se reconecta solo y no
// debe reiniciar el backend); el resto es informativo y no toca la base.
// Pública (docs/20 §6, primera fila): la consulta el chequeo de salud del contenedor, sin sesión.
@ApiTags('salud')
@Publica()
@Controller('salud')
export class SaludController {
  constructor(
    @Inject(POOL) private readonly pool: Pool,
    private readonly metricas: MetricasBrokerService,
    private readonly alta: AltaService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Estado del servicio, de su conexión a la base y de la cola del broker' })
  @ApiOkResponse({ description: '{ estado, base, tablas, broker: { conectado, administracion, ultima_muestra, mensajes_descartados, mensajes_en_cola, bytes_en_cola, clientes_conectados, cola_tope, condicion_abierta }, aprovisionamiento_en_curso }' })
  async estado(): Promise<{ estado: string; base: string; tablas: number; broker: EstadoBroker; aprovisionamiento_en_curso: number }> {
    const r = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    return { estado: 'ok', base: 'conectada', tablas: Number(r.rows[0].n), broker: this.metricas.estado(), aprovisionamiento_en_curso: this.alta.operacionesEnCurso };
  }
}
