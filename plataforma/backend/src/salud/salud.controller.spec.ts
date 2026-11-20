import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import type { AltaService } from '../alta/alta.service.js';
import type { MetricasBrokerService } from '../broker/metricas.service.js';
import type { PeticionConUsuario } from '../sesion/guardia.js';
import { Rol, UsuarioSesion, usuarioSistema } from '../sesion/permisos.js';
import { SaludController } from './salud.controller.js';

// GET /salud según quién pregunta (docs/10 §6, docs/20 §6; 20/11/2026): sin la acción `sistema`, solo `{ estado }`; con ella, el detalle.
// La guardia ya dejó (o no) a quien pregunta en `req.usuario` (guardia.spec.ts, identificación opcional); aquí se prueba la decisión.
const BROKER = { conectado: true, administracion: true, ultima_muestra: null, mensajes_descartados: 0, mensajes_en_cola: 3, bytes_en_cola: 120, clientes_conectados: 7, cola_tope: 10000, condicion_abierta: null };

function armar(falla = false) {
  const query = vi.fn(() => (falla ? Promise.reject(new Error('base caída')) : Promise.resolve({ rows: [{ n: '29' }] })));
  const metricas = { estado: () => BROKER } as unknown as MetricasBrokerService;
  const alta = { operacionesEnCurso: 2 } as unknown as AltaService;
  return { query, c: new SaludController({ query } as unknown as Pool, metricas, alta) };
}
const pedido = (usuario?: UsuarioSesion): PeticionConUsuario => ({ usuario }) as unknown as PeticionConUsuario;
const persona = (rol: Rol, todos = false): UsuarioSesion =>
  ({ ...usuarioSistema(), id: 'u1', nombre: 'Ana', email: 'ana@ejemplo.invalid', sistema: false, todos, sitios: new Map([['s1', rol]]), sesionId: 'a'.repeat(64) });

describe('SaludController: el detalle solo con la acción «sistema»', () => {
  it('sin credencial → exactamente { estado: "ok" }, y la base se consulta igual (el chequeo sigue diciendo si está viva)', async () => {
    const { c, query } = armar();
    expect(await c.estado(pedido())).toEqual({ estado: 'ok' });
    expect(query).toHaveBeenCalledTimes(1);
  });

  it('con la clave de administrador o la sesión de un administrador del sistema → el detalle completo, igual que antes', async () => {
    const detalle = { estado: 'ok', base: 'conectada', tablas: 29, broker: BROKER, aprovisionamiento_en_curso: 2 };
    expect(await armar().c.estado(pedido(usuarioSistema()))).toEqual(detalle);
    expect(await armar().c.estado(pedido(persona('consulta', true)))).toEqual(detalle);
  });

  it('cualquier perfil de sitio, incluido el administrador de sitio → solo { estado }', async () => {
    for (const rol of ['consulta', 'investigador', 'operador', 'administrador'] as const) {
      expect(await armar().c.estado(pedido(persona(rol)))).toEqual({ estado: 'ok' });
    }
  });

  it('con la base caída, la consulta rechaza para todos (500, como antes): ni el anónimo recibe un «ok» que no es cierto', async () => {
    await expect(armar(true).c.estado(pedido())).rejects.toThrow('base caída');
    await expect(armar(true).c.estado(pedido(usuarioSistema()))).rejects.toThrow('base caída');
  });
});
