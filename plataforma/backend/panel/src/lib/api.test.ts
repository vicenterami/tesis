import { afterEach, describe, expect, it, vi } from 'vitest';
import { ErrorApi, accionPara, obtener } from './api';

describe('obtener: un solo cliente HTTP, errores con código y acción', () => {
  afterEach(() => vi.unstubAllGlobals());
  it('200 → el JSON', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify([{ id: 'x' }]), { status: 200 })));
    await expect(obtener<{ id: string }[]>('/dispositivos')).resolves.toEqual([{ id: 'x' }]);
  });
  it('409 → ErrorApi con la acción «recarga»; 421 → «nombre del servidor»; otro código → acción genérica', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('', { status: 409 })));
    await expect(obtener('/x')).rejects.toMatchObject({ codigo: 409, accion: expect.stringContaining('recarga') } satisfies Partial<ErrorApi>);
    expect(accionPara(421)).toContain('nombre del servidor');
    expect(accionPara(418)).toContain('inténtalo');
  });
});
