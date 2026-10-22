-- Per-business-profile tool licenses + optional freemium record-cap overrides.
-- Entitlement source of truth moves from org_tool_licenses → profile_tool_licenses.
-- Existing org rows are copied to every profile under that org (preserves prior access).

CREATE TABLE IF NOT EXISTS profile_tool_licenses (
  business_profile_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source_claim_id BIGINT UNSIGNED NULL,
  current_period_end TIMESTAMP NULL,
  record_limit_override INT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (business_profile_id, tool_id),
  KEY idx_ptl_status (status),
  KEY idx_ptl_tool (tool_id),
  CONSTRAINT fk_ptl_profile FOREIGN KEY (business_profile_id)
    REFERENCES business_profiles (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Seat count on org billing lines (one tool may be licensed on N profiles).
ALTER TABLE org_subscription_items
  ADD COLUMN quantity INT UNSIGNED NOT NULL DEFAULT 1;

-- Backfill: every profile under an org inherits that org's active tool licenses.
INSERT INTO profile_tool_licenses
  (business_profile_id, tool_id, status, source_claim_id, current_period_end)
SELECT bp.id, otl.tool_id, otl.status, otl.source_claim_id, otl.current_period_end
FROM org_tool_licenses otl
INNER JOIN business_profiles bp ON bp.organization_id = otl.organization_id
ON DUPLICATE KEY UPDATE
  status = VALUES(status),
  source_claim_id = COALESCE(VALUES(source_claim_id), profile_tool_licenses.source_claim_id),
  current_period_end = VALUES(current_period_end);
