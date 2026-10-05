-- Justx BOS: indexes for invoice queries by date (the invoice list order, this month's totals, reports and the
-- POS counter's bills for today). Index-only: no data changes, and the runner skips an index that already exists.
-- InnoDB builds secondary indexes online (ALGORITHM=INPLACE, LOCK=NONE), so the table stays readable and writable.

ALTER TABLE bos_invoices ADD INDEX idx_bos_invoices_issue (tenant_id, issue_date), ALGORITHM=INPLACE, LOCK=NONE;

ALTER TABLE bos_invoices ADD INDEX idx_bos_invoices_source_issue (tenant_id, source_tool, issue_date), ALGORITHM=INPLACE, LOCK=NONE;
