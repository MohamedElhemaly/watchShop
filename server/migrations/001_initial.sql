CREATE TABLE IF NOT EXISTS sodfa_schema_migrations (
  version VARCHAR(64) NOT NULL PRIMARY KEY,
  applied_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sodfa_admin_accounts (
  open_id VARCHAR(191) NOT NULL PRIMARY KEY,
  email VARCHAR(320) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sodfa_admin_sessions (
  token_hash CHAR(64) NOT NULL PRIMARY KEY,
  open_id VARCHAR(191) NOT NULL,
  csrf_hash CHAR(64) NOT NULL,
  secure_cookie BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sodfa_sessions_owner (open_id),
  KEY idx_sodfa_sessions_expiry (expires_at),
  CONSTRAINT fk_sodfa_sessions_owner FOREIGN KEY (open_id)
    REFERENCES sodfa_admin_accounts(open_id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sodfa_oauth_states (
  state_hash CHAR(64) NOT NULL PRIMARY KEY,
  nonce_hash CHAR(64) NOT NULL,
  redirect_uri VARCHAR(512) NOT NULL,
  secure_cookie BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATETIME(3) NOT NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  KEY idx_sodfa_oauth_expiry (expires_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sodfa_store_settings (
  id TINYINT UNSIGNED NOT NULL PRIMARY KEY,
  phone_number VARCHAR(16) NOT NULL DEFAULT '',
  whatsapp_number VARCHAR(16) NOT NULL DEFAULT '',
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sodfa_products (
  id CHAR(36) NOT NULL PRIMARY KEY,
  name VARCHAR(120) NOT NULL,
  description TEXT NOT NULL,
  base_price INT UNSIGNED NOT NULL,
  discount_percent TINYINT UNSIGNED NOT NULL DEFAULT 0,
  image_url VARCHAR(512) NULL,
  image_alt VARCHAR(200) NOT NULL DEFAULT '',
  is_active BOOLEAN NOT NULL DEFAULT FALSE,
  sort_order INT NOT NULL DEFAULT 0,
  deleted_at DATETIME(3) NULL,
  created_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3),
  updated_at DATETIME(3) NOT NULL DEFAULT CURRENT_TIMESTAMP(3) ON UPDATE CURRENT_TIMESTAMP(3),
  KEY idx_sodfa_products_public (is_active, deleted_at, sort_order, created_at),
  CONSTRAINT chk_sodfa_discount_percent CHECK (discount_percent BETWEEN 0 AND 99)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
