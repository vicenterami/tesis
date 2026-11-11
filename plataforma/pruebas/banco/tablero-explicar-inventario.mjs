// EXPLAIN de la consulta del inventario (GET /dispositivos; docs/16 §61), sin filtros, tal como la arma consulta.service.ts: se toma su
// texto del fuente y las constantes SQL del compilado (dist/, `pnpm openapi` o `nest build`). Orden «nombre» (la lista entera) o «entrega»
// (página de 50). Desde plataforma/backend:
//   node ../pruebas/banco/tablero-explicar-inventario.mjs src/consulta/consulta.service.ts "$PWD/dist" nombre | <psql del banco>
import { readFileSync } from 'node:fs';
const [archivo, dist, orden] = process.argv.slice(2);
const { SQL_EN_LINEA, SQL_ESTADO_VISUAL } = await import(`${dist}/consulta/tablero.js`);
const src = readFileSync(archivo, 'utf8');
const i = src.indexOf('WITH inv AS (');
const j = src.indexOf('`, p);', i);
let q = src.slice(i, j).replace(/\$\{SQL_EN_LINEA\}/g, SQL_EN_LINEA).replace(/\$\{SQL_ESTADO_VISUAL\}/g, SQL_ESTADO_VISUAL);
q = q.replace(/\$\{ORDEN_SQL\[[^\]]*\]\}/, orden === 'entrega' ? 'inv.entrega_orden ASC NULLS LAST, ' : '').replace(/\$\{pagina\}/, orden === 'entrega' ? 'LIMIT 50' : '');
q = q.replace(/\$\{[^}]*\}/g, (m) => { throw new Error('sin resolver: ' + m); });
q = q.replace(/\$(\d)::(uuid\[\]|uuid|text)/g, 'NULL::$2');
console.log('EXPLAIN (ANALYZE, BUFFERS, SUMMARY ON)\n' + q + ';');
