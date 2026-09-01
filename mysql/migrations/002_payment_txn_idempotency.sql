-- Idempotent payment webhooks: allow failed then success for same external id.
ALTER TABLE payment_transactions
  ADD UNIQUE KEY uq_pay_txn_provider_ext_st (provider, external_id, type, status);
