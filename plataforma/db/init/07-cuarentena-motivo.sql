-- 07 · Dominio cerrado para cuarentena.motivo (regla de docs/08 §6: si el CÓDIGO interpreta los
-- valores, van con CHECK, como dispositivo.estado y condicion.tipo). Hasta hoy la columna solo tenía
-- un comentario con los tres valores; el pipeline escribe exactamente estos y el panel filtrará por
-- ellos. Si aparece un motivo nuevo, se agrega aquí con migración, no se inventa desde el código.
ALTER TABLE cuarentena DROP CONSTRAINT IF EXISTS cuarentena_motivo_chk;
ALTER TABLE cuarentena ADD CONSTRAINT cuarentena_motivo_chk
  CHECK (motivo IN ('desconocido', 'malformada', 'invalida'));
COMMENT ON COLUMN cuarentena.motivo IS
  'Por qué se rechazó: desconocido (filtro 1), malformada (tópico fuera del patrón o filtro 2), invalida (filtro 3).';
