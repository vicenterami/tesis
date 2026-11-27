# Enganche de la plataforma propia para corrida.sh (docs/23 §4.1). Funciones p_*; lo demás es igual para todas.
P_DISCO=propia-instalada
P_ADAPTADOR=propia
P_RED_A=83; P_RED_B=84                      # 8883 (MQTT sobre TLS por el proxy) por la red A y la B
P_DIR='~/plataforma'
P_INST="$INST/propia"
p_arrancar() { en "sudo systemctl start docker.socket docker.service && cd $P_DIR && docker compose up -d >/dev/null 2>&1; echo compose-up-salio-\$?"; }
p_sql() { en "cd $P_DIR && docker compose exec -T timescaledb psql -X -U plataforma -d plataforma -At -F, -c \"$1\"" 2>/dev/null; }
# p_guardados DESDE_MS HASTA_MS PATRON → id,magnitud,ts_ms (una fila por punto guardado, con repetidos si los hubiera)
p_guardados() {
  p_sql "SELECT d.id_fisico, c.magnitud_codigo, round(extract(epoch FROM m.tiempo)*1000)::bigint FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico LIKE '$3' AND m.tiempo >= to_timestamp($1/1000.0) AND m.tiempo < to_timestamp($2/1000.0)"
}
p_conteo() { p_sql "SELECT count(*) FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico LIKE 'tt40-%' AND m.tiempo >= to_timestamp($1/1000.0)"; }
p_plantar_borrar() { p_sql "WITH x AS (SELECT m.canal_id, m.tiempo FROM medicion m JOIN canal c ON c.id=m.canal_id JOIN dispositivo d ON d.id=c.dispositivo_id WHERE d.id_fisico LIKE 'tt40-d%' AND m.tiempo >= to_timestamp($1/1000.0) AND m.tiempo < to_timestamp($2/1000.0) ORDER BY m.tiempo LIMIT 1) DELETE FROM medicion m USING x WHERE m.canal_id=x.canal_id AND m.tiempo=x.tiempo RETURNING 1"; }
p_extra() { # lo que explica una pérdida en esta plataforma: tramas en cuarentena del banco, por motivo
  p_sql "SELECT 'cuarentena_' || motivo, count(*) FROM cuarentena q LEFT JOIN dispositivo d ON d.id=q.dispositivo_id WHERE (d.id_fisico LIKE 'tt40-%' OR q.dispositivo_id IS NULL) GROUP BY motivo"
}
# Un inicio de sesión y una consulta de historial (S2), como una persona en el panel: código HTTP y milisegundos de cada uno.
p_sesion_historial() {
  local ph; ph=$(puerto 43); local c=(curl -sS -m 60 --resolve "localhost:$ph:127.0.0.1" --cacert "$P_INST/ca.crt" -o /dev/null)
  local j; j=$(mktemp); local id; id=$(p_sql "SELECT id FROM dispositivo WHERE id_fisico='tt40-d001'")
  local a b
  a=$("${c[@]}" -w '%{http_code},%{time_total}' -c "$j" -H 'X-Pedido: panel' -H 'Content-Type: application/json' --data-binary @"$P_INST/persona.json" "https://localhost:$ph/sesion")
  b=$("${c[@]}" -w '%{http_code},%{time_total}' -b "$j" "https://localhost:$ph/dispositivos/$id/historico")
  "${c[@]}" -X DELETE -b "$j" -H 'X-Pedido: panel' "https://localhost:$ph/sesion" 2>/dev/null; rm -f "$j"
  echo "sesion,$a"; echo "historial,$b"
}
p_servicios() { en "cd $P_DIR && docker compose ps -a --format '{{.Name}}'"; }
