-- Justx BOS assets: fixed-asset register, custody, transfers, maintenance, disposal and depreciation.
-- Additive only (new bos_* tables). Depreciation is calculated on read; nothing is posted to other tables.

-- method: slm (a fixed % of cost a year) | wdv (a % of the opening book value a year) | none.
-- status: in_use | maintenance | disposed. Depreciation runs from purchase_date and stops at disposed_on or salvage_value.
CREATE TABLE IF NOT EXISTS bos_assets (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  tag VARCHAR(40) NOT NULL,
  name VARCHAR(160) NOT NULL,
  category VARCHAR(60) NOT NULL,
  serial_no VARCHAR(80) NULL,
  location VARCHAR(120) NULL,
  department_id CHAR(36) NULL,
  employee_id CHAR(36) NULL,
  vendor_name VARCHAR(200) NULL,
  bill_id CHAR(36) NULL,
  purchase_date DATE NOT NULL,
  cost DECIMAL(14, 2) NOT NULL,
  salvage_value DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  method VARCHAR(8) NOT NULL DEFAULT 'slm',
  rate DECIMAL(6, 2) NOT NULL DEFAULT 0.00,
  status VARCHAR(16) NOT NULL DEFAULT 'in_use',
  warranty_until DATE NULL,
  disposed_on DATE NULL,
  disposal_amount DECIMAL(14, 2) NULL,
  disposal_note VARCHAR(300) NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_assets_tag (tenant_id, tag),
  KEY idx_bos_assets_status (tenant_id, status),
  KEY idx_bos_assets_employee (tenant_id, employee_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: assign | return | transfer | maintenance_start | maintenance_end | dispose | reinstate.
-- Names are copied at the time, so history reads the same after people or departments change.
-- seq orders events recorded on the same day.
CREATE TABLE IF NOT EXISTS bos_asset_events (
  id CHAR(36) NOT NULL,
  seq BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  asset_id CHAR(36) NOT NULL,
  kind VARCHAR(20) NOT NULL,
  event_date DATE NOT NULL,
  employee_id CHAR(36) NULL,
  employee_name VARCHAR(170) NULL,
  department_name VARCHAR(120) NULL,
  location VARCHAR(120) NULL,
  amount DECIMAL(14, 2) NULL,
  note VARCHAR(300) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_bos_asset_events_seq (seq),
  KEY idx_bos_asset_events_asset (asset_id, event_date),
  KEY idx_bos_asset_events_kind (tenant_id, kind, event_date),
  CONSTRAINT fk_bos_asset_events_asset FOREIGN KEY (asset_id) REFERENCES bos_assets (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
