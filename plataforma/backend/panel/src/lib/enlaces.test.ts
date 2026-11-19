import { describe, expect, it } from 'vitest';
import { ErrorApi } from './api';
import {
  ESPERA_PREVIA, FALLO_PREVIA, FORMULARIO_VACIO, NO_RENOVABLE, firmaDeSeleccion, minimoQueRige, motivoPorPrevia, octetosLocales, origenLocal, SIN_MAGNITUDES, acortaDe, avisoDeEnlace, avisosSinDatos, cuerpoPrevia, cuerpoVista, direccionCompleta, faltaParaPublicar,
  quePublica, sitiosQuePublica, textoAcorta, tituloDe, ventanaPreviaValida,
} from './enlaces';
import type { Sitio } from './modelo';
import type { VistaPublica } from './publico';
import type { Sesion } from './sesion';

// P9, quien publica (docs/19 §4, O, puntos 3, 4, 10 y 11): lo puro de la pantalla «Vista pública».
const SITIOS: Sitio[] = [
  { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] },
  { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'consulta', zonas: [] },
];
const persona = (administrador_sistema = false): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }, { sitio_id: 's2', codigo: 'mag', nombre: 'Magallanes', rol: 'consulta' }],
  permisos: { administrador: ['leer', 'enlaces'], consulta: ['leer'] }, administrador_sistema,
});
const error = (codigo: number, cuerpo: Record<string, unknown>): ErrorApi =>
  new ErrorApi(codigo, '', `HTTP ${codigo}`, Array.isArray(cuerpo.message) ? (cuerpo.message as string[]) : typeof cuerpo.message === 'string' ? [cuerpo.message] : [], null, cuerpo);

describe('quién publica y el formulario', () => {
  it('solo los sitios donde la persona tiene la acción `enlaces`; el administrador del sistema, todos', () => {
    expect(sitiosQuePublica(persona(), SITIOS).map((s) => s.codigo)).toEqual(['uct']);
    expect(sitiosQuePublica(persona(true), SITIOS).map((s) => s.codigo)).toEqual(['uct', 'mag']);
  });
  it('el cuerpo recorta el texto, una descripción vacía va como null, y la vista previa suma la ventana que dibuja', () => {
    const f = { ...FORMULARIO_VACIO, titulo: '  Clima  ', descripcion: '   ', magnitudes: ['temperatura'], zonas: ['z1'] };
    expect(cuerpoVista(f)).toEqual({ titulo: 'Clima', descripcion: null, magnitudes: ['temperatura'], ventana_maxima: '7d', zonas: ['z1'], plazo_dias: 30, retencion_dias: 90 });
    expect(cuerpoPrevia(f, '24h')).toMatchObject({ ventana: '24h', magnitudes: ['temperatura'] });
  });
  it('lo que falta para publicar, en el orden del formulario; «Elige al menos una magnitud para publicar.» es el del punto 11', () => {
    expect(faltaParaPublicar(FORMULARIO_VACIO)).toBe('Escribe un título.');
    expect(faltaParaPublicar({ ...FORMULARIO_VACIO, titulo: 'Clima' })).toBe(SIN_MAGNITUDES);
    expect(SIN_MAGNITUDES).toBe('Elige al menos una magnitud para publicar.');
    expect(faltaParaPublicar({ ...FORMULARIO_VACIO, titulo: 'x'.repeat(81), magnitudes: ['t'] })).toBe('El título admite hasta 80 caracteres.');
    expect(faltaParaPublicar({ ...FORMULARIO_VACIO, titulo: 'Clima', magnitudes: ['t'], retencion_dias: 30 })).toBe('Conserva el texto entre 31 y 365 días.');
    expect(faltaParaPublicar({ ...FORMULARIO_VACIO, titulo: 'Clima', magnitudes: ['t'] })).toBeNull();
  });
  it('la ventana de la vista previa nunca pasa la máxima del enlace', () => {
    expect(ventanaPreviaValida('30d', '7d')).toBe('7d');
    expect(ventanaPreviaValida('24h', '7d')).toBe('24h');
  });
  it('una magnitud sin ningún valor en la ventana avisa que el visitante verá la tarjeta vacía', () => {
    const p = {
      magnitudes: [
        { codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel', ahora: null, serie: [null], protegido: true, zonas: [{ nombre: 'Norte', ahora: null, serie: [20] }] },
        { codigo: 'humedad', nombre: 'Humedad', unidad: '%RH', ahora: null, serie: [null], protegido: true, zonas: [] },
      ],
    } as unknown as VistaPublica;
    expect(avisosSinDatos(p)).toEqual(['Sin datos de «Humedad» en esta ventana: el visitante verá la tarjeta vacía.']);
  });
});

describe('la lista y sus textos (puntos 4, 10 y 11)', () => {
  it('qué publica: magnitudes, ventana y zonas, en palabras', () => {
    const m = [{ codigo: 'temperatura', nombre: 'Temperatura', unidad: 'Cel' }, { codigo: 'humedad', nombre: 'Humedad', unidad: '%RH' }];
    expect(quePublica({ magnitudes: m, ventana_maxima: '7d', zonas: [{ id: 'a', nombre: 'Norte' }, { id: 'b', nombre: 'Sur' }] })).toBe('Temperatura y Humedad; hasta 7 días; zonas Norte y Sur');
    expect(quePublica({ magnitudes: m.slice(0, 1), ventana_maxima: '24h', zonas: [] })).toBe('Temperatura; hasta 24 horas; sin desglose por zona');
  });
  it('un enlace anonimizado se nombra «Enlace retirado»; la dirección completa es el origen más la ruta con el fragmento', () => {
    expect(tituloDe({ titulo: '', anonimizado_en: '2026-11-01T00:00:00Z' })).toBe('Enlace retirado');
    expect(tituloDe({ titulo: 'Clima', anonimizado_en: null })).toBe('Clima');
    expect(direccionCompleta('https://ejemplo.invalid/', '/panel/#/v/xyz')).toBe('https://ejemplo.invalid/panel/#/v/xyz');
  });
  it('renovar que acorta: el 409 `acorta` trae las dos fechas y el texto las dice en la hora del sitio', () => {
    const e = error(409, { codigo: 'acorta', expira_en_actual: '2026-12-17T15:00:00Z', expira_en_nueva: '2026-11-24T15:00:00Z', message: 'x' });
    const a = acortaDe(e)!;
    expect(a).toEqual({ actual: '2026-12-17T15:00:00Z', nueva: '2026-11-24T15:00:00Z' });
    expect(textoAcorta(a.actual, a.nueva, 'America/Santiago')).toBe('Vencía el 17 de diciembre de 2026, 12:00; con este plazo vencerá antes, el 24 de noviembre de 2026, 12:00.');
    expect(acortaDe(error(409, { codigo: 'no_renovable' }))).toBeNull();
  });
  it('los errores del punto 11: el tope con el número del sitio, «ya no se puede renovar», elegir una magnitud; lo demás, el aviso común', () => {
    expect(avisoDeEnlace(error(409, { codigo: 'tope_enlaces', message: 'Este sitio ya tiene 5 enlaces. Revoca uno para crear otro.' })).texto).toBe('Este sitio ya tiene 5 enlaces. Revoca uno para crear otro.');
    expect(avisoDeEnlace(error(409, { codigo: 'no_renovable', message: NO_RENOVABLE })).texto).toBe('Este enlace ya no se puede renovar. Crea uno nuevo.');
    expect(avisoDeEnlace(error(400, { message: [SIN_MAGNITUDES] })).texto).toBe(SIN_MAGNITUDES);
    expect(avisoDeEnlace(error(409, { message: 'el enlace ya estaba revocado' })).tipo).toBe('conflicto');
    expect(avisoDeEnlace(error(400, { message: ['titulo debe tener al menos una letra o un número'] })).texto).toBe('Revisa los datos: titulo debe tener al menos una letra o un número.');
  });
});

describe('lo que la revisión del 17/11/2026 sumó', () => {
  it('la firma de la selección cambia con magnitudes, zonas y ventana máxima, no con el título ni el plazo; «Publicar» espera la previa de esa firma', () => {
    const f = { ...FORMULARIO_VACIO, magnitudes: ['temperatura'] };
    expect(firmaDeSeleccion({ ...f, titulo: 'otro', plazo_dias: 7 } as typeof f)).toBe(firmaDeSeleccion(f));
    expect(firmaDeSeleccion({ ...f, zonas: ['z1'] })).not.toBe(firmaDeSeleccion(f));
    const base = { hayPrevia: true, firmaActual: firmaDeSeleccion(f), firmaPrevia: firmaDeSeleccion(f), esperando: false, cargando: false, fallo: false };
    expect(motivoPorPrevia(base)).toBeNull();
    expect(motivoPorPrevia({ ...base, esperando: true })).toBe(ESPERA_PREVIA);
    expect(motivoPorPrevia({ ...base, cargando: true })).toBe(ESPERA_PREVIA);
    expect(motivoPorPrevia({ ...base, firmaPrevia: null })).toBe(ESPERA_PREVIA);
    expect(motivoPorPrevia({ ...base, firmaPrevia: firmaDeSeleccion({ ...f, zonas: ['z1'] }) })).toBe(ESPERA_PREVIA);
    expect(motivoPorPrevia({ ...base, fallo: true })).toBe(FALLO_PREVIA);
    expect(motivoPorPrevia({ ...base, hayPrevia: false })).toBe(ESPERA_PREVIA); // con la firma igual, pero sin vista previa
  });
  it('el 409 `minimo_cambio` trae el k que rige; otro error, null', () => {
    expect(minimoQueRige(error(409, { codigo: 'minimo_cambio', minimo_dispositivos: 5, message: 'x' }))).toBe(5);
    expect(minimoQueRige(error(409, { codigo: 'acorta' }))).toBeNull();
    expect(avisoDeEnlace(error(409, { codigo: 'minimo_cambio', minimo_dispositivos: 5, message: 'Alguien cambió el mínimo de este sitio entretanto: ahora es k = 5. Revísalo antes de cambiarlo.' })).tipo).toBe('conflicto');
  });
  it('un nombre que solo sirve en el equipo o en una red privada se reconoce; uno público, no', () => {
    for (const local of ['localhost', 'LOCALHOST', 'panel.localhost', 'equipo.local', 'servidor', 'panel.lan', 'nodo.internal', 'casa.home.arpa', '127.0.0.1', '[::1]', 'fd12:3456::1', 'fe80::1',
      '[::ffff:127.0.0.1]', '[::ffff:7f00:1]', 'localhost.', 'home.arpa', 'fe9a::1', 'febf::1']) expect(origenLocal(local), local).toBe(true);
    for (const publico of ['sensores.ejemplo.invalid', 'sensores.ejemplo.invalid.', '192.0.2.10', '198.51.100.7', 'fcmapa.ejemplo.invalid', '[::ffff:192.0.2.10]', '[::ffff:c000:20a]', '[fec0::1]', 'arpa.ejemplo.invalid']) expect(origenLocal(publico), publico).toBe(false);
    // Las redes privadas, por octetos (las direcciones con forma real no se escriben en el repositorio): 10/8, 172.16/12, 192.168/16,
    // 100.64/10 (direcciones compartidas) y 169.254/16; sus vecinas, no.
    for (const o of [[10, 1, 2, 3], [172, 16, 0, 1], [172, 31, 9, 9], [192, 168, 4, 5], [100, 64, 0, 1], [100, 127, 3, 4], [169, 254, 1, 1]]) expect(octetosLocales(o), o.join('-')).toBe(true);
    for (const o of [[172, 32, 0, 1], [100, 128, 0, 1], [100, 63, 0, 1], [11, 0, 0, 1], [192, 169, 0, 1], [10, 1, 2]]) expect(octetosLocales(o), o.join('-')).toBe(false);
  });
});
