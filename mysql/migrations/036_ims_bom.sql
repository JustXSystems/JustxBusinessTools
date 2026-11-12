-- Justxsystems IMS: Bill of Materials — reusable package templates and customer BOM documents.
-- Industry-agnostic (kits, project packages, assemblies). Additive only.
-- invoice_id / invoice_convert_mode are filled by create-invoice; stock columns added in 037.

CREATE TABLE IF NOT EXISTS ims_bom_packages (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  code VARCHAR(40) NULL,
  name VARCHAR(200) NOT NULL,
  capacity_label VARCHAR(120) NULL,
  description TEXT NULL,
  default_margin_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  default_tax_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_pkg_code (tenant_id, code),
  KEY idx_ims_bom_pkg_name (tenant_id, active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_package_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  package_id CHAR(36) NOT NULL,
  section VARCHAR(80) NOT NULL DEFAULT 'Main Items',
  sort_no INT NOT NULL DEFAULT 0,
  line_kind VARCHAR(16) NOT NULL DEFAULT 'stock',
  item_id CHAR(36) NULL,
  description VARCHAR(500) NOT NULL,
  make_text VARCHAR(200) NULL,
  qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  unit VARCHAR(24) NOT NULL DEFAULT 'nos',
  scale_by_capacity TINYINT(1) NOT NULL DEFAULT 0,
  default_rate DECIMAL(14, 4) NOT NULL DEFAULT 0.0000,
  remarks VARCHAR(500) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_pkg_lines (tenant_id, package_id, sort_no),
  KEY idx_ims_bom_pkg_line_item (tenant_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_docs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  package_id CHAR(36) NULL,
  package_name VARCHAR(200) NULL,
  doc_no VARCHAR(40) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  doc_date DATE NOT NULL,
  capacity_label VARCHAR(120) NULL,
  title VARCHAR(240) NULL,
  customer_name VARCHAR(200) NOT NULL DEFAULT '',
  location VARCHAR(240) NULL,
  party_id CHAR(36) NULL,
  margin_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  tax_pct DECIMAL(7, 3) NOT NULL DEFAULT 0.000,
  materials_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  margin_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  prepared_by VARCHAR(120) NULL,
  -- Reserved for P3: GST invoice link + user choice at convert time
  invoice_id CHAR(36) NULL,
  invoice_convert_mode VARCHAR(24) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bom_doc_no (tenant_id, doc_no),
  KEY idx_ims_bom_docs_status (tenant_id, status, doc_date),
  KEY idx_ims_bom_docs_customer (tenant_id, customer_name),
  KEY idx_ims_bom_docs_party (tenant_id, party_id),
  KEY idx_ims_bom_docs_pkg (tenant_id, package_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_bom_doc_lines (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  doc_id CHAR(36) NOT NULL,
  section VARCHAR(80) NOT NULL DEFAULT 'Main Items',
  sort_no INT NOT NULL DEFAULT 0,
  line_kind VARCHAR(16) NOT NULL DEFAULT 'stock',
  item_id CHAR(36) NULL,
  description VARCHAR(500) NOT NULL,
  make_text VARCHAR(200) NULL,
  qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  unit VARCHAR(24) NOT NULL DEFAULT 'nos',
  scale_by_capacity TINYINT(1) NOT NULL DEFAULT 0,
  rate DECIMAL(14, 4) NOT NULL DEFAULT 0.0000,
  amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  remarks VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bom_doc_lines (tenant_id, doc_id, sort_no),
  KEY idx_ims_bom_doc_line_item (tenant_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
