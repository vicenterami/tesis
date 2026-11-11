import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as credenciales from '../../alta/credenciales.js';
import type { CredencialHttp } from '../recepcion.service.js';
import { Cupo } from './topes.js';
import { VerificacionDeTokens } from './verificacion.js';

// Filtro 1 de la vía HTTP con la caché de verificaciones (docs/10 §8.4 punto 52 (a)): scrypt solo la primera vez y en los fallos.
describe('VerificacionDeTokens', () => {
  const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
  const OTRO = 'otro-token-de-treinta-y-dos-chars';
  let huella: string;
  let huella2: string;
  beforeAll(async () => {
    huella = await credenciales.hashScrypt(TOKEN);
    huella2 = await credenciales.hashScrypt(OTRO);
  });
  const fila = (extra: Partial<CredencialHttp> = {}): CredencialHttp => ({ id: 'd1', via: 'http', estado: 'activo', hash: huella, ...extra });
  const espiar = () => vi.spyOn(credenciales, 'verificarScrypt');

  it('token correcto → ok, y la segunda vez entra por la caché sin scrypt', async () => {
    const espia = espiar();
    try {
      const v = new VerificacionDeTokens();
      expect(v.enCache(fila(), TOKEN)).toBe(false);
      expect(await v.verificar(fila(), TOKEN)).toBe('ok');
      expect(v.enCache(fila(), TOKEN)).toBe(true);
      expect(espia).toHaveBeenCalledTimes(1);
      expect(v.entradas).toBe(1);
    } finally {
      espia.mockRestore();
    }
  });
  it('un token equivocado para un dispositivo en caché no está en caché, y scrypt dice que no (el fallo cuesta lo mismo que antes)', async () => {
    const espia = espiar();
    try {
      const v = new VerificacionDeTokens();
      await v.verificar(fila(), TOKEN);
      expect(v.enCache(fila(), OTRO)).toBe(false);
      expect(await v.verificar(fila(), OTRO)).toBe('no');
      expect(espia).toHaveBeenCalledTimes(2);
      expect(v.enCache(fila(), TOKEN)).toBe(true); // el fallo no borra lo verificado
    } finally {
      espia.mockRestore();
    }
  });
  it('rotación: otra huella en la base deja la entrada sin efecto; el token nuevo se verifica con scrypt y queda en caché', async () => {
    const v = new VerificacionDeTokens();
    await v.verificar(fila(), TOKEN);
    expect(v.enCache(fila({ hash: huella2 }), TOKEN)).toBe(false);
    expect(await v.verificar(fila({ hash: huella2 }), TOKEN)).toBe('no');
    expect(await v.verificar(fila({ hash: huella2 }), OTRO)).toBe('ok');
    expect(v.enCache(fila({ hash: huella2 }), OTRO)).toBe(true);
    expect(v.enCache(fila(), TOKEN)).toBe(false); // la huella vieja ya no está en la base: la entrada vieja se reemplazó
  });
  it('otra vía, dado de baja o sin credencial activa → no, aunque el token sea el correcto; y la caché tampoco los acepta', async () => {
    const v = new VerificacionDeTokens();
    await v.verificar(fila(), TOKEN); // d1 queda en caché con su token
    for (const f of [fila({ via: 'mqtt' }), fila({ estado: 'baja' }), fila({ hash: null })]) {
      expect(v.enCache(f, TOKEN)).toBe(false);
      expect(await v.verificar(f, TOKEN)).toBe('no');
    }
  });
  it('un dispositivo que no existe → no, verificando igual contra la huella de relleno (scrypt una vez)', async () => {
    const espia = espiar();
    try {
      const v = new VerificacionDeTokens();
      expect(v.enCache(undefined, TOKEN)).toBe(false);
      expect(await v.verificar(undefined, TOKEN)).toBe('no');
      expect(espia).toHaveBeenCalledTimes(1);
      expect(v.entradas).toBe(0);
    } finally {
      espia.mockRestore();
    }
  });
  it('cupo lleno → saturado sin verificar; el cupo se libera al terminar y aunque la verificación lance', async () => {
    const cupo = new Cupo(1);
    const v = new VerificacionDeTokens(cupo);
    const espia = espiar().mockRejectedValueOnce(new Error('sin hilos'));
    try {
      await expect(v.verificar(fila(), TOKEN)).rejects.toThrow('sin hilos');
      expect(cupo.tomar()).toBe(true); // quedó libre
      expect(await v.verificar(fila(), TOKEN)).toBe('saturado');
      cupo.soltar();
      expect(await v.verificar(fila(), TOKEN)).toBe('ok');
    } finally {
      espia.mockRestore();
    }
  });
  it('si calcular la huella de relleno falla una vez, no queda guardado el fallo: la siguiente vez se recalcula', async () => {
    const espia = vi.spyOn(credenciales, 'hashScrypt').mockRejectedValueOnce(new Error('sin memoria'));
    try {
      const v = new VerificacionDeTokens();
      await expect(v.verificar(undefined, TOKEN)).rejects.toThrow('sin memoria');
      expect(await v.verificar(undefined, TOKEN)).toBe('no');
    } finally {
      espia.mockRestore();
    }
  });
  it('la pista por identificador: tras un ok con identificador, el mismo token da pista; otro token u otro identificador, no', async () => {
    const v = new VerificacionDeTokens();
    expect(v.pista('nodo-01', TOKEN)).toBe(false);
    expect(await v.verificar(fila(), TOKEN, 'nodo-01')).toBe('ok');
    expect(v.pista('nodo-01', TOKEN)).toBe(true);
    expect(v.pista('nodo-01', OTRO)).toBe(false);
    expect(v.pista('nodo-02', TOKEN)).toBe(false);
    expect(await v.verificar(fila(), OTRO, 'nodo-01')).toBe('no');
    expect(v.pista('nodo-01', TOKEN)).toBe(true); // un fallo no borra la pista
  });
  it('la caché no pasa del tope: con 3 entradas como máximo, la cuarta suelta la más antigua', async () => {
    const v = new VerificacionDeTokens(new Cupo(), 3);
    for (const id of ['d1', 'd2', 'd3', 'd4']) expect(await v.verificar(fila({ id }), TOKEN)).toBe('ok');
    expect(v.entradas).toBe(3);
    expect(v.enCache(fila({ id: 'd1' }), TOKEN)).toBe(false);
    expect(v.enCache(fila({ id: 'd4' }), TOKEN)).toBe(true);
  });
});
