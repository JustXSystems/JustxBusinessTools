-- Justx BOS accounting: chart of accounts, opening balances and manual journals.
-- Additive only (new bos_* tables). Postings from invoices, bills, claims, payroll, bank lines and assets
-- are derived on read; nothing is written to those tables.

-- type: asset | liability | equity | income | expense. system_key marks the accounts BOS posts to (renamable, not removable).
-- categories: for expense accounts, the bill and claim categories that post here instead of the default account.
CREATE TABLE IF NOT EXISTS bos_accounts (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  code VARCHAR(12) NOT NULL,
  name VARCHAR(120) NOT NULL,
  type VARCHAR(10) NOT NULL,
  system_key VARCHAR(40) NULL,
  categories JSON NULL,
  description VARCHAR(300) NULL,
  archived_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_accounts_code (tenant_id, code),
  UNIQUE KEY uq_bos_accounts_system (tenant_id, system_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- books_start: records dated earlier are summed up in the opening balances instead of posted one by one.
CREATE TABLE IF NOT EXISTS bos_accounting_settings (
  tenant_id INT UNSIGNED NOT NULL,
  books_start DATE NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_opening_balances (
  tenant_id INT UNSIGNED NOT NULL,
  account_id CHAR(36) NOT NULL,
  debit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  credit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  PRIMARY KEY (tenant_id, account_id),
  CONSTRAINT fk_bos_opening_balances_account FOREIGN KEY (account_id) REFERENCES bos_accounts (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: posted | void. Journals are voided rather than edited or deleted, so the trail stays complete.
CREATE TABLE IF NOT EXISTS bos_journals (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  journal_no VARCHAR(48) NOT NULL,
  entry_date DATE NOT NULL,
  narration VARCHAR(300) NOT NULL,
  total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(8) NOT NULL DEFAULT 'posted',
  void_reason VARCHAR(300) NULL,
  voided_by INT UNSIGNED NULL,
  voided_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_journals_no (tenant_id, journal_no),
  KEY idx_bos_journals_date (tenant_id, entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_journal_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  journal_id CHAR(36) NOT NULL,
  line_no SMALLINT UNSIGNED NOT NULL,
  account_id CHAR(36) NOT NULL,
  debit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  credit DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  note VARCHAR(200) NULL,
  PRIMARY KEY (id),
  KEY idx_bos_journal_lines_journal (journal_id, line_no),
  KEY idx_bos_journal_lines_account (tenant_id, account_id),
  CONSTRAINT fk_bos_journal_lines_journal FOREIGN KEY (journal_id) REFERENCES bos_journals (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
