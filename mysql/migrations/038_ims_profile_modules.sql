-- Per-business-profile IMS left-nav module allowlist (Admin → Tools → IMS → Modules).
-- NULL = all modules enabled (legacy default). JSON array of module keys when restricted.

ALTER TABLE business_profiles
  ADD COLUMN ims_modules JSON NULL AFTER home_tool_ids;
