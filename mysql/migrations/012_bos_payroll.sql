-- Justx BOS payroll: per-tenant payroll settings, employee salary structures, monthly runs and payslips.
-- Same rules as 010: bos_ prefix, scoped by tenant_id, no foreign keys into JBT tables. Purely additive.
-- Payslips snapshot the employee and every figure, so history survives later edits to structures or records.

CREATE TABLE IF NOT EXISTS bos_payroll_settings (
  tenant_id INT UNSIGNED NOT NULL,
  config JSON NOT NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_salary_structures (
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  basic DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  hra DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  special DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  pf_applicable TINYINT(1) NOT NULL DEFAULT 1,
  pt_applicable TINYINT(1) NOT NULL DEFAULT 1,
  tds_monthly DECIMAL(14, 2) NULL,
  pan VARCHAR(10) NULL,
  uan VARCHAR(12) NULL,
  pf_number VARCHAR(40) NULL,
  esi_number VARCHAR(20) NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, employee_id),
  CONSTRAINT fk_bos_salary_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_payroll_runs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  period CHAR(7) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  employee_count INT UNSIGNED NOT NULL DEFAULT 0,
  gross_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  deduction_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  net_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  employer_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  paid_on DATE NULL,
  calculated_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  finalized_by INT UNSIGNED NULL,
  finalized_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_payroll_runs_period (tenant_id, period),
  KEY idx_bos_payroll_runs_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_payslips (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  run_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  emp_code VARCHAR(32) NOT NULL,
  employee_name VARCHAR(170) NOT NULL,
  designation VARCHAR(120) NULL,
  department_name VARCHAR(120) NULL,
  days_in_month TINYINT UNSIGNED NOT NULL,
  paid_days DECIMAL(5, 1) NOT NULL DEFAULT 0.0,
  lop_days DECIMAL(5, 1) NOT NULL DEFAULT 0.0,
  attendance JSON NULL,
  earnings JSON NOT NULL,
  deductions JSON NOT NULL,
  employer JSON NOT NULL,
  adjustments JSON NULL,
  statutory JSON NULL,
  gross DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  total_deductions DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  net_pay DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  employer_cost DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_payslips_run_employee (run_id, employee_id),
  KEY idx_bos_payslips_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_payslips_run FOREIGN KEY (run_id) REFERENCES bos_payroll_runs (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
