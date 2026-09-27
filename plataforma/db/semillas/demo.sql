-- Semilla de demostración (docs/15 §0). Idempotente: se puede correr las veces que haga falta.
-- Reemplaza los INSERT a mano del README del backend con un solo paso verificable.
--
-- RESULTADO ESPERADO al terminar (lo comprueba plataforma/pruebas/semilla-demo.sh):
--   sitio        1 fila  'Campus Dr. Luis Rivas del Canto'
--   zona         1 fila  'Laboratorio' en ese sitio
--   dispositivo  1 fila  id_fisico 'dev-0001', estado 'activo', intervalo_esperado_s = 5
--   canal        1 fila  dev-0001 × 'temperatura'
--   regla_umbral 1 fila  sobre ese canal: umbral_alto 30, histeresis 2
-- Y en la API: GET /dispositivos lista a dev-0001 con su canal de temperatura.
-- Con eso, el guion de docs/15 sale como está escrito: 22.4 se guarda; 35 abre la condición de umbral;
-- 29 no la toca (histéresis); 27 la cierra; callar más de 10 s abre sin_comunicacion.
--
-- Lo que esta semilla NO hace: la credencial MQTT de dev-0001 vive en el passwd del broker (no
-- versionado); si no existe, crearla con mosquitto_passwd (README del backend).

INSERT INTO sitio (id, nombre)
  VALUES ('00000000-0000-0000-0000-000000000001', 'Campus Dr. Luis Rivas del Canto')
  ON CONFLICT DO NOTHING;

INSERT INTO zona (id, sitio_id, nombre)
  VALUES ('00000000-0000-0000-0000-000000000002', '00000000-0000-0000-0000-000000000001', 'Laboratorio')
  ON CONFLICT DO NOTHING;

INSERT INTO dispositivo (zona_id, id_fisico, nombre)
  SELECT '00000000-0000-0000-0000-000000000002', 'dev-0001', 'Nodo de prueba 1'
  WHERE NOT EXISTS (SELECT 1 FROM dispositivo WHERE id_fisico = 'dev-0001');

-- Intervalo corto a propósito: permite provocar «sin comunicación» en la demostración sin esperar.
UPDATE dispositivo SET intervalo_esperado_s = 5 WHERE id_fisico = 'dev-0001';

INSERT INTO canal (dispositivo_id, magnitud_codigo)
  SELECT d.id, 'temperatura' FROM dispositivo d
  WHERE d.id_fisico = 'dev-0001'
    AND NOT EXISTS (SELECT 1 FROM canal c WHERE c.dispositivo_id = d.id AND c.magnitud_codigo = 'temperatura');

INSERT INTO regla_umbral (canal_id, umbral_alto, histeresis)
  SELECT c.id, 30, 2 FROM canal c JOIN dispositivo d ON d.id = c.dispositivo_id
  WHERE d.id_fisico = 'dev-0001' AND c.magnitud_codigo = 'temperatura'
    AND NOT EXISTS (SELECT 1 FROM regla_umbral r WHERE r.canal_id = c.id);
