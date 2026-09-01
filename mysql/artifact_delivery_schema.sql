-- Artifact delivery / Download Folder sync (SaaS: client-side UNC write)
-- Applied at runtime by ensureArtifactDeliverySchema(); this file is for db:setup / docs.

CREATE TABLE IF NOT EXISTS artifact_deliveries (
  id VARCHAR(64) NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  original_filename VARCHAR(255) NOT NULL,
  mime_type VARCHAR(120) NOT NULL DEFAULT 'application/octet-stream',
  byte_size INT UNSIGNED NOT NULL DEFAULT 0,
  content_hash CHAR(64) NOT NULL,
  storage_key VARCHAR(512) NOT NULL,
  sync_status VARCHAR(32) NOT NULL DEFAULT 'pending',
  delivery_channel VARCHAR(32) NULL,
  destination_path VARCHAR(1024) NULL,
  conflict_policy VARCHAR(16) NOT NULL DEFAULT 'overwrite',
  attempt_count INT UNSIGNED NOT NULL DEFAULT 0,
  last_error VARCHAR(500) NULL,
  browser_fallback_at TIMESTAMP NULL,
  synced_at TIMESTAMP NULL,
  expires_at TIMESTAMP NULL,
  meta JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_art_pending (business_profile_id, sync_status, created_at),
  KEY idx_art_org (organization_id, created_at),
  KEY idx_art_hash (business_profile_id, content_hash)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artifact_delivery_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  artifact_id VARCHAR(64) NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  event_type VARCHAR(48) NOT NULL,
  channel VARCHAR(32) NULL,
  detail JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_art_ev_art (artifact_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS artifact_sync_agents (
  id VARCHAR(64) NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  label VARCHAR(120) NULL,
  last_seen_at TIMESTAMP NULL,
  last_probe_ok TINYINT(1) NOT NULL DEFAULT 0,
  last_probe_path VARCHAR(512) NULL,
  last_probe_error VARCHAR(500) NULL,
  revoked_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_agent_token (token_hash),
  KEY idx_agent_profile (business_profile_id, revoked_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
