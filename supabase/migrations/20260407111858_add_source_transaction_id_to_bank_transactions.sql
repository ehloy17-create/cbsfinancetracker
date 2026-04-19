/*
  # Add source_transaction_id to bank_transactions

  ## Changes
  - Adds `source_transaction_id` (uuid, nullable) to `bank_transactions` to link a bank deposit
    back to the originating GCash or cash transaction (from the `transactions` table).
  - This allows the bank ledger to show both sides of a move-to-bank or remittance operation
    as a single linked entry.

  ## Notes
  - Nullable: only populated for deposit-type transactions that originate from GCash/cash moves.
  - No FK constraint to avoid cascade issues; the link is informational.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_transactions' AND column_name = 'source_transaction_id'
  ) THEN
    ALTER TABLE bank_transactions ADD COLUMN source_transaction_id uuid DEFAULT NULL;
  END IF;
END $$;
