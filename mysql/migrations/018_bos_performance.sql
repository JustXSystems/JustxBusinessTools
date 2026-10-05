-- Justx BOS performance & learning: training catalog and enrollments, certifications, KRAs, promotions,
-- performance improvement plans and recognition. Additive only (new bos_* tables). An employee record changes
-- only when a manager approves a promotion and chooses to apply it.

-- team: all | management | technical | operations. duration_days NULL means ongoing.
-- A program with certificate = 1 issues a certificate on completion, valid for validity_months (NULL: no expiry).
CREATE TABLE IF NOT EXISTS bos_training_programs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  team VARCHAR(16) NOT NULL DEFAULT 'all',
  duration_days DECIMAL(4, 1) NULL,
  certificate TINYINT(1) NOT NULL DEFAULT 0,
  validity_months SMALLINT UNSIGNED NULL,
  mandatory TINYINT(1) NOT NULL DEFAULT 0,
  description TEXT NULL,
  archived TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_training_programs_title (tenant_id, title)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: enrolled | completed | cancelled. session_date is the scheduled session, when known.
CREATE TABLE IF NOT EXISTS bos_training_enrollments (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  program_id CHAR(36) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  enrolled_on DATE NOT NULL,
  session_date DATE NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'enrolled',
  completed_on DATE NULL,
  note VARCHAR(300) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_training_enrollments_program (program_id, status),
  KEY idx_bos_training_enrollments_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_training_enrollments_program FOREIGN KEY (program_id) REFERENCES bos_training_programs (id),
  CONSTRAINT fk_bos_training_enrollments_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Issued by BOS from a completed enrollment (cert_no CERT-0001…, enrollment_id set) or recorded from an outside issuer.
CREATE TABLE IF NOT EXISTS bos_certifications (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  program_id CHAR(36) NULL,
  enrollment_id CHAR(36) NULL,
  cert_no VARCHAR(32) NULL,
  issuer VARCHAR(160) NULL,
  credential_no VARCHAR(80) NULL,
  link VARCHAR(500) NULL,
  issued_on DATE NOT NULL,
  expires_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_certifications_enrollment (enrollment_id),
  KEY idx_bos_certifications_employee (tenant_id, employee_id),
  KEY idx_bos_certifications_expiry (tenant_id, expires_on),
  CONSTRAINT fk_bos_certifications_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: on_track | at_risk | off_track | achieved | missed. A KRA is current while today is within its period.
CREATE TABLE IF NOT EXISTS bos_kras (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  title VARCHAR(200) NOT NULL,
  target VARCHAR(80) NULL,
  weight TINYINT UNSIGNED NULL,
  period_start DATE NOT NULL,
  period_end DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'on_track',
  progress TINYINT UNSIGNED NULL,
  note VARCHAR(500) NULL,
  reviewed_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_kras_period (tenant_id, period_end),
  KEY idx_bos_kras_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_kras_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: pending | approved | rejected. current_* are copied when proposed; applied = the employee record was updated.
CREATE TABLE IF NOT EXISTS bos_promotions (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  current_designation VARCHAR(120) NULL,
  proposed_designation VARCHAR(120) NOT NULL,
  current_ctc DECIMAL(14, 2) NULL,
  proposed_ctc DECIMAL(14, 2) NULL,
  effective_date DATE NOT NULL,
  reason TEXT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  decided_on DATE NULL,
  decided_by_name VARCHAR(170) NULL,
  decision_note VARCHAR(300) NULL,
  applied TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_promotions_status (tenant_id, status),
  CONSTRAINT fk_bos_promotions_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: active | passed | failed | cancelled. review_on moves when a plan is extended.
CREATE TABLE IF NOT EXISTS bos_pips (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  reason VARCHAR(300) NOT NULL,
  goals TEXT NULL,
  started_on DATE NOT NULL,
  review_on DATE NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'active',
  closed_on DATE NULL,
  outcome_note VARCHAR(300) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_pips_status (tenant_id, status),
  CONSTRAINT fk_bos_pips_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS bos_recognitions (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  category VARCHAR(80) NOT NULL,
  awarded_on DATE NOT NULL,
  note VARCHAR(300) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_recognitions_date (tenant_id, awarded_on),
  CONSTRAINT fk_bos_recognitions_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
