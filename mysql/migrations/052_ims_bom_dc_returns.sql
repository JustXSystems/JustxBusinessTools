-- Partial unused-material returns against an approved Delivery Challan.
-- Stock RETURN_IN posts with the DC doc_no; BOM issued_qty uses net (delivered − returned).
-- Also: dedicated quotation reference on BOM + optional mandatory gate in settings.

ALTER TABLE ims_bom_docs
  ADD COLUMN quotation_ref VARCHAR(120) NULL AFTER project_ref;

ALTER TABLE ims_settings
  ADD COLUMN bom_require_quotation_ref TINYINT(1) NOT NULL DEFAULT 0 AFTER bom_confirm_needs_approval;

CREATE TABLE IF NOT EXISTS ims_bom_dc_returns (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  dc_id CHAR(36) NOT NULL,
  bom_doc_id CHAR(36) NOT NULL,
  return_no VARCHAR(48) NOT NULL,
  return_date DATE NOT NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_dc_return_no (tenant_id, return_no),
  KEY idx_ims_bom_dc_return_dc (tenant_id, dc_id),
  KEY idx_ims_bom_dc_return_bom (tenant_id, bom_doc_id, return_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_dc_return_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  return_id CHAR(36) NOT NULL,
  dc_id CHAR(36) NOT NULL,
  dc_line_id CHAR(36) NOT NULL,
  bom_line_id CHAR(36) NOT NULL,
  item_id CHAR(36) NULL,
  description VARCHAR(500) NOT NULL,
  qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  unit VARCHAR(24) NOT NULL DEFAULT 'nos',
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_dc_rtn_lines (tenant_id, return_id),
  KEY idx_ims_bom_dc_rtn_dc_line (tenant_id, dc_line_id),
  KEY idx_ims_bom_dc_rtn_bom_line (tenant_id, bom_line_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ims_bom_dc_lines
  ADD COLUMN returned_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000 AFTER qty;
