// «Acerca de» (docs/21 §7; docs/19 §4, P11; HU-27): versión del backend (package.json), commit de la compilación si la imagen lo trae
// (variable COMPILACION_COMMIT, fijada al construir con `--build-arg COMMIT=…`; sin ella, null), la licencia AGPL-3.0-only con el enlace
// al código fuente si la instancia lo configura (CODIGO_FUENTE_URL, https) y la ruta de los avisos de terceros, generados en la
// compilación desde `pnpm licenses` (generar-avisos-terceros.sh).
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

export const RUTA_AVISOS_TERCEROS = '/panel/avisos-de-terceros.txt';
export const LICENCIA = 'AGPL-3.0-only';
const FORMA_COMMIT = /^[0-9a-f]{7,40}$/;

export interface Acerca {
  nombre: string;
  version: string | null; // null sin sesión (revisión del 11/11/2026): la versión exacta ayuda a quien busca una vulnerabilidad conocida
  commit: string | null;
  licencia: string;
  aviso_licencia: string;
  codigo_fuente: string | null;
  avisos_terceros: string;
}

// La versión del package.json del backend: en la imagen, /app/package.json (dist/legal → ../../); en desarrollo, el de backend/.
let version: string | undefined;
export function versionDelPaquete(ruta = join(import.meta.dirname, '..', '..', 'package.json')): string {
  if (version !== undefined) return version;
  try {
    const v = (JSON.parse(readFileSync(ruta, 'utf8')) as { version?: unknown }).version;
    version = typeof v === 'string' && /^\d+\.\d+\.\d+/.test(v) ? v : 'desconocida';
  } catch {
    version = 'desconocida';
  }
  return version;
}

// Solo un hash hexadecimal de 7 a 40 caracteres (lo demás se ignora: la variable no debe poder inyectar texto en la página); se acorta a 12.
export function commitDeEntorno(v: string | undefined): string | null {
  const t = (v ?? '').trim().toLowerCase();
  return FORMA_COMMIT.test(t) ? t.slice(0, 12) : null;
}

// Solo una URL https sin credenciales; si no, null y la página dice que se pida al responsable.
export function urlCodigoFuente(v: string | undefined): string | null {
  const t = (v ?? '').trim();
  if (t === '' || t.length > 300) return null;
  try {
    const u = new URL(t);
    return u.protocol === 'https:' && u.username === '' && u.password === '' ? u.toString() : null;
  } catch {
    return null;
  }
}

// Sin sesión, «acerca de» dice la licencia, el aviso AGPL, el enlace al código y los avisos de terceros (lo que la AGPL obliga a ofrecer a
// quien usa el sistema por la red), pero no la versión ni el commit: esos, solo a una persona con sesión (revisión del 11/11/2026).
export function acercaSegunSesion(a: Acerca, conSesion: boolean): Acerca {
  return conSesion ? a : { ...a, version: null, commit: null };
}

export function acerca(commit: string | null, codigoFuente: string | null, versionPaquete = versionDelPaquete()): Acerca {
  return {
    nombre: 'Sistema integrado para el registro, gestión y monitoreo de dispositivos IoT',
    version: versionPaquete, commit, licencia: LICENCIA,
    aviso_licencia:
      'Este programa es software libre: puedes redistribuirlo y modificarlo según los términos de la Licencia Pública General Affero de GNU ' +
      '(AGPL), versión 3 únicamente. Se distribuye sin ninguna garantía. Quien usa este sistema por la red tiene derecho a recibir su código fuente' +
      (codigoFuente === null ? ': pídelo al responsable de la instancia (página de privacidad o soporte).' : `: ${codigoFuente}`),
    codigo_fuente: codigoFuente,
    avisos_terceros: RUTA_AVISOS_TERCEROS,
  };
}
