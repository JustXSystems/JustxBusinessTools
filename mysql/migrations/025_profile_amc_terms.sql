-- Business Profile: separate terms & notes for Quotation V1 "Annual Maintenance -AMC" quotations.
-- Applied automatically by runPendingMigrations() on API startup (no manual SQL).

ALTER TABLE business_profiles
  ADD COLUMN amc_terms TEXT NULL;
