ALTER TABLE sodfa_products
  ADD COLUMN discount_start_on DATE NULL,
  ADD COLUMN discount_end_on DATE NULL,
  ADD COLUMN discount_reason VARCHAR(120) NOT NULL DEFAULT '';
