-- Per-organization feature switches. Anything that changes a screen existing customers already use
-- ships behind a switch that an admin turns on later (Admin → Tools → <tool> → Switches).
-- A missing row means "off". Purely additive: nothing existing is altered.

CREATE TABLE IF NOT EXISTS org_feature_switches (
  organization_id INT UNSIGNED NOT NULL,
  switch_key VARCHAR(64) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, switch_key)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
