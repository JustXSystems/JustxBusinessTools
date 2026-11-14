-- BOM commercial close: scope/exclusions + per-document paper overrides.

ALTER TABLE ims_bom_docs
  ADD COLUMN scope_of_supply TEXT NULL AFTER warranty_terms,
  ADD COLUMN exclusions TEXT NULL AFTER scope_of_supply,
  ADD COLUMN paper_json JSON NULL AFTER exclusions;
