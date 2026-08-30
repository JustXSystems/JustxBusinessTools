-- Admin platform: profiles lifecycle, tool catalog, users, subscriptions, payments, gateways, themes

CREATE TABLE IF NOT EXISTS approval_requests (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  entity_type VARCHAR(48) NOT NULL,
  entity_id VARCHAR(64) NOT NULL,
  action VARCHAR(32) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  requested_by INT UNSIGNED NULL,
  reviewed_by INT UNSIGNED NULL,
  note VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  reviewed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  KEY idx_approval_org_status (organization_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS business_profile_meta (
  business_profile_id INT UNSIGNED NOT NULL,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'approved',
  requested_by INT UNSIGNED NULL,
  reviewed_by INT UNSIGNED NULL,
  review_note VARCHAR(255) NULL,
  archived_at TIMESTAMP NULL,
  PRIMARY KEY (business_profile_id),
  CONSTRAINT fk_bpm_profile FOREIGN KEY (business_profile_id) REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tool_catalog (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  group_name VARCHAR(80) NOT NULL DEFAULT 'General',
  sort_order INT NOT NULL DEFAULT 0,
  available TINYINT(1) NOT NULL DEFAULT 1,
  formula TEXT NULL,
  field_overrides JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_tool_catalog_org_tool (organization_id, tool_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_tool_access (
  user_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  granted TINYINT(1) NOT NULL DEFAULT 1,
  PRIMARY KEY (user_id, tool_id),
  CONSTRAINT fk_uta_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS user_verifications (
  user_id INT UNSIGNED NOT NULL,
  email_verified TINYINT(1) NOT NULL DEFAULT 0,
  phone_verified TINYINT(1) NOT NULL DEFAULT 0,
  kyc_status VARCHAR(20) NOT NULL DEFAULT 'unverified',
  verified_by INT UNSIGNED NULL,
  verified_at TIMESTAMP NULL,
  PRIMARY KEY (user_id),
  CONSTRAINT fk_uv_user FOREIGN KEY (user_id) REFERENCES users (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_plans (
  id VARCHAR(40) NOT NULL,
  organization_id INT UNSIGNED NULL,
  name VARCHAR(80) NOT NULL,
  tagline VARCHAR(160) NULL,
  description TEXT NULL,
  price_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'month',
  record_limit INT NULL,
  access_mode VARCHAR(20) NOT NULL DEFAULT 'limited',
  features JSON NULL,
  available TINYINT(1) NOT NULL DEFAULT 1,
  highlighted TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscription_notices (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  kind VARCHAR(32) NOT NULL,
  channel VARCHAR(20) NOT NULL DEFAULT 'in_app',
  title VARCHAR(160) NOT NULL,
  body TEXT NOT NULL,
  due_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_sub_notice_org (organization_id, due_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_ops (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  kind VARCHAR(24) NOT NULL,
  party VARCHAR(160) NOT NULL,
  amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(24) NOT NULL DEFAULT 'pending',
  approval_status VARCHAR(20) NOT NULL DEFAULT 'pending',
  due_date DATE NULL,
  reference VARCHAR(80) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_payment_ops_org (organization_id, status, approval_status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS payment_gateways (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  provider VARCHAR(40) NOT NULL,
  display_name VARCHAR(80) NOT NULL,
  mode VARCHAR(12) NOT NULL DEFAULT 'test',
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  mapped_plan_ids JSON NULL,
  config JSON NULL,
  last_health VARCHAR(20) NULL,
  last_health_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gw_org (organization_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS gateway_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  gateway_id BIGINT UNSIGNED NOT NULL,
  event_type VARCHAR(48) NOT NULL,
  message VARCHAR(255) NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_gw_events (gateway_id, created_at),
  CONSTRAINT fk_gw_events_gw FOREIGN KEY (gateway_id) REFERENCES payment_gateways (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_themes (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  name VARCHAR(80) NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 0,
  tokens JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_theme_org (organization_id, is_active)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subscription_plans (id, name, tagline, description, price_inr, billing_interval, record_limit, access_mode, features, available, highlighted, sort_order)
SELECT 'free', 'Free', 'Limited use', 'Saved records per tool on the free (limited) mode.', 0, 'month', 28, 'limited',
  JSON_ARRAY('All operator tools', 'Limited saved records per tool', 'Print & PDF'), 1, 0, 1
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'free');

INSERT INTO subscription_plans (id, name, tagline, description, price_inr, billing_interval, record_limit, access_mode, features, available, highlighted, sort_order)
SELECT 'pro', 'Pro', 'Unlimited use', 'Unlimited saved records for trackers and documents.', 499, 'month', NULL, 'unlimited',
  JSON_ARRAY('Unlimited records', 'CSV / Excel export', 'Priority support'), 1, 1, 2
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM subscription_plans WHERE id = 'pro');

CREATE TABLE IF NOT EXISTS upi_payment_claims (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NULL,
  business_profile_id INT UNSIGNED NOT NULL,
  plan_id VARCHAR(40) NOT NULL,
  tool_ids JSON NULL,
  amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  payer_name VARCHAR(160) NOT NULL,
  payer_email VARCHAR(180) NOT NULL,
  payer_phone VARCHAR(20) NULL,
  payer_upi VARCHAR(80) NULL,
  utr VARCHAR(64) NOT NULL,
  paid_at DATE NULL,
  notes TEXT NULL,
  review_note TEXT NULL,
  reviewed_by INT UNSIGNED NULL,
  reviewed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_upi_claim_org (organization_id, status, created_at),
  KEY idx_upi_claim_utr (utr)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS notify_outbox (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  channel VARCHAR(20) NOT NULL,
  destination VARCHAR(180) NOT NULL,
  subject VARCHAR(200) NULL,
  body TEXT NOT NULL,
  kind VARCHAR(40) NOT NULL,
  claim_id BIGINT UNSIGNED NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'sent',
  error_message VARCHAR(255) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_notify_outbox_kind (kind, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_config (config_key, value)
SELECT 'upi_payee', JSON_OBJECT(
  'enabled', true,
  'vpa', 'justx@upi',
  'payeeName', 'JustX Systems LLP',
  'merchantCode', ''
)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'upi_payee');

CREATE TABLE IF NOT EXISTS tool_skus (
  tool_id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'General',
  price_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  billing_interval VARCHAR(20) NOT NULL DEFAULT 'month',
  included_free TINYINT(1) NOT NULL DEFAULT 0,
  available TINYINT(1) NOT NULL DEFAULT 1,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tool_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS org_tool_licenses (
  organization_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source_claim_id BIGINT UNSIGNED NULL,
  current_period_end TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, tool_id),
  KEY idx_otl_org_status (organization_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO platform_config (config_key, value)
SELECT 'upi_notify', JSON_OBJECT(
  'emailEnabled', true,
  'emailTo', 'billing@justx.local',
  'whatsappEnabled', true,
  'whatsappTo', '',
  'submitSubject', 'New UPI subscription payment to verify',
  'submitBody', 'Claim #{{id}} from {{payerName}} ({{payerEmail}} / {{payerPhone}}) paid ₹{{amount}} via UPI. UTR {{utr}}. Payer UPI: {{payerUpi}}. Org: {{orgName}}.',
  'decisionSubject', 'JustX subscription payment {{status}}',
  'decisionBody', 'Hello {{payerName}}, your JustX payment of ₹{{amount}} (UTR {{utr}}) was {{status}}. {{reviewNote}}'
)
FROM DUAL WHERE NOT EXISTS (SELECT 1 FROM platform_config WHERE config_key = 'upi_notify');
