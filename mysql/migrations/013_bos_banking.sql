-- Justx BOS banking: bank & cash accounts, statement lines and their reconciliation.
-- Additive only (new bos_* tables). Account numbers are not stored, only the last four digits.

CREATE TABLE IF NOT EXISTS bos_bank_accounts (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(8) NOT NULL DEFAULT 'bank',
  bank_name VARCHAR(120) NULL,
  account_last4 VARCHAR(4) NULL,
  ifsc VARCHAR(11) NULL,
  opening_balance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  opening_date DATE NOT NULL,
  archived_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_bank_accounts_tenant (tenant_id, archived_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- amount is signed: money in (credit) is positive, money out (debit) is negative.
-- status: unmatched | matched (linked to match_type/match_id) | categorized | excluded.
CREATE TABLE IF NOT EXISTS bos_bank_txns (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  account_id CHAR(36) NOT NULL,
  txn_date DATE NOT NULL,
  description VARCHAR(300) NOT NULL,
  reference VARCHAR(120) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  statement_balance DECIMAL(14, 2) NULL,
  source VARCHAR(8) NOT NULL DEFAULT 'import',
  fingerprint CHAR(40) NOT NULL,
  import_id CHAR(36) NULL,
  line_no INT UNSIGNED NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'unmatched',
  match_type VARCHAR(16) NULL,
  match_id CHAR(36) NULL,
  category VARCHAR(80) NULL,
  note VARCHAR(300) NULL,
  reconciled_by INT UNSIGNED NULL,
  reconciled_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_bank_txns_fp (account_id, fingerprint),
  KEY idx_bos_bank_txns_account (tenant_id, account_id, txn_date),
  KEY idx_bos_bank_txns_status (tenant_id, status),
  KEY idx_bos_bank_txns_match (tenant_id, match_type, match_id),
  CONSTRAINT fk_bos_bank_txns_account FOREIGN KEY (account_id) REFERENCES bos_bank_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
