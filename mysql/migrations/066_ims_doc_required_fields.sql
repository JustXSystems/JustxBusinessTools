-- Configurable required fields enforced at the final step of each IMS document
-- (BOM confirm, DC approve, Return record, PO submit/send, Invoice issue).
-- Folds in the earlier bom_require_quotation_ref toggle; legacy column is kept in sync.
ALTER TABLE ims_settings
  ADD COLUMN doc_required_fields_json JSON NULL AFTER bom_quotation_statuses_json;
