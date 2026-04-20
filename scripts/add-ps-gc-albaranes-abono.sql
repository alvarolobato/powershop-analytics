-- One-time patch for mirrors created before ps_gc_albaranes.abono existed.
-- Safe to run multiple times.
ALTER TABLE ps_gc_albaranes ADD COLUMN IF NOT EXISTS abono BOOLEAN;
