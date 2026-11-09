# Personas de prueba y de demostración con clave temporal (docs/20 §4), creadas con el dueño de la base. Lo usan semilla-demo.sh y
# panel-sesion-e2e.sh. Se carga con `. lib-personas.sh` después de definir PLAT (la carpeta plataforma/).
# La clave nunca viaja como argumento (visible en ps): entra por la entrada estándar del contenedor del backend, que calcula el hash con
# su propia función y su costo (alta/credenciales.ts, N = 2^17), y el hash entra a la base dentro del SQL, por la entrada estándar de psql.

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

# persona_temporal NOMBRE EMAIL SITIO_CODIGO ROL  (la clave temporal por la entrada estándar)
# Crea la persona o, si ya existe, le pone esa clave temporal (con la vigencia del backend, horas_clave_temporal), la reactiva, le da ese rol en ese sitio y corta sus sesiones.
# Escribe su id. Solo correos de dominio reservado (@ejemplo.invalid, RFC 2606): nunca una cuenta real.
persona_temporal() {
  local nombre=$1 email=$2 sitio=$3 rol=$4 h clave horas
  # Una línea, sin el salto final: `<<<"$clave"` agrega uno, y el hash sería el de «clave + salto» (pasó en la primera corrida del e2e).
  IFS= read -r clave || [ -n "$clave" ] || { echo "persona_temporal: falta la clave por la entrada estándar" >&2; return 1; }
  [[ "$email" =~ ^[a-z0-9._-]+@ejemplo\.invalid$ ]] || { echo "persona_temporal: solo correos @ejemplo.invalid ($email)" >&2; return 1; }
  [[ "$rol" =~ ^(administrador|consulta)$ ]] && [[ "$sitio" =~ ^[a-z0-9-]+$ ]] && [[ "$nombre" =~ ^[[:alnum:][:space:]áéíóúñÁÉÍÓÚÑ.-]+$ ]] || { echo "persona_temporal: argumentos inválidos" >&2; return 1; }
  h=$(printf '%s' "$clave" | hash_persona) || { echo "persona_temporal: el backend no calculó el hash (¿está arriba?)" >&2; return 1; }
  horas=$(horas_clave_temporal)
  docker compose -f "$PLAT/docker-compose.yml" exec -T timescaledb psql -X -U plataforma -d plataforma -v ON_ERROR_STOP=1 -tA -q <<SQL
WITH u AS (
  INSERT INTO usuario (nombre, email, hash_password, clave_temporal, clave_temporal_vence_en)
  VALUES ('$nombre', '$email', '$h', true, now() + make_interval(hours => $horas))
  ON CONFLICT (email) DO UPDATE SET hash_password = EXCLUDED.hash_password, clave_temporal = true,
    clave_temporal_vence_en = EXCLUDED.clave_temporal_vence_en, activo = true
  RETURNING id),
s AS (INSERT INTO usuario_sitio (usuario_id, sitio_id, rol) SELECT u.id, sitio.id, '$rol' FROM u, sitio WHERE sitio.codigo = '$sitio'
  ON CONFLICT (usuario_id, sitio_id) DO UPDATE SET rol = EXCLUDED.rol, activo = true RETURNING usuario_id),
c AS (UPDATE sesion SET revocada_en = now() WHERE usuario_id IN (SELECT id FROM u) AND revocada_en IS NULL)
SELECT id FROM u WHERE EXISTS (SELECT 1 FROM s);
SQL
}
