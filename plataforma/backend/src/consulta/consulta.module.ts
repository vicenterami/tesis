import { Module } from '@nestjs/common';
import { CanalesController } from './canales.controller';
import { CondicionesController } from './condiciones.controller';
import { ConsultaService } from './consulta.service';
import { CuarentenaController } from './cuarentena.controller';
import { DispositivosController } from './dispositivos.controller';

// M5 Persistencia y consulta — la API que consumirá el panel (patrón B: el navegador solo habla con el backend).
// Solo lectura. Sin autenticación de usuarios todavía (M7): por eso el servidor escucha en 127.0.0.1.
@Module({
  controllers: [DispositivosController, CanalesController, CondicionesController, CuarentenaController],
  providers: [ConsultaService],
})
export class ConsultaModule {}
