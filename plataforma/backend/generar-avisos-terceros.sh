#!/usr/bin/env bash
# Avisos de terceros de la instancia (docs/21 §7; docs/19 §4, P11; HU-27): escribe panel/public/avisos-de-terceros.txt desde
# `pnpm licenses list --prod --json` del workspace (el backend y el panel), con nombre, versión, licencia, sitio y las líneas de copyright
# del archivo de licencia de cada paquete (sin correos), y al final el texto de la licencia MIT (la de la mayoría) y, por cada otra licencia
# presente (Apache-2.0, BSD, ISC…), el texto completo del LICENSE (y del NOTICE, si existe) del primer paquete que la usa (decidido el
# 11/11/2026: un enlace a SPDX no basta para cumplir las licencias que piden acompañar su texto). Solo dependencias de PRODUCCIÓN: las
# de desarrollo (vitest, tsx, eslint, typescript, vite…) no viajan en la imagen y no aparecen. El panel lo sirve en /panel/; «Acerca de»
# (GET /acerca) da su ruta.
#   bash plataforma/backend/generar-avisos-terceros.sh              regenera el archivo (después de cambiar dependencias)
#   bash plataforma/backend/generar-avisos-terceros.sh --comprobar  no escribe: falla (salida 1) si una dependencia de producción del
#                                                                   lockfile no está en el archivo, con nombre@versión, o si falta el texto
#                                                                   completo de alguna licencia distinta de MIT (guardián, paso 2r2)
# Requiere las dependencias instaladas (pnpm install): la licencia y el copyright se leen de node_modules. Node, sin python.
set -euo pipefail
AQUI="$(cd "$(dirname "$0")" && pwd)"
ARCHIVO="$AQUI/panel/public/avisos-de-terceros.txt"
MODO="${1:-generar}"
[[ "$MODO" == generar || "$MODO" == --comprobar ]] || { echo "uso: bash $0 [--comprobar]" >&2; exit 2; }
LISTA=$(cd "$AQUI" && pnpm licenses list --prod --json 2>/dev/null) || { echo "FALLA pnpm licenses list no respondió (¿pnpm install?)" >&2; exit 1; }
printf '%s' "$LISTA" | node --input-type=module -e '
import { readFileSync, readdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
const [modo, archivo] = process.argv.slice(1);
const porLicencia = JSON.parse(readFileSync(0, "utf8"));
const paquetes = [];
for (const [licencia, lista] of Object.entries(porLicencia)) {
  for (const p of lista) for (const [i, v] of p.versions.entries()) paquetes.push({ nombre: p.name, version: v, licencia, sitio: p.homepage ?? "", ruta: p.paths[i] ?? p.paths[0] });
}
paquetes.sort((a, b) => (a.nombre + "@" + a.version).localeCompare(b.nombre + "@" + b.version));
const clave = (p) => `${p.nombre}@${p.version}`;
const otrasLicencias = [...new Set(paquetes.map((p) => p.licencia))].filter((l) => l !== "MIT").sort();
const TITULO_TEXTO = "Texto completo de la licencia";
if (modo === "--comprobar") {
  let texto = "";
  try { texto = readFileSync(archivo, "utf8"); } catch { console.log(`FALLA no existe ${archivo}`); process.exit(1); }
  const faltan = paquetes.filter((p) => !texto.includes(`\n${clave(p)} `));
  if (faltan.length > 0) { console.log(`FALLA ${faltan.length} dependencia(s) de producción sin aviso: ${faltan.map(clave).join(", ")}`); process.exit(1); }
  const sinTexto = otrasLicencias.filter((l) => !texto.includes(`\n${TITULO_TEXTO} ${l} `));
  if (sinTexto.length > 0) { console.log(`FALLA sin el texto completo de la(s) licencia(s): ${sinTexto.join(", ")} (regenerar con generar-avisos-terceros.sh)`); process.exit(1); }
  console.log(`OK    las ${paquetes.length} dependencias de producción del lockfile tienen su aviso, y las ${otrasLicencias.length} licencias distintas de MIT (${otrasLicencias.join(", ")}) su texto completo, en panel/public/avisos-de-terceros.txt`);
  process.exit(0);
}
const copyright = (ruta) => {
  try {
    const f = readdirSync(ruta).find((n) => /^(licen[cs]e|copying)(\.|$)/i.test(n));
    if (f === undefined) return [];
    return readFileSync(join(ruta, f), "utf8").split(/\r?\n/).map((l) => l.trim()).filter((l) => /^(copyright|\(c\)|©)/i.test(l)).slice(0, 3)
      // Sin correos: el nombre del titular basta para el aviso, y el repositorio no publica direcciones de nadie.
      .map((l) => l.replace(/<?[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}>?/gi, "").replace(/\(\s*\)/g, "").replace(/\s{2,}/g, " ").trim());
  } catch { return []; }
};
const lineas = [
  "Avisos de terceros de la instancia (se sirve en /panel/avisos-de-terceros.txt)",
  "=============================================================================",
  "",
  "GENERADO por plataforma/backend/generar-avisos-terceros.sh desde `pnpm licenses list --prod --json` (dependencias de producción del",
  "backend y del panel; las de desarrollo no viajan en la imagen). No se edita a mano: se regenera al cambiar dependencias, y el guardián",
  "comprueba que no falte ninguna. Una línea por paquete: nombre@versión, licencia y sitio; debajo, el copyright de su archivo de licencia.",
  "",
  `Paquetes: ${paquetes.length}. Licencias: ${[...new Set(paquetes.map((p) => p.licencia))].sort().join(", ")}.`,
  "",
];
for (const p of paquetes) {
  lineas.push(`${clave(p)} · ${p.licencia}${p.sitio ? ` · ${p.sitio}` : ""}`);
  for (const c of copyright(p.ruta)) lineas.push(`    ${c}`);
}
lineas.push("", "Texto de la licencia MIT (la de la mayoría de los paquetes; el de cada una de las demás va completo más abajo):", "",
  "Permission is hereby granted, free of charge, to any person obtaining a copy of this software and associated documentation",
  "files (the \"Software\"), to deal in the Software without restriction, including without limitation the rights to use, copy,",
  "modify, merge, publish, distribute, sublicense, and/or sell copies of the Software, and to permit persons to whom the",
  "Software is furnished to do so, subject to the following conditions:", "",
  "The above copyright notice and this permission notice shall be included in all copies or substantial portions of the",
  "Software.", "",
  "THE SOFTWARE IS PROVIDED \"AS IS\", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR IMPLIED, INCLUDING BUT NOT LIMITED TO THE",
  "WARRANTIES OF MERCHANTABILITY, FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE AUTHORS OR",
  "COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE,",
  "ARISING FROM, OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE SOFTWARE.", "",
  "El código propio del panel y del resto del sistema se publica bajo AGPL-3.0-only (archivo LICENSE en la raíz de plataforma/).");
// Por cada licencia distinta de MIT: el LICENSE (y el NOTICE, si existe) del primer paquete que la usa y lo trae, sin correos.
const sinCorreos = (s) => s.replace(/<?[^\s<>()]+@[^\s<>()]+\.[a-z]{2,}>?/gi, "").replace(/\(\s*\)/g, "").replace(/[ \t]{2,}/g, " ");
const leerArchivo = (ruta, patron) => {
  try { const f = readdirSync(ruta).find((n) => patron.test(n)); return f === undefined ? null : readFileSync(join(ruta, f), "utf8").trim(); } catch { return null; }
};
const faltanTextos = [];
for (const l of otrasLicencias) {
  const con = paquetes.filter((p) => p.licencia === l).map((p) => ({ p, texto: leerArchivo(p.ruta, /^(licen[cs]e|copying)(\.|$)/i) })).find((x) => x.texto !== null);
  if (con === undefined) { faltanTextos.push(l); continue; }
  lineas.push("", `${TITULO_TEXTO} ${l} (de ${clave(con.p)}, el primer paquete que la usa):`, "", sinCorreos(con.texto));
  const aviso = leerArchivo(con.p.ruta, /^notice(\.|$)/i);
  if (aviso !== null) lineas.push("", `NOTICE de ${clave(con.p)}:`, "", sinCorreos(aviso));
}
if (faltanTextos.length > 0) { console.log(`FALLA ningún paquete trae el archivo de licencia de: ${faltanTextos.join(", ")}`); process.exit(1); }
writeFileSync(archivo, lineas.join("\n") + "\n");
console.log(`escrito ${archivo}: ${paquetes.length} paquetes de producción`);
' -- "$MODO" "$ARCHIVO"
