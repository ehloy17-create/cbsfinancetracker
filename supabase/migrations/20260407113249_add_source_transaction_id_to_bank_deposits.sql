/*
  # Add source_transaction_id to bank_deposits

  ## Changes
  - Adds `source_transaction_id` (uuid, nullable FK → transactions.id ON DELETE SET NULL)
    to the `bank_deposits` table so each deposit created from a GCash "move to bank"
    cash-out can be traced back to the originating GCash transaction.

  ## Purpose
  - Enables two-way deletion: deleting the GCash cash-out transaction can find and
    reverse the paired bank_deposit and bank_transaction records, and vice-versa.
  - Enables the Bank deposits tab to show a delete action only on GCash-linked deposits
    without exposing manual entries to accidental deletion.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_deposits' AND column_name = 'source_transaction_id'
  ) THEN
    ALTER TABLE bank_deposits
      ADD COLUMN source_transaction_id uuid REFERENCES transactions(id) ON DELETE SET NULL;
  END IF;
END $$;
