-- Tenant default BOM paper layout for live preview + print/PDF (browser print).
-- classic | tiered | epc | executive | field

ALTER TABLE ims_settings
  ADD COLUMN bom_paper_template VARCHAR(24) NOT NULL DEFAULT 'classic'
  AFTER ticket_prefix;
