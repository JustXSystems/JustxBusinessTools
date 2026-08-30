-- In-app corporate notification inbox (role-targeted, per-user read state)

CREATE TABLE IF NOT EXISTS app_notifications (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NULL,
  event_type VARCHAR(64) NOT NULL,
  category VARCHAR(32) NOT NULL,
  severity VARCHAR(16) NOT NULL DEFAULT 'info',
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  icon VARCHAR(16) NULL,
  href VARCHAR(255) NULL,
  entity_type VARCHAR(48) NULL,
  entity_id VARCHAR(64) NULL,
  actor_user_id INT UNSIGNED NULL,
  target_roles JSON NOT NULL,
  target_user_id INT UNSIGNED NULL,
  dedupe_key VARCHAR(160) NULL,
  meta JSON NULL,
  due_at DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  expires_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uq_app_notif_dedupe (organization_id, dedupe_key),
  KEY idx_app_notif_inbox (organization_id, business_profile_id, created_at),
  KEY idx_app_notif_type (event_type, created_at),
  KEY idx_app_notif_cat (category, severity, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS app_notification_reads (
  notification_id BIGINT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  read_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (notification_id, user_id),
  KEY idx_notif_reads_user (user_id, read_at),
  CONSTRAINT fk_notif_reads_notif FOREIGN KEY (notification_id)
    REFERENCES app_notifications (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
