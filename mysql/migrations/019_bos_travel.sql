-- Justx BOS travel requests (HR → Expenses & Assets). Additive only (one new bos_* table).
-- Asset assignment and expense claims on the same screen reuse bos_assets and bos_expenses unchanged.

-- request_no: TRV-0001… per tenant. mode: flight | train | bus | car | other.
-- status: pending | approved | rejected | cancelled. "On trip" and "completed" are derived from the dates.
-- advance is what the traveller asks for up front; it is informational and never posted to the books.
CREATE TABLE IF NOT EXISTS bos_travel_requests (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  request_no VARCHAR(20) NOT NULL,
  employee_id CHAR(36) NOT NULL,
  purpose VARCHAR(200) NOT NULL,
  from_place VARCHAR(120) NOT NULL,
  to_place VARCHAR(120) NOT NULL,
  depart_on DATE NOT NULL,
  return_on DATE NOT NULL,
  mode VARCHAR(12) NOT NULL DEFAULT 'train',
  estimated_cost DECIMAL(14, 2) NOT NULL DEFAULT 0,
  advance DECIMAL(14, 2) NOT NULL DEFAULT 0,
  project_id CHAR(36) NULL,
  note VARCHAR(1000) NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'pending',
  decision_note VARCHAR(500) NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(120) NULL,
  decided_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_travel_requests_no (tenant_id, request_no),
  KEY idx_bos_travel_requests_status (tenant_id, status, depart_on),
  KEY idx_bos_travel_requests_employee (tenant_id, employee_id),
  CONSTRAINT fk_bos_travel_requests_employee FOREIGN KEY (employee_id) REFERENCES bos_employees (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
