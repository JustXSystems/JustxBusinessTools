-- Justx BOS sales billing (Finance → Sales Billing): the product & service catalog, and quotations, sales orders
-- and delivery challans that convert into the existing GST invoices. Additive only (new bos_* tables).
-- POS counter bills are ordinary bos_invoices (source_tool = 'pos') with a payment; they need no table of their own.

-- kind: goods | service. Lines copy name, HSN, unit, rate and GST rate, so editing an item never changes old documents.
CREATE TABLE IF NOT EXISTS bos_items (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  sku VARCHAR(64) NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'goods',
  hsn VARCHAR(20) NULL,
  unit VARCHAR(20) NULL,
  rate DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_rate DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_items_sku (tenant_id, sku),
  KEY idx_bos_items_name (tenant_id, active, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: quotation (QT/) | order (SO/) | challan (DC/), numbered per fiscal year.
-- status — quotation: draft | sent | accepted | declined (expired is derived from valid_until);
--          order: confirmed | cancelled (in transit / delivered / invoiced are derived from its challans and invoice);
--          challan: draft | dispatched | delivered | cancelled.
-- source_id is the document this one was made from (quotation → order, order → challan).
-- invoice_id is the draft invoice it was converted into; a deleted or voided invoice frees it to be invoiced again.
CREATE TABLE IF NOT EXISTS bos_sales_docs (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  kind VARCHAR(10) NOT NULL,
  doc_no VARCHAR(48) NOT NULL,
  status VARCHAR(12) NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  party_gstin VARCHAR(20) NULL,
  party_address VARCHAR(500) NULL,
  place_of_supply VARCHAR(80) NULL,
  intra_state TINYINT(1) NOT NULL DEFAULT 1,
  doc_date DATE NOT NULL,
  valid_until DATE NULL,
  delivery_on DATE NULL,
  customer_ref VARCHAR(80) NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  cgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  sgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  igst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  line_items JSON NOT NULL,
  notes TEXT NULL,
  ship_to VARCHAR(500) NULL,
  challan_reason VARCHAR(12) NULL,
  transporter VARCHAR(120) NULL,
  vehicle_no VARCHAR(30) NULL,
  dispatched_on DATE NULL,
  delivered_on DATE NULL,
  received_by VARCHAR(120) NULL,
  decided_on DATE NULL,
  decision_note VARCHAR(500) NULL,
  source_id CHAR(36) NULL,
  invoice_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_sales_docs_no (tenant_id, doc_no),
  KEY idx_bos_sales_docs_kind (tenant_id, kind, doc_date),
  KEY idx_bos_sales_docs_source (tenant_id, source_id),
  KEY idx_bos_sales_docs_invoice (tenant_id, invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
