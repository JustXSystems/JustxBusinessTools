-- Idempotent payment webhooks (existing production DBs).
-- Unique on provider + external_id + type + status so failed→success can both record.
ALTER TABLE payment_transactions
  ADD UNIQUE KEY uq_pay_txn_provider_ext_st (provider, external_id, type, status);
