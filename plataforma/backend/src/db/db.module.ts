import { Global, Inject, Logger, Module, OnApplicationShutdown } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';

export const POOL = 'POOL_POSTGRES';

// Un "pool" es un conjunto de conexiones abiertas y reutilizables: abrir una conexión a PostgreSQL
// cuesta decenas de milisegundos, así que se abren unas pocas al inicio y se prestan por consulta.
// Se usa SQL directo con el driver `pg` (sin ORM): para series de tiempo y funciones de TimescaleDB
// como time_bucket, el SQL explícito es más simple, más rápido y más fácil de auditar (docs/07 §3).
@Global()
@Module({
  providers: [
    {
      provide: POOL,
      inject: [ConfigService],
      useFactory: (config: ConfigService): Pool => {
        const pool = new Pool({
          host: config.get<string>('DB_HOST', '127.0.0.1'),
          port: config.get<number>('DB_PUERTO', 5432),
          database: config.getOrThrow<string>('DB_NOMBRE'),
          // El rol de la aplicación, no el dueño (migración 14; docs/10 §8.4 punto 44): SELECT en todo, INSERT en 11 tablas y UPDATE en 5.
          user: config.get<string>('DB_APP_USUARIO', 'plataforma_app'), // el nombre que crea la migración 14
          password: config.get<string>('DB_APP_CLAVE', ''), // validada al arrancar (main.ts, claveApp)
          max: 5,
        });
        pool.on('error', (e) => new Logger('db').error(`error en el pool: ${e.message}`));
        return pool;
      },
    },
  ],
  exports: [POOL],
})
export class DbModule implements OnApplicationShutdown {
  constructor(@Inject(POOL) private readonly pool: Pool) {}

  // Al apagar la aplicación (Ctrl+C, SIGTERM) se cierran las conexiones de forma ordenada.
  async onApplicationShutdown(): Promise<void> {
    await this.pool.end();
  }
}
