-- Justx IMS-Dealer: purchase-order extras (additive).
-- delivery_address and payment_terms_days print on the PO and drive the bill due date on receipt.
-- intra_state + the CGST / SGST / IGST split freeze the GST treatment chosen when the PO was raised.
ALTER TABLE ims_purchase_orders
  ADD COLUMN delivery_address VARCHAR(500) NULL AFTER expected_date,
  ADD COLUMN payment_terms_days SMALLINT UNSIGNED NULL AFTER delivery_address,
  ADD COLUMN intra_state TINYINT(1) NOT NULL DEFAULT 1 AFTER payment_terms_days,
  ADD COLUMN discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER subtotal,
  ADD COLUMN cgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER tax_total,
  ADD COLUMN sgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER cgst,
  ADD COLUMN igst DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER sgst,
  ADD COLUMN submitted_at TIMESTAMP NULL AFTER approval_note;

ALTER TABLE ims_purchase_orders ADD INDEX idx_ims_po_expected (tenant_id, status, expected_date);

ALTER TABLE ims_parties ADD INDEX idx_ims_parties_name (tenant_id, name);
