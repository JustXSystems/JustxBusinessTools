CREATE TABLE IF NOT EXISTS clients (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  name VARCHAR(160) NOT NULL,
  email VARCHAR(180) NULL,
  phone VARCHAR(40) NULL,
  company VARCHAR(160) NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS invoices (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  client_id INT UNSIGNED NOT NULL,
  invoice_number VARCHAR(40) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  status ENUM('draft', 'sent', 'paid', 'overdue') NOT NULL DEFAULT 'draft',
  issue_date DATE NOT NULL,
  due_date DATE NOT NULL,
  notes TEXT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_invoice_number (invoice_number),
  KEY idx_invoices_client (client_id),
  CONSTRAINT fk_invoices_client FOREIGN KEY (client_id) REFERENCES clients (id) ON DELETE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS tasks (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  title VARCHAR(200) NOT NULL,
  description TEXT NULL,
  status ENUM('todo', 'in_progress', 'done') NOT NULL DEFAULT 'todo',
  due_date DATE NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS expenses (
  id INT UNSIGNED NOT NULL AUTO_INCREMENT,
  category VARCHAR(80) NOT NULL,
  amount DECIMAL(12, 2) NOT NULL DEFAULT 0.00,
  description VARCHAR(255) NULL,
  expense_date DATE NOT NULL,
  created_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- Sample seed data (skipped when tables already have rows — safe to re-run db:setup)

INSERT INTO clients (name, email, phone, company, notes)
SELECT * FROM (
  SELECT 'Amina Khan' AS name, 'amina@northline.co' AS email, '+1 415 555 0142' AS phone, 'Northline Studio' AS company, 'Retainer client — brand and web.' AS notes
  UNION ALL SELECT 'Marcus Hale', 'marcus@haleventures.io', '+1 646 555 0198', 'Hale Ventures', 'Quarterly reporting and invoicing.'
  UNION ALL SELECT 'Priya Shah', 'priya@shahgoods.com', '+44 20 7946 0958', 'Shah Goods', 'Wholesale catalog updates.'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM clients LIMIT 1);

INSERT INTO invoices (client_id, invoice_number, amount, status, issue_date, due_date, notes)
SELECT * FROM (
  SELECT 1 AS client_id, 'INV-1001' AS invoice_number, 2400.00 AS amount, 'paid' AS status, '2026-07-01' AS issue_date, '2026-07-15' AS due_date, 'July retainer' AS notes
  UNION ALL SELECT 1, 'INV-1004', 1850.00, 'sent', '2026-08-01', '2026-08-15', 'August retainer'
  UNION ALL SELECT 2, 'INV-1002', 6200.00, 'overdue', '2026-06-10', '2026-06-24', 'Strategy sprint'
  UNION ALL SELECT 3, 'INV-1003', 980.00, 'draft', '2026-08-12', '2026-08-26', 'Product photos'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM invoices LIMIT 1);

INSERT INTO tasks (title, description, status, due_date)
SELECT * FROM (
  SELECT 'Send August invoices' AS title, 'Review open drafts and send to clients.' AS description, 'in_progress' AS status, '2026-08-20' AS due_date
  UNION ALL SELECT 'Renew domain for Northline', 'northline.co expires next month.', 'todo', '2026-08-28'
  UNION ALL SELECT 'File quarterly expenses', 'Export receipts from the last quarter.', 'todo', '2026-09-05'
  UNION ALL SELECT 'Close Hale Ventures sprint', 'Collect final sign-off.', 'done', '2026-08-10'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM tasks LIMIT 1);

INSERT INTO expenses (category, amount, description, expense_date)
SELECT * FROM (
  SELECT 'Software' AS category, 29.00 AS amount, 'Design tool subscription' AS description, '2026-08-01' AS expense_date
  UNION ALL SELECT 'Travel', 186.40, 'Client meeting — downtown', '2026-08-06'
  UNION ALL SELECT 'Office', 64.12, 'Supplies', '2026-08-11'
  UNION ALL SELECT 'Contractors', 450.00, 'Copywriting assist', '2026-08-14'
) AS seed
WHERE NOT EXISTS (SELECT 1 FROM expenses LIMIT 1);
