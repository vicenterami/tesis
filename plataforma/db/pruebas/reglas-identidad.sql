-- Reglas de identidad de la migración 11 (docs/10 §8.4 punto 24), plantadas: cada caso intenta lo prohibido y espera el
-- rechazo de la base. Todo ocurre dentro de una transacción que termina en ROLLBACK: no queda nada en la base.
-- La corre el guardián (paso 1c). La carrera de dos altas simultáneas no cabe en una sola sesión: se probó a mano (docs/16 §13).
BEGIN;
-- Corre contra la base que esté arriba: si otro proceso tiene tomada una fila, se rinde en vez de colgar al guardián.
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE resultado (orden int, linea text) ON COMMIT DROP;
DO $$
DECLARE s uuid; z uuid;
BEGIN
  SELECT id INTO s FROM sitio ORDER BY id LIMIT 1;
  SELECT id INTO z FROM zona WHERE sitio_id = s ORDER BY id LIMIT 1;
  IF s IS NULL OR z IS NULL THEN
    INSERT INTO resultado VALUES (0, 'FALLA no hay un sitio con zona donde plantar los casos (¿falta la semilla?)');
    RETURN;
  END IF;
  INSERT INTO dispositivo (zona_id, id_fisico, nombre) VALUES (z, 'prueba-identidad-d', 'prueba');
  INSERT INTO pasarela (sitio_id, id_fisico, nombre) VALUES (s, 'prueba-identidad-p', 'prueba');

  BEGIN
    INSERT INTO pasarela (sitio_id, id_fisico, nombre) VALUES (s, 'prueba-identidad-d', 'x');
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
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via) VALUES (z, 'prueba-identidad-l', 'x', 'lorawan');
    INSERT INTO resultado VALUES (4, 'FALLA se aceptó un dispositivo LoRaWAN sin pasarela');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (4, 'OK    dispositivo LoRaWAN sin pasarela: rechazado');
  END;
  BEGIN
    UPDATE sitio SET codigo = 'Sitio Malo!' WHERE id = s;
    INSERT INTO resultado VALUES (5, 'FALLA se aceptó un código de sitio que no sirve como segmento de tópico');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (5, 'OK    código de sitio inválido: rechazado');
  END;
  BEGIN
    INSERT INTO dispositivo (zona_id, id_fisico, nombre, via, pasarela_id)
      SELECT z, 'prueba-identidad-n', 'x', 'lorawan', id FROM pasarela WHERE id_fisico = 'prueba-identidad-p';
    INSERT INTO resultado VALUES (6, 'OK    alta legítima de un nodo LoRaWAN con su pasarela: aceptada');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (6, 'FALLA se rechazó un alta legítima: ' || SQLERRM);
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
