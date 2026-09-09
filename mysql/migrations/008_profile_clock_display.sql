-- Business Profile: footer date/time chrome (show/hide + format).
-- Applied automatically by runPendingMigrations() on API startup (no manual SQL).

ALTER TABLE business_profiles
  ADD COLUMN clock_display_visible TINYINT(1) NOT NULL DEFAULT 1;

ALTER TABLE business_profiles
  ADD COLUMN clock_display_format VARCHAR(48) NOT NULL DEFAULT 'dd_mmm_yyyy_hm_a';
