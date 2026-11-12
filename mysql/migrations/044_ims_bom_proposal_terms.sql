-- Commercial proposal fields for market-grade BOM paper / public share.
-- Adds project + terms metadata and promotes Aether as the default paper for new tenants.

ALTER TABLE ims_bom_docs
  ADD COLUMN project_ref VARCHAR(120) NULL AFTER location,
  ADD COLUMN valid_until DATE NULL AFTER prepared_by,
  ADD COLUMN payment_terms VARCHAR(240) NULL AFTER valid_until,
  ADD COLUMN delivery_terms VARCHAR(240) NULL AFTER payment_terms,
  ADD COLUMN warranty_terms VARCHAR(240) NULL AFTER delivery_terms;

ALTER TABLE ims_settings
  MODIFY COLUMN bom_paper_template VARCHAR(24) NOT NULL DEFAULT 'aether';
