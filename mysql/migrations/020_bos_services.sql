-- Justx BOS employee services (HR → Employee Services): helpdesk tickets, certificate and letter requests,
-- ID card and kit requests, with a comment thread. Additive only (new bos_* tables).

-- request_no: SRV-0001… per tenant. type: helpdesk | certificate | id_card | kit | other.
-- certificate_kind (certificate requests only): employment | experience | salary.
-- status: open (unassigned) | in_progress (assigned) | resolved | cancelled.
-- letter_no (LTR-0001…) and letter_on are set when a certificate request is resolved; the letter itself is
-- generated from the employee record when it's viewed, so a reopened request keeps its number.
CREATE TABLE IF NOT EXISTS bos_service_requests (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  request_no VARCHAR(20) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  type VARCHAR(16) NOT NULL,
  certificate_kind VARCHAR(16) NULL,
  subject VARCHAR(200) NOT NULL,
  details TEXT NULL,
  addressed_to VARCHAR(200) NULL,
  priority VARCHAR(8) NOT NULL DEFAULT 'normal',
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  assignee_employee_id CHAR(36) NULL,
  assignee_name VARCHAR(160) NULL,
  resolution_note VARCHAR(1000) NULL,
  resolved_at TIMESTAMP NULL,
  resolved_by_name VARCHAR(120) NULL,
  letter_no VARCHAR(20) NULL,
  letter_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_service_requests_no (tenant_id, request_no),
  KEY idx_bos_service_requests_status (tenant_id, status, created_at),
  KEY idx_bos_service_requests_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_service_requests_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- internal = 1 notes are visible to owners and admins only.
CREATE TABLE IF NOT EXISTS bos_service_comments (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  request_id CHAR(36) NOT NULL,
  author_user_id INT UNSIGNED NULL,
  author_name VARCHAR(120) NULL,
  body TEXT NOT NULL,
  internal TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_service_comments_request (request_id, created_at),
  CONSTRAINT fk_bos_service_comments_request FOREIGN KEY (request_id) REFERENCES bos_service_requests (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
