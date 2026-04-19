/*
  # Add FK constraint for source_transaction_id on bank_transactions

  ## Changes
  - Adds a foreign key constraint from `bank_transactions.source_transaction_id`
    to `transactions.id` so Supabase can resolve the join in queries.
  - Uses ON DELETE SET NULL so deleting a GCash transaction doesn't cascade-delete
    the bank transaction entry.

  ## Notes
  - Only affects rows where source_transaction_id is non-null (GCash-originated deposits).
  - Existing rows with invalid UUIDs (remittance IDs pointing to non-existent transactions)
    are first nulled out to avoid FK violation on constraint creation.
*/

UPDATE bank_transactions
SET source_transaction_id = NULL
WHERE source_transaction_id IS NOT NULL
  AND source_transaction_id NOT IN (SELECT id FROM transactions);

ALTER TABLE bank_transactions
  ADD CONSTRAINT fk_bank_tx_source_transaction
  FOREIGN KEY (source_transaction_id)
  REFERENCES transactions(id)
  ON DELETE SET NULL;
