-- JustX Business Tools (JBT) schema — business profile, sequences, tool records

CREATE TABLE IF NOT EXISTS business_profiles (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  logo_data_url LONGTEXT NULL,
  business_name VARCHAR(200) NOT NULL DEFAULT '',
  address_line1 VARCHAR(255) NULL,
  address_line2 VARCHAR(255) NULL,
  gstin VARCHAR(20) NULL,
  pan VARCHAR(12) NULL,
  state VARCHAR(80) NULL,
  state_code VARCHAR(4) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  bank_name VARCHAR(120) NULL,
  bank_branch VARCHAR(120) NULL,
  bank_account VARCHAR(40) NULL,
  bank_ifsc VARCHAR(16) NULL,
  bank_upi VARCHAR(80) NULL,
  terms TEXT NULL,
  home_tool_ids JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_business_profiles_gstin (gstin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO business_profiles (id, business_name)
SELECT 1, ''
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM business_profiles WHERE id = 1);

CREATE TABLE IF NOT EXISTS document_sequences (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_profile_id INT UNSIGNED NOT NULL DEFAULT 1,
  tool_id VARCHAR(40) NOT NULL,
  year SMALLINT NOT NULL,
  month TINYINT NOT NULL,
  last_seq INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_doc_seq (business_profile_id, tool_id, year, month),
  KEY idx_doc_seq_tool (tool_id),
  CONSTRAINT fk_doc_seq_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tool_records (
  id VARCHAR(64) NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL DEFAULT 1,
  tool_id VARCHAR(40) NOT NULL,
  data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_tool_records_profile_tool (business_profile_id, tool_id),
  CONSTRAINT fk_tool_records_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS document_records (
  id VARCHAR(64) NOT NULL,
  business_profile_id INT UNSIGNED NOT NULL DEFAULT 1,
  tool_id VARCHAR(40) NOT NULL,
  doc_no VARCHAR(48) NOT NULL,
  doc_date DATE NOT NULL,
  extra_date DATE NULL,
  party_name VARCHAR(200) NULL,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  data JSON NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_document_records_profile_tool (business_profile_id, tool_id),
  KEY idx_document_records_doc_no (doc_no),
  CONSTRAINT fk_document_records_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tool_usage (
  business_profile_id INT UNSIGNED NOT NULL DEFAULT 1,
  tool_id VARCHAR(40) NOT NULL,
  record_count INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_profile_id, tool_id),
  CONSTRAINT fk_tool_usage_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS subscriptions (
  business_profile_id INT UNSIGNED NOT NULL,
  plan_id VARCHAR(20) NOT NULL DEFAULT 'free',
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  current_period_start TIMESTAMP NULL,
  current_period_end TIMESTAMP NULL,
  payment_provider VARCHAR(40) NULL,
  external_subscription_id VARCHAR(128) NULL,
  external_customer_id VARCHAR(128) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_profile_id),
  CONSTRAINT fk_subscriptions_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO subscriptions (business_profile_id, plan_id, status)
SELECT 1, 'free', 'active'
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM subscriptions WHERE business_profile_id = 1);

CREATE TABLE IF NOT EXISTS subscription_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  business_profile_id INT UNSIGNED NOT NULL,
  event_type VARCHAR(64) NOT NULL,
  provider VARCHAR(40) NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_subscription_events_profile (business_profile_id),
  CONSTRAINT fk_subscription_events_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
