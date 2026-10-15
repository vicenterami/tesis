-- Reglas de identidad de las migraciones 11, 15 y 16 (docs/10 §8.4 puntos 24 y 47), plantadas: cada caso intenta lo prohibido y espera el
-- rechazo de la base. Todo ocurre dentro de una transacción que termina en ROLLBACK: no queda nada en la base.
-- La corre el guardián (paso 1c). La carrera de dos altas simultáneas no cabe en una sola sesión: se probó a mano (docs/16 §13).
BEGIN;
-- Corre contra la base que esté arriba: si otro proceso tiene tomada una fila, se rinde en vez de colgar al guardián.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE resultado (orden int, linea text) ON COMMIT DROP;
DO $$
DECLARE s uuid; z uuid; restriccion text; f text;
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
END $$;
SELECT linea FROM resultado ORDER BY orden;
ROLLBACK;
-- Lo que este archivo promete («no queda nada en la base») se comprueba, no se supone: si alguien cambiara el ROLLBACK por
-- un COMMIT, aquí sale FALLA.
SELECT CASE WHEN (SELECT count(*) FROM dispositivo WHERE id_fisico LIKE 'prueba-identidad-%')
               + (SELECT count(*) FROM pasarela WHERE id_fisico LIKE 'prueba-identidad-%') = 0
            THEN 'OK    no quedó nada de la prueba en la base'
            ELSE 'FALLA quedaron filas de la prueba en la base (¿COMMIT en vez de ROLLBACK?)' END;
