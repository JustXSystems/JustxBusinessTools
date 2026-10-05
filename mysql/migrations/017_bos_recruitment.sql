-- Justx BOS recruitment & onboarding: openings, candidates through the hiring pipeline, offers and the joiner checklist.
-- Additive only (new bos_* tables). An employee record is created only when a manager asks for it.

-- status: draft | open | on_hold | closed. openings is the number of people to hire for the role.
CREATE TABLE IF NOT EXISTS bos_job_openings (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(160) NOT NULL,
  department_id CHAR(36) NULL,
  location VARCHAR(120) NULL,
  employment_type VARCHAR(16) NOT NULL DEFAULT 'full_time',
  openings SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  priority VARCHAR(8) NOT NULL DEFAULT 'medium',
  status VARCHAR(12) NOT NULL DEFAULT 'draft',
  salary_min DECIMAL(14, 2) NULL,
  salary_max DECIMAL(14, 2) NULL,
  target_date DATE NULL,
  description TEXT NULL,
  opened_on DATE NULL,
  closed_on DATE NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_bos_job_openings_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- stage: applied | interview | shortlisted | offer | hired | rejected | withdrawn.
-- offer_status: sent | accepted | declined. Accepting an offer hires the candidate; onboarding is a JSON checklist
-- (documents, kyc, it, induction, kra) and employee_id is set once the employee record is created from the candidate.
CREATE TABLE IF NOT EXISTS bos_candidates (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  opening_id CHAR(36) NOT NULL,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'Direct',
  referred_by VARCHAR(160) NULL,
  applied_on DATE NOT NULL,
  stage VARCHAR(16) NOT NULL DEFAULT 'applied',
  stage_on DATE NOT NULL,
  rating TINYINT UNSIGNED NULL,
  current_ctc DECIMAL(14, 2) NULL,
  expected_ctc DECIMAL(14, 2) NULL,
  notice_days SMALLINT UNSIGNED NULL,
  resume_link VARCHAR(500) NULL,
  notes TEXT NULL,
  interview_at DATETIME NULL,
  interview_mode VARCHAR(16) NULL,
  interviewer VARCHAR(160) NULL,
  offer_ctc DECIMAL(14, 2) NULL,
  offer_sent_on DATE NULL,
  offer_status VARCHAR(12) NULL,
  offer_responded_on DATE NULL,
  offer_terms TEXT NULL,
  joining_date DATE NULL,
  hired_on DATE NULL,
  closed_reason VARCHAR(300) NULL,
  onboarding JSON NULL,
  employee_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_candidates_employee (tenant_id, employee_id),
  KEY idx_bos_candidates_stage (tenant_id, stage),
  KEY idx_bos_candidates_opening (opening_id),
  CONSTRAINT fk_bos_candidates_opening FOREIGN KEY (opening_id) REFERENCES bos_job_openings (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: applied | stage | interview | offer | offer_response | note | onboarding | employee. seq orders same-day events.
CREATE TABLE IF NOT EXISTS bos_candidate_events (
  id CHAR(36) NOT NULL,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  candidate_id CHAR(36) NOT NULL,
  kind VARCHAR(16) NOT NULL,
  from_stage VARCHAR(16) NULL,
  to_stage VARCHAR(16) NULL,
  note VARCHAR(500) NULL,
  event_date DATE NOT NULL,
  actor_name VARCHAR(170) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_candidate_events_seq (seq),
  KEY idx_bos_candidate_events_candidate (candidate_id, event_date),
  CONSTRAINT fk_bos_candidate_events_candidate FOREIGN KEY (candidate_id) REFERENCES bos_candidates (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
