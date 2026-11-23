-- Reglas del catálogo editable (migración 27; docs/08 §8, docs/10 §8.4 punto 69), plantadas: cada caso intenta lo prohibido y espera el
-- rechazo de la base por la restricción o el permiso que lo cierra; al final, lo legítimo pasa como plataforma_app. Todo ocurre dentro de
-- una transacción que termina en ROLLBACK: no queda nada en la base. La corre el guardián (paso 1c2).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE resultado (orden int, linea text) ON COMMIT DROP;
DO $$
DECLARE
  -- {sentencia, lo que debe rechazarla (nombre de la restricción, o «permiso» para plataforma_app), qué se prueba}
  casos text[][] := ARRAY[
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES (''x1'',''x'',''V'',''NaN'',1)', 'ck_magnitud_rango', 'rango_min NaN'],
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES (''x1'',''x'',''V'',0,''NaN'')', 'ck_magnitud_rango', 'rango_max NaN'],
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES (''x1'',''x'',''V'',0,''Infinity'')', 'ck_magnitud_rango', 'rango infinito'],
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min) VALUES (''x1'',''x'',''V'',0)', 'ck_magnitud_rango', 'rango sin máximo'],
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES (''x1'',''x'',''V'',1,1)', 'ck_magnitud_rango', 'rango_min = rango_max'],
    ['INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES (''X1'',''x'',''V'',0,1)', 'ck_magnitud_codigo', 'código de magnitud con mayúscula'],
    ['UPDATE magnitud SET umbral_alto_sugerido = rango_max + 1 WHERE codigo = ''temperatura''', 'ck_magnitud_sugeridos', 'sugerido fuera del rango'],
    ['UPDATE magnitud SET umbral_alto_sugerido = rango_min + 1, umbral_bajo_sugerido = rango_min + 1 WHERE codigo = ''temperatura''', 'ck_magnitud_sugeridos', 'sugerido bajo = alto'],
    ['UPDATE magnitud SET umbral_bajo_sugerido = ''NaN'' WHERE codigo = ''temperatura''', 'ck_magnitud_sugeridos', 'sugerido NaN'],
    ['UPDATE magnitud SET histeresis_sugerida = -1 WHERE codigo = ''temperatura''', 'ck_magnitud_histeresis_sugerida', 'histéresis sugerida negativa'],
    ['UPDATE magnitud SET histeresis_sugerida = ''Infinity'' WHERE codigo = ''temperatura''', 'ck_magnitud_histeresis_sugerida', 'histéresis sugerida infinita'],
    ['INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES (''fport'', ''temperatura'')', 'ck_magnitud_alias_reservada', 'alias con una clave reservada'],
    ['INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES (''Temp'', ''temperatura'')', 'ck_magnitud_alias_clave', 'alias con mayúscula'],
    ['INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES (''temperature'', ''humedad'')', 'pk_magnitud_alias', 'una clave hacia dos magnitudes'],
    ['SELECT fn_crear_receta(''vacia-v1'', ''x'', 4, ''[]'')', 'fn_crear_receta', 'receta sin campos'],
    ['SELECT fn_crear_receta(''campus-heltec-v3-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8"}]'')', 'pk_receta_decodificacion', 'código de receta repetido'],
    ['SELECT fn_crear_receta(''larga-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":1,"tipo":"u32be"}]'')', 'ck_receta_campo_cabe', 'campo que no cabe en la trama'],
    ['SELECT fn_crear_receta(''doble-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8"},{"magnitud_codigo":"humedad","desplazamiento":1,"tipo":"u8"}]'')', 'uq_receta_campo_magnitud', 'la misma magnitud dos veces en una receta'],
    ['SELECT fn_crear_receta(''cero-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8","dividir_por":0}]'')', 'ck_receta_campo_factores', 'dividir por 0'],
    ['SELECT fn_crear_receta(''tipo-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"f32"}]'')', 'ck_receta_campo_tipo', 'tipo que no existe'],
    ['SELECT fn_crear_receta(''mag-v1'', ''x'', 4, ''[{"magnitud_codigo":"no_existe","desplazamiento":0,"tipo":"u8"}]'')', 'fk_receta_campo_magnitud', 'magnitud que no existe'],
    ['SELECT fn_crear_receta(''clave-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8","dividir_pro":100}]'')', 'fn_crear_receta', 'clave mal escrita en un campo (no se ignora)'],
    ['SELECT fn_crear_receta(''decimal-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":1.5,"tipo":"u8"}]'')', 'fn_crear_receta', 'desplazamiento decimal'],
    ['SELECT fn_crear_receta(''texto-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8","sumar_antes":"200"}]'')', 'fn_crear_receta', 'factor escrito como texto'],
    ['SELECT fn_crear_receta(''nulo-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8","dividir_por":null}]'')', 'fn_crear_receta', 'factor nulo'],
    ['SELECT fn_crear_receta(''tipo3-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":3}]'')', 'fn_crear_receta', 'tipo que no es texto'],
    ['SELECT fn_crear_receta(''arr-v1'', ''x'', 4, ''[7]'')', 'fn_crear_receta', 'campo que no es objeto'],
    ['SELECT fn_crear_receta(''enorme-v1'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8","multiplicar_por":1e30}]'')', 'fn_crear_receta', 'factor enorme (sin desbordar el entero)'],
    ['SELECT fn_crear_receta(''Mal'', ''x'', 4, ''[{"magnitud_codigo":"humedad","desplazamiento":0,"tipo":"u8"}]'')', 'ck_receta_decodificacion_codigo', 'código de receta con mayúscula'],
    ['UPDATE receta_campo SET largo_bytes = 20', 'fk_receta_campo_receta', 'un campo cambia su largo sin su receta'],
    ['DELETE FROM receta_decodificacion WHERE codigo = ''campus-heltec-v3-v1''', 'fk_receta_campo_receta|fk_dispositivo_decodificador', 'borrar una receta en uso'],
    ['INSERT INTO receta_decodificacion (codigo, nombre, largo_bytes) VALUES (''directa-v1'', ''x'', 4)', 'permiso', 'la aplicación inserta una receta sin su función'],
    ['INSERT INTO receta_campo (receta_codigo, largo_bytes, orden, magnitud_codigo, desplazamiento, tipo) VALUES (''campus-heltec-v3-v1'', 10, 4, ''bateria'', 0, ''u8'')', 'permiso', 'la aplicación le agrega un campo a una receta en uso'],
    ['UPDATE magnitud SET unidad_canonica = unidad_canonica WHERE false', 'permiso', 'la aplicación cambia la unidad canónica'],
    ['UPDATE magnitud SET codigo = codigo WHERE false', 'permiso', 'la aplicación cambia el código de una magnitud'],
    ['DELETE FROM magnitud_alias WHERE false', 'permiso', 'la aplicación borra un alias sin su función'],
    ['DELETE FROM magnitud WHERE false', 'permiso', 'la aplicación borra una magnitud'],
    ['UPDATE receta_campo SET dividir_por = dividir_por WHERE false', 'permiso', 'la aplicación edita una receta']
  ];
  i int; restriccion text; esperado text;
BEGIN
  FOR i IN 1 .. array_length(casos, 1) LOOP
    esperado := casos[i][2];
    BEGIN
      IF esperado = 'permiso' THEN SET LOCAL ROLE plataforma_app; END IF;
      EXECUTE casos[i][1];
      -- Aceptado: se aborta el bloque para deshacerlo, así un caso que pasa por error no contamina a los siguientes.
      RAISE EXCEPTION 'aceptado' USING ERRCODE = 'PX001';
    EXCEPTION WHEN SQLSTATE 'PX001' THEN
      RESET ROLE;
      INSERT INTO resultado VALUES (i, 'FALLA se aceptó: ' || casos[i][3]);
    WHEN insufficient_privilege THEN
      RESET ROLE;
      INSERT INTO resultado VALUES (i, CASE WHEN esperado = 'permiso' THEN 'OK    sin permiso: ' || casos[i][3]
                                            ELSE 'FALLA ' || casos[i][3] || ': negado por permiso, se esperaba ' || esperado END);
    WHEN OTHERS THEN
      RESET ROLE;
      GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
      -- fn_crear_receta rechaza la receta sin campos con su propio mensaje (no hay restricción que nombrar).
      IF restriccion = '' AND SQLERRM LIKE esperado || ':%' THEN restriccion := esperado; END IF;
      -- «a|b»: vale cualquiera (el orden en que PostgreSQL revisa dos claves foráneas de una misma fila no está garantizado).
      IF restriccion = ANY (string_to_array(esperado, '|')) THEN restriccion := esperado; END IF;
      INSERT INTO resultado VALUES (i, CASE WHEN restriccion = esperado THEN 'OK    rechazado por ' || esperado || ': ' || casos[i][3]
                                            ELSE 'FALLA ' || casos[i][3] || ': rechazado por otra causa (' || coalesce(nullif(restriccion, ''), SQLERRM) || ')' END);
    END;
  END LOOP;

  -- Lo legítimo pasa, como plataforma_app: crear una magnitud con su alias, quitar el alias, fijar un sugerido y crear una receta.
  BEGIN
    SET LOCAL ROLE plataforma_app;
    INSERT INTO magnitud (codigo, nombre, unidad_canonica, rango_min, rango_max) VALUES ('prueba_catalogo', 'Prueba', 'ppm', 0, 5000);
    INSERT INTO magnitud_alias (clave, magnitud_codigo) VALUES ('prueba_catalogo_ppm', 'prueba_catalogo');
    UPDATE magnitud SET rango_max = 6000, umbral_alto_sugerido = 1000, histeresis_sugerida = 50 WHERE codigo = 'prueba_catalogo';
    IF fn_quitar_alias('prueba_catalogo_ppm') <> 1 THEN RAISE EXCEPTION 'fn_quitar_alias no quitó el alias'; END IF;
    IF fn_crear_receta('prueba-catalogo-v1', 'Prueba', 4,
         '[{"magnitud_codigo":"prueba_catalogo","desplazamiento":2,"tipo":"u16le","sumar_antes":-10,"multiplicar_por":3,"dividir_por":2}]') <> 1 THEN
      RAISE EXCEPTION 'fn_crear_receta no guardó un campo';
    END IF;
    RESET ROLE;
    INSERT INTO resultado VALUES (100, 'OK    como plataforma_app: crear magnitud y alias, fijar rango y sugeridos, quitar el alias y crear una receta');
  EXCEPTION WHEN OTHERS THEN
    RESET ROLE;
    INSERT INTO resultado VALUES (100, 'FALLA lo legítimo del catálogo no pasó como plataforma_app: ' || SQLERRM);
  END;
END $$;
SELECT linea FROM resultado ORDER BY orden;
ROLLBACK;
SELECT CASE WHEN (SELECT count(*) FROM magnitud WHERE codigo = 'prueba_catalogo') + (SELECT count(*) FROM receta_decodificacion WHERE codigo LIKE 'prueba-catalogo%') = 0
            THEN 'OK    no quedó nada de la prueba del catálogo en la base'
            ELSE 'FALLA quedaron filas de la prueba del catálogo (¿COMMIT en vez de ROLLBACK?)' END;
