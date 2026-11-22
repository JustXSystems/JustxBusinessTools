-- MSME / UDYAM registration shown on tax invoice paper (India compliance).

ALTER TABLE ims_settings
  ADD COLUMN msme_registered TINYINT(1) NOT NULL DEFAULT 0 AFTER bank_name,
  ADD COLUMN msme_udyam VARCHAR(32) NULL AFTER msme_registered;
