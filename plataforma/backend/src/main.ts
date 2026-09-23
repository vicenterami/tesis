// El proceso corre SIEMPRE en UTC, sin depender de la zona del sistema que lo aloje (portátil en
// Chile, servidor en UTC, contenedor sin zona). Ninguna operación con Date debe verse afectada por
// dónde corre el backend (docs/13). Va antes de cualquier import que pueda crear un Date.
process.env.TZ = 'UTC';

import { Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { interfazDeEscucha } from './arranque';
import { configurarOpenApi } from './openapi';

// Punto de entrada. Levanta la aplicación Nest: al iniciarse, cada módulo se conecta a lo suyo
// (base de datos, broker) y queda escuchando. El puerto HTTP sirve la API y, más adelante, el panel.
async function arrancar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['log', 'warn', 'error'] });
  configurarOpenApi(app); // contrato OpenAPI generado desde el código, servido en /docs
  const puerto = Number(process.env.HTTP_PUERTO ?? 3000);
  // Dónde escucha (docs/10 §6): fuera de Docker, solo en este equipo (127.0.0.1, valor por defecto).
  // Dentro del contenedor, en todas las interfaces DEL CONTENEDOR (0.0.0.0): es la única forma de que el
  // proxy lo alcance por la red interna, y sin `ports` en el compose esa dirección no existe fuera del servidor.
  const interfaz = interfazDeEscucha(process.env.HTTP_INTERFAZ);
  await app.listen(puerto, interfaz);
  new Logger('arranque').log(`API escuchando en http://${interfaz}:${puerto}`);
}

void arrancar();
