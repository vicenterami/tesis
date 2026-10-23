-- Reglas de identidad de las migraciones 11, 15, 16, 17, 18, 19, 20 y 21 (docs/10 §8.4 puntos 24, 47, 51, 53 y 54; §4.1), plantadas: cada caso intenta lo prohibido y espera el
-- rechazo de la base. Todo ocurre dentro de una transacción que termina en ROLLBACK: no queda nada en la base.
-- La corre el guardián (paso 1c). La carrera de dos altas simultáneas no cabe en una sola sesión: se probó a mano (docs/16 §13).
BEGIN;
-- Corre contra la base que esté arriba: si otro proceso tiene tomada una fila, se rinde en vez de colgar al guardián.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE resultado (orden int, linea text) ON COMMIT DROP;
DO $$
DECLARE s uuid; z uuid; restriccion text; f text; filas int;
BEGIN
  SELECT id INTO s FROM sitio ORDER BY id LIMIT 1;
  SELECT id INTO z FROM zona WHERE sitio_id = s ORDER BY id LIMIT 1;
  IF s IS NULL OR z IS NULL THEN
    INSERT INTO resultado VALUES (0, 'FALLA no hay un sitio con zona donde plantar los casos (¿falta la semilla?)');
    RETURN;
  END IF;
  INSERT INTO dispositivo (zona_id, id_fisico, nombre) VALUES (z, 'prueba-identidad-d', 'prueba');
  INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES (s, 'prueba-identidad-p', 'prueba', 'milesight');

  BEGIN
    INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES (s, 'prueba-identidad-d', 'x', 'milesight');
    INSERT INTO resultado VALUES (1, 'FALLA una pasarela pudo usar el identificador de un dispositivo');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES (1, 'OK    pasarela con el identificador de un dispositivo: rechazada');
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre) VALUES (z, 'prueba-identidad-p', 'x');
    INSERT INTO resultado VALUES (2, 'FALLA un dispositivo pudo usar el identificador de una pasarela');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO resultado VALUES (2, 'OK    dispositivo con el identificador de una pasarela: rechazado');
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre) VALUES (z, 'Prueba_Identidad', 'x');
    INSERT INTO resultado VALUES (3, 'FALLA se aceptó un identificador fuera de la lista blanca [a-z0-9-]');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (3, 'OK    identificador fuera de la lista blanca: rechazado');
  END;
  BEGIN
    -- Con formato milesight, para que lo rechace la regla de la pasarela y no la de vía y formato (migración 15).
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato) VALUES (z, 'prueba-identidad-l', 'x', 'lorawan', 'milesight');
    INSERT INTO resultado VALUES (4, 'FALLA se aceptó un dispositivo LoRaWAN sin pasarela');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (4, CASE WHEN restriccion = 'ck_dispositivo_via_pasarela_id' THEN 'OK    dispositivo LoRaWAN sin pasarela: rechazado'
      ELSE 'FALLA dispositivo LoRaWAN sin pasarela rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    UPDATE sitio SET codigo = 'Sitio Malo!' WHERE id = s;
    INSERT INTO resultado VALUES (5, 'FALLA se aceptó un código de sitio que no sirve como segmento de tópico');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (5, 'OK    código de sitio inválido: rechazado');
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, pasarela_id, formato)
      SELECT z, 'prueba-identidad-n', 'x', 'lorawan', id, formato FROM pasarela WHERE id_fisico = 'prueba-identidad-p';
    INSERT INTO resultado VALUES (6, 'OK    alta legítima de un nodo LoRaWAN con su pasarela: aceptada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (6, 'FALLA se rechazó un alta legítima: ' || SQLERRM);
  END;
  -- Migración 15: el formato lo declara la pasarela y el nodo lo hereda (docs/10 §8.4 punto 47).
  BEGIN
    INSERT INTO pasarela (sitio_id, id_fisico, nombre) VALUES (s, 'prueba-identidad-q', 'x');
    INSERT INTO resultado VALUES (7, 'FALLA se aceptó una pasarela sin formato declarado');
  EXCEPTION WHEN not_null_violation THEN
    INSERT INTO resultado VALUES (7, 'OK    pasarela sin formato declarado: rechazada');
  END;
  BEGIN
    INSERT INTO pasarela (sitio_id, id_fisico, nombre, formato) VALUES (s, 'prueba-identidad-q', 'x', 'senml');
    INSERT INTO resultado VALUES (8, 'FALLA se aceptó una pasarela con un formato de dispositivo directo');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (8, CASE WHEN restriccion = 'ck_pasarela_formato' THEN 'OK    pasarela con formato senml: rechazada'
      ELSE 'FALLA pasarela con formato senml rechazada por otra regla: ' || restriccion END);
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, pasarela_id, formato)
      SELECT z, 'prueba-identidad-c', 'x', 'lorawan', id, 'chirpstack' FROM pasarela WHERE id_fisico = 'prueba-identidad-p';
    INSERT INTO resultado VALUES (9, 'FALLA un nodo LoRaWAN pudo declarar un formato distinto al de su pasarela');
  EXCEPTION WHEN foreign_key_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (9, CASE WHEN restriccion = 'fk_dispositivo_pasarela_formato' THEN 'OK    nodo LoRaWAN con un formato distinto al de su pasarela: rechazado'
      ELSE 'FALLA nodo con otro formato rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, formato) VALUES (z, 'prueba-identidad-m', 'x', 'mqtt', 'milesight');
    INSERT INTO resultado VALUES (10, 'FALLA un dispositivo directo pudo declarar el formato de una pasarela');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (10, CASE WHEN restriccion = 'ck_dispositivo_via_formato' THEN 'OK    dispositivo mqtt con formato milesight: rechazado'
      ELSE 'FALLA dispositivo mqtt con formato milesight rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    UPDATE pasarela SET formato = 'chirpstack' WHERE id_fisico = 'prueba-identidad-p';
    SELECT formato INTO f FROM dispositivo WHERE id_fisico = 'prueba-identidad-n';
    INSERT INTO resultado VALUES (11, CASE WHEN f = 'chirpstack' THEN 'OK    corregir el formato de la pasarela corrige el de su nodo (cascada)'
      ELSE 'FALLA el nodo no siguió a su pasarela: quedó en ' || coalesce(f, 'nada') END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (11, 'FALLA no se pudo corregir el formato de la pasarela: ' || SQLERRM);
  END;
  -- Migración 16: una credencial tiene un titular y solo uno (un dispositivo o una pasarela).
  BEGIN
    INSERT INTO credencial (hash) VALUES ('x');
    INSERT INTO resultado VALUES (12, 'FALLA se aceptó una credencial sin titular');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (12, 'OK    credencial sin titular: rechazada');
  END;
  BEGIN
    INSERT INTO credencial (dispositivo_id, pasarela_id, hash)
      SELECT (SELECT id FROM dispositivo WHERE id_fisico = 'prueba-identidad-d'), id, 'x' FROM pasarela WHERE id_fisico = 'prueba-identidad-p';
    INSERT INTO resultado VALUES (13, 'FALLA se aceptó una credencial con dos titulares');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (13, CASE WHEN restriccion = 'ck_credencial_titular' THEN 'OK    credencial con dos titulares: rechazada'
      ELSE 'FALLA credencial con dos titulares rechazada por otra regla: ' || restriccion END);
  END;
  BEGIN
    INSERT INTO credencial (pasarela_id, hash) SELECT id, 'x' FROM pasarela WHERE id_fisico = 'prueba-identidad-p';
    INSERT INTO resultado VALUES (14, 'OK    credencial de una pasarela: aceptada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (14, 'FALLA se rechazó la credencial legítima de una pasarela: ' || SQLERRM);
  END;
  -- Migración 17: el perfil de decodificación solo en la vía lorawan y de la lista; el contador de trama cabe en 32 bits sin signo.
  BEGIN
    UPDATE dispositivo SET decodificador = 'campus-heltec-v3-v1' WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (15, 'FALLA un dispositivo directo aceptó un perfil de decodificación');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (15, CASE WHEN restriccion = 'ck_dispositivo_decodificador_via' THEN 'OK    perfil de decodificación en un dispositivo mqtt: rechazado'
      ELSE 'FALLA perfil en un dispositivo mqtt rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    UPDATE dispositivo SET decodificador = 'perfil-inexistente' WHERE id_fisico = 'prueba-identidad-n';
    INSERT INTO resultado VALUES (16, 'FALLA se aceptó un perfil que no está en la lista');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (16, CASE WHEN restriccion = 'ck_dispositivo_decodificador' THEN 'OK    perfil fuera de la lista: rechazado'
      ELSE 'FALLA perfil fuera de la lista rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    UPDATE dispositivo SET decodificador = 'campus-heltec-v3-v1' WHERE id_fisico = 'prueba-identidad-n';
    INSERT INTO resultado VALUES (17, 'OK    perfil campus-heltec-v3-v1 en un nodo lorawan: aceptado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (17, 'FALLA se rechazó un perfil legítimo en un nodo lorawan: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez, ultimo_fcnt)
      SELECT id, now(), 4294967296 FROM dispositivo WHERE id_fisico = 'prueba-identidad-n';
    INSERT INTO resultado VALUES (18, 'FALLA se aceptó un contador de trama de más de 32 bits');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (18, CASE WHEN restriccion = 'ck_estado_dispositivo_ultimo_fcnt' THEN 'OK    contador de trama 2^32: rechazado'
      ELSE 'FALLA contador 2^32 rechazado por otra regla: ' || restriccion END);
  END;
  BEGIN
    INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez, ultimo_fcnt)
      SELECT id, now(), 4294967295 FROM dispositivo WHERE id_fisico = 'prueba-identidad-n';
    INSERT INTO resultado VALUES (19, 'OK    contador de trama 2^32 - 1: aceptado');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (19, 'FALLA se rechazó el contador máximo legítimo: ' || SQLERRM);
  END;
  -- Migración 18: la calibración de un canal lleva las dos escalas o ninguna, y distintas (docs/10 §8.4 punto 51).
  BEGIN
    INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero)
      SELECT id, 'humedad_suelo', 2.65 FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (20, 'FALLA se aceptó una calibración con una sola escala');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (20, CASE WHEN restriccion = 'ck_canal_escala' THEN 'OK    calibración con una sola escala: rechazada'
      ELSE 'FALLA calibración con una sola escala rechazada por otra regla: ' || restriccion END);
  END;
  BEGIN
    INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero, escala_cien)
      SELECT id, 'humedad_suelo', 2.65, 2.65 FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (21, 'FALLA se aceptó una calibración con el 0 % igual al 100 %');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (21, CASE WHEN restriccion = 'ck_canal_escala' THEN 'OK    calibración con el 0 % igual al 100 %: rechazada'
      ELSE 'FALLA calibración degenerada rechazada por otra regla: ' || restriccion END);
  WHEN OTHERS THEN  -- p. ej. si el caso 20 dejó su fila por una regresión: el canal es único por dispositivo y magnitud
    INSERT INTO resultado VALUES (21, 'FALLA calibración degenerada: error inesperado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero, escala_cien)
      SELECT id, 'humedad_suelo', 'NaN', 1.20 FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (23, 'FALLA se aceptó una calibración con NaN');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (23, CASE WHEN restriccion = 'ck_canal_escala' THEN 'OK    calibración con NaN: rechazada'
      ELSE 'FALLA calibración con NaN rechazada por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (23, 'FALLA calibración con NaN: error inesperado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero, escala_cien)
      SELECT id, 'humedad_suelo', 2.65, '-Infinity' FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (24, 'FALLA se aceptó una calibración infinita');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (24, CASE WHEN restriccion = 'ck_canal_escala' THEN 'OK    calibración con un infinito: rechazada'
      ELSE 'FALLA calibración infinita rechazada por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (24, 'FALLA calibración infinita: error inesperado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO canal (dispositivo_id, magnitud_codigo, escala_cero, escala_cien)
      SELECT id, 'humedad_suelo', 2.65, 1.20 FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    GET DIAGNOSTICS filas = ROW_COUNT;  -- un INSERT … SELECT sin filas no da error: se exige que haya insertado una
    INSERT INTO resultado VALUES (22, CASE WHEN filas = 1 THEN 'OK    calibración del suelo (0 % al aire 2,65 V, 100 % en agua 1,20 V): aceptada'
      ELSE 'FALLA la calibración legítima no insertó ninguna fila' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (22, 'FALLA se rechazó una calibración legítima: ' || SQLERRM);
  END;
  -- Migración 19 (tope por emisor): el motivo «tope» y la condición «tope_superado» entran; un motivo ajeno y unos contadores sin ventana, no.
  BEGIN
    INSERT INTO cuarentena (origen, topico, motivo, payload_crudo, recibido_en)
      VALUES ('http', '/recepcion/prueba-identidad-d', 'tope', '\x00'::bytea, now());
    INSERT INTO resultado VALUES (25, 'OK    cuarentena con motivo tope (migración 19): aceptada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (25, 'FALLA se rechazó el motivo tope: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO cuarentena (origen, topico, motivo, payload_crudo, recibido_en)
      VALUES ('http', '/recepcion/prueba-identidad-d', 'otro', '\x00'::bytea, now());
    INSERT INTO resultado VALUES (26, 'FALLA se aceptó un motivo fuera del dominio de cuarentena');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (26, CASE WHEN restriccion = 'ck_cuarentena_motivo' THEN 'OK    motivo fuera del dominio de cuarentena: rechazado'
      ELSE 'FALLA motivo rechazado por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (26, 'FALLA motivo fuera del dominio: error inesperado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO condicion (dispositivo_id, tipo) SELECT id, 'tope_superado' FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    GET DIAGNOSTICS filas = ROW_COUNT;
    INSERT INTO resultado VALUES (27, CASE WHEN filas = 1 THEN 'OK    condición tope_superado (migración 19): aceptada'
      ELSE 'FALLA la condición tope_superado no insertó ninguna fila' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (27, 'FALLA se rechazó la condición tope_superado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO estado_dispositivo (dispositivo_id, visto_por_ultima_vez, ventana_lecturas)
      SELECT id, now(), 5 FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (28, 'FALLA se aceptaron contadores de la ventana sin inicio de ventana');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (28, CASE WHEN restriccion = 'ck_estado_dispositivo_ventana' THEN 'OK    contadores de la ventana sin inicio: rechazados'
      ELSE 'FALLA contadores rechazados por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (28, 'FALLA contadores sin ventana: error inesperado: ' || SQLERRM);
  END;
  -- Migración 20 (desvío del reloj de la pasarela): la condición «reloj_desviado» entra; un tipo ajeno, no.
  BEGIN
    INSERT INTO condicion (dispositivo_id, tipo) SELECT id, 'reloj_desviado' FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    GET DIAGNOSTICS filas = ROW_COUNT;
    INSERT INTO resultado VALUES (29, CASE WHEN filas = 1 THEN 'OK    condición reloj_desviado (migración 20): aceptada'
      ELSE 'FALLA la condición reloj_desviado no insertó ninguna fila' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (29, 'FALLA se rechazó la condición reloj_desviado: ' || SQLERRM);
  END;
  BEGIN
    INSERT INTO condicion (dispositivo_id, tipo) SELECT id, 'otra' FROM dispositivo WHERE id_fisico = 'prueba-identidad-d';
    INSERT INTO resultado VALUES (30, 'FALLA se aceptó un tipo fuera del dominio de condición');
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (30, CASE WHEN restriccion = 'ck_condicion_tipo' THEN 'OK    tipo fuera del dominio de condición: rechazado'
      ELSE 'FALLA tipo rechazado por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (30, 'FALLA tipo fuera del dominio: error inesperado: ' || SQLERRM);
  END;
  -- Migración 21 (calibración por API, docs/10 §8.4 punto 51): el disparador pone actualizado_en en cada UPDATE, aunque el UPDATE traiga
  -- otro valor (dentro de esta transacción now() no cambia: por eso se planta un valor viejo y se exige que el disparador lo reemplace);
  -- y el CHECK de la 18 también rechaza un UPDATE que deje una sola escala. Usan el canal de suelo del caso 22.
  BEGIN
    UPDATE canal SET escala_cero = 2.205, escala_cien = 1.170, actualizado_en = '2000-01-01T00:00:00Z'
      WHERE magnitud_codigo = 'humedad_suelo' AND dispositivo_id = (SELECT id FROM dispositivo WHERE id_fisico = 'prueba-identidad-d');
    GET DIAGNOSTICS filas = ROW_COUNT;
    SELECT CASE WHEN c.actualizado_en = now() THEN 'si' ELSE 'no' END INTO f FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
     WHERE d.id_fisico = 'prueba-identidad-d' AND c.magnitud_codigo = 'humedad_suelo';
    INSERT INTO resultado VALUES (31, CASE WHEN filas = 1 AND f = 'si' THEN 'OK    el disparador pone actualizado_en en now() en cada UPDATE del canal (migración 21)'
      WHEN filas <> 1 THEN 'FALLA el UPDATE del canal no tocó ninguna fila (¿falló el caso 22?)'
      ELSE 'FALLA actualizado_en conservó el valor que traía el UPDATE: falta el disparador' END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (31, 'FALLA UPDATE de la calibración: error inesperado: ' || SQLERRM);
  END;
  BEGIN
    UPDATE canal SET escala_cien = NULL
      WHERE magnitud_codigo = 'humedad_suelo' AND dispositivo_id = (SELECT id FROM dispositivo WHERE id_fisico = 'prueba-identidad-d');
    GET DIAGNOSTICS filas = ROW_COUNT;
    INSERT INTO resultado VALUES (32, CASE WHEN filas = 1 THEN 'FALLA un UPDATE dejó la calibración con una sola escala'
      ELSE 'FALLA el UPDATE de una sola escala no tocó ninguna fila (¿falló el caso 22?)' END);
  EXCEPTION WHEN check_violation THEN
    GET STACKED DIAGNOSTICS restriccion = CONSTRAINT_NAME;
    INSERT INTO resultado VALUES (32, CASE WHEN restriccion = 'ck_canal_escala' THEN 'OK    un UPDATE que deja una sola escala: rechazado'
      ELSE 'FALLA UPDATE de una sola escala rechazado por otra regla: ' || restriccion END);
  WHEN OTHERS THEN
    INSERT INTO resultado VALUES (32, 'FALLA UPDATE de una sola escala: error inesperado: ' || SQLERRM);
  END;
END $$;
SELECT linea FROM resultado ORDER BY orden;
ROLLBACK;
-- Lo que este archivo promete («no queda nada en la base») se comprueba, no se supone: si alguien cambiara el ROLLBACK por
-- un COMMIT, aquí sale FALLA.
SELECT CASE WHEN (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE 'prueba-identidad-%')
               + (SELECT count(*) FROM pasarela WHERE id_fisico LIKE 'prueba-identidad-%') = 0
            THEN 'OK    no quedó nada de la prueba en la base'
            ELSE 'FALLA quedaron filas de la prueba en la base (¿COMMIT en vez de ROLLBACK?)' END;
