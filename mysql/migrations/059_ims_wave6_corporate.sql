-- Wave 6: Sales Orders + SO DCs, multi-currency, installments, portal tokens,
-- dunning sequences. GSP credentials live in ims_integrations (provider=gsp).

-- ---------- Document currency (invoices + bills) ----------
ALTER TABLE ims_invoices
  ADD COLUMN currency_code VARCHAR(3) NOT NULL DEFAULT 'INR' AFTER grand_total,
  ADD COLUMN fx_rate DECIMAL(18, 8) NOT NULL DEFAULT 1.00000000 AFTER currency_code,
  ADD COLUMN fx_base_total DECIMAL(14, 2) NULL AFTER fx_rate;

ALTER TABLE ims_bills
  ADD COLUMN currency_code VARCHAR(3) NOT NULL DEFAULT 'INR' AFTER grand_total,
  ADD COLUMN fx_rate DECIMAL(18, 8) NOT NULL DEFAULT 1.00000000 AFTER currency_code,
  ADD COLUMN fx_base_total DECIMAL(14, 2) NULL AFTER fx_rate;

ALTER TABLE ims_settings
  ADD COLUMN base_currency VARCHAR(3) NOT NULL DEFAULT 'INR' AFTER gstin,
  ADD COLUMN so_prefix VARCHAR(12) NOT NULL DEFAULT 'SO' AFTER retainer_prefix,
  ADD COLUMN so_dc_prefix VARCHAR(12) NOT NULL DEFAULT 'SODC' AFTER so_prefix,
  ADD COLUMN dunning_sequences JSON NULL AFTER invoice_approval_limit;

-- ---------- Sales Orders ----------
CREATE TABLE IF NOT EXISTS ims_sales_orders (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  so_no VARCHAR(48) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  customer_id CHAR(36) NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_gstin VARCHAR(20) NULL,
  customer_email VARCHAR(120) NULL,
  customer_mobile VARCHAR(20) NULL,
  bill_to_address VARCHAR(500) NULL,
  ship_to_address VARCHAR(500) NULL,
  customer_po_ref VARCHAR(80) NULL,
  order_date DATE NOT NULL,
  delivery_date DATE NULL,
  currency_code VARCHAR(3) NOT NULL DEFAULT 'INR',
  fx_rate DECIMAL(18, 8) NOT NULL DEFAULT 1.00000000,
  `lines` JSON NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  terms TEXT NULL,
  invoice_id CHAR(36) NULL,
  source_bom_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  confirmed_at TIMESTAMP NULL,
  cancelled_at TIMESTAMP NULL,
  cancel_reason VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_so_no (tenant_id, so_no),
  KEY idx_ims_so_status (tenant_id, status, order_date),
  KEY idx_ims_so_customer (tenant_id, customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Delivery challans from sales orders (stock OUT on approve).
CREATE TABLE IF NOT EXISTS ims_so_dcs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  sales_order_id CHAR(36) NOT NULL,
  doc_no VARCHAR(48) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'draft',
  doc_date DATE NOT NULL,
  ship_to VARCHAR(500) NULL,
  transporter VARCHAR(200) NULL,
  vehicle_no VARCHAR(40) NULL,
  notes TEXT NULL,
  `lines` JSON NOT NULL,
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  approved_by INT UNSIGNED NULL,
  approved_by_name VARCHAR(120) NULL,
  approved_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_so_dc_no (tenant_id, doc_no),
  KEY idx_ims_so_dc_so (tenant_id, sales_order_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_invoice_so_dc_links (
  tenant_id INT UNSIGNED NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  so_dc_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, invoice_id, so_dc_id),
  UNIQUE KEY uq_ims_inv_so_dc (tenant_id, so_dc_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

ALTER TABLE ims_sales_orders
  ADD COLUMN portal_token VARCHAR(64) NULL AFTER invoice_id,
  ADD COLUMN portal_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER portal_token;

ALTER TABLE ims_invoices
  ADD COLUMN portal_token VARCHAR(64) NULL AFTER einv_status,
  ADD COLUMN sales_order_id CHAR(36) NULL AFTER recurring_id;

CREATE UNIQUE INDEX uq_ims_invoice_portal_token ON ims_invoices (portal_token);
CREATE UNIQUE INDEX uq_ims_so_portal_token ON ims_sales_orders (portal_token);
CREATE INDEX idx_ims_invoice_so ON ims_invoices (tenant_id, sales_order_id);

-- ---------- Installment plans ----------
CREATE TABLE IF NOT EXISTS ims_installment_plans (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  invoice_id CHAR(36) NOT NULL,
  label VARCHAR(120) NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'active',
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_installment_invoice (tenant_id, invoice_id),
  KEY idx_ims_installment_status (tenant_id, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_installment_schedule (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  plan_id CHAR(36) NOT NULL,
  seq_no INT NOT NULL DEFAULT 1,
  due_on DATE NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(16) NOT NULL DEFAULT 'pending',
  label VARCHAR(80) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_inst_sched (tenant_id, plan_id, seq_no),
  KEY idx_ims_inst_due (tenant_id, due_on, status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- ---------- Dunning sequences (beyond single letter) ----------
CREATE TABLE IF NOT EXISTS ims_dunning_runs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  customer_id CHAR(36) NULL,
  customer_name VARCHAR(200) NOT NULL,
  level_key VARCHAR(24) NOT NULL,
  level_label VARCHAR(80) NOT NULL,
  letter_tone VARCHAR(24) NOT NULL DEFAULT 'friendly',
  total_due DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  invoice_ids JSON NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'prepared',
  prepared_by INT UNSIGNED NULL,
  prepared_by_name VARCHAR(120) NULL,
  prepared_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  notes VARCHAR(500) NULL,
  PRIMARY KEY (id),
  KEY idx_ims_dunning_customer (tenant_id, customer_id, prepared_at),
  KEY idx_ims_dunning_level (tenant_id, level_key, prepared_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
