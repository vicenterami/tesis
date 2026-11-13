import { Logger } from '@nestjs/common';
import { scrypt } from 'node:crypto';
import { beforeAll, describe, expect, it, vi } from 'vitest';
import * as credenciales from '../../alta/credenciales.js';
import type { CredencialHttp } from '../recepcion.service.js';
import { Cupo } from './topes.js';
import { VerificacionDeTokens } from './verificacion.js';

// Filtro 1 de la vía HTTP (docs/10 §8.4 punto 52). Las huellas se calculan aquí con las funciones del alta: ningún literal con forma de hash.
const TOKEN = 'abcdefghijklmnopqrstuvwxyz012345';
const OTRO = 'otro-token-de-treinta-y-dos-chars';
const espiar = () => vi.spyOn(credenciales, 'verificarCredencialDispositivo');

// Cuántas veces corre scrypt de verdad. Un espía sobre el espacio de nombres de credenciales.js no lo ve: verificarCredencialDispositivo
// llama a verificarScrypt por su enlace local del módulo. Por eso se simula node:crypto en parte: scrypt es la función real envuelta en un
// contador, y todo lo demás queda real.
vi.mock('node:crypto', async (original) => {
  const real = await original<typeof import('node:crypto')>();
  return { ...real, scrypt: vi.fn(real.scrypt) };
});
const llamadasScrypt = vi.mocked(scrypt);

// Camino anterior: credenciales `scrypt$…` creadas antes del 13/11/2026, con la caché de verificaciones (a) y el cupo (d).
describe('VerificacionDeTokens, camino anterior (scrypt)', () => {
  let huella: string;
  let huella2: string;
  beforeAll(async () => {
    huella = await credenciales.hashScrypt(TOKEN, undefined, credenciales.N_CREDENCIAL_ANTERIOR);
    huella2 = await credenciales.hashScrypt(OTRO, undefined, credenciales.N_CREDENCIAL_ANTERIOR);
  });
  const fila = (extra: Partial<CredencialHttp> = {}): CredencialHttp => ({ id: 'd1', via: 'http', estado: 'activo', credencial_id: 'c1', hash: huella, ...extra });

  it('token correcto → ok con un scrypt, y la segunda vez entra por la caché sin scrypt', async () => {
    const espia = espiar();
    try {
      const v = new VerificacionDeTokens();
      llamadasScrypt.mockClear();
      expect(v.enCache(fila(), TOKEN)).toBe(false);
      expect(await v.verificar(fila(), TOKEN)).toBe('ok');
      expect(llamadasScrypt).toHaveBeenCalledTimes(1);
      expect(v.enCache(fila(), TOKEN)).toBe(true);
      expect(llamadasScrypt).toHaveBeenCalledTimes(1);
      expect(espia).toHaveBeenCalledTimes(1);
      expect(await espia.mock.results[0].value).toEqual({ valida: true, camino: 'scrypt' });
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
  it('primer acierto → la fila se convierte: su id, la huella scrypt verificada y el resumen SHA-256 del token; un fallo no convierte', async () => {
    const convertir = vi.fn((_id: string, _anterior: string, _nueva: string) => Promise.resolve(true));
    const v = new VerificacionDeTokens(new Cupo(), 10, convertir);
    expect(await v.verificar(fila(), OTRO)).toBe('no');
    expect(convertir).not.toHaveBeenCalled();
    expect(await v.verificar(fila(), TOKEN, 'nodo-01')).toBe('ok');
    expect(convertir).toHaveBeenCalledTimes(1);
    expect(convertir).toHaveBeenCalledWith('c1', huella, credenciales.resumirSecreto(TOKEN));
    expect(credenciales.verificarResumen(TOKEN, convertir.mock.calls[0][2])).toBe(true);
    expect(v.entradas).toBe(0); // convertida: la entrada de la caché ya no sirve (la huella activa es otra) y se suelta
    // La trama siguiente llega con la fila ya convertida: camino rápido, sin scrypt y sin otra conversión.
    const espia = espiar();
    try {
      expect(await v.verificar(fila({ hash: credenciales.resumirSecreto(TOKEN) }), TOKEN, 'nodo-01')).toBe('ok');
      expect(await espia.mock.results[0].value).toEqual({ valida: true, camino: 'sha256' });
      expect(convertir).toHaveBeenCalledTimes(1);
    } finally {
      espia.mockRestore();
    }
  });
  it('I5: si la conversión falla, la trama sigue (ok), se anota sin token ni huella y la caché sigue valiendo', async () => {
    const convertir = vi.fn(() => Promise.reject(Object.assign(new Error(`fallo con ${TOKEN} y ${huella}`), { code: '57014' })));
    const v = new VerificacionDeTokens(new Cupo(), 10, convertir);
    const avisos = vi.spyOn(Logger.prototype, 'warn').mockImplementation(() => undefined);
    try {
      expect(await v.verificar(fila(), TOKEN)).toBe('ok');
      expect(convertir).toHaveBeenCalledTimes(1);
      expect(avisos).toHaveBeenCalledTimes(1);
      const aviso = String(avisos.mock.calls[0][0]);
      expect(aviso).toContain('57014');
      expect(aviso).not.toContain(TOKEN);
      expect(aviso).not.toContain(huella);
      expect(aviso).not.toContain(credenciales.resumirSecreto(TOKEN));
      expect(v.enCache(fila(), TOKEN)).toBe(true);
      // Un rechazo sin objeto (undefined) tampoco pierde la trama.
      const sinObjeto = new VerificacionDeTokens(new Cupo(), 10, () => Promise.reject(undefined)); // eslint-disable-line @typescript-eslint/prefer-promise-reject-errors
      expect(await sinObjeto.verificar(fila(), TOKEN)).toBe('ok');
    } finally {
      avisos.mockRestore();
    }
  });
  it('una conversión que no encuentra la fila (se rotó entretanto) no es un error: la caché queda como estaba', async () => {
    const v = new VerificacionDeTokens(new Cupo(), 10, () => Promise.resolve(false));
    expect(await v.verificar(fila(), TOKEN)).toBe('ok');
    expect(v.enCache(fila(), TOKEN)).toBe(true);
  });
});

// Camino rápido: credenciales `sha256$…` (todas las creadas desde el 13/11/2026), sin cupo ni scrypt.
describe('VerificacionDeTokens, camino rápido (SHA-256)', () => {
  const huella = credenciales.resumirSecreto(TOKEN);
  const fila = (extra: Partial<CredencialHttp> = {}): CredencialHttp => ({ id: 'd1', via: 'http', estado: 'activo', credencial_id: 'c1', hash: huella, ...extra });

  it('token correcto → ok; equivocado → no; sin cupo (aun con el cupo lleno), sin scrypt y sin caché ni conversión', async () => {
    const cupo = new Cupo(1);
    expect(cupo.tomar()).toBe(true); // lleno
    const convertir = vi.fn(() => Promise.resolve(true));
    const v = new VerificacionDeTokens(cupo, 10, convertir);
    llamadasScrypt.mockClear();
    expect(v.caminoAnterior(fila())).toBe(false);
    expect(await v.verificar(fila(), TOKEN)).toBe('ok');
    expect(await v.verificar(fila(), OTRO)).toBe('no');
    expect(llamadasScrypt).not.toHaveBeenCalled();
    expect(convertir).not.toHaveBeenCalled();
    expect(v.entradas).toBe(0);
  });
  it('I3: inexistente, sin credencial, de otra vía o dado de baja → no, con el MISMO trabajo que un token equivocado: un resumen contra una huella de relleno, sin scrypt', async () => {
    const v = new VerificacionDeTokens();
    // La huella anterior de otra vía se fabrica antes de contar: es el único scrypt de este caso, y no lo hace el código que se prueba.
    const anteriorOtraVia = fila({ hash: await credenciales.hashScrypt(TOKEN, undefined, credenciales.N_CREDENCIAL_ANTERIOR), via: 'mqtt' });
    const espia = espiar();
    llamadasScrypt.mockClear();
    try {
      expect(await v.verificar(fila(), OTRO)).toBe('no'); // existe, huella nueva, token equivocado
      const casos = [undefined, fila({ hash: null, credencial_id: null }), fila({ via: 'mqtt' }), fila({ estado: 'baja' }), anteriorOtraVia];
      for (const f of casos) expect(await v.verificar(f, TOKEN)).toBe('no'); // ni con el token correcto
      expect(espia).toHaveBeenCalledTimes(1 + casos.length);
      const huellas = espia.mock.calls.map(([, h]) => h);
      expect(huellas[0]).toBe(huella);
      const relleno = huellas[1];
      expect(credenciales.caminoDeCredencial(relleno)).toBe('sha256');
      expect(relleno).not.toBe(huella);
      expect(new Set(huellas.slice(1))).toEqual(new Set([relleno])); // un relleno fijo por proceso
      for (const r of espia.mock.results) expect(await r.value).toMatchObject({ camino: 'sha256', valida: false });
      expect(llamadasScrypt).not.toHaveBeenCalled(); // ni con la huella de relleno ni con la anterior de otra vía
    } finally {
      espia.mockRestore();
    }
  });
  it('I4: un ok del camino rápido actualiza la pista del identificador; un fallo no la borra', async () => {
    const v = new VerificacionDeTokens();
    expect(v.pista('nodo-01', TOKEN)).toBe(false);
    expect(await v.verificar(fila(), TOKEN, 'nodo-01')).toBe('ok');
    expect(v.pista('nodo-01', TOKEN)).toBe(true);
    expect(await v.verificar(fila(), OTRO, 'nodo-01')).toBe('no');
    expect(v.pista('nodo-01', TOKEN)).toBe(true);
    expect(v.pista('nodo-01', OTRO)).toBe(false);
  });
  it('una huella con otra forma (ni sha256$ ni scrypt$) no verifica nada: no, por el camino rápido', async () => {
    const v = new VerificacionDeTokens();
    expect(await v.verificar(fila({ hash: `bcrypt$${TOKEN}` }), TOKEN)).toBe('no');
    expect(v.caminoAnterior(fila({ hash: `bcrypt$${TOKEN}` }))).toBe(false);
  });
});
