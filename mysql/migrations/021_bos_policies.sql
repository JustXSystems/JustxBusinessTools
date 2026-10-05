-- Justx BOS HR policies & compliance (HR → Policies & Compliance): the policy library with versioned
-- acknowledgements, the statutory compliance calendar, and the agreements register. Additive only (new bos_* tables).

-- category: hr | compliance | finance | it | safety | other. status: draft | published | archived.
-- version counts publications: 0 until first published. Publishing a material change bumps it, and everyone
-- acknowledges again (acknowledgements are kept per version, so the history stays).
CREATE TABLE IF NOT EXISTS bos_policies (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  category VARCHAR(16) NOT NULL,
  summary VARCHAR(600) NULL,
  body MEDIUMTEXT NOT NULL,
  mandatory TINYINT(1) NOT NULL DEFAULT 0,
  status VARCHAR(12) NOT NULL DEFAULT 'draft',
  version INT UNSIGNED NOT NULL DEFAULT 0,
  effective_on DATE NULL,
  published_at TIMESTAMP NULL,
  published_by_name VARCHAR(120) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_policies_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One row per employee per policy version. method: self (the employee, signed in) | recorded (by a manager,
-- e.g. from a signed paper copy, with recorded_by_name).
CREATE TABLE IF NOT EXISTS bos_policy_acks (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  policy_id CHAR(36) NOT NULL,
  version INT UNSIGNED NOT NULL,
  employee_id CHAR(36) NOT NULL,
  method VARCHAR(10) NOT NULL DEFAULT 'self',
  user_id INT UNSIGNED NULL,
  recorded_by_name VARCHAR(120) NULL,
  note VARCHAR(300) NULL,
  ip VARCHAR(45) NULL,
  acknowledged_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_policy_acks (policy_id, version, employee_id),
  KEY idx_bos_policy_acks_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_policy_acks_policy FOREIGN KEY (policy_id) REFERENCES bos_policies (id) ON DELETE CASCADE,
  CONSTRAINT fk_bos_policy_acks_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Statutory filings and renewals. area: pf | esi | pt | tds | lwf | posh | shops | gratuity | bonus | other.
-- recurrence: none | monthly | quarterly | half_yearly | yearly. due_day keeps the intended day of the month for
-- recurring items, so a filing due on the 31st doesn't drift to the 28th after February.
-- status: open | done. Marking a recurring item done creates the next one and links it in next_id.
-- template_key is set when the item came from the standard list, so the list isn't added twice.
CREATE TABLE IF NOT EXISTS bos_compliance_items (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  area VARCHAR(16) NOT NULL DEFAULT 'other',
  due_on DATE NOT NULL,
  due_day TINYINT UNSIGNED NULL,
  recurrence VARCHAR(12) NOT NULL DEFAULT 'none',
  responsible VARCHAR(120) NULL,
  note VARCHAR(1000) NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open',
  done_on DATE NULL,
  done_by_name VARCHAR(120) NULL,
  reference VARCHAR(120) NULL,
  next_id CHAR(36) NULL,
  template_key VARCHAR(40) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_compliance_due (tenant_id, status, due_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- agreement_no: AGR-0001… per tenant. type: employment | nda | non_compete | consultant | internship | other.
-- With an employee (employee_id) or an outside party (counterparty), e.g. a contractor or manpower agency.
-- document_url links to the signed copy wherever it's stored (http/https only). status: active | ended.
CREATE TABLE IF NOT EXISTS bos_agreements (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  agreement_no VARCHAR(20) NOT NULL,
  type VARCHAR(16) NOT NULL,
  title VARCHAR(160) NOT NULL,
  employee_id CHAR(36) NULL,
  counterparty VARCHAR(160) NULL,
  signed_on DATE NULL,
  starts_on DATE NULL,
  expires_on DATE NULL,
  document_url VARCHAR(500) NULL,
  note VARCHAR(1000) NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'active',
  ended_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_agreements_no (tenant_id, agreement_no),
  KEY idx_bos_agreements_employee (tenant_id, employee_id),
  KEY idx_bos_agreements_expiry (tenant_id, status, expires_on),
  CONSTRAINT fk_bos_agreements_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
