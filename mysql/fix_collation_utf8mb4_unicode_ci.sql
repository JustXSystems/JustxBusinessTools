-- Fix MySQL 8 collation mismatch (ER_CANT_AGGREGATE_2COLLATIONS) when joining
-- runtime-created commerce tables to utf8mb4_unicode_ci schemas (e.g. tool_skus).
-- Safe to re-run. Prefer deploying the API (ensure*Schema auto-converts).

ALTER TABLE org_subscription_items CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE checkout_intents CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE org_tool_licenses CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE product_bundles CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
ALTER TABLE product_bundle_items CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
-- tool_skus is usually already unicode_ci from admin_platform.sql; convert if needed:
ALTER TABLE tool_skus CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci;
