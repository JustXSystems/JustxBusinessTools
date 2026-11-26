-- Which Quotation V1 statuses BOM quotation-reference suggestions include (submitted / sent / approved).
-- NULL = default (approved only), matching the behaviour before this setting existed.
ALTER TABLE ims_settings
  ADD COLUMN bom_quotation_statuses_json JSON NULL AFTER bom_require_quotation_ref;
