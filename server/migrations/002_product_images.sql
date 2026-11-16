CREATE TABLE IF NOT EXISTS sodfa_product_images (
  id CHAR(36) NOT NULL PRIMARY KEY,
  product_id CHAR(36) NOT NULL,
  image_url VARCHAR(512) NOT NULL,
  image_alt VARCHAR(200) NOT NULL DEFAULT '',
  color_label VARCHAR(80) NOT NULL DEFAULT '',
  sort_order INT UNSIGNED NOT NULL DEFAULT 0,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sodfa_product_images_product_sort (product_id, sort_order, created_at),
  CONSTRAINT fk_sodfa_product_images_product FOREIGN KEY (product_id)
    REFERENCES sodfa_products(id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
