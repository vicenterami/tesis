import { describe, expect, it } from 'vitest';
import { desvioDePasarela, tiempoPlausible } from './tiempo.js';

// Filtro 4, regla 7 de docs/13: la marca del emisor se acepta solo si es plausible.
describe('tiempoPlausible', () => {
  const recibido = new Date('2026-09-10T12:00:00Z');

  it('sin marca → hora de recepción (nodo sin reloj)', () => {
    expect(tiempoPlausible(undefined, recibido)).toBe(recibido);
  });
  it('marca anterior al año 2000 → hora de recepción (reloj sin inicializar, epoch 0)', () => {
    expect(tiempoPlausible(new Date(0), recibido)).toBe(recibido);
    expect(tiempoPlausible(new Date('1999-12-31T23:59:59Z'), recibido)).toBe(recibido);
  });
  it('marca antigua pero posterior a 2000 → se respeta (cola de lecturas sin cobertura)', () => {
    const vieja = new Date('2026-09-01T08:00:00Z');
    expect(tiempoPlausible(vieja, recibido)).toBe(vieja);
  });
  it('adelanto de hasta 2 minutos → se respeta la marca (deriva normal de un reloj barato)', () => {
    const casiFuturo = new Date(recibido.getTime() + 90_000);
    expect(tiempoPlausible(casiFuturo, recibido)).toBe(casiFuturo);
    const justoEnElLimite = new Date(recibido.getTime() + 120_000);
    expect(tiempoPlausible(justoEnElLimite, recibido)).toBe(justoEnElLimite);
  });
  it('más de 2 minutos en el futuro → hora de recepción (reloj adelantado)', () => {
    expect(tiempoPlausible(new Date(recibido.getTime() + 121_000), recibido)).toBe(recibido);
    expect(tiempoPlausible(new Date('2030-01-01T00:00:00Z'), recibido)).toBe(recibido);
  });
  it('fecha inválida → hora de recepción, sin lanzar', () => {
    expect(tiempoPlausible(new Date('basura'), recibido)).toBe(recibido);
  });
});

// Regla 18 de docs/13 (decidido el 21/10/2026, docs/10 §8.4 punto 54): la marca de una PASARELA a más de 10 min de la llegada es su reloj.
describe('tiempoPlausible con origen pasarela (tolerancia de desvío)', () => {
  const recibido = new Date('2026-10-20T15:00:00Z');
  const cuatroDias = new Date(recibido.getTime() - 4 * 86_400_000); // la UG65 sin NTP del 20/10 (docs/16 §45)

  it('pasarela 4 días atrás → hora de recepción, con desvío negativo (atrasada)', () => {
    expect(tiempoPlausible(cuatroDias, recibido, 'pasarela')).toBe(recibido);
    expect(desvioDePasarela(cuatroDias, recibido, 'pasarela')).toBe(-4 * 86_400_000);
  });
  it('pasarela 9 min atrás → se respeta la marca, sin desvío', () => {
    const nueve = new Date(recibido.getTime() - 9 * 60_000);
    expect(tiempoPlausible(nueve, recibido, 'pasarela')).toBe(nueve);
    expect(desvioDePasarela(nueve, recibido, 'pasarela')).toBeUndefined();
  });
  it('pasarela justo 10 min atrás → se respeta; 10 min y 1 s → hora de recepción', () => {
    const diez = new Date(recibido.getTime() - 600_000);
    expect(tiempoPlausible(diez, recibido, 'pasarela')).toBe(diez);
    expect(tiempoPlausible(new Date(recibido.getTime() - 601_000), recibido, 'pasarela')).toBe(recibido);
  });
  it('dispositivo 4 días atrás → se respeta (cola sin cobertura): la regla 18 no lo toca', () => {
    expect(tiempoPlausible(cuatroDias, recibido, 'dispositivo')).toBe(cuatroDias);
    expect(tiempoPlausible(cuatroDias, recibido)).toBe(cuatroDias); // sin origen: el de siempre
    expect(desvioDePasarela(cuatroDias, recibido, 'dispositivo')).toBeUndefined();
  });
  it('más de 2 min en el futuro → hora de recepción para los dos orígenes; la pasarela abre condición desde ahí (hasta 2 min, nada)', () => {
    const tresMin = new Date(recibido.getTime() + 180_000);
    expect(tiempoPlausible(tresMin, recibido, 'dispositivo')).toBe(recibido);
    expect(tiempoPlausible(tresMin, recibido, 'pasarela')).toBe(recibido);
    expect(desvioDePasarela(tresMin, recibido, 'pasarela')).toBe(180_000); // toda marca de pasarela reemplazada avisa (revisión del 22/10)
    expect(desvioDePasarela(new Date(recibido.getTime() + 60_000), recibido, 'pasarela')).toBeUndefined(); // deriva normal: se respeta
    expect(desvioDePasarela(new Date(recibido.getTime() + 3_600_000), recibido, 'pasarela')).toBe(3_600_000);
  });
  it('pasarela sin marca, inválida o anterior a 2000 → hora de recepción por la regla 7, sin desvío que informar', () => {
    expect(desvioDePasarela(undefined, recibido, 'pasarela')).toBeUndefined();
    expect(desvioDePasarela(new Date('basura'), recibido, 'pasarela')).toBeUndefined();
    expect(desvioDePasarela(new Date(0), recibido, 'pasarela')).toBeUndefined();
  });
});
