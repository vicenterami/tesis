import { EventEmitter } from 'node:events';
import { describe, expect, it } from 'vitest';
import { errorDeCliente } from './cliente.js';

// Una conexión cortada por la base (idle_in_transaction) llega a un cliente prestado como evento 'error' (docs/16 §61).
describe('errorDeCliente', () => {
  it('con el oyente, el error se registra y no se lanza; plantada: sin oyente, emitir «error» lanza (lo que tumbaba el proceso)', () => {
    const corte = new Error('terminating connection due to idle-in-transaction timeout');
    const conOyente = new EventEmitter().on('error', errorDeCliente);
    expect(() => conOyente.emit('error', corte)).not.toThrow();
    expect(() => new EventEmitter().emit('error', corte)).toThrow(/idle-in-transaction/);
  });
});
