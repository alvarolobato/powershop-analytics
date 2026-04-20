-- One-time patch: add PVP tarifa 1 from 4D Articulos.Precio1 for mirrors created earlier.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ps_articulos'
  ) THEN
    ALTER TABLE ps_articulos ADD COLUMN IF NOT EXISTS precio1 NUMERIC(15, 2);
  END IF;
END $$;
