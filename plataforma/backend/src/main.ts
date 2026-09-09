import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// Punto de entrada. Levanta la aplicación Nest: al iniciarse, cada módulo se conecta a lo suyo
// (base de datos, broker) y queda escuchando. El puerto HTTP sirve la API y, más adelante, el panel.
async function arrancar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  const puerto = Number(process.env.HTTP_PUERTO ?? 3000);
  await app.listen(puerto, '127.0.0.1'); // en desarrollo solo escucha en este equipo
  new Logger('arranque').log(`API escuchando en http://127.0.0.1:${puerto}`);
}

void arrancar();
