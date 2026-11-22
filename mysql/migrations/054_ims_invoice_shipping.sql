-- Shipping charges with GST on sales invoices (Zoho / SAP parity).

ALTER TABLE ims_invoices
  ADD COLUMN shipping_charges DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER igst,
  ADD COLUMN shipping_gst_rate DECIMAL(5, 2) NOT NULL DEFAULT 0.00 AFTER shipping_charges,
  ADD COLUMN shipping_tax DECIMAL(14, 2) NOT NULL DEFAULT 0.00 AFTER shipping_gst_rate;
