-- Business Profile: quotation sign-off footer template and sender contact options (JSON).
-- Applied automatically by runPendingMigrations() on API startup (no manual SQL).

ALTER TABLE business_profiles
  ADD COLUMN document_footer JSON NULL;
