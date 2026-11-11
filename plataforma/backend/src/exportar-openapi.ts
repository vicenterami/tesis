import 'reflect-metadata';
import './zona-utc.js';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module.js';
import { construirDocumento } from './openapi.js';

// `pnpm openapi`: arma la aplicación SIN iniciarla ni escuchar en ningún puerto, genera el contrato y lo escribe en
// openapi.json. El documento sale de los decoradores, así que no hace falta la base ni el broker. Hasta el 09/10 la
// iniciaba (app.init) y se conectaba al broker con la identidad del backend (clientId fijo): con la pila arriba, el
// broker debe desconectar al cliente ya conectado con ese mismo id, o sea al backend en marcha (MQTT 3.1.1, [MQTT-3.1.4-2]).
async function exportar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  const doc = construirDocumento(app);
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2) + '\n');
  const n = Object.keys(doc.paths).length;
  await app.close();
  console.log(`openapi.json escrito: ${n} rutas`);
}
void exportar();
