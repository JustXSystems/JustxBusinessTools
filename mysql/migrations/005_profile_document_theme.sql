-- Business Profile: document PDF accent + per-profile UI theme override.
-- Applied automatically by runPendingMigrations() on API startup (no manual SQL).

ALTER TABLE business_profiles
  ADD COLUMN document_accent_color VARCHAR(7) NULL;

ALTER TABLE business_profiles
  ADD COLUMN theme_preset VARCHAR(120) NULL;
