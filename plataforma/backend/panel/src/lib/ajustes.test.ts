import { describe, expect, it } from 'vitest';
import { ErrorApi } from './api';
import {
  acortaElPlazo, afectadosDe, avisoDeEspera, equivalenciaEnDias, esperaQueRige, faltaEspera, puedeEnSitio, sitiosConAjustes, textoAfectados, textoEquivalencia,
  type EsperaSitio,
} from './ajustes';
import type { Sitio } from './modelo';
import type { Sesion } from './sesion';

// P15, «Ajustes del sitio» (docs/19 §4, Q): lo puro de la pantalla.
const SITIOS: Sitio[] = [
  { id: 's1', codigo: 'uct', nombre: 'Campus', zona_horaria: 'America/Santiago', rol: 'administrador', zonas: [] },
  { id: 's2', codigo: 'mag', nombre: 'Magallanes', zona_horaria: 'America/Punta_Arenas', rol: 'consulta', zonas: [] },
  { id: 's3', codigo: 'sur', nombre: 'Sur', zona_horaria: 'America/Santiago', rol: 'investigador', zonas: [] },
];
const persona = (permisos: Record<string, string[]>, administrador_sistema = false): Sesion => ({
  sistema: false, usuario: { id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid' }, clave_temporal: false, expira_en: null, inactividad_vence_en: null,
  sitios: [{ sitio_id: 's1', codigo: 'uct', nombre: 'Campus', rol: 'administrador' }, { sitio_id: 's2', codigo: 'mag', nombre: 'Magallanes', rol: 'consulta' }, { sitio_id: 's3', codigo: 'sur', nombre: 'Sur', rol: 'investigador' }],
  permisos, administrador_sistema,
});
const ESPERA: EsperaSitio = { espera_primera_trama_h: 168, por_omision: 168, minimo: 1, maximo: 2160 };
const error = (codigo: number, cuerpo: Record<string, unknown>): ErrorApi =>
  new ErrorApi(codigo, '', `HTTP ${codigo}`, typeof cuerpo.message === 'string' ? [cuerpo.message] : [], null, cuerpo);

describe('quién ve qué en cada sitio', () => {
  it('cada acción por sitio: `ajustes` (el plazo) y `enlaces` (el k y el tope) se miran aparte; el administrador del sistema, todo', () => {
    const p = persona({ administrador: ['leer', 'ajustes', 'enlaces'], consulta: ['leer'], investigador: ['leer', 'enlaces'] });
    expect(puedeEnSitio(p, SITIOS[0]!, 'ajustes')).toBe(true);
    expect(puedeEnSitio(p, SITIOS[1]!, 'ajustes')).toBe(false);
    expect(puedeEnSitio(p, SITIOS[2]!, 'ajustes')).toBe(false);
    expect(puedeEnSitio(p, SITIOS[2]!, 'enlaces')).toBe(true);
    expect(puedeEnSitio(persona({ consulta: ['leer'] }, true), SITIOS[1]!, 'ajustes')).toBe(true);
    expect(puedeEnSitio(p, { codigo: 'ajeno' }, 'enlaces')).toBe(false); // un sitio donde no tiene membresía
  });
  it('los sitios con alguna de las dos acciones; sin ninguna, ninguno', () => {
    const p = persona({ administrador: ['leer', 'ajustes', 'enlaces'], consulta: ['leer'], investigador: ['leer', 'enlaces'] });
    expect(sitiosConAjustes(p, SITIOS).map((x) => x.codigo)).toEqual(['uct', 'sur']);
    expect(sitiosConAjustes(persona({ administrador: ['leer'], consulta: ['leer'], investigador: ['leer'] }), SITIOS)).toEqual([]);
  });
});

describe('el plazo de la primera trama', () => {
  it('la equivalencia en días: justos, con un decimal con coma y menos de uno', () => {
    expect(equivalenciaEnDias(168)).toBe('7 días');
    expect(equivalenciaEnDias(24)).toBe('1 día');
    expect(equivalenciaEnDias(36)).toBe('1,5 días');
    expect(equivalenciaEnDias(23)).toBe('menos de un día');
    expect(equivalenciaEnDias(2160)).toBe('90 días');
    expect(equivalenciaEnDias(0)).toBe('');
    expect(equivalenciaEnDias(Number.NaN)).toBe('');
    expect(textoEquivalencia(168)).toBe('168 horas son 7 días');
    expect(textoEquivalencia(1)).toBe('1 hora son menos de un día');
  });
  it('lo que falta para guardar: cargando, fuera de rango, no entero, vacío y el mismo que rige; null si sirve', () => {
    expect(faltaEspera(24, null)).toBe('espera a que cargue el plazo');
    for (const malo of [0, 2161, 1.5, null, Number.NaN, '24']) expect(faltaEspera(malo, ESPERA), String(malo)).toBe('elige un número entero entre 1 y 2160');
    expect(faltaEspera(168, ESPERA)).toBe('es el que ya rige');
    expect(faltaEspera(24, ESPERA)).toBeNull();
    expect(faltaEspera(2160, ESPERA)).toBeNull();
  });
  it('el 409 `espera_cambio` trae el plazo que rige y es un conflicto; otro error, null', () => {
    const e = error(409, { codigo: 'espera_cambio', espera_primera_trama_h: 72, message: 'Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de 72 h. Revísalo antes de cambiarlo.' });
    expect(esperaQueRige(e)).toBe(72);
    expect(avisoDeEspera(e)).toEqual({ tipo: 'conflicto', texto: 'Alguien cambió el plazo de la primera trama de este sitio entretanto: ahora es de 72 h. Revísalo antes de cambiarlo.' });
    expect(esperaQueRige(error(409, { codigo: 'minimo_cambio', minimo_dispositivos: 5 }))).toBeNull();
    expect(esperaQueRige(error(400, { codigo: 'espera_cambio', espera_primera_trama_h: 72 }))).toBeNull();
    expect(avisoDeEspera(error(400, { message: 'x' })).tipo).toBe('error');
  });
  it('acortar es bajar del que rige (solo entonces se pregunta); el aviso dice cuántos equipos y es singular con uno', () => {
    expect(acortaElPlazo(24, ESPERA)).toBe(true);
    expect(acortaElPlazo(168, ESPERA)).toBe(false);
    expect(acortaElPlazo(500, ESPERA)).toBe(false);
    expect(acortaElPlazo(24, null)).toBe(false);
    expect(textoAfectados(3)).toBe('Con este plazo, 3 equipos que esperan su primera trama pasarán a «Sin señal» y abrirán su alarma de falta de comunicación en la revisión siguiente del sistema. ¿Guardar igual?');
    expect(textoAfectados(1)).toContain('1 equipo que espera su primera trama pasará a «Sin señal»');
    expect(afectadosDe({ ...ESPERA, afectados: 4 })).toBe(4);
    expect(afectadosDe(ESPERA)).toBe(0);
    expect(afectadosDe({ ...ESPERA, afectados: -1 })).toBe(0);
  });
});
