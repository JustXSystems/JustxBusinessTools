-- Invoice approval threshold + retainer/advance apply + pending_approval status support.

ALTER TABLE ims_settings
  ADD COLUMN invoice_approval_limit DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER po_approval_limit;

ALTER TABLE ims_invoices
  ADD COLUMN advance_applied DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER credit_applied,
  ADD COLUMN approved_by INT UNSIGNED NULL AFTER cancelled_at,
  ADD COLUMN approved_by_name VARCHAR(120) NULL AFTER approved_by,
  ADD COLUMN approved_at TIMESTAMP NULL AFTER approved_by_name,
  ADD COLUMN approval_note VARCHAR(255) NULL AFTER approved_at;

-- Retainer prefix for document numbering.
ALTER TABLE ims_settings
  ADD COLUMN retainer_prefix VARCHAR(12) NOT NULL DEFAULT 'RA' AFTER proforma_prefix;
