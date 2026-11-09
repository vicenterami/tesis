import { Global, Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AlcanceService } from './alcance.service';
import { GuardiaCentral } from './guardia';
import { SesionController } from './sesion.controller';
import { SesionService } from './sesion.service';
import { UsuariosController } from './usuarios.controller';
import { UsuariosService } from './usuarios.service';

// M7 · Seguridad e identidad (docs/20; docs/10 §8.4 puntos 36 y 41): sesión de personas, usuarios con roles por sitio y el guardia
// central, registrado como guardia GLOBAL (APP_GUARD): corre antes de toda ruta de Nest, y una ruta pública se marca con @Publica().
// Global para que la consulta, el alta y el canal en vivo resuelvan el sitio de cada recurso con el mismo AlcanceService.
@Global()
@Module({
  controllers: [SesionController, UsuariosController],
  providers: [SesionService, AlcanceService, UsuariosService, { provide: APP_GUARD, useClass: GuardiaCentral }],
  exports: [SesionService, AlcanceService],
})
export class SesionModule {}
