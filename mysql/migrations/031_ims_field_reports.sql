-- Justx IMS: onsite visits, ping dates, task due times and the saved-report approval flow.

-- One onsite visit: open while checked_out_at is NULL. visit_date is the business-timezone day of check-in.
-- outcome: completed | follow_up | order_received | payment_collected | customer_unavailable | rescheduled | other.
CREATE TABLE IF NOT EXISTS ims_field_visits (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  user_name VARCHAR(120) NULL,
  visit_date DATE NOT NULL,
  site_name VARCHAR(200) NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NULL,
  purpose VARCHAR(40) NOT NULL DEFAULT 'visit',
  task_id CHAR(36) NULL,
  address VARCHAR(500) NULL,
  photo_note VARCHAR(500) NULL,
  in_lat DECIMAL(10, 7) NULL,
  in_lng DECIMAL(10, 7) NULL,
  in_accuracy_m INT UNSIGNED NULL,
  checked_in_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  checked_out_at TIMESTAMP NULL,
  out_lat DECIMAL(10, 7) NULL,
  out_lng DECIMAL(10, 7) NULL,
  out_accuracy_m INT UNSIGNED NULL,
  summary VARCHAR(1000) NULL,
  outcome VARCHAR(24) NULL,
  next_visit_on DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_visit_user (tenant_id, user_id, visit_date),
  KEY idx_ims_visit_day (tenant_id, visit_date),
  KEY idx_ims_visit_open (tenant_id, user_id, checked_out_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Business-timezone day of each ping / status row, so a day's trail doesn't depend on the DB session timezone.
ALTER TABLE ims_field_checkins ADD COLUMN ping_date DATE NULL;

ALTER TABLE ims_field_checkins ADD KEY idx_ims_field_ping_day (tenant_id, user_id, ping_date);

-- HH:MM, optional.
ALTER TABLE ims_field_tasks ADD COLUMN due_time CHAR(5) NULL;

-- approval_status: draft | pending_approval | approved | sent (the schedule's own on/off stays in status: active | paused).
ALTER TABLE ims_reports ADD COLUMN approval_status VARCHAR(20) NOT NULL DEFAULT 'draft';

ALTER TABLE ims_reports ADD COLUMN approved_by INT UNSIGNED NULL;

ALTER TABLE ims_reports ADD COLUMN approved_by_name VARCHAR(120) NULL;

ALTER TABLE ims_reports ADD COLUMN approved_at TIMESTAMP NULL;

ALTER TABLE ims_reports ADD COLUMN review_note VARCHAR(500) NULL;

ALTER TABLE ims_reports ADD COLUMN sent_to VARCHAR(1000) NULL;

ALTER TABLE ims_reports ADD COLUMN sent_at TIMESTAMP NULL;
