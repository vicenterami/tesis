// Oyente de 'error' para un cliente prestado del pool (docs/16 §61). pg pone un oyente solo a los clientes ociosos del pool: si la base
// corta la conexión de uno prestado (idle_in_transaction_session_timeout, un reinicio), el evento 'error' sin oyente tumbaba el proceso
// entero (medido el 11/11/2026 con un alta individual detrás de un lote de 500). Con el oyente, la consulta en curso falla, la petición
// responde su error y el cliente se descarta al devolverlo. Quien presta un cliente lo pone al tomarlo y lo quita al soltarlo.
import { Logger } from '@nestjs/common';

const registro = new Logger('db');
export function errorDeCliente(e: Error): void {
  registro.warn(`conexión de la base cortada durante una transacción: ${e.message}`);
}
