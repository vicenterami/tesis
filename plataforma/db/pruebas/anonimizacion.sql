-- fn_anonimizar_usuario (migración 24; docs/20 §11), plantada: la función es SECURITY DEFINER y las reglas que protegen no pueden vivir
-- solo en quien la llama (corrección del 11/11/2026). Cada caso intenta lo prohibido o comprueba lo que debe borrar. Todo dentro de una
-- transacción que termina en ROLLBACK: no queda nada en la base. La corre el guardián (paso 1c).
BEGIN;
SET LOCAL lock_timeout = '2s';
SET LOCAL statement_timeout = '10s';
CREATE TEMP TABLE resultado (orden int, linea text) ON COMMIT DROP;
DO $$
DECLARE a uuid; b uuid; c uuid; n int; t text;
BEGIN
  -- Dentro de la transacción, nadie más es administrador del sistema: así «el último» es el de la prueba, sin depender de la base.
  UPDATE usuario SET administrador_sistema = false WHERE administrador_sistema;
  INSERT INTO usuario (nombre, email, hash_password, administrador_sistema) VALUES ('Prueba A', 'anon-a@prueba-anonimizar.invalid', 'x', true) RETURNING id INTO a;
  INSERT INTO usuario (nombre, email, hash_password) VALUES ('Prueba B', 'anon-b@prueba-anonimizar.invalid', 'x') RETURNING id INTO b;
  INSERT INTO acceso (email_intentado, resultado, usuario_id) VALUES ('anon-b@prueba-anonimizar.invalid', 'clave_incorrecta', b);
  INSERT INTO acceso (email_intentado, resultado) VALUES ('anon-b@prueba-anonimizar.invalid', 'clave_incorrecta');
  INSERT INTO evento (tipo, detalle, usuario_id) VALUES ('usuario_cambio', jsonb_build_object('usuario_id', b, 'activo', false, 'motivo', 'texto libre con un nombre'), a);

  BEGIN
    PERFORM fn_anonimizar_usuario(a, a);
    INSERT INTO resultado VALUES (1, 'FALLA el último administrador del sistema activo se dio de baja');
  EXCEPTION WHEN check_violation THEN
    INSERT INTO resultado VALUES (1, 'OK    el último administrador del sistema activo no se anonimiza (la función lo rechaza)');
  END;
  BEGIN
    PERFORM fn_anonimizar_usuario(b, NULL);
    INSERT INTO resultado VALUES (2, 'FALLA la función aceptó una baja sin quién la da (por nulo)');
  EXCEPTION WHEN raise_exception THEN
    INSERT INTO resultado VALUES (2, 'OK    sin quién da la baja (por nulo): rechazada');
  END;
  BEGIN
    PERFORM fn_anonimizar_usuario(b, b);
    SELECT count(*) INTO n FROM acceso WHERE email_intentado = 'anon-b@prueba-anonimizar.invalid';
    INSERT INTO resultado VALUES (3, CASE WHEN n = 0 THEN 'OK    la baja anula el correo tecleado en sus intentos de acceso (los dos)'
      ELSE 'FALLA quedaron ' || n || ' filas de acceso con el correo de antes' END);
    SELECT detalle->>'motivo' INTO t FROM evento WHERE tipo = 'usuario_cambio' AND detalle->>'usuario_id' = b::text;
    INSERT INTO resultado VALUES (4, CASE WHEN t IS NULL THEN 'OK    la baja anula el motivo (texto libre) de sus eventos usuario_cambio; el evento sigue'
      ELSE 'FALLA el evento conserva el motivo: ' || t END);
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (3, 'FALLA la baja de una persona sin perfil global falló: ' || SQLERRM);
  END;
  BEGIN
    -- Lo legítimo pasa: con otro administrador del sistema activo, el primero sí se da de baja.
    INSERT INTO usuario (nombre, email, hash_password, administrador_sistema) VALUES ('Prueba C', 'anon-c@prueba-anonimizar.invalid', 'x', true) RETURNING id INTO c;
    PERFORM fn_anonimizar_usuario(a, a);
    INSERT INTO resultado VALUES (5, 'OK    con otro administrador del sistema activo, el primero sí se da de baja');
  EXCEPTION WHEN OTHERS THEN
    INSERT INTO resultado VALUES (5, 'FALLA con otro administrador del sistema activo, la baja falló: ' || SQLERRM);
  END;
END $$;
SELECT linea FROM resultado ORDER BY orden;
ROLLBACK;
SELECT CASE WHEN (SELECT count(*) FROM usuario WHERE email LIKE '%@prueba-anonimizar.invalid') = 0
            THEN 'OK    no quedó nada de la prueba de anonimización en la base'
            ELSE 'FALLA quedaron filas de la prueba de anonimización (¿COMMIT en vez de ROLLBACK?)' END;
