-- Track applied versioned migrations (also created by the Node runner).
CREATE TABLE IF NOT EXISTS schema_migrations (
  id VARCHAR(128) NOT NULL,
  applied_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
