import { tiempoPlausible } from './tiempo';

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
