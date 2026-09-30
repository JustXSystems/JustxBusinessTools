-- Business Profile: on-screen document preview text tone ('standard' gray or 'dark').
-- Applied automatically by runPendingMigrations() on API startup (no manual SQL).

ALTER TABLE business_profiles
  ADD COLUMN document_text_tone VARCHAR(16) NULL;
