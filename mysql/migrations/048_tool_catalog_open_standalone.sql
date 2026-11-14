-- Launch BOS / IMS as standalone apps (no JBT shell) when opened from home.
-- open_standalone = 1 → open /bos or /ims in a new window; 0 → keep /tools/* inside JBT.

ALTER TABLE tool_catalog
  ADD COLUMN open_standalone TINYINT(1) NOT NULL DEFAULT 0 AFTER available;

UPDATE tool_catalog
SET open_standalone = 1
WHERE tool_id IN ('bos', 'imsdealer');
