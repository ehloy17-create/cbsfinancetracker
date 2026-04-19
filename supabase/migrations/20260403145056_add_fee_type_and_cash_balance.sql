/*
  # Add Fee Type and Cash Balance Tracking

  1. Changes to transactions table
    - Add `fee_type` column: 'cash' or 'gcash' (default 'gcash')
      - 'gcash': transaction fee is collected via GCash (added to GCash balance)
      - 'cash': transaction fee is collected as physical cash (tracked in cash balance)

  2. Changes to system_state table
    - New keys will be used (upserted via app):
      - `cash_beginning_balance`: starting physical cash for the day
      - `current_cash_balance`: running physical cash balance
      - `cash_balance_date`: date the cash balance was last reset

  3. Notes
    - Existing transactions default to 'gcash' fee type (preserves existing behavior)
    - No data loss — only additive changes
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'fee_type'
  ) THEN
    ALTER TABLE transactions ADD COLUMN fee_type text NOT NULL DEFAULT 'gcash'
      CHECK (fee_type IN ('cash', 'gcash'));
  END IF;
END $$;
