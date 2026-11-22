-- Progress / milestone billing % on tax invoices (partial bill against a job / BOM / quote).

ALTER TABLE ims_invoices
  ADD COLUMN progress_pct DECIMAL(5, 2) NULL AFTER retention_amount,
  ADD COLUMN progress_label VARCHAR(120) NULL AFTER progress_pct;
