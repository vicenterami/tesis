# Personas de prueba y de demostración con clave temporal (docs/20 §4), creadas con el dueño de la base. Lo usan semilla-demo.sh,
# panel-sesion-e2e.sh y personas-semilla-prueba.sh. Se carga con `. lib-personas.sh` después de definir PLAT (la carpeta plataforma/).
# La clave nunca viaja como argumento (visible en ps): entra por la entrada estándar del contenedor del backend, que calcula el hash con
# su propia función y su costo (alta/credenciales.ts, N = 2^17), y el hash entra a la base dentro del SQL, por la entrada estándar de psql.
# Con bash anterior a 5.1, un `<<<` pasa por un archivo temporal de $TMPDIR: las claves que viajan así son temporales y de cuentas
# de prueba o de demostración.

# 24 caracteres base64url (18 bytes aleatorios), la misma forma que generarClaveTemporal() del backend (sesion/claves.ts).
clave_temporal() { openssl rand -base64 18 | tr '+/' '-_' | tr -d '\n='; }

# hash_persona: lee la clave por la entrada estándar (tal cual, sin quitar nada: pasarla con printf '%s') y escribe su hash scrypt$N$r$p$sal$clave (o nada, si el backend no responde).
hash_persona() {
  local h
  h=$(docker compose -f "$PLAT/docker-compose.yml" exec -T backend node -e \
    "let s='';process.stdin.on('data',d=>s+=d).on('end',()=>require('/app/dist/alta/credenciales.js').hashScrypt(s,undefined,2**17).then(h=>process.stdout.write(h)))")
  [[ "$h" =~ ^scrypt\$[0-9]+\$[0-9]+\$[0-9]+\$[A-Za-z0-9+/=]+\$[A-Za-z0-9+/=]+$ ]] && printf '%s' "$h"
}

# La vigencia de la clave temporal que rige en el backend (CLAVE_TEMPORAL_HORAS, 1–72 h; 2 por defecto; docs/20 §4): se lee del contenedor
# (no es un secreto). Si no se puede leer o no es un entero de 1 a 72, la de por defecto, 2: la misma regla que arranque.ts.
horas_clave_temporal() {
  local h
  h=$(docker compose -f "$PLAT/docker-compose.yml" exec -T backend printenv CLAVE_TEMPORAL_HORAS 2>/dev/null | tr -d '[:space:]')
  if [[ "$h" =~ ^[0-9]+$ ]] && [ "$h" -ge 1 ] && [ "$h" -le 72 ]; then echo "$h"; else echo 2; fi
}

# persona_temporal NOMBRE EMAIL SITIO_CODIGO ROL [rotar|conservar]  (la clave temporal por la entrada estándar; ROL: administrador,
# investigador, operador o consulta, los cuatro perfiles de sitio de la migración 24)
# Crea la persona con esa clave temporal (con la vigencia del backend, horas_clave_temporal) o, si ya existe, según el modo:
#   rotar (por defecto; lo usa panel-sesion-e2e.sh con personas propias): le pone esa clave temporal y corta sus sesiones;
#   conservar (semilla-demo.sh desde el 13/11/2026): si la cuenta está activa y ya eligió su clave (clave_temporal = false) o su temporal
#     sigue vigente, NO toca ni la huella ni las sesiones; con la temporal vencida (o sin fecha), o con la cuenta desactivada, le pone la
#     nueva y corta sus sesiones, como en rotar: una cuenta desactivada se reactiva siempre con una clave temporal nueva (quien la
#     desactivó porque su clave se filtró no la ve volver con esa clave).
# En los dos modos la reactiva (limpiando la baja con motivo, ck_usuario_baja) y le da ese rol en ese sitio. La decisión se toma dentro
# del ON CONFLICT … DO UPDATE, con CASE sobre la fila existente (sin leer antes y escribir después: dos corridas a la vez no se pisan).
# Escribe «id resultado», con resultado: nueva (cuenta creada), rotada (clave cambiada), propia (conserva la que eligió) o vigente
# (conserva su temporal, aún vigente). La clave recibida quedó en uso solo con nueva o rotada; solo con rotada se cortan sesiones.
# Solo correos de dominio reservado (@ejemplo.invalid, RFC 2606): nunca una cuenta real.
persona_temporal() {
  local nombre=$1 email=$2 sitio=$3 rol=$4 modo=${5:-rotar} h clave horas cambia
  # Una línea, sin el salto final: `<<<"$clave"` agrega uno, y el hash sería el de «clave + salto» (pasó en la primera corrida del e2e).
  IFS= read -r clave || [ -n "$clave" ] || { echo "persona_temporal: falta la clave por la entrada estándar" >&2; return 1; }
  [[ "$email" =~ ^[a-z0-9._-]+@ejemplo\.invalid$ ]] || { echo "persona_temporal: solo correos @ejemplo.invalid ($email)" >&2; return 1; }
  [[ "$rol" =~ ^(administrador|investigador|operador|consulta)$ ]] && [[ "$sitio" =~ ^[a-z0-9-]+$ ]] && [[ "$nombre" =~ ^[[:alnum:][:space:]áéíóúñÁÉÍÓÚÑ.-]+$ ]] || { echo "persona_temporal: argumentos inválidos" >&2; return 1; }
  case "$modo" in
    rotar) cambia="true" ;;
    # Vencida = la que ya no deja entrar (el backend la rechaza desde su vencimiento, docs/20 §4); sin fecha, también se reemplaza.
    # Desactivada: se reactiva con la temporal nueva, nunca con la huella que tenía al darse de baja.
    conservar) cambia="(NOT usuario.activo OR (usuario.clave_temporal AND (usuario.clave_temporal_vence_en IS NULL OR usuario.clave_temporal_vence_en <= now())))" ;;
    *) echo "persona_temporal: modo «$modo» (rotar o conservar)" >&2; return 1 ;;
  esac
  h=$(printf '%s' "$clave" | hash_persona) || { echo "persona_temporal: el backend no calculó el hash (¿está arriba?)" >&2; return 1; }
  horas=$(horas_clave_temporal)
  # xmax = 0 en lo que devuelve un INSERT … ON CONFLICT: la fila se insertó (no venía de un UPDATE). Con la huella recién calculada en la
  # fila, la clave recibida quedó en uso; si no, se conservó la anterior, propia o temporal vigente.
  docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q -F ' ' <<SQL
WITH u AS (
  INSERT INTO usuario (nombre, email, hash_password, clave_temporal, clave_temporal_vence_en)
  VALUES ('$nombre', '$email', '$h', true, now() + make_interval(hours => $horas))
  ON CONFLICT (email) DO UPDATE SET
    hash_password = CASE WHEN $cambia THEN EXCLUDED.hash_password ELSE usuario.hash_password END,
    clave_temporal = CASE WHEN $cambia THEN true ELSE usuario.clave_temporal END,
    clave_temporal_vence_en = CASE WHEN $cambia THEN EXCLUDED.clave_temporal_vence_en ELSE usuario.clave_temporal_vence_en END,
    activo = true, desactivado_en = NULL, desactivado_por = NULL, motivo_baja = NULL
  RETURNING id, CASE WHEN xmax = 0 THEN 'nueva' WHEN hash_password = '$h' THEN 'rotada' WHEN clave_temporal THEN 'vigente' ELSE 'propia' END AS resultado),
s AS (INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) SELECT u.id, sitio.id, '$rol' FROM u, sitio WHERE sitio.codigo = '$sitio'
  ON CONFLICT (usuario_id, sitio_id) DO UPDATE SET rol = EXCLUDED.rol, activo = true RETURNING usuario_id),
c AS (UPDATE sesion SET revocada_en = now() WHERE usuario_id IN (SELECT id FROM u WHERE resultado = 'rotada') AND revocada_en IS NULL)
SELECT id, resultado FROM u WHERE EXISTS (SELECT 1 FROM s);
SQL
}
