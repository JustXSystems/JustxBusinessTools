-- Justx IMS-Dealer: system, compliance & interop extras (excise register details, auditor assignments and
-- verdicts on auto-detected issues, document attachments, bank import batches). Additive only: every column is
-- nullable or defaulted, and the runner skips a column or index that already exists.

-- Excise register: batch, vendor, case packing and the movement status of each permit.
ALTER TABLE ims_excise_records ADD COLUMN batch_no VARCHAR(64) NULL;

ALTER TABLE ims_excise_records ADD COLUMN vendor_id CHAR(36) NULL;

ALTER TABLE ims_excise_records ADD COLUMN vendor_name VARCHAR(200) NULL;

ALTER TABLE ims_excise_records ADD COLUMN cases DECIMAL(14, 3) NOT NULL DEFAULT 0.000;

ALTER TABLE ims_excise_records ADD COLUMN bottles_per_case SMALLINT UNSIGNED NULL;

ALTER TABLE ims_excise_records ADD COLUMN permit_date DATE NULL;

ALTER TABLE ims_excise_records ADD COLUMN excise_category VARCHAR(40) NULL;

ALTER TABLE ims_excise_records ADD COLUMN status VARCHAR(12) NOT NULL DEFAULT 'received';

ALTER TABLE ims_excise_records ADD COLUMN movement_id CHAR(36) NULL;

ALTER TABLE ims_excise_records ADD INDEX idx_ims_excise_permit (tenant_id, permit_no);

-- Auditor workspace: who a flag / query is assigned to, and which auto-detected rule it records a verdict on.
ALTER TABLE ims_audit_items ADD COLUMN assignee_user_id INT UNSIGNED NULL;

ALTER TABLE ims_audit_items ADD COLUMN assignee_name VARCHAR(120) NULL;

ALTER TABLE ims_audit_items ADD COLUMN rule_key VARCHAR(80) NULL;

ALTER TABLE ims_audit_items ADD COLUMN amount DECIMAL(14, 2) NULL;

ALTER TABLE ims_audit_items ADD COLUMN due_date DATE NULL;

ALTER TABLE ims_audit_items ADD INDEX idx_ims_audit_rule (tenant_id, rule_key);

-- Document vault: small files are kept inline as data URLs (≤ 2 MB); larger ones stay as external links in url.
ALTER TABLE ims_documents ADD COLUMN file_name VARCHAR(200) NULL;

ALTER TABLE ims_documents ADD COLUMN mime VARCHAR(100) NULL;

ALTER TABLE ims_documents ADD COLUMN size_bytes INT UNSIGNED NULL;

ALTER TABLE ims_documents ADD COLUMN content MEDIUMTEXT NULL;

ALTER TABLE ims_documents ADD COLUMN entity_type VARCHAR(16) NULL;

ALTER TABLE ims_documents ADD COLUMN entity_id CHAR(36) NULL;

ALTER TABLE ims_documents ADD COLUMN entity_label VARCHAR(120) NULL;

ALTER TABLE ims_documents ADD INDEX idx_ims_docs_entity (tenant_id, entity_type, entity_id);

-- Bank statement imports: batch, what the line was matched to (label for display) and the match confidence.
ALTER TABLE ims_bank_txns ADD COLUMN batch_id CHAR(36) NULL;

ALTER TABLE ims_bank_txns ADD COLUMN matched_label VARCHAR(200) NULL;

ALTER TABLE ims_bank_txns ADD COLUMN match_score TINYINT UNSIGNED NULL;

ALTER TABLE ims_bank_txns ADD COLUMN matched_by VARCHAR(120) NULL;

ALTER TABLE ims_bank_txns ADD INDEX idx_ims_bank_match (tenant_id, matched_type, matched_id);

-- Helpdesk: category-wise listing.
ALTER TABLE ims_tickets ADD INDEX idx_ims_tickets_raiser (tenant_id, raised_by, created_at);
