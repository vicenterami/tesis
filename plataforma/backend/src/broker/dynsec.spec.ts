import { AdministradorDynsec, ErrorDynsec, TOPICO_ORDENES, ordenesAltaDispositivo } from './dynsec';

// Sin broker: se captura lo publicado y se simula la respuesta por el tópico de respuestas.
function armar(esperaMs = 50) {
  const publicados: { topico: string; carga: string }[] = [];
  const admin = new AdministradorDynsec((topico, carga) => { publicados.push({ topico, carga }); return Promise.resolve(); }, esperaMs);
  const correlacionDe = (i = 0): string => (JSON.parse(publicados[i].carga) as { commands: { correlationData: string }[] }).commands[0].correlationData;
  return { admin, publicados, correlacionDe };
}

describe('AdministradorDynsec: órdenes al plugin por el tópico de control, emparejadas por correlación', () => {
  it('publica las órdenes con un mismo correlationData y resuelve con las respuestas', async () => {
    const { admin, publicados, correlacionDe } = armar();
    const p = admin.ordenar([...ordenesAltaDispositivo('dev-0009', 'secreto-de-prueba'), { command: 'getClient', username: 'dev-0009' }]);
    expect(publicados[0].topico).toBe(TOPICO_ORDENES);
    const orden = (JSON.parse(publicados[0].carga) as { commands: Record<string, unknown>[] }).commands[0];
    expect(orden).toMatchObject({ command: 'createClient', username: 'dev-0009', roles: [{ rolename: 'dispositivo', priority: 1 }] });
    const c = correlacionDe();
    admin.recibir(JSON.stringify({ responses: [{ command: 'createClient', correlationData: c }, { command: 'getClient', correlationData: c, data: {} }] }));
    await expect(p).resolves.toHaveLength(2);
    expect(admin.enVuelo).toBe(0);
  });

  it('una respuesta con error rechaza con el nombre de la orden y el mensaje del plugin', async () => {
    const { admin, correlacionDe } = armar();
    const p = admin.ordenar([{ command: 'createClient', username: 'dev-0001', password: 'x' }]);
    admin.recibir(JSON.stringify({ responses: [{ command: 'createClient', correlationData: correlacionDe(), error: 'Client already exists' }] }));
    await expect(p).rejects.toThrow(ErrorDynsec);
    await expect(p).rejects.toThrow('createClient: Client already exists');
    expect(((await p.catch((x: unknown) => x)) as ErrorDynsec).ambiguo).toBe(false); // rechazo explícito: no se ejecutó
  });

  it('sin respuesta en el plazo → se rechaza y no queda nada pendiente', async () => {
    const { admin } = armar(20);
    const e = (await admin.ordenar([{ command: 'deleteClient', username: 'dev-0001' }]).catch((x: unknown) => x)) as ErrorDynsec;
    expect(e.message).toContain('sin respuesta del broker en 20 ms');
    expect(e.ambiguo).toBe(true); // pudo ejecutarse: quien llama deshace
    expect(admin.enVuelo).toBe(0);
  });

  it('respuestas ajenas, ilegibles o sin correlación se ignoran; al perder la conexión lo pendiente se rechaza de inmediato', async () => {
    const { admin } = armar(10_000);
    const p = admin.ordenar([{ command: 'deleteClient', username: 'dev-0001' }]);
    admin.recibir('esto no es JSON');
    admin.recibir(JSON.stringify({ responses: [{ command: 'deleteClient', correlationData: 'otra' }] }));
    admin.recibir(JSON.stringify({ responses: [{ command: 'deleteClient' }] }));
    expect(admin.enVuelo).toBe(1);
    admin.cancelarTodo('broker fuera de línea');
    await expect(p).rejects.toThrow('broker fuera de línea');
    expect(admin.enVuelo).toBe(0);
  });

  it('si no se puede publicar (sin conexión), se rechaza en el acto y no queda nada pendiente', async () => {
    const admin = new AdministradorDynsec(() => Promise.reject(new Error('sin conexión')), 10_000);
    const e = (await admin.ordenar([{ command: 'deleteClient', username: 'dev-0001' }]).catch((x: unknown) => x)) as ErrorDynsec;
    expect(e.message).toContain('no se pudo publicar la orden: sin conexión');
    expect(e.ambiguo).toBe(false); // nunca salió del proceso
    expect(admin.enVuelo).toBe(0);
  });

  it('el secreto viaja solo en la orden al broker, nunca en el error', async () => {
    const { admin, correlacionDe } = armar();
    const p = admin.ordenar(ordenesAltaDispositivo('dev-0009', 'SECRETO-XYZ'));
    admin.recibir(JSON.stringify({ responses: [{ command: 'createClient', correlationData: correlacionDe(), error: 'fallo' }] }));
    const e = (await p.catch((x: unknown) => x)) as Error;
    expect(`${e.name}: ${e.message} ${e.stack ?? ''}`).not.toContain('SECRETO-XYZ');
  });
});
