-- 07 · Dominio cerrado para cuarentena.motivo (regla de docs/08 §6: si el CÓDIGO interpreta los
-- valores, van con CHECK, como dispositivo.estado y condicion.tipo). Hasta hoy la columna solo tenía
-- un comentario con los tres valores; el pipeline escribe exactamente estos y el panel filtrará por
-- ellos. Si aparece un motivo nuevo, se agrega aquí con migración, no se inventa desde el código.
-- Volver a correr esta migración sobre una base más nueva no debe estrechar la regla, duplicarla ni pisar su comentario
-- (docs/08 §6): la redefine la 09, que es la vigente. Aquí solo se crea si no existe con ninguno de sus dos nombres (el de
-- la convención y el que tuvo hasta la migración 12).
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conrelid = 'cuarentena'::regclass
                  AND conname IN ('ck_cuarentena_motivo', 'cuarentena_motivo_chk')) THEN
    ALTER TABLE cuarentena ADD CONSTRAINT ck_cuarentena_motivo
      CHECK (motivo IN ('desconocido', 'malformada', 'invalida'));
    COMMENT ON COLUMN cuarentena.motivo IS
      'Por qué se rechazó: desconocido (filtro 1), malformada (tópico fuera del patrón o filtro 2), invalida (filtro 3).';
  END IF;
END $$;
