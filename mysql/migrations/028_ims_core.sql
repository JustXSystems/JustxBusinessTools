-- Justx IMS-Dealer: inventory, purchasing, sales, receivables/payables, field ops, audit and integrations
-- for distributors and dealers. Its own schema (every table is ims_*), partitioned by tenant_id = business profile.
-- It never writes another tool's tables. Cross-tool links go through ims_links (imports into IMS) and the
-- BOS connector (BOS reads ims_invoices). Additive only.

-- One row per business profile. permissions maps IMS role to allowed actions, taxonomy holds the
-- categories, brands, units and reasons pick-lists, reminders holds the AR auto-reminder rules and templates.
CREATE TABLE IF NOT EXISTS ims_settings (
  tenant_id INT UNSIGNED NOT NULL,
  business_name VARCHAR(200) NULL,
  business_type VARCHAR(24) NOT NULL DEFAULT 'distributor',
  gstin VARCHAR(20) NULL,
  state VARCHAR(80) NULL,
  state_code VARCHAR(4) NULL,
  address VARCHAR(500) NULL,
  phone VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  fiscal_year_start TINYINT UNSIGNED NOT NULL DEFAULT 4,
  po_prefix VARCHAR(12) NOT NULL DEFAULT 'PO',
  invoice_prefix VARCHAR(12) NOT NULL DEFAULT 'SI',
  bill_prefix VARCHAR(12) NOT NULL DEFAULT 'PB',
  return_prefix VARCHAR(12) NOT NULL DEFAULT 'RT',
  check_prefix VARCHAR(12) NOT NULL DEFAULT 'SC',
  ticket_prefix VARCHAR(12) NOT NULL DEFAULT 'TK',
  po_approval_limit DECIMAL(14, 2) NOT NULL DEFAULT 50000.00,
  draft_po_purge_days SMALLINT UNSIGNED NOT NULL DEFAULT 3,
  payment_terms_days SMALLINT UNSIGNED NOT NULL DEFAULT 30,
  default_gst_rate DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  allow_negative_stock TINYINT(1) NOT NULL DEFAULT 0,
  excise_enabled TINYINT(1) NOT NULL DEFAULT 0,
  permissions JSON NULL,
  taxonomy JSON NULL,
  reminders JSON NULL,
  terms TEXT NULL,
  updated_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_sequences (
  tenant_id INT UNSIGNED NOT NULL,
  seq_key VARCHAR(40) NOT NULL,
  period VARCHAR(12) NOT NULL,
  seq_value INT UNSIGNED NOT NULL DEFAULT 0,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, seq_key, period)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- IMS role per JBT user. ims_role is owner | manager | staff | accountant | auditor | field.
-- JBT owners and admins are treated as IMS owners even without a row.
CREATE TABLE IF NOT EXISTS ims_members (
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  display_name VARCHAR(120) NULL,
  ims_role VARCHAR(16) NOT NULL DEFAULT 'staff',
  phone VARCHAR(40) NULL,
  is_account_manager TINYINT(1) NOT NULL DEFAULT 0,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: supplier | customer | both. opening_balance is signed (positive = they owe us).
CREATE TABLE IF NOT EXISTS ims_parties (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  kind VARCHAR(10) NOT NULL DEFAULT 'customer',
  name VARCHAR(200) NOT NULL,
  contact_person VARCHAR(120) NULL,
  mobile VARCHAR(40) NULL,
  email VARCHAR(180) NULL,
  gstin VARCHAR(20) NULL,
  pan VARCHAR(12) NULL,
  address VARCHAR(500) NULL,
  city VARCHAR(80) NULL,
  state VARCHAR(80) NULL,
  state_code VARCHAR(4) NULL,
  payment_terms_days SMALLINT UNSIGNED NULL,
  credit_limit DECIMAL(14, 2) NULL,
  opening_balance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  account_manager_id INT UNSIGNED NULL,
  account_manager_name VARCHAR(120) NULL,
  tags VARCHAR(255) NULL,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_parties_kind (tenant_id, kind, active, name),
  KEY idx_ims_parties_gstin (tenant_id, gstin)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- current_stock holds saleable units. damaged_stock is quarantined until written off or returned.
-- Quantities are DECIMAL(14,3) so loose units (kg, litres) work.
CREATE TABLE IF NOT EXISTS ims_items (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  sku VARCHAR(64) NULL,
  barcode VARCHAR(64) NULL,
  category VARCHAR(80) NULL,
  brand VARCHAR(80) NULL,
  unit VARCHAR(20) NOT NULL DEFAULT 'pcs',
  hsn VARCHAR(20) NULL,
  gst_rate DECIMAL(5, 2) NOT NULL DEFAULT 18.00,
  supplier_id CHAR(36) NULL,
  purchase_price DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  selling_price DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  mrp DECIMAL(14, 2) NULL,
  current_stock DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  damaged_stock DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  min_stock DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  max_stock DECIMAL(14, 3) NULL,
  reorder_qty DECIMAL(14, 3) NULL,
  location VARCHAR(80) NULL,
  volume_ml INT UNSIGNED NULL,
  excise_category VARCHAR(40) NULL,
  notes TEXT NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  last_movement_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_items_sku (tenant_id, sku),
  KEY idx_ims_items_barcode (tenant_id, barcode),
  KEY idx_ims_items_name (tenant_id, active, name),
  KEY idx_ims_items_category (tenant_id, category),
  KEY idx_ims_items_supplier (tenant_id, supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Append-only stock ledger. type is OPENING | IN | OUT | DAMAGE | ADJUSTMENT | RETURN_IN | RETURN_OUT | WRITE_OFF.
-- delta is signed (what changed current_stock). before_qty and after_qty snapshot the saleable stock.
-- ref_type is manual | po | invoice | return | check | pos | tally | import.
CREATE TABLE IF NOT EXISTS ims_movements (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  item_id CHAR(36) NOT NULL,
  item_name VARCHAR(200) NOT NULL,
  type VARCHAR(12) NOT NULL,
  qty DECIMAL(14, 3) NOT NULL,
  delta DECIMAL(14, 3) NOT NULL,
  before_qty DECIMAL(14, 3) NOT NULL,
  after_qty DECIMAL(14, 3) NOT NULL,
  unit_cost DECIMAL(14, 2) NULL,
  unit_price DECIMAL(14, 2) NULL,
  value DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  ref_type VARCHAR(12) NOT NULL DEFAULT 'manual',
  ref_id CHAR(36) NULL,
  ref_no VARCHAR(64) NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NULL,
  reason VARCHAR(80) NULL,
  refund_status VARCHAR(12) NULL,
  excise_duty DECIMAL(14, 2) NULL,
  notes VARCHAR(500) NULL,
  movement_date DATE NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_mov_item (tenant_id, item_id, created_at),
  KEY idx_ims_mov_date (tenant_id, movement_date, type),
  KEY idx_ims_mov_ref (tenant_id, ref_type, ref_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: draft | pending_approval | approved | rejected | sent | partially_received | received | cancelled.
-- lines JSON holds item_id, name, sku, hsn, unit, qty, received_qty, rate, gst_rate and amount.
-- Snapshots freeze the supplier and business details printed on the PO.
CREATE TABLE IF NOT EXISTS ims_purchase_orders (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  po_no VARCHAR(48) NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  supplier_id CHAR(36) NULL,
  supplier_name VARCHAR(200) NOT NULL,
  supplier_snapshot JSON NULL,
  business_snapshot JSON NULL,
  order_date DATE NOT NULL,
  expected_date DATE NULL,
  `lines` JSON NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  terms TEXT NULL,
  notes TEXT NULL,
  approval_note VARCHAR(500) NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(120) NULL,
  decided_at TIMESTAMP NULL,
  sent_at TIMESTAMP NULL,
  sent_via VARCHAR(16) NULL,
  received_at TIMESTAMP NULL,
  bill_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_po_no (tenant_id, po_no),
  KEY idx_ims_po_status (tenant_id, status, order_date),
  KEY idx_ims_po_supplier (tenant_id, supplier_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- A counting session. status: counting | submitted | approved | adjusted | cancelled.
-- lines JSON holds item_id, name, unit, system_qty, physical_qty, difference and note.
CREATE TABLE IF NOT EXISTS ims_stock_checks (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  check_no VARCHAR(48) NOT NULL,
  title VARCHAR(200) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'counting',
  scope JSON NULL,
  `lines` JSON NOT NULL,
  variance_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  variance_value DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  counted_by INT UNSIGNED NULL,
  counted_by_name VARCHAR(120) NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(120) NULL,
  decided_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_check_no (tenant_id, check_no),
  KEY idx_ims_check_status (tenant_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- kind: customer (goods come back in) | supplier (goods go back out).
-- status: open | completed | cancelled. refund_status: none | pending | refunded | credit_note.
-- disposition (customer returns): restock | damaged.
CREATE TABLE IF NOT EXISTS ims_returns (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  return_no VARCHAR(48) NOT NULL,
  kind VARCHAR(10) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  ref_doc_id CHAR(36) NULL,
  ref_doc_no VARCHAR(64) NULL,
  return_date DATE NOT NULL,
  `lines` JSON NOT NULL,
  total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  reason VARCHAR(120) NULL,
  disposition VARCHAR(10) NOT NULL DEFAULT 'restock',
  refund_status VARCHAR(12) NOT NULL DEFAULT 'none',
  refund_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_return_no (tenant_id, return_no),
  KEY idx_ims_return_kind (tenant_id, kind, return_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- GST sales invoice. status: draft | issued | cancelled. Paid, partly paid and overdue are derived from amount_paid and due_date.
-- stock_posted = 1 once its OUT movements are written (on issue).
-- source_tool and source_ref record where it came from (quotation_v1, pos, tally, ...).
CREATE TABLE IF NOT EXISTS ims_invoices (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  invoice_no VARCHAR(48) NOT NULL,
  status VARCHAR(12) NOT NULL DEFAULT 'draft',
  customer_id CHAR(36) NULL,
  customer_name VARCHAR(200) NOT NULL,
  customer_gstin VARCHAR(20) NULL,
  customer_address VARCHAR(500) NULL,
  customer_mobile VARCHAR(40) NULL,
  place_of_supply VARCHAR(80) NULL,
  intra_state TINYINT(1) NOT NULL DEFAULT 1,
  invoice_date DATE NOT NULL,
  due_date DATE NULL,
  `lines` JSON NOT NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  discount_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  cgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  sgst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  igst DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  round_off DECIMAL(8, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  pay_mode VARCHAR(12) NULL,
  stock_posted TINYINT(1) NOT NULL DEFAULT 0,
  account_manager_id INT UNSIGNED NULL,
  account_manager_name VARCHAR(120) NULL,
  promise_date DATE NULL,
  promise_amount DECIMAL(14, 2) NULL,
  disputed TINYINT(1) NOT NULL DEFAULT 0,
  last_reminder_at TIMESTAMP NULL,
  reminder_count SMALLINT UNSIGNED NOT NULL DEFAULT 0,
  source_tool VARCHAR(40) NULL,
  source_ref VARCHAR(64) NULL,
  notes TEXT NULL,
  terms TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_invoice_no (tenant_id, invoice_no),
  KEY idx_ims_invoice_date (tenant_id, status, invoice_date),
  KEY idx_ims_invoice_customer (tenant_id, customer_id),
  KEY idx_ims_invoice_due (tenant_id, due_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Supplier bill (accounts payable).
-- status: pending_approval | approved | on_hold | scheduled | cancelled. Paid and partly paid are derived from amount_paid.
CREATE TABLE IF NOT EXISTS ims_bills (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  bill_no VARCHAR(48) NOT NULL,
  supplier_bill_no VARCHAR(64) NULL,
  status VARCHAR(18) NOT NULL DEFAULT 'pending_approval',
  supplier_id CHAR(36) NULL,
  supplier_name VARCHAR(200) NOT NULL,
  po_id CHAR(36) NULL,
  po_no VARCHAR(48) NULL,
  bill_date DATE NOT NULL,
  due_date DATE NULL,
  `lines` JSON NULL,
  subtotal DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  tax_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  grand_total DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  amount_paid DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  hold_reason VARCHAR(255) NULL,
  scheduled_on DATE NULL,
  pay_method VARCHAR(12) NULL,
  decided_by INT UNSIGNED NULL,
  decided_by_name VARCHAR(120) NULL,
  decided_at TIMESTAMP NULL,
  notes TEXT NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_bill_no (tenant_id, bill_no),
  KEY idx_ims_bill_status (tenant_id, status, due_date),
  KEY idx_ims_bill_supplier (tenant_id, supplier_id),
  KEY idx_ims_bill_po (tenant_id, po_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- direction: in (customer receipt) | out (supplier payment). doc_type: invoice | bill | on_account.
-- run_id groups the payments of one AP payment run.
CREATE TABLE IF NOT EXISTS ims_payments (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  direction VARCHAR(3) NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  doc_type VARCHAR(12) NOT NULL DEFAULT 'on_account',
  doc_id CHAR(36) NULL,
  doc_no VARCHAR(64) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  method VARCHAR(12) NOT NULL DEFAULT 'cash',
  reference VARCHAR(80) NULL,
  paid_on DATE NOT NULL,
  run_id CHAR(36) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_pay_party (tenant_id, party_id, paid_on),
  KEY idx_ims_pay_doc (tenant_id, doc_type, doc_id),
  KEY idx_ims_pay_date (tenant_id, direction, paid_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Manual credit / debit ledger (credit notes, debit notes, opening balances, adjustments).
-- entry_type: debit (party owes more) | credit (party owes less).
CREATE TABLE IF NOT EXISTS ims_ledger_entries (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NOT NULL,
  entry_type VARCHAR(6) NOT NULL,
  category VARCHAR(16) NOT NULL DEFAULT 'adjustment',
  amount DECIMAL(14, 2) NOT NULL,
  entry_date DATE NOT NULL,
  ref_no VARCHAR(64) NULL,
  linked_type VARCHAR(12) NULL,
  linked_id CHAR(36) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_ledger_party (tenant_id, party_id, entry_date),
  KEY idx_ims_ledger_date (tenant_id, entry_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Collections follow-up trail. kind: reminder | promise | note | call | dispute | escalation.
-- channel: whatsapp | sms | email | call | visit. promise status: open | kept | broken.
CREATE TABLE IF NOT EXISTS ims_ar_activity (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NULL,
  invoice_id CHAR(36) NULL,
  kind VARCHAR(12) NOT NULL,
  channel VARCHAR(10) NULL,
  template_key VARCHAR(40) NULL,
  message TEXT NULL,
  promise_date DATE NULL,
  promise_amount DECIMAL(14, 2) NULL,
  status VARCHAR(8) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_ar_party (tenant_id, party_id, created_at),
  KEY idx_ims_ar_invoice (tenant_id, invoice_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS ims_expenses (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  expense_date DATE NOT NULL,
  category VARCHAR(60) NOT NULL,
  description VARCHAR(255) NULL,
  amount DECIMAL(14, 2) NOT NULL,
  gst_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  pay_method VARCHAR(12) NOT NULL DEFAULT 'cash',
  vendor VARCHAR(200) NULL,
  reference VARCHAR(80) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_exp_date (tenant_id, expense_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- One closing per business day. summary JSON freezes the computed day figures at close time.
-- status: open | closed.
CREATE TABLE IF NOT EXISTS ims_daily_closings (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  closing_date DATE NOT NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'open',
  opening_cash DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  expected_cash DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  counted_cash DECIMAL(14, 2) NULL,
  variance DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  summary JSON NULL,
  notes TEXT NULL,
  closed_by INT UNSIGNED NULL,
  closed_by_name VARCHAR(120) NULL,
  closed_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_closing_date (tenant_id, closing_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Field-staff pings. kind: check_in | check_out | ping | status.
-- field_status: active | at_site | travelling | on_leave | offline.
CREATE TABLE IF NOT EXISTS ims_field_checkins (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  user_id INT UNSIGNED NOT NULL,
  user_name VARCHAR(120) NULL,
  kind VARCHAR(10) NOT NULL,
  field_status VARCHAR(12) NOT NULL DEFAULT 'active',
  lat DECIMAL(10, 7) NULL,
  lng DECIMAL(10, 7) NULL,
  accuracy_m INT UNSIGNED NULL,
  site_name VARCHAR(200) NULL,
  task_id CHAR(36) NULL,
  note VARCHAR(500) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_field_user (tenant_id, user_id, created_at),
  KEY idx_ims_field_day (tenant_id, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- task_type: delivery | collection | visit | audit | installation | service | other.
-- status: open | in_progress | done | cancelled. priority: low | normal | high | urgent.
CREATE TABLE IF NOT EXISTS ims_field_tasks (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  task_type VARCHAR(14) NOT NULL DEFAULT 'visit',
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  priority VARCHAR(8) NOT NULL DEFAULT 'normal',
  assignee_user_id INT UNSIGNED NULL,
  assignee_name VARCHAR(120) NULL,
  party_id CHAR(36) NULL,
  party_name VARCHAR(200) NULL,
  site_address VARCHAR(500) NULL,
  lat DECIMAL(10, 7) NULL,
  lng DECIMAL(10, 7) NULL,
  due_on DATE NULL,
  amount DECIMAL(14, 2) NULL,
  notes TEXT NULL,
  completed_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_task_assignee (tenant_id, assignee_user_id, status),
  KEY idx_ims_task_due (tenant_id, status, due_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Saved / scheduled reports. schedule: none | daily | weekly | monthly. status: active | paused.
CREATE TABLE IF NOT EXISTS ims_reports (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  name VARCHAR(200) NOT NULL,
  report_type VARCHAR(32) NOT NULL,
  params JSON NULL,
  format VARCHAR(6) NOT NULL DEFAULT 'xlsx',
  schedule VARCHAR(8) NOT NULL DEFAULT 'none',
  recipients JSON NULL,
  status VARCHAR(8) NOT NULL DEFAULT 'active',
  last_run_at TIMESTAMP NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_reports (tenant_id, status, name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- provider: tally | pos. config holds host, port, company or the POS provider and keys.
-- sync holds what to sync and how often.
CREATE TABLE IF NOT EXISTS ims_integrations (
  tenant_id INT UNSIGNED NOT NULL,
  provider VARCHAR(16) NOT NULL,
  enabled TINYINT(1) NOT NULL DEFAULT 0,
  config JSON NULL,
  sync JSON NULL,
  last_sync_at TIMESTAMP NULL,
  last_status VARCHAR(10) NULL,
  updated_by INT UNSIGNED NULL,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, provider)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- status: success | failed | partial. direction: export | import.
CREATE TABLE IF NOT EXISTS ims_sync_log (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  provider VARCHAR(16) NOT NULL,
  direction VARCHAR(6) NOT NULL,
  entity VARCHAR(24) NOT NULL,
  status VARCHAR(8) NOT NULL,
  records INT UNSIGNED NOT NULL DEFAULT 0,
  message VARCHAR(500) NULL,
  actor_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_sync (tenant_id, provider, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Daily excise register for liquor / bar businesses (enabled by ims_settings.excise_enabled).
CREATE TABLE IF NOT EXISTS ims_excise_records (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  record_date DATE NOT NULL,
  item_id CHAR(36) NULL,
  item_name VARCHAR(200) NOT NULL,
  brand VARCHAR(80) NULL,
  volume_ml INT UNSIGNED NULL,
  opening_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  received_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  issued_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  closing_qty DECIMAL(14, 3) NOT NULL DEFAULT 0.000,
  duty_rate DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  duty_amount DECIMAL(14, 2) NOT NULL DEFAULT 0.00,
  permit_no VARCHAR(64) NULL,
  transport_permit_no VARCHAR(64) NULL,
  notes VARCHAR(500) NULL,
  created_by INT UNSIGNED NULL,
  created_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_excise_date (tenant_id, record_date),
  KEY idx_ims_excise_item (tenant_id, item_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Bank statement lines for the auditor's reconciliation. status: unmatched | matched | ignored.
CREATE TABLE IF NOT EXISTS ims_bank_txns (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  txn_date DATE NOT NULL,
  description VARCHAR(255) NOT NULL,
  amount DECIMAL(14, 2) NOT NULL,
  direction VARCHAR(6) NOT NULL,
  reference VARCHAR(80) NULL,
  status VARCHAR(10) NOT NULL DEFAULT 'unmatched',
  matched_type VARCHAR(12) NULL,
  matched_id CHAR(36) NULL,
  created_by INT UNSIGNED NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_bank (tenant_id, status, txn_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- CA / auditor workspace. kind: flag (auditor-raised issue) | query (question to the business).
-- area: sales | purchases | banking | gst | inventory | expenses | aging | other.
-- severity: low | medium | high | critical. status: open | responded | resolved | dismissed.
-- thread JSON holds the replies as author, at and text.
CREATE TABLE IF NOT EXISTS ims_audit_items (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  kind VARCHAR(6) NOT NULL,
  area VARCHAR(12) NOT NULL DEFAULT 'other',
  title VARCHAR(255) NOT NULL,
  detail TEXT NULL,
  entity_type VARCHAR(16) NULL,
  entity_id CHAR(36) NULL,
  entity_label VARCHAR(120) NULL,
  severity VARCHAR(8) NOT NULL DEFAULT 'medium',
  status VARCHAR(10) NOT NULL DEFAULT 'open',
  thread JSON NULL,
  raised_by INT UNSIGNED NULL,
  raised_by_name VARCHAR(120) NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_audit (tenant_id, kind, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Auditor document vault (links to files kept in the business's own storage).
CREATE TABLE IF NOT EXISTS ims_documents (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  title VARCHAR(200) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'other',
  period VARCHAR(20) NULL,
  url VARCHAR(1000) NULL,
  notes VARCHAR(500) NULL,
  uploaded_by INT UNSIGNED NULL,
  uploaded_by_name VARCHAR(120) NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_docs (tenant_id, category, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Helpdesk. status: open | in_progress | waiting | resolved | closed. priority: low | normal | high | urgent.
CREATE TABLE IF NOT EXISTS ims_tickets (
  id CHAR(36) NOT NULL,
  tenant_id INT UNSIGNED NOT NULL,
  ticket_no VARCHAR(48) NOT NULL,
  subject VARCHAR(255) NOT NULL,
  category VARCHAR(40) NOT NULL DEFAULT 'general',
  priority VARCHAR(8) NOT NULL DEFAULT 'normal',
  status VARCHAR(12) NOT NULL DEFAULT 'open',
  description TEXT NULL,
  thread JSON NULL,
  raised_by INT UNSIGNED NULL,
  raised_by_name VARCHAR(120) NULL,
  assigned_to INT UNSIGNED NULL,
  assigned_to_name VARCHAR(120) NULL,
  resolved_at TIMESTAMP NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_ims_ticket_no (tenant_id, ticket_no),
  KEY idx_ims_tickets (tenant_id, status, created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Idempotent cross-tool imports. One source record maps to one IMS record per target_type.
CREATE TABLE IF NOT EXISTS ims_links (
  tenant_id INT UNSIGNED NOT NULL,
  source_tool VARCHAR(40) NOT NULL,
  source_ref VARCHAR(64) NOT NULL,
  target_type VARCHAR(16) NOT NULL,
  target_id CHAR(36) NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (tenant_id, source_tool, source_ref, target_type),
  KEY idx_ims_links_target (tenant_id, target_type, target_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Activity history and audit trail for every IMS mutation.
CREATE TABLE IF NOT EXISTS ims_events (
  id BIGINT UNSIGNED NOT NULL AUTO_INCREMENT,
  tenant_id INT UNSIGNED NOT NULL,
  actor_user_id INT UNSIGNED NULL,
  actor_name VARCHAR(120) NULL,
  event_type VARCHAR(64) NOT NULL,
  entity_type VARCHAR(24) NULL,
  entity_id VARCHAR(64) NULL,
  summary VARCHAR(255) NOT NULL,
  payload JSON NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_ims_events_tenant (tenant_id, created_at),
  KEY idx_ims_events_entity (tenant_id, entity_type, entity_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;
