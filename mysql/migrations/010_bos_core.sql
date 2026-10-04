-- Justx BOS (Business Operating System) core schema.
-- Self-contained: every table is prefixed bos_ and scoped by tenant_id (the JBT business profile id).
-- There are no foreign keys into JBT tables, so the schema can be lifted into its own database
-- and run by a standalone BOS host. Purely additive: nothing existing is altered.

CREATE TABLE IF NOT EXISTS bos_settings (
  tenant_id INT UNSIGNED NOT NULL,
  company_name VARCHAR(200) NULL,
  gstin VARCHAR(20) NULL,
  state VARCHAR(80) NULL,
  state_code VARCHAR(4) NULL,
  address VARCHAR(500) NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  invoice_prefix VARCHAR(12) NOT NULL DEFAULT 'INV',
  employee_prefix VARCHAR(12) NOT NULL DEFAULT 'EMP',
  fiscal_year_start TINYINT UNSIGNED NOT NULL DEFAULT 4,
  default_tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  payment_terms_days SMALLINT UNSIGNED NOT NULL DEFAULT 15,
  invoice_notes TEXT NULL,
  weekend_days VARCHAR(20) NOT NULL DEFAULT '0',
  leave_policy JSON NULL,
  auto_sync TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_sequences (
  tenant_id INT UNSIGNED NOT NULL,
  seq_key VARCHAR(40) NOT NULL,
  period VARCHAR(12) NOT NULL,
  seq_value INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, seq_key, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_parties (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  kind VARCHAR(12) NOT NULL DEFAULT 'customer',
  name VARCHAR(200) NOT NULL,
  company VARCHAR(200) NULL,
  gstin VARCHAR(20) NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  address VARCHAR(500) NULL,
  city VARCHAR(120) NULL,
  state VARCHAR(80) NULL,
  notes TEXT NULL,
  source_tool VARCHAR(40) NULL,
  source_ref VARCHAR(64) NULL,
  created_by INT UNSIGNED NULL,
  archived_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_parties_tenant_kind (tenant_id, kind),
  KEY idx_bos_parties_tenant_phone (tenant_id, phone),
  KEY idx_bos_parties_tenant_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_invoices (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  invoice_no VARCHAR(48) NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  party_gstin VARCHAR(20) NULL,
  party_address VARCHAR(500) NULL,
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  place_of_supply VARCHAR(80) NULL,
  intra_state TINYINT(1) NOT NULL DEFAULT 1,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  cgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  sgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  igst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  line_items JSON NOT NULL,
  notes TEXT NULL,
  source_tool VARCHAR(40) NULL,
  source_ref VARCHAR(64) NULL,
  created_by INT UNSIGNED NULL,
  sent_at TIMESTAMP NULL,
  voided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_invoices_no (tenant_id, invoice_no),
  KEY idx_bos_invoices_status (tenant_id, status),
  KEY idx_bos_invoices_due (tenant_id, due_date),
  KEY idx_bos_invoices_party (tenant_id, party_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_payments (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  paid_on DATE NOT NULL,
  method VARCHAR(24) NOT NULL DEFAULT 'bank',
  reference VARCHAR(120) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_payments_invoice (tenant_id, invoice_id),
  KEY idx_bos_payments_date (tenant_id, paid_on),
  CONSTRAINT fk_bos_payments_invoice FOREIGN KEY (invoice_id) REFERENCES bos_invoices (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_bills (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  bill_no VARCHAR(64) NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  bill_date DATE NOT NULL,
  due_date DATE NOT NULL,
  category VARCHAR(80) NULL,
  amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  notes TEXT NULL,
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  paid_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_bills_status (tenant_id, status),
  KEY idx_bos_bills_due (tenant_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_expenses (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NULL,
  claimant_name VARCHAR(120) NULL,
  category VARCHAR(80) NOT NULL,
  description VARCHAR(500) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  spent_on DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'submitted',
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_expenses_status (tenant_id, status),
  KEY idx_bos_expenses_date (tenant_id, spent_on),
  KEY idx_bos_expenses_employee (tenant_id, employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_departments (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(120) NOT NULL,
  code VARCHAR(20) NULL,
  head_employee_id CHAR(36) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_departments_name (tenant_id, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_employees (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  emp_code VARCHAR(32) NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NULL,
  work_email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  designation VARCHAR(120) NULL,
  department_id CHAR(36) NULL,
  manager_id CHAR(36) NULL,
  employment_type VARCHAR(16) NOT NULL DEFAULT 'full_time',
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  join_date DATE NOT NULL,
  exit_date DATE NULL,
  location VARCHAR(120) NULL,
  dob DATE NULL,
  ctc_annual DECIMAL(14, 2) NULL,
  personal JSON NULL,
  bank JSON NULL,
  user_id INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_employees_code (tenant_id, emp_code),
  KEY idx_bos_employees_dept (tenant_id, department_id),
  KEY idx_bos_employees_status (tenant_id, status),
  KEY idx_bos_employees_user (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_profile_changes (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  changes JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  requested_by INT UNSIGNED NULL,
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_profile_changes (tenant_id, status),
  CONSTRAINT fk_bos_profile_changes_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_leave_requests (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  leave_type VARCHAR(16) NOT NULL,
  from_date DATE NOT NULL,
  to_date DATE NOT NULL,
  half_day TINYINT(1) NOT NULL DEFAULT 0,
  days DECIMAL(5, 1) NOT NULL DEFAULT 0.0,
  reason VARCHAR(500) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  decision_note VARCHAR(500) NULL,
  decided_by INT UNSIGNED NULL,
  decided_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_leave_status (tenant_id, status),
  KEY idx_bos_leave_employee (tenant_id, employee_id, from_date),
  CONSTRAINT fk_bos_leave_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_attendance (
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  work_date DATE NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'present',
  check_in TIME NULL,
  check_out TIME NULL,
  source VARCHAR(16) NOT NULL DEFAULT 'manual',
  note VARCHAR(255) NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, employee_id, work_date),
  KEY idx_bos_attendance_date (tenant_id, work_date),
  CONSTRAINT fk_bos_attendance_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_holidays (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  holiday_date DATE NOT NULL,
  name VARCHAR(120) NOT NULL,
  kind VARCHAR(16) NOT NULL DEFAULT 'public',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_holidays (tenant_id, holiday_date, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_projects (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'lead',
  site_address VARCHAR(500) NULL,
  value_estimate DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  start_date DATE NULL,
  due_date DATE NULL,
  notes TEXT NULL,
  source_tool VARCHAR(40) NULL,
  source_ref VARCHAR(64) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_projects_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_links (
  tenant_id INT UNSIGNED NOT NULL,
  source_tool VARCHAR(40) NOT NULL,
  source_ref VARCHAR(64) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_tool, source_ref, target_type),
  KEY idx_bos_links_target (tenant_id, target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(120) NULL,
  event_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(24) NULL,
  entity_id VARCHAR(64) NULL,
  summary VARCHAR(255) NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_events_tenant (tenant_id, created_at),
  KEY idx_bos_events_entity (tenant_id, entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
