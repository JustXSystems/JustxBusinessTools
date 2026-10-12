-- Justx IMS — sales & finance extras (additive).

-- Invoices: round-off preference, per-invoice auto reminders, dispute reason and lifecycle stamps.
ALTER TABLE ims_invoices ADD COLUMN round_to_rupee TINYINT(1) NOT NULL DEFAULT 0;
ALTER TABLE ims_invoices ADD COLUMN auto_reminder TINYINT(1) NOT NULL DEFAULT 1;
ALTER TABLE ims_invoices ADD COLUMN dispute_reason VARCHAR(255) NULL;
ALTER TABLE ims_invoices ADD COLUMN issued_at TIMESTAMP NULL;
ALTER TABLE ims_invoices ADD COLUMN cancelled_at TIMESTAMP NULL;
ALTER TABLE ims_invoices ADD COLUMN cancel_reason VARCHAR(255) NULL;

-- Bills: expense category and the payment run that scheduled or paid them.
ALTER TABLE ims_bills ADD COLUMN category VARCHAR(60) NULL;
ALTER TABLE ims_bills ADD COLUMN run_id CHAR(36) NULL;

-- Manual ledger ("udhaar") entries. entry_type follows the IMS ledger screen:
-- credit = the party owes you, debit = you owe the party. Settled entries net to zero.
ALTER TABLE ims_ledger_entries ADD COLUMN phone VARCHAR(40) NULL;
ALTER TABLE ims_ledger_entries ADD COLUMN due_date DATE NULL;
ALTER TABLE ims_ledger_entries ADD COLUMN settled_on DATE NULL;
ALTER TABLE ims_ledger_entries ADD COLUMN settle_method VARCHAR(12) NULL;
ALTER TABLE ims_ledger_entries ADD COLUMN settled_by_name VARCHAR(120) NULL;

-- AP payment runs. status: scheduled | paid | cancelled. bill_ids JSON lists the bills in the run.
CREATE TABLE IF NOT EXISTS ims_payment_runs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  run_no VARCHAR(48) NOT NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'scheduled',
  run_date DATE NOT NULL,
  method VARCHAR(12) NOT NULL DEFAULT 'bank',
  reference VARCHAR(80) NULL,
  bill_ids JSON NOT NULL,
  bill_count INT UNSIGNED NOT NULL DEFAULT 0,
  total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes VARCHAR(500) NULL,
  paid_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_payrun_no (tenant_id, run_no),
  KEY idx_ims_payrun_date (tenant_id, run_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE INDEX idx_ims_exp_cat ON ims_expenses (tenant_id, category, expense_date);
