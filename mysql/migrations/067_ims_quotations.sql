-- Native IMS Quotations (full Quotation Generator V1 parity + IMS catalog/SO/Invoice/BOM integration).
-- Partitioned by tenant_id = business profile. Zero stock/GL/GSTR impact until converted.

CREATE TABLE IF NOT EXISTS ims_quotations (
  id VARCHAR(64) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  quote_no VARCHAR(64) NOT NULL,
  revision SMALLINT UNSIGNED NOT NULL DEFAULT 1,
  parent_quote_id VARCHAR(64) NULL,
  category VARCHAR(24) NOT NULL DEFAULT 'other',
  engagement VARCHAR(24) NOT NULL DEFAULT 'sale',
  category_custom_label VARCHAR(120) NULL,
  status VARCHAR(24) NOT NULL DEFAULT 'draft',
  quote_date DATE NOT NULL,
  valid_until DATE NULL,
  follow_up_date DATE NULL,
  party_id VARCHAR(64) NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_company VARCHAR(200) NULL,
  customer_city VARCHAR(80) NULL,
  customer_state VARCHAR(80) NULL,
  customer_gstin VARCHAR(20) NULL,
  customer_phone VARCHAR(40) NULL,
  customer_email VARCHAR(180) NULL,
  customer_address VARCHAR(500) NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  taxable DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  cgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  sgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  igst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  total_gst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  buyback_less DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  round_off DECIMAL(10, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  lines_json JSON NOT NULL,
  extra_charge_json JSON NULL,
  gst_override_json JSON NULL,
  display_json JSON NULL,
  notes TEXT NULL,
  company_snapshot_json JSON NULL,
  history_json JSON NULL,
  prepared_by VARCHAR(120) NOT NULL DEFAULT '',
  prepared_by_phone VARCHAR(40) NULL,
  prepared_by_email VARCHAR(180) NULL,
  created_by_user_id INT UNSIGNED NULL,
  approval_token VARCHAR(64) NOT NULL,
  finance_sent TINYINT(1) NOT NULL DEFAULT 0,
  approved_at TIMESTAMP NULL,
  approved_by VARCHAR(120) NULL,
  rejected_at TIMESTAMP NULL,
  rejected_by VARCHAR(120) NULL,
  converted_so_id VARCHAR(64) NULL,
  converted_invoice_id VARCHAR(64) NULL,
  converted_bom_id VARCHAR(64) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_quotations_no (tenant_id, quote_no),
  UNIQUE KEY uq_ims_quotations_token (approval_token),
  KEY idx_ims_quotations_tenant_status (tenant_id, status, updated_at),
  KEY idx_ims_quotations_followup (tenant_id, follow_up_date),
  KEY idx_ims_quotations_party (tenant_id, party_id),
  KEY idx_ims_quotations_parent (tenant_id, parent_quote_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_quotation_alerts (
  id VARCHAR(64) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  quotation_id VARCHAR(64) NULL,
  message VARCHAR(500) NOT NULL,
  is_read TINYINT(1) NOT NULL DEFAULT 0,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_qalerts_tenant (tenant_id, is_read, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ims_settings
  ADD COLUMN quote_settings_json JSON NULL AFTER doc_required_fields_json;

ALTER TABLE ims_sales_orders
  ADD COLUMN quotation_id VARCHAR(64) NULL AFTER customer_po_ref;

ALTER TABLE ims_invoices
  ADD COLUMN quotation_id VARCHAR(64) NULL AFTER sales_order_id;
