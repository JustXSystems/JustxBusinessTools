-- Business Profile: Quotation V1 terms & notes per "For" (engagement key → text), e.g. {"amc": "..."}.
-- Carries over the AMC-only terms from 025. Applied automatically by runPendingMigrations() on API startup.

ALTER TABLE business_profiles
  ADD COLUMN quote_terms JSON NULL;

UPDATE business_profiles
  SET quote_terms = JSON_OBJECT('amc', amc_terms)
  WHERE quote_terms IS NULL AND amc_terms IS NOT NULL AND TRIM(amc_terms) <> '';
