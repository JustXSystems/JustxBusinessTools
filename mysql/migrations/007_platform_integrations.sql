-- Platform-wide optional integrations (Google OAuth, email webhook, …)
-- Managed from Admin → Integrations; .env remains fallback / bootstrap.

CREATE TABLE IF NOT EXISTS platform_integrations (
  id VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config_json JSON NULL,
  secrets_enc TEXT NULL,
  status VARCHAR(32) NOT NULL DEFAULT 'not_configured',
  status_detail VARCHAR(500) NULL,
  last_checked_at TIMESTAMP NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  updated_by INT UNSIGNED NULL,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
