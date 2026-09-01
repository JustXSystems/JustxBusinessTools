-- Product packs (bundles) + billing line items + checkout intents.
-- Tool SKU commercial columns are applied at runtime by ensureToolSkuSchema().

CREATE TABLE IF NOT EXISTS product_bundles (
  id VARCHAR(64) NOT NULL,
  name VARCHAR(120) NOT NULL,
  tagline VARCHAR(160) NULL,
  description TEXT NULL,
  discount_pct DECIMAL(5, 2) NOT NULL DEFAULT 0,
  fixed_price_inr DECIMAL(12, 2) NULL,
  available TINYINT(1) NOT NULL DEFAULT 1,
  highlighted TINYINT(1) NOT NULL DEFAULT 0,
  sort_order INT NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS product_bundle_items (
  bundle_id VARCHAR(64) NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  PRIMARY KEY (bundle_id, tool_id),
  KEY idx_pbi_tool (tool_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

INSERT INTO product_bundles (id, name, tagline, description, discount_pct, fixed_price_inr, available, highlighted, sort_order)
SELECT 'all_tools', 'All Tools Pack', 'Every paid business tool',
       'Grants a license for every paid tool SKU. À la carte remains available per tool.',
       0, NULL, 1, 1, 0
FROM DUAL
WHERE NOT EXISTS (SELECT 1 FROM product_bundles WHERE id = 'all_tools');

CREATE TABLE IF NOT EXISTS org_subscription_items (
  organization_id INT UNSIGNED NOT NULL,
  tool_id VARCHAR(64) NOT NULL,
  unit_price_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  status VARCHAR(20) NOT NULL DEFAULT 'active',
  source VARCHAR(40) NULL,
  external_ref VARCHAR(128) NULL,
  current_period_end TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (organization_id, tool_id),
  KEY idx_osi_org_status (organization_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS checkout_intents (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  organization_id INT UNSIGNED NOT NULL,
  profile_id INT NOT NULL,
  session_id VARCHAR(128) NOT NULL,
  tool_ids JSON NOT NULL,
  amount_inr DECIMAL(12, 2) NOT NULL DEFAULT 0,
  provider VARCHAR(40) NOT NULL DEFAULT 'mock',
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  completed_at TIMESTAMP NULL,
  PRIMARY KEY (id),
  UNIQUE KEY uk_checkout_session (session_id),
  KEY idx_checkout_org (organization_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
