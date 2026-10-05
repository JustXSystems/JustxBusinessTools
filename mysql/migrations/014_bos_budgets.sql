-- Justx BOS budgeting: one budget per financial year and basis, with a monthly plan per head.
-- Additive only (new bos_* tables). Actual spend is read from bills, expenses and payroll; nothing is copied.

-- basis: category (heads are spend categories plus payroll) | department (heads are departments plus company-wide).
CREATE TABLE IF NOT EXISTS bos_budgets (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  fy_start DATE NOT NULL,
  basis VARCHAR(16) NOT NULL DEFAULT 'category',
  name VARCHAR(120) NOT NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_budgets_fy (tenant_id, fy_start, basis)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: category (head_key = normalised category name) | payroll | department (head_key = department id) | company.
-- months holds 12 amounts, the first month of the financial year first; annual is their sum.
CREATE TABLE IF NOT EXISTS bos_budget_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  budget_id CHAR(36) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  head_key VARCHAR(120) NOT NULL DEFAULT '',
  label VARCHAR(120) NOT NULL,
  months JSON NOT NULL,
  annual DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  note VARCHAR(300) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_budget_lines_head (budget_id, kind, head_key),
  KEY idx_bos_budget_lines_tenant (tenant_id, budget_id),
  CONSTRAINT fk_bos_budget_lines_budget FOREIGN KEY (budget_id) REFERENCES bos_budgets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
