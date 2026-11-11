-- Justx Party Registry — single source of truth for customers & suppliers
-- per business profile (tenant_id = business_profiles.id).
--
-- Canonical UI: IMS → Suppliers & Customers.
-- Quotation V1 and BOS read/write the same book via the shared party module.
-- Kind vocabulary is IMS-canonical: customer | supplier | both
-- (BOS "vendor" is an API alias for supplier).

CREATE TABLE IF NOT EXISTS jbt_parties (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'customer',
  name VARCHAR(200) NOT NULL,
  company VARCHAR(200) NULL,
  contact_person VARCHAR(120) NULL,
  mobile VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  gstin VARCHAR(20) NULL,
  pan VARCHAR(12) NULL,
  address VARCHAR(500) NULL,
  city VARCHAR(120) NULL,
  state VARCHAR(80) NULL,
  state_code VARCHAR(4) NULL,
  payment_terms_days SMALLINT UNSIGNED NULL,
  credit_limit DECIMAL(14, 2) NULL,
  opening_balance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  account_manager_id INT UNSIGNED NULL,
  account_manager_name VARCHAR(120) NULL,
  tags VARCHAR(255) NULL,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_jbt_parties_tenant_kind (tenant_id, kind, active, name),
  KEY idx_jbt_parties_tenant_gstin (tenant_id, gstin),
  KEY idx_jbt_parties_tenant_mobile (tenant_id, mobile),
  KEY idx_jbt_parties_tenant_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Provenance / merge trail (quotation docs, legacy bos/ims ids, imports).
CREATE TABLE IF NOT EXISTS jbt_party_origins (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  party_id CHAR(36) NOT NULL,
  source_tool VARCHAR(40) NOT NULL,
  source_ref VARCHAR(64) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_jbt_party_origins (tenant_id, source_tool, source_ref),
  KEY idx_jbt_party_origins_party (tenant_id, party_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
