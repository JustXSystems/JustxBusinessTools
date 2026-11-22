-- Wave 3: sales / payment defaults (invoice editor, POS, installments, GST rate list).
-- Arrays are JSON (NULL = built-in defaults); scalars carry their historical defaults.

ALTER TABLE ims_settings
  ADD COLUMN payment_term_presets JSON NULL AFTER ap_due_soon_days,
  ADD COLUMN default_round_to_rupee TINYINT(1) NOT NULL DEFAULT 1 AFTER payment_term_presets,
  ADD COLUMN default_retention_pct DECIMAL(5,2) NOT NULL DEFAULT 0 AFTER default_round_to_rupee,
  ADD COLUMN gst_rate_options JSON NULL AFTER default_retention_pct,
  ADD COLUMN pay_methods JSON NULL AFTER gst_rate_options,
  ADD COLUMN default_pay_method VARCHAR(12) NOT NULL DEFAULT 'cash' AFTER pay_methods,
  ADD COLUMN pos_pay_methods JSON NULL AFTER default_pay_method,
  ADD COLUMN pos_round_to_rupee TINYINT(1) NOT NULL DEFAULT 1 AFTER pos_pay_methods,
  ADD COLUMN default_installment_count INT UNSIGNED NOT NULL DEFAULT 3 AFTER pos_round_to_rupee,
  ADD COLUMN installment_every_months INT UNSIGNED NOT NULL DEFAULT 1 AFTER default_installment_count,
  ADD COLUMN max_installments INT UNSIGNED NOT NULL DEFAULT 60 AFTER installment_every_months;
