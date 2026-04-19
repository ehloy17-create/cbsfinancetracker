/*
  # Add total_cash_fees to daily_history

  ## Summary
  Adds a `total_cash_fees` column to `daily_history` to separately track fees
  collected as physical cash vs GCash fees. This allows the history page and
  daily close to accurately reflect both fee types.

  ## Changes
  - `daily_history`: new column `total_cash_fees numeric DEFAULT 0`

  ## Notes
  - Existing rows default to 0 (no data loss)
  - GCash fees (total_transaction_fee) affect GCash running balance
  - Cash fees (total_cash_fees) go to physical cash fund, not GCash balance
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'daily_history' AND column_name = 'total_cash_fees'
  ) THEN
    ALTER TABLE daily_history ADD COLUMN total_cash_fees numeric NOT NULL DEFAULT 0;
  END IF;
END $$;
