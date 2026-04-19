/*
  # Add is_closed flag to transactions

  ## Summary
  Adds an `is_closed` boolean column to the `transactions` table.

  ## Changes
  - `transactions.is_closed` (boolean, default false) — set to true when a daily close archives the day's transactions

  ## Purpose
  After a daily close, transactions are marked as closed so the dashboard only shows the current (open) day's activity.
  The beginning balance for the new day comes from the archived ending balance.
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'is_closed'
  ) THEN
    ALTER TABLE transactions ADD COLUMN is_closed boolean NOT NULL DEFAULT false;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_is_closed ON transactions(is_closed);
