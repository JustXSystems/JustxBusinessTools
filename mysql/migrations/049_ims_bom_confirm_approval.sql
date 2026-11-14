-- Optional gate: confirming a BOM requires the Approvals permission (owners always can).
-- Place after schedule columns (047) so column order stays stable on fresh installs.
ALTER TABLE ims_settings
  ADD COLUMN bom_confirm_needs_approval TINYINT(1) NOT NULL DEFAULT 0 AFTER bom_schedule_columns_json;
