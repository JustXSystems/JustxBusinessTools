-- Delivery Challans (DC) from confirmed BOMs.
-- Partial delivery: many DCs per BOM. Stock OUT only when a DC is approved.
-- Invoices may link multiple DCs; invoice issue posts stock only when no DC links exist.

CREATE TABLE IF NOT EXISTS ims_bom_dcs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  bom_doc_id CHAR(36) NOT NULL,
  doc_no VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  doc_date DATE NOT NULL,
  ship_to VARCHAR(500) NULL,
  transporter VARCHAR(200) NULL,
  vehicle_no VARCHAR(40) NULL,
  notes TEXT NULL,
  verified_by INT UNSIGNED NULL,
  verified_by_name VARCHAR(120) NULL,
  verified_at TIMESTAMP NULL,
  approved_by INT UNSIGNED NULL,
  approved_by_name VARCHAR(120) NULL,
  approved_at TIMESTAMP NULL,
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_dc_no (tenant_id, doc_no),
  KEY idx_ims_bom_dc_bom (tenant_id, bom_doc_id, status),
  KEY idx_ims_bom_dc_date (tenant_id, status, doc_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_dc_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  dc_id CHAR(36) NOT NULL,
  bom_line_id CHAR(36) NOT NULL,
  item_id CHAR(36) NULL,
  section VARCHAR(80) NOT NULL DEFAULT 'Main Items',
  sort_no INT NOT NULL DEFAULT 0,
  description VARCHAR(500) NOT NULL,
  make_text VARCHAR(200) NULL,
  qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  unit VARCHAR(24) NOT NULL DEFAULT 'nos',
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_dc_lines (tenant_id, dc_id, sort_no),
  KEY idx_ims_bom_dc_line_bom (tenant_id, bom_line_id),
  KEY idx_ims_bom_dc_line_item (tenant_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Many DCs may be referenced by one invoice (stock already moved on DC approve).
CREATE TABLE IF NOT EXISTS ims_invoice_dc_links (
  tenant_id INT UNSIGNED NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  dc_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, invoice_id, dc_id),
  KEY idx_ims_inv_dc_dc (tenant_id, dc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
