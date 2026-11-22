-- Wave 1 of IMS Settings centralization: remaining document prefixes +
-- print-pack / attachment size ops knobs (tenant-configurable).

ALTER TABLE ims_settings
  ADD COLUMN bom_prefix VARCHAR(12) NOT NULL DEFAULT 'BOM' AFTER ticket_prefix,
  ADD COLUMN bom_dc_prefix VARCHAR(12) NOT NULL DEFAULT 'DC' AFTER bom_prefix,
  ADD COLUMN bom_dc_return_prefix VARCHAR(12) NOT NULL DEFAULT 'RTN' AFTER bom_dc_prefix,
  ADD COLUMN print_pack_max INT UNSIGNED NOT NULL DEFAULT 25 AFTER allow_negative_stock,
  ADD COLUMN attachment_max_bytes INT UNSIGNED NOT NULL DEFAULT 2097152 AFTER print_pack_max;
