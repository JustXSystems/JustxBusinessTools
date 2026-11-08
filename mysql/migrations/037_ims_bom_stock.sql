-- BOM P3: track materials stock issue separately from GST invoice convert.
-- Additive only (nullable / defaulted).

ALTER TABLE ims_bom_docs ADD COLUMN stock_issued_at TIMESTAMP NULL;

ALTER TABLE ims_bom_docs ADD COLUMN stock_issue_count INT UNSIGNED NOT NULL DEFAULT 0;
