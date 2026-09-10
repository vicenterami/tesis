process.env.TZ = 'UTC';
import { NestFactory } from '@nestjs/core';
import { writeFileSync } from 'node:fs';
import { AppModule } from './app.module';
import { construirDocumento } from './openapi';

// `pnpm openapi`: levanta la aplicación SIN escuchar en ningún puerto, genera el contrato y lo
// escribe en openapi.json. Requiere la base y el broker (los módulos se conectan al iniciarse).
async function exportar(): Promise<void> {
  const app = await NestFactory.create(AppModule, { logger: ['error'] });
  await app.init();
  const doc = construirDocumento(app);
  writeFileSync('openapi.json', JSON.stringify(doc, null, 2) + '\n');
  const n = Object.keys(doc.paths).length;
  await app.close();
  console.log(`openapi.json escrito: ${n} rutas`);
}
void exportar();
