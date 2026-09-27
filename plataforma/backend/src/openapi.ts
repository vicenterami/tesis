import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// Contrato de la API (TT-13). Se GENERA desde los decoradores de los controladores: el documento
// nunca puede describir endpoints que no existen ni omitir los que sí. Dos usos:
//   · en ejecución, la documentación interactiva en /docs, SOLO con HTTP_DOCS=si (docs/11 §3; main.ts);
//   · `pnpm openapi` escribe openapi.json al repositorio, para versionar el contrato y citarlo.
export function construirDocumento(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Plataforma de registro, monitoreo y gestión de datos de sensores')
    .setDescription(
      'API de consulta (M5) para el panel. Solo lectura. Todos los instantes en ISO 8601 UTC (sufijo Z); ' +
        'las agregaciones por día se calculan en la zona horaria del sitio. Rangos semiabiertos [desde, hasta).',
    )
    .setVersion('0.1.0')
    .addTag('dispositivos', 'Inventario y ficha de dispositivos')
    .addTag('canales', 'Series de tiempo agregadas por canal')
    .addTag('condiciones', 'Estados anómalos abiertos y cerrados')
    .addTag('cuarentena', 'Tramas rechazadas por el pipeline')
    .addTag('salud', 'Estado del servicio')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function configurarOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, construirDocumento(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    customSiteTitle: 'API · plataforma de sensores',
  });
}
