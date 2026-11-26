-- Serialized (unit-level) stock tracking: one row per unique physical scan code / serial number
-- linked to its parent product in ims_items. Unique per tenant so no two items/units share a scan code.

ALTER TABLE ims_items
  ADD COLUMN track_serials TINYINT(1) NOT NULL DEFAULT 0 AFTER active;

CREATE TABLE IF NOT EXISTS ims_item_serials (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  item_id CHAR(36) NOT NULL,
  serial_no VARCHAR(100) NOT NULL,
  status VARCHAR(16) NOT NULL DEFAULT 'in_stock',
  purchase_price DECIMAL(14, 2) NULL,
  in_movement_id CHAR(36) NULL,
  out_movement_id CHAR(36) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_item_serials_code (tenant_id, serial_no),
  KEY idx_ims_item_serials_item (tenant_id, item_id, status),
  CONSTRAINT fk_ims_item_serials_item FOREIGN KEY (item_id) REFERENCES ims_items (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
