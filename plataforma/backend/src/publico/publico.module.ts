import { Module } from '@nestjs/common';
import { EnlacesController } from './enlaces.controller.js';
import { EnlacesService } from './enlaces.service.js';
import { PublicoController } from './publico.controller.js';
import { VistaPublicaService } from './vista-publica.service.js';

// Vista pública por enlace (RF-62, HU-32; docs/19 §4, O): GET /publico, sin sesión y con el token en su cabecera, y la administración de
// los enlaces de un sitio con su vista previa (sesión y la acción `enlaces`). AlcanceService llega del módulo global de sesión.
@Module({
  controllers: [PublicoController, EnlacesController],
  providers: [VistaPublicaService, EnlacesService],
})
export class PublicoModule {}
