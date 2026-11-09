// El proceso corre SIEMPRE en UTC, sin depender de la zona del sistema que lo aloje (portátil en
// Chile, servidor en UTC, contenedor sin zona). Ninguna operación con Date debe verse afectada por
// dónde corre el backend (docs/13). Va antes de cualquier import que pueda crear un Date.
process.env.TZ = 'UTC';

import { ConsoleLogger, Logger } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import type { NestExpressApplication } from '@nestjs/platform-express';
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import type { NextFunction, Request, Response } from 'express';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { AvisosAcotados, hostsPermitidos, interfazDeEscucha, rechazoDeHost, registrosEnJson, rutaSinCache, servirDocumentacion, claveAdmin, claveApp } from './arranque';
import { configurarOpenApi } from './openapi';

// Punto de entrada. Levanta la aplicación Nest: al iniciarse, cada módulo se conecta a lo suyo
// (base de datos, broker) y queda escuchando. El puerto HTTP sirve la API y, más adelante, el panel.
async function arrancar(): Promise<void> {
  // Registros (docs/10 §6): en contenedor, un evento JSON por línea (LOG_FORMATO=json); en desarrollo, texto.
  const logger = new ConsoleLogger({ json: registrosEnJson(process.env.LOG_FORMATO), logLevels: ['log', 'warn', 'error'] });
  const app = await NestFactory.create<NestExpressApplication>(AppModule, { logger });
  const log = new Logger('arranque');
  // Sin la clave del rol de la aplicación (migración 14) el servidor no arranca y dice qué hacer. Después de crear la aplicación
  // (ConfigModule ya cargó el .env en una ejecución local) y no en el módulo de la base, para que `pnpm openapi`, que arma la
  // aplicación sin base, no la necesite. El pool no abre conexiones hasta la primera consulta.
  claveApp(process.env.DB_APP_CLAVE);
  // Apagado ordenado (docs/10 §6): sin esto Nest no escucha SIGTERM, Docker espera 10 s y mata el proceso
  // (código 137), y los cierres de cada módulo —suscripción al broker, supervisor, pool de la base— no corren.
  app.enableShutdownHooks();

  // Cabeceras de seguridad (docs/11 §3): CSP `default-src 'self'`, X-Frame-Options, nosniff,
  // Referrer-Policy; y helmet retira X-Powered-By. HSTS queda fuera A PROPÓSITO: solo tiene sentido
  // detrás de TLS y lo pondrá una sola capa (el proxy) cuando exista; dos capas serían dos fuentes.
  app.use(helmet({ strictTransportSecurity: false }));
  // La dirección del cliente la resuelve la recepción por HTTP con el secreto compartido del proxy (recepcion/http/direccion.ts,
  // docs/10 §8.4 punto 52): Express no debe creer X-Forwarded-For por sí solo, así que `trust proxy` queda apagado (su valor por defecto).
  // El cuerpo de la recepción por HTTP llega crudo, como por MQTT, y con el mismo tope que el broker (max_packet_size, 64 KiB). Va
  // antes del lector de JSON que Nest agrega al iniciar: para /recepcion manda este. Un cuerpo de más responde 413 en JSON.
  // Sin distinguir mayúsculas, como el enrutador de Express: con startsWith, /RECEPCION/… llegaba a la ruta con el cuerpo de JSON.
  app.useBodyParser('raw', { type: (req: Request) => /^\/recepcion\//i.test(req.url ?? ''), limit: 64 * 1024 });
  app.use('/recepcion', (err: { status?: number; type?: string }, _req: Request, res: Response, next: NextFunction) => {
    if (err?.type === 'entity.too.large') return void res.status(413).json({ statusCode: 413, message: 'trama de más de 64 KiB' });
    if (err) return void res.status(400).json({ statusCode: 400, message: 'cuerpo ilegible' });
    next();
  });
  // helmet no emite Permissions-Policy; la API no usa cámara, micrófono ni ubicación. Y toda respuesta de la API va con
  // `Cache-Control: no-store` (arranque.ts, rutaSinCache; revisión del 08/11/2026): una sola regla en vez de repetirla ruta por ruta.
  // Una ruta puede pisarla después (el canal en vivo pone la suya, también sin caché).
  app.use((req: Request, res: Response, next: NextFunction) => {
    res.setHeader('Permissions-Policy', 'camera=(), microphone=(), geolocation=()');
    if (rutaSinCache(req.path)) res.setHeader('Cache-Control', 'no-store');
    next();
  });

  // Lista de nombres de host (docs/11 §3, docs/10 §8.4 punto 40): toda petición cuyo `Host` no sea uno de los locales ni uno
  // de HTTP_HOSTS recibe 421 y no llega a ninguna ruta. Es lo que detiene el DNS rebinding, que el control
  // de origen del canal en vivo no cubre (eventos.controller.ts). El rechazo se registra como WARN, acotado.
  const permitidos = hostsPermitidos(process.env.HTTP_HOSTS); // un valor malformado detiene el arranque, a propósito
  // Clave de administrador por cabecera (docs/10 §8.4 punto 41; desde el 08/11/2026, el «usuario del sistema» de docs/20 §5): se valida
  // aquí para que una clave corta detenga el arranque; el guardia central (sesion/guardia.ts) la vuelve a leer por ConfigService.
  if (claveAdmin(process.env.HTTP_CLAVE_ADMIN) === undefined) log.warn('HTTP_CLAVE_ADMIN ausente: solo entra quien tenga sesión (y la cabecera X-Clave-Admin responde 503)');
  const avisos = new AvisosAcotados();
  app.use((req: Request, res: Response, next: NextFunction) => {
    const rechazo = rechazoDeHost(req.headers.host, permitidos);
    if (rechazo === null) return next();
    const aviso = avisos.registrar(rechazo);
    if (aviso !== null) log.warn(`petición rechazada (421): ${aviso}`);
    res.status(421).json({ statusCode: 421, message: 'host no permitido' });
  });

  // Documentación interactiva solo si se pide (HTTP_DOCS=si). Swagger UI trae scripts en línea, así
  // que SOLO bajo /docs la CSP los permite; el resto de la API conserva la política estricta.
  if (servirDocumentacion(process.env.HTTP_DOCS)) {
    app.use(
      '/docs',
      helmet.contentSecurityPolicy({
        directives: { ...helmet.contentSecurityPolicy.getDefaultDirectives(), 'script-src': ["'self'", "'unsafe-inline'"] },
      }),
    );
    configurarOpenApi(app); // contrato OpenAPI generado desde el código, servido en /docs
    log.warn('documentación interactiva /docs ACTIVA (HTTP_DOCS=si): solo para desarrollo');
  }

  // El panel (docs/19), compilado por Vite, se sirve como archivos estáticos bajo /panel (docs/10 §8.4): mismo origen que
  // la API, así no hace falta CORS y la sesión (Etapa 4) valdrá para los dos. Ruta: backend/panel/dist, tanto desde dist/
  // (compilado) como desde src/ (desarrollo con --watch); en la imagen, /app/panel/dist. Si no está construido, /panel
  // responde 404 y se avisa al arrancar: la API sigue funcionando sin él.
  const panel = join(__dirname, '..', 'panel', 'dist');
  if (existsSync(join(panel, 'index.html'))) {
    app.useStaticAssets(panel, { prefix: '/panel/', index: 'index.html' });
  } else {
    log.warn(`panel no construido (${panel}): /panel responderá 404; construirlo con pnpm --filter panel build`);
  }

  const puerto = Number(process.env.HTTP_PUERTO ?? 3000);
  // Dónde escucha (docs/10 §6): fuera de Docker, solo en este equipo (127.0.0.1, valor por defecto).
  // Dentro del contenedor, en todas las interfaces DEL CONTENEDOR (0.0.0.0): es la única forma de que el
  // proxy lo alcance por la red interna, y sin `ports` en el compose esa dirección no existe fuera del servidor.
  const interfaz = interfazDeEscucha(process.env.HTTP_INTERFAZ);
  await app.listen(puerto, interfaz);
  log.log(`API escuchando en http://${interfaz}:${puerto}; Host aceptados: ${[...permitidos].join(', ')}`);
}

void arrancar();
