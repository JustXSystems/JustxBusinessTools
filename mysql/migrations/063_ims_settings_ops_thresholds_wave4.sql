-- Wave 4: remaining high-value ops thresholds (reorder fallback, bank match, audit rules, dunning wording, currency list).
-- JSON columns are NULL = built-in defaults; scalars carry their historical hard-coded values.
-- Statutory GST (slabs, CGST/SGST split) and paisa epsilons intentionally stay in code.

ALTER TABLE ims_settings
  ADD COLUMN reorder_fallback_factor DECIMAL(5,2) NOT NULL DEFAULT 2.00 AFTER max_installments,
  ADD COLUMN bank_match_defaults JSON NULL AFTER reorder_fallback_factor,
  ADD COLUMN audit_rules JSON NULL AFTER bank_match_defaults,
  ADD COLUMN audit_severity_amount JSON NULL AFTER audit_rules,
  ADD COLUMN dunning_firm_pay_within_days INT UNSIGNED NOT NULL DEFAULT 7 AFTER audit_severity_amount,
  ADD COLUMN common_currencies JSON NULL AFTER dunning_firm_pay_within_days;
