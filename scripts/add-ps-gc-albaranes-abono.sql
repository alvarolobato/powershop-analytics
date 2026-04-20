-- One-time patch for mirrors created before ps_gc_albaranes.abono existed.
-- Idempotent: skips quietly when the table is missing (e.g. wrong database).
DO $$
BEGIN
  IF EXISTS (
    SELECT 1
    FROM information_schema.tables
    WHERE table_schema = 'public'
      AND table_name = 'ps_gc_albaranes'
  ) THEN
    ALTER TABLE ps_gc_albaranes ADD COLUMN IF NOT EXISTS abono BOOLEAN;
  END IF;
END $$;
