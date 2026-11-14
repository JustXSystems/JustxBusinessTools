-- Tenant-configurable BOM schedule columns for preview / print / PDF.
-- NULL = use industry-pack defaults for the selected purpose.

ALTER TABLE ims_settings
  ADD COLUMN bom_schedule_columns_json JSON NULL AFTER bom_hide_margin;
