import { Controller, Get, Inject } from '@nestjs/common';
import { Pool } from 'pg';
import { POOL } from '../db/db.module';

// GET /salud → estado del backend y de su conexión a la base. Lo usará el healthcheck del
// contenedor y sirve para comprobar el arranque a mano con curl.
@Controller('salud')
export class SaludController {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  @Get()
  async estado(): Promise<{ estado: string; base: string; tablas: number }> {
    const r = await this.pool.query<{ n: string }>(
      "SELECT count(*)::text AS n FROM pg_tables WHERE schemaname = 'public'",
    );
    return { estado: 'ok', base: 'conectada', tablas: Number(r.rows[0].n) };
  }
}
