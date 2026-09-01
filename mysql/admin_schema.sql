-- JBT Admin: organizations, auth, audit, analytics, payments (Phases P1–P6)

-- Extend business profiles for multi-GST branches (idempotent; home_tool_ids lives in jbt_schema.sql)
SET @db := DATABASE();

SET @q := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'business_profiles' AND COLUMN_NAME = 'organization_id') = 0,
    'ALTER TABLE business_profiles ADD COLUMN organization_id INT UNSIGNED NULL AFTER id',
    'SELECT 1'
  )
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @q := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'business_profiles' AND COLUMN_NAME = 'is_default') = 0,
    'ALTER TABLE business_profiles ADD COLUMN is_default TINYINT(1) NOT NULL DEFAULT 0',
    'SELECT 1'
  )
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

SET @q := (
  SELECT IF(
    (SELECT COUNT(*) FROM information_schema.COLUMNS
     WHERE TABLE_SCHEMA = @db AND TABLE_NAME = 'business_profiles' AND COLUMN_NAME = 'config_version') = 0,
    'ALTER TABLE business_profiles ADD COLUMN config_version INT UNSIGNED NOT NULL DEFAULT 1',
    'SELECT 1'
  )
);
PREPARE stmt FROM @q; EXECUTE stmt; DEALLOCATE PREPARE stmt;

CREATE TABLE IF NOT EXISTS organizations (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(200) NOT NULL,
  owner_user_id INT UNSIGNED NULL,
  plan_id VARCHAR(20) NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS users (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  email VARCHAR(180) NOT NULL,
  password_hash VARCHAR(255) NULL,
  name VARCHAR(120) NULL,
  phone VARCHAR(20) NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  is_platform_admin TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_users_email (email)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_members (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  role VARCHAR(20) NOT NULL DEFAULT 'staff',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_org_member (organization_id, user_id),
  CONSTRAINT fk_org_members_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE,
  CONSTRAINT fk_org_members_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS branch_access (
  user_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  PRIMARY KEY (user_id, business_profile_id),
  CONSTRAINT fk_branch_access_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE,
  CONSTRAINT fk_branch_access_profile FOREIGN KEY (business_profile_id) REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sessions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  user_id INT UNSIGNED NOT NULL,
  token_hash CHAR(64) NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  expires_at TIMESTAMP NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_sessions_token (token_hash),
  KEY idx_sessions_user (user_id),
  CONSTRAINT fk_sessions_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS audit_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NULL,
  business_profile_id INT UNSIGNED NULL,
  user_id INT UNSIGNED NULL,
  action VARCHAR(64) NOT NULL,
  entity_type VARCHAR(64) NULL,
  entity_id VARCHAR(64) NULL,
  diff JSON NULL,
  ip VARCHAR(45) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_audit_org (organization_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS platform_config (
  config_key VARCHAR(64) NOT NULL,
  value JSON NOT NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (config_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_config (config_key, value)
SELECT 'powered_by', JSON_OBJECT('text', 'Powered by JustX Systems LLP', 'locked', true)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'powered_by');

INSERT INTO platform_config (config_key, value)
SELECT 'branding', JSON_OBJECT(
  'logoUrl', '/icons/jbt-icon.svg',
  'appName', 'JustX Business Tools',
  'tagline', 'JustX Systems',
  'splashDurationMs', 1800
)
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'branding');

-- Analytics (P2)
CREATE TABLE IF NOT EXISTS usage_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  session_id VARCHAR(64) NULL,
  event_type VARCHAR(48) NOT NULL,
  tool_id VARCHAR(40) NULL,
  properties JSON NULL,
  device VARCHAR(32) NULL,
  app_version VARCHAR(16) NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_usage_events_profile_time (business_profile_id, occurred_at),
  KEY idx_usage_events_tool (tool_id, occurred_at),
  KEY idx_usage_events_type (event_type, occurred_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS usage_daily_rollups (
  date DATE NOT NULL,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(40) NOT NULL,
  opens INT UNSIGNED NOT NULL DEFAULT 0,
  creates INT UNSIGNED NOT NULL DEFAULT 0,
  updates INT UNSIGNED NOT NULL DEFAULT 0,
  deletes INT UNSIGNED NOT NULL DEFAULT 0,
  exports INT UNSIGNED NOT NULL DEFAULT 0,
  prints INT UNSIGNED NOT NULL DEFAULT 0,
  calc_runs INT UNSIGNED NOT NULL DEFAULT 0,
  limit_blocks INT UNSIGNED NOT NULL DEFAULT 0,
  upgrade_clicks INT UNSIGNED NOT NULL DEFAULT 0,
  unique_users INT UNSIGNED NOT NULL DEFAULT 0,
  PRIMARY KEY (business_profile_id, tool_id, date),
  KEY idx_rollups_org_date (organization_id, date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS analytics_insights (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NULL,
  insight_type VARCHAR(48) NOT NULL,
  title VARCHAR(200) NOT NULL,
  body TEXT NOT NULL,
  action_label VARCHAR(80) NULL,
  action_href VARCHAR(255) NULL,
  dismissed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_insights_org (organization_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- SaaS payments (P3)
CREATE TABLE IF NOT EXISTS org_subscriptions (
  organization_id INT UNSIGNED NOT NULL,
  plan_id VARCHAR(20) NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP NULL,
  current_period_end TIMESTAMP NULL,
  payment_provider VARCHAR(40) NULL,
  external_subscription_id VARCHAR(128) NULL,
  external_customer_id VARCHAR(128) NULL,
  mrr_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id),
  CONSTRAINT fk_org_subscriptions_org FOREIGN KEY (organization_id) REFERENCES organizations (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_transactions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  external_id VARCHAR(128) NULL,
  type VARCHAR(32) NOT NULL,
  status VARCHAR(32) NOT NULL,
  amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  currency CHAR(3) NOT NULL DEFAULT 'INR',
  error_code VARCHAR(64) NULL,
  error_message VARCHAR(255) NULL,
  metadata JSON NULL,
  occurred_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pay_txn_org (organization_id, occurred_at),
  KEY idx_pay_txn_status (status, occurred_at),
  UNIQUE KEY uq_pay_txn_provider_ext_st (provider, external_id, type, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS billing_invoices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  invoice_no VARCHAR(48) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  period_start DATE NULL,
  period_end DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_billing_invoice_no (invoice_no),
  KEY idx_billing_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Tool definitions / schema designer (P6)
CREATE TABLE IF NOT EXISTS tool_definitions (
  id VARCHAR(64) NOT NULL,
  organization_id INT UNSIGNED NULL,
  tool_type VARCHAR(20) NOT NULL,
  definition JSON NOT NULL,
  is_platform TINYINT(1) NOT NULL DEFAULT 0,
  published_version INT UNSIGNED NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tool_def_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS config_revisions (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  business_profile_id INT UNSIGNED NULL,
  scope VARCHAR(48) NOT NULL,
  version INT UNSIGNED NOT NULL,
  payload JSON NOT NULL,
  published_by INT UNSIGNED NULL,
  published_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_config_rev (organization_id, business_profile_id, scope, version)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seed default org linking profile 1 (password: admin123 — change in production)
INSERT INTO organizations (id, name, plan_id, status)
SELECT 1, 'Default Organization', 'free', 'active'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM organizations WHERE id = 1);

UPDATE business_profiles SET organization_id = 1, is_default = 1 WHERE id = 1 AND organization_id IS NULL;

INSERT INTO org_subscriptions (organization_id, plan_id, status)
SELECT 1, 'free', 'active' FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM org_subscriptions WHERE organization_id = 1);

-- Default admin: admin@justx.local / admin123 (change after first login)
INSERT INTO users (email, password_hash, name, status)
SELECT 'admin@justx.local', '$2b$10$RWGK5IAKuU9wpd.uOF7iae6H6ryA9Ag.TnzzzniZzhSjnwMZfVPpW', 'JBT Admin', 'active'
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM users WHERE email = 'admin@justx.local');

INSERT INTO org_members (organization_id, user_id, role)
SELECT 1, u.id, 'owner' FROM users u WHERE u.email = 'admin@justx.local'
AND NOT EXISTS (SELECT 1 FROM org_members WHERE organization_id = 1 AND user_id = u.id);

UPDATE organizations o SET owner_user_id = (SELECT id FROM users WHERE email = 'admin@justx.local' LIMIT 1)
WHERE o.id = 1 AND o.owner_user_id IS NULL;
