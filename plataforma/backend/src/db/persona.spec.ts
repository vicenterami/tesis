import { describe, expect, it, vi } from 'vitest';
import type { Pool } from 'pg';
import { ActividadService } from '../consulta/actividad.service.js';
import { TableroService } from '../consulta/tablero.service.js';
import { EnlacesService } from '../publico/enlaces.service.js';
import type { VistaPublicaService } from '../publico/vista-publica.service.js';
import { sqlPersona } from './persona.js';

// Homónimos (20/11/2026; RF-46; docs/20 §10 R29): dos cuentas con el mismo nombre se distinguen por el correo en los cuatro
// lugares donde se muestra quién lo hizo, y una cuenta anonimizada no deja correo. Aquí, con un doble del grupo de conexiones (sin base):
// la forma que cada servicio devuelve y que su SQL pide el correo con la guarda de la anonimización. El resultado de esa guarda contra
// datos reales lo comprueban los casos de `plataforma/pruebas/sesion-smoke.sh` (actividad y eventos del dispositivo, con la pila; la guarda de la
// anonimización se probó además sobre una relación de ejemplo: ver docs/16 §93).
const S = '55555555-5555-4555-8555-555555555555';
const D = '00000000-0000-4000-8000-000000000001';
const U1 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa1';
const U2 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa2';
const U3 = 'aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaa3';
const GUARDA = /CASE WHEN (\w+)\.anonimizado_en IS NULL THEN \1\.email END/; // el mismo alias en la condición y en el correo

function pool(filas: unknown[]) {
  const sql: string[] = [];
  const query = vi.fn((texto: string) => { sql.push(texto.replace(/\s+/g, ' ')); return Promise.resolve({ rows: filas }); });
  return { pool: { query } as unknown as Pool, sql };
}

describe('sqlPersona', () => {
  it('arma { id, nombre, correo } desde el alias, con el correo solo si la cuenta no está anonimizada y NULL si no hay cuenta', () => {
    const q = sqlPersona('uc');
    expect(q).toContain("json_build_object('id', uc.id, 'nombre', uc.nombre, 'correo', CASE WHEN uc.anonimizado_en IS NULL THEN uc.email END)");
    expect(q.startsWith('CASE WHEN uc.id IS NULL THEN NULL ELSE')).toBe(true);
  });
});

describe('actividad del sitio: la persona con su correo', () => {
  const base = { instante: '2026-11-20T10:00:00.000000Z', clase: 'evento', tipo: 'alta', detalle: null, dispositivo_id: D, dispositivo_nombre: 'Nodo 1', objeto: null };
  const f = { desde: new Date('2026-11-13T00:00:00Z'), hasta: new Date('2026-11-20T12:00:00Z'), limite: 50 };

  it('dos homónimos salen con el mismo nombre y correos distintos; una cuenta anonimizada, sin correo; sin persona, null', async () => {
    const { pool: p, sql } = pool([
      { ...base, id: 'e1', usuario_id: U1, usuario_nombre: 'Marta', usuario_correo: 'marta.a@example.org' },
      { ...base, id: 'e2', usuario_id: U2, usuario_nombre: 'Marta', usuario_correo: 'marta.b@example.org' },
      { ...base, id: 'e3', usuario_id: U3, usuario_nombre: 'Cuenta dada de baja · 3f2a', usuario_correo: null },
      { ...base, id: 'e4', usuario_id: null, usuario_nombre: null, usuario_correo: null },
    ]);
    const r = await new ActividadService(p).actividad(S, f);
    expect(r.map((x) => x.usuario)).toEqual([
      { id: U1, nombre: 'Marta', correo: 'marta.a@example.org' },
      { id: U2, nombre: 'Marta', correo: 'marta.b@example.org' },
      { id: U3, nombre: 'Cuenta dada de baja · 3f2a', correo: null },
      null,
    ]);
    expect(r[0].usuario?.nombre).toBe(r[1].usuario?.nombre);
    expect(r[0].usuario?.correo).not.toBe(r[1].usuario?.correo);
    expect(sql[0]).toMatch(GUARDA);
  });
  it('el texto de la fila sigue sin el correo de nadie', async () => {
    const { pool: p } = pool([{ ...base, id: 'e1', usuario_id: U1, usuario_nombre: 'Marta', usuario_correo: 'marta.a@example.org' }]);
    const r = await new ActividadService(p).actividad(S, f);
    expect(r[0].texto).not.toContain('@');
  });
});

describe('eventos de la ficha del dispositivo: la persona con su correo', () => {
  it('la consulta pide { id, nombre, correo } con la guarda de la anonimización y devuelve lo que la base entrega', async () => {
    const filas = [
      { id: 'e1', tipo: 'alta', detalle: null, ocurrido_en: 'x', usuario: { id: U1, nombre: 'Marta', correo: 'marta.a@example.org' } },
      { id: 'e2', tipo: 'baja', detalle: null, ocurrido_en: 'y', usuario: { id: U2, nombre: 'Marta', correo: 'marta.b@example.org' } },
      { id: 'e3', tipo: 'baja', detalle: null, ocurrido_en: 'z', usuario: { id: U3, nombre: 'Cuenta dada de baja · 3f2a', correo: null } },
    ];
    const { pool: p, sql } = pool(filas);
    const r = await new TableroService(p).eventosDispositivo(D, new Date('2026-10-01T00:00:00Z'), new Date('2026-11-20T00:00:00Z'), 50);
    expect(r).toEqual(filas);
    expect(sql[0]).toContain(`${sqlPersona('u')} AS usuario`);
    expect(sql[0]).toMatch(GUARDA);
  });
});

describe('enlaces públicos: «creado por» y «revocado por» con su correo', () => {
  it('la lista pide las dos personas con la guarda de la anonimización y las entrega con su correo (nulo si la cuenta está anonimizada)', async () => {
    const fila = {
      id: 'l1', titulo: 'Clima', descripcion: null, ventana_maxima: '7d', zonas: [], magnitudes: [], retencion_dias: 90, anonimizado_en: null,
      creado_por: { id: U1, nombre: 'Marta', correo: 'marta.a@example.org' }, revocado_por: { id: U3, nombre: 'Cuenta dada de baja · 3f2a', correo: null },
      creado_en: '2026-11-17T00:00:00.000Z', expira_en: '2026-12-17T00:00:00.000Z', renovado_en: null, revocado_en: '2026-11-18T00:00:00.000Z',
      accesos_7d: 0, ahora: '2026-11-20T12:00:00.000Z',
    };
    const { pool: p, sql } = pool([fila]);
    const r = await new EnlacesService(p, { olvidar: vi.fn() } as unknown as VistaPublicaService).listar(S, true);
    expect(r[0].creado_por).toEqual({ id: U1, nombre: 'Marta', correo: 'marta.a@example.org' });
    expect(r[0].revocado_por).toEqual({ id: U3, nombre: 'Cuenta dada de baja · 3f2a', correo: null });
    expect(sql[0]).toContain(`${sqlPersona('uc')} AS creado_por`);
    expect(sql[0]).toContain(`${sqlPersona('ur')} AS revocado_por`);
  });
});
