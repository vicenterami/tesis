import { Module } from '@nestjs/common';
import { LegalController } from './legal.controller.js';

// Legal y acerca de (docs/19 §4, P11; docs/21 §7; docs/20 §12): términos con su versión y la aceptación, privacidad generada desde el
// inventario de docs/21, «acerca de» y el formulario de soporte.
@Module({ controllers: [LegalController] })
export class LegalModule {}
