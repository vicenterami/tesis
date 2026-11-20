import { describe, expect, it } from 'vitest';
import { textoActividad, tipoValido } from './actividad.js';

// Actividad del sitio (P14; docs/19 §4, G): texto para personas por tipo; el correo va solo dentro de `usuario{}` y el texto nunca lleva correos ni direcciones.
describe('textoActividad', () => {
  it('eventos con persona: verbo y dispositivo entre comillas', () => {
    expect(textoActividad('evento', 'reglas_cambiadas', 'Nodo invernadero')).toBe('cambió los umbrales de «Nodo invernadero»');
    expect(textoActividad('evento', 'alta', 'Nodo 1')).toBe('dio de alta «Nodo 1»');
    expect(textoActividad('evento', 'baja', null)).toBe('dio de baja un dispositivo');
    expect(textoActividad('evento', 'reglas_cambiadas', 'N', { magnitud: 'Humedad' })).toBe('cambió los umbrales de «N» (Humedad)');
  });
  it('accesos: entró, salió, bloqueos; un tipo nuevo sin texto cae en el genérico (nunca vacío)', () => {
    expect(textoActividad('acceso', 'ok', null)).toBe('entró al sistema');
    expect(textoActividad('acceso', 'cierre', null)).toBe('cerró su sesión');
    expect(textoActividad('acceso', 'bloqueado', null)).toBe('quedó bloqueada por intentos fallidos');
    expect(textoActividad('evento', 'tipo_futuro', 'X')).toBe('tipo futuro en «X»');
    expect(textoActividad('acceso', 'otro', null)).toBe('acceso: otro');
  });
  it('eventos sin dispositivo (corrección del 11/11/2026): pasarelas, cuentas y términos, con el nombre de la pasarela o de la persona', () => {
    expect(textoActividad('evento', 'pasarela_alta', null, {}, 'Pasarela norte')).toBe('dio de alta la pasarela «Pasarela norte»');
    expect(textoActividad('evento', 'pasarela_baja', null)).toBe('dio de baja una pasarela');
    expect(textoActividad('evento', 'usuario_alta', null, {}, 'Ana')).toBe('dio de alta la cuenta de «Ana»');
    expect(textoActividad('evento', 'usuario_cambio', null, { motivo: 'texto libre' }, 'Ana')).toBe('cambió la cuenta de «Ana»'); // el motivo no sale
    expect(textoActividad('evento', 'usuario_baja', null, {}, 'Cuenta dada de baja · 3f2a')).toBe('se dio de baja (cuenta anonimizada)');
    expect(textoActividad('evento', 'terminos_aceptados', null)).toBe('aceptó los términos de uso');
    expect(textoActividad('evento', 'alta', 'Nodo 1', {}, 'ignorado')).toBe('dio de alta «Nodo 1»'); // con dispositivo, lo de siempre
  });
  it('enlaces públicos (17/11/2026; docs/19 §4, O, punto 4): publicó, renovó y revocó, con el título del enlace', () => {
    expect(textoActividad('evento', 'enlace_creado', null, { sitio_id: 'x' }, 'Aula de física')).toBe('publicó el enlace público «Aula de física»');
    expect(textoActividad('evento', 'enlace_renovado', null, {}, 'Aula de física')).toBe('renovó el enlace público «Aula de física»');
    expect(textoActividad('evento', 'enlace_revocado', null)).toBe('revocó un enlace público');
    expect(textoActividad('evento', 'enlace_tope', null, { sitio_id: 'x', max_enlaces: 20 })).toBe('fijó en 20 el tope de enlaces públicos del sitio');
    expect(textoActividad('evento', 'enlace_tope', null, { max_enlaces: '20; texto' })).toBe('cambió el tope de enlaces públicos del sitio');
    expect(textoActividad('evento', 'enlace_minimo', null, { sitio_id: 'x', minimo_dispositivos: 4, anterior: 3 })).toBe('fijó en 4 el mínimo de dispositivos de la vista pública del sitio');
    expect(textoActividad('evento', 'enlace_minimo', null, { minimo_dispositivos: '4<b>' })).toBe('cambió el mínimo de dispositivos de la vista pública del sitio');
  });
  it('el filtro tipo: minúsculas y guion bajo, hasta 40', () => {
    expect(tipoValido('reglas_cambiadas')).toBe(true);
    expect(tipoValido("x' OR 1=1")).toBe(false);
    expect(tipoValido('a'.repeat(41))).toBe(false);
  });
});
