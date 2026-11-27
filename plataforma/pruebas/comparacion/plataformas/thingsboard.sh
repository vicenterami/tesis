# Enganche de ThingsBoard CE para corrida.sh (docs/23 §4.2). FILA=a (su Compose, por omisión) o b (con el heap que prescribe su guía).
P_DISCO=tb${TB_VERSION:-43}-instalada
P_ADAPTADOR=thingsboard
P_RED_A=18; P_RED_B=19                      # 1883 (MQTT plano, el puerto de su Compose) por la red A y la B
P_DIR='~/tb'
P_INST="$INST/tb${TB_VERSION:-43}"
p_arrancar() {
  local f="-f docker-compose.yml"; [ "$FILA" = b ] && f="$f -f fila-b.yml"; [ "${TB_VERSION:-43}" = 44 ] && f="$f -f licencia-44.yml"
  en "sudo systemctl start docker.socket docker.service && cd $P_DIR && docker compose $f up -d >/dev/null 2>&1; echo compose-up-salio-\$?"
}
p_sql() { en "cd $P_DIR && docker compose exec -T postgres psql -X -U postgres -d thingsboard -At -F, -c \"$1\"" 2>/dev/null; }
p_guardados() {
  p_sql "SELECT d.name, CASE k.key WHEN 'temperature' THEN 'temperatura' WHEN 'humidity' THEN 'humedad' ELSE k.key END, t.ts FROM ts_kv t JOIN device d ON d.id=t.entity_id JOIN key_dictionary k ON k.key_id=t.key WHERE d.name LIKE '$3' AND t.ts >= $1 AND t.ts < $2"
}
p_conteo() { p_sql "SELECT count(*) FROM ts_kv t JOIN device d ON d.id=t.entity_id WHERE d.name LIKE 'tt40-%' AND t.ts >= $1"; }
p_plantar_borrar() { p_sql "WITH x AS (SELECT t.entity_id, t.key, t.ts FROM ts_kv t JOIN device d ON d.id=t.entity_id WHERE d.name LIKE 'tt40-d%' AND t.ts >= $1 AND t.ts < $2 ORDER BY t.ts LIMIT 1) DELETE FROM ts_kv t USING x WHERE t.entity_id=x.entity_id AND t.key=x.key AND t.ts=x.ts RETURNING 1"; }
p_extra() { :; }
p_sesion_historial() {
  local api="http://127.0.0.1:$(puerto 80)" tok id a b
  local r; r=$(mktemp)
  a=$(curl -sS -m 60 -o "$r" -w '%{http_code},%{time_total}' -H 'Content-Type: application/json' -d @"$P_INST/login.json" "$api/api/auth/login")
  tok=$(python3 -I -c 'import json,sys; print(json.load(open(sys.argv[1])).get("token",""))' "$r" 2>/dev/null); rm -f "$r"
  id=$(awk -F, '$1=="tt40-d001"{print $2}' "$P_INST/ids.csv")
  local hasta; hasta=$(date +%s%3N)
  b=$(curl -sS -m 60 -o /dev/null -w '%{http_code},%{time_total}' -H "X-Authorization: Bearer $tok" \
      "$api/api/plugins/telemetry/DEVICE/$id/values/timeseries?keys=temperature,humidity&startTs=$((hasta - 86400000))&endTs=$hasta&limit=10000")
  echo "sesion,$a"; echo "historial,$b"
}
p_servicios() { en "cd $P_DIR && docker compose ps -a --format '{{.Name}}'"; }
