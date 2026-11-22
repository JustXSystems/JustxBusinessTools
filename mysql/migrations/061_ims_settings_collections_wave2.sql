-- Wave 2: configurable AR aging breaks, collection priority days, AP due-soon window.
-- Reminder day offsets live inside ims_settings.reminders JSON (no new column).

ALTER TABLE ims_settings
  ADD COLUMN aging_breaks JSON NULL AFTER attachment_max_bytes,
  ADD COLUMN ar_priority_critical_days INT UNSIGNED NOT NULL DEFAULT 91 AFTER aging_breaks,
  ADD COLUMN ar_priority_high_days INT UNSIGNED NOT NULL DEFAULT 61 AFTER ar_priority_critical_days,
  ADD COLUMN ar_priority_medium_days INT UNSIGNED NOT NULL DEFAULT 31 AFTER ar_priority_high_days,
  ADD COLUMN ap_due_soon_days INT UNSIGNED NOT NULL DEFAULT 7 AFTER ar_priority_medium_days;
