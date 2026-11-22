-- Corporate invoice enhancements: doc kinds, ship-to, customer PO, payment bank/UPI,
-- credit-note linkage, e-Invoice / e-Way stubs (IRP connectors land in a later wave).

ALTER TABLE ims_settings
  ADD COLUMN bank_upi VARCHAR(80) NULL AFTER phone,
  ADD COLUMN bank_account_name VARCHAR(120) NULL AFTER bank_upi,
  ADD COLUMN bank_account_no VARCHAR(40) NULL AFTER bank_account_name,
  ADD COLUMN bank_ifsc VARCHAR(20) NULL AFTER bank_account_no,
  ADD COLUMN bank_name VARCHAR(120) NULL AFTER bank_ifsc,
  ADD COLUMN cn_prefix VARCHAR(12) NOT NULL DEFAULT 'CN' AFTER invoice_prefix,
  ADD COLUMN dn_prefix VARCHAR(12) NOT NULL DEFAULT 'DN' AFTER cn_prefix,
  ADD COLUMN proforma_prefix VARCHAR(12) NOT NULL DEFAULT 'PF' AFTER dn_prefix;

ALTER TABLE ims_invoices
  ADD COLUMN doc_kind VARCHAR(16) NOT NULL DEFAULT 'tax_invoice' AFTER invoice_no,
  ADD COLUMN against_invoice_id CHAR(36) NULL AFTER doc_kind,
  ADD COLUMN against_invoice_no VARCHAR(48) NULL AFTER against_invoice_id,
  ADD COLUMN customer_po_no VARCHAR(64) NULL AFTER place_of_supply,
  ADD COLUMN ship_to_name VARCHAR(200) NULL AFTER customer_mobile,
  ADD COLUMN ship_to_gstin VARCHAR(20) NULL AFTER ship_to_name,
  ADD COLUMN ship_to_address VARCHAR(500) NULL AFTER ship_to_gstin,
  ADD COLUMN ship_to_state VARCHAR(80) NULL AFTER ship_to_address,
  ADD COLUMN ship_to_mobile VARCHAR(40) NULL AFTER ship_to_state,
  ADD COLUMN credit_applied DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER amount_paid,
  ADD COLUMN einv_status VARCHAR(24) NULL AFTER cancel_reason,
  ADD COLUMN irn VARCHAR(64) NULL AFTER einv_status,
  ADD COLUMN ack_no VARCHAR(64) NULL AFTER irn,
  ADD COLUMN ack_at TIMESTAMP NULL AFTER ack_no,
  ADD COLUMN signed_qr TEXT NULL AFTER ack_at,
  ADD COLUMN eway_bill_no VARCHAR(24) NULL AFTER signed_qr,
  ADD COLUMN eway_valid_upto TIMESTAMP NULL AFTER eway_bill_no,
  ADD KEY idx_ims_invoice_kind (tenant_id, doc_kind, status),
  ADD KEY idx_ims_invoice_against (tenant_id, against_invoice_id);
