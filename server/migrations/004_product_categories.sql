CREATE TABLE IF NOT EXISTS sodfa_categories (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(80) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  UNIQUE KEY uq_sodfa_categories_name (name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE sodfa_products
  ADD COLUMN category_id CHAR(36) NULL,
  ADD KEY idx_sodfa_products_category (category_id),
  ADD CONSTRAINT fk_sodfa_products_category FOREIGN KEY (category_id)
    REFERENCES sodfa_categories(id) ON DELETE RESTRICT;
