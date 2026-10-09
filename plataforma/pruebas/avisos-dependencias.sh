#!/usr/bin/env bash
# Lo que la auditoría de dependencias deja pendiente, sin bloquear (docs/11 §4): las excepciones declaradas en
# plataforma/backend/pnpm-workspace.yaml (`audit.ignore`, o el nombre antiguo `auditConfig.ignoreGhsas`) y los avisos que no
# bloquean (moderados o bajos). En GitHub Actions cada uno sale como advertencia amarilla y en el resumen de la corrida; en
# local, como líneas AVISO. Sale siempre 0: avisa, no bloquea (el bloqueo es `pnpm audit --audit-level=high`). Lo que le
# impide revisar (sin el archivo, sin pnpm, sin red) también sale como aviso: nunca en silencio.
#   bash plataforma/pruebas/avisos-dependencias.sh
set -u
n=0
# El resumen es Markdown: un < o > del texto de un aviso no debe convertirse en HTML.
resumen() { local s=${1//</&lt;}; s=${s//>/&gt;}; [ -n "${GITHUB_STEP_SUMMARY:-}" ] && printf '%s\n' "$s" >> "$GITHUB_STEP_SUMMARY"; return 0; }
# Los comandos de GitHub exigen codificar %, \r y \n en el mensaje; y además : y , en el título.
cod() { local s=${1//'%'/'%25'}; s=${s//$'\r'/'%0D'}; s=${s//$'\n'/'%0A'}; printf '%s' "$s"; }
aviso() { # título · detalle
  if [ -n "${GITHUB_ACTIONS:-}" ]; then
    local t; t=$(cod "$1"); t=${t//':'/'%3A'}; t=${t//','/'%2C'}
    printf '::warning title=%s::%s\n' "$t" "$(cod "$2")"
  else printf 'AVISO %s: %s\n' "$1" "$2"; fi
  resumen "- **$1:** $2"; n=$((n+1)); }

resumen "### Dependencias pendientes de resolver (no bloquean; docs/11 §4)"
if ! cd "$(dirname "$0")/../backend" 2>/dev/null || [ ! -f pnpm-workspace.yaml ]; then
  aviso "Revisión no hecha" "no se encontró plataforma/backend/pnpm-workspace.yaml"; exit 0
fi
# Los GHSA fuera de comentarios: así vale para el nombre vigente y para el antiguo de la clave.
for g in $(grep -v '^[[:space:]]*#' pnpm-workspace.yaml | grep -oE 'GHSA-[a-z0-9]{4}-[a-z0-9]{4}-[a-z0-9]{4}' | sort -u); do
  d=$(gh api "/advisories/$g" --jq '"\(.vulnerabilities[0].package.name), \(.severity): \(.summary). Versión corregida: \([.vulnerabilities[].first_patched_version // empty] | if length == 0 then "ninguna publicada" else join(", ") end)"' 2>/dev/null) \
    || d="detalle no disponible (sin gh o sin red)"
  # Con el parche ya publicado sigue en amarillo, pero lo dice en el título (decidido el 08/10/2026); en local, el paso
  # 2q del guardián falla hasta que se actualice y se quite la excepción.
  case "$d" in
    "detalle no disponible"*) aviso "Excepción sin verificar $g" "$d: no se supo si ya hay parche; revisar a mano (en local, paso 2q)." ;;
    *"Versión corregida: ninguna publicada"*) aviso "Excepción vigente $g" "$d. Pendiente de resolver." ;;
    *) aviso "HAY PARCHE para la excepción $g" "$d. Actualizar y quitar la excepción de audit.ignore." ;;
  esac
done
if ! command -v pnpm >/dev/null; then
  aviso "Auditoría no hecha" "pnpm no está en el PATH"
else
  j=$(pnpm audit --json 2>/dev/null)
  if ! jq -e '.advisories' >/dev/null 2>&1 <<<"$j"; then
    aviso "Auditoría no disponible" "pnpm audit --json no devolvió un resultado legible (¿sin red o registro caído?)"
  else
    while read -r s l; do [ -n "$l" ] && aviso "Dependencia con aviso ($s)" "$l"; done < <(jq -r '.advisories[] |
      "\(.severity) \(.module_name): \(.title) (\(.github_advisory_id // .url)). Versión corregida: \(.patched_versions // "ninguna publicada")"' <<<"$j")
  fi
fi
[ "$n" -eq 0 ] && { echo "Sin pendientes de dependencias."; resumen "Sin pendientes."; }
exit 0
