import { INestApplication } from '@nestjs/common';
import { DocumentBuilder, OpenAPIObject, SwaggerModule } from '@nestjs/swagger';

// Contrato de la API (TT-13). Se GENERA desde los decoradores de los controladores: el documento
// nunca puede describir endpoints que no existen ni omitir los que sí. Dos usos:
//   · en ejecución, la documentación interactiva en /docs, SOLO con HTTP_DOCS=si (docs/11 §3; main.ts);
//   · `pnpm openapi` escribe openapi.json al repositorio, para versionar el contrato y citarlo.
export function construirDocumento(app: INestApplication): OpenAPIObject {
  const config = new DocumentBuilder()
    .setTitle('Registro, gestión y monitoreo de dispositivos IoT')
    .setDescription(
      'API del sistema: consulta (M5) y canal de tiempo real (SSE) para el panel; recepción de tramas por HTTP; administración ' +
        '(alta, baja, rotación de credenciales y calibración) con la clave de administración. Todos los instantes en ISO 8601 UTC ' +
        '(sufijo Z); las agregaciones por día se calculan en la zona horaria del sitio. Rangos semiabiertos [desde, hasta).',
    )
    .setVersion('0.1.0')
    .addTag('dispositivos', 'Inventario y ficha de dispositivos')
    .addTag('canales', 'Series de tiempo agregadas por canal y calibración')
    .addTag('condiciones', 'Estados anómalos abiertos y cerrados')
    .addTag('cuarentena', 'Tramas rechazadas por el pipeline')
    .addTag('tiempo real', 'Canal SSE hacia el panel: mediciones, señales de vida y condiciones (TT-39)')
    .addTag('salud', 'Estado del servicio')
    .addTag('recepcion', 'Recepción de tramas por HTTP (vía http)')
    .addTag('pasarelas', 'Pasarelas y servidores de red externos (rutas B y C)')
    .build();
  return SwaggerModule.createDocument(app, config);
}

export function configurarOpenApi(app: INestApplication): void {
  SwaggerModule.setup('docs', app, construirDocumento(app), {
    jsonDocumentUrl: 'docs/openapi.json',
    customSiteTitle: 'API · registro, gestión y monitoreo de dispositivos IoT',
  });
}
