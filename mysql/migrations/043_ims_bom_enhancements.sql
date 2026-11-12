-- BOM market-leading enhancements (Phases 1–4 MVP). Additive only.
-- Issues: #29 epic; #30–#47 children.

-- ========== Phase 1: revisions, effectivity, cost, PDF ==========
ALTER TABLE ims_bom_packages
  ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN effective_from DATE NULL,
  ADD COLUMN effective_to DATE NULL,
  ADD COLUMN variables_json JSON NULL,
  ADD COLUMN options_json JSON NULL;

ALTER TABLE ims_bom_package_lines
  ADD COLUMN qty_formula VARCHAR(240) NULL,
  ADD COLUMN child_package_id CHAR(36) NULL,
  ADD COLUMN optional_flag TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN option_key VARCHAR(64) NULL,
  ADD COLUMN alternate_item_ids_json JSON NULL,
  ADD COLUMN service_spare TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN scrap_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN cost_rate DECIMAL(14, 4) NULL;

ALTER TABLE ims_bom_docs
  ADD COLUMN revision INT UNSIGNED NOT NULL DEFAULT 1,
  ADD COLUMN parent_doc_id CHAR(36) NULL,
  ADD COLUMN variables_json JSON NULL,
  ADD COLUMN options_json JSON NULL,
  ADD COLUMN proposal_token CHAR(64) NULL,
  ADD COLUMN proposal_status VARCHAR(24) NULL,
  ADD COLUMN proposal_sent_at TIMESTAMP NULL,
  ADD COLUMN proposal_responded_at TIMESTAMP NULL,
  ADD COLUMN proposal_response_note VARCHAR(500) NULL,
  ADD COLUMN rate_card_id CHAR(36) NULL,
  ADD COLUMN pdf_artifact_id CHAR(36) NULL,
  ADD COLUMN pdf_sha256 CHAR(64) NULL,
  ADD COLUMN pdf_generated_at TIMESTAMP NULL,
  ADD COLUMN materials_cost DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  ADD COLUMN as_built_at TIMESTAMP NULL,
  ADD COLUMN as_built_json JSON NULL;

ALTER TABLE ims_bom_doc_lines
  ADD COLUMN qty_formula VARCHAR(240) NULL,
  ADD COLUMN child_package_id CHAR(36) NULL,
  ADD COLUMN optional_flag TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN option_key VARCHAR(64) NULL,
  ADD COLUMN alternate_item_ids_json JSON NULL,
  ADD COLUMN service_spare TINYINT(1) NOT NULL DEFAULT 0,
  ADD COLUMN scrap_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN cost_rate DECIMAL(14, 4) NULL,
  ADD COLUMN issued_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  ADD COLUMN serial_notes VARCHAR(500) NULL,
  ADD COLUMN source_package_line_id CHAR(36) NULL;

CREATE UNIQUE INDEX uq_ims_bom_docs_proposal_token ON ims_bom_docs (proposal_token);

-- Immutable revision snapshots (packages + docs)
CREATE TABLE IF NOT EXISTS ims_bom_revisions (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  entity_type VARCHAR(16) NOT NULL,
  entity_id CHAR(36) NOT NULL,
  revision INT UNSIGNED NOT NULL,
  snapshot_json JSON NOT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_rev (tenant_id, entity_type, entity_id, revision),
  KEY idx_ims_bom_rev_entity (tenant_id, entity_type, entity_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ========== Phase 2: rate cards ==========
CREATE TABLE IF NOT EXISTS ims_bom_rate_cards (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  code VARCHAR(40) NULL,
  name VARCHAR(200) NOT NULL,
  currency VARCHAR(8) NOT NULL DEFAULT 'INR',
  valid_from DATE NULL,
  valid_to DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_rate_code (tenant_id, code),
  KEY idx_ims_bom_rate_active (tenant_id, active, valid_from, valid_to)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_rate_card_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  rate_card_id CHAR(36) NOT NULL,
  item_id CHAR(36) NULL,
  sku VARCHAR(80) NULL,
  description VARCHAR(500) NULL,
  unit VARCHAR(24) NOT NULL DEFAULT 'nos',
  rate DECIMAL(14, 4) NOT NULL DEFAULT 0.0000,
  cost_rate DECIMAL(14, 4) NULL,
  sort_no INT NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_rate_lines (tenant_id, rate_card_id, sort_no),
  KEY idx_ims_bom_rate_item (tenant_id, item_id),
  KEY idx_ims_bom_rate_sku (tenant_id, sku)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Link POs created from BOM shortfall
ALTER TABLE ims_purchase_orders
  ADD COLUMN bom_doc_id CHAR(36) NULL;

CREATE INDEX idx_ims_po_bom_doc ON ims_purchase_orders (tenant_id, bom_doc_id);

-- PDF binary storage for confirmed BOMs (client-generated jspdf upload)
CREATE TABLE IF NOT EXISTS ims_bom_pdf_blobs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  doc_id CHAR(36) NOT NULL,
  sha256 CHAR(64) NOT NULL,
  pdf_base64 LONGTEXT NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_pdf_doc (tenant_id, doc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
