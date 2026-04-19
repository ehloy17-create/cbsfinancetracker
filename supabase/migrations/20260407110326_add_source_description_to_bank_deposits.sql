/*
  # Add source_description to bank_deposits

  ## Changes
  - Adds `source_description` (text) column to `bank_deposits` table to track what originated the deposit
    (e.g., "GCash move to bank", "Cash fund remittance to bank")
  - Adds `source_type` (text) column to distinguish deposit origins: 'gcash_move', 'cash_remittance', 'manual'

  ## Security
  - No RLS changes; bank_deposits inherits existing policies
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_deposits' AND column_name = 'source_description'
  ) THEN
    ALTER TABLE bank_deposits ADD COLUMN source_description text DEFAULT '';
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'bank_deposits' AND column_name = 'source_type'
  ) THEN
    ALTER TABLE bank_deposits ADD COLUMN source_type text DEFAULT 'manual';
  END IF;
END $$;
