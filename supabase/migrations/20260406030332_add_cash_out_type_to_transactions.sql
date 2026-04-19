/*
  # Add cash_out_type to transactions

  ## Summary
  Adds a `cash_out_type` column to the `transactions` table to distinguish
  between two types of cash out transactions:

  1. `disbursement` — The cash out amount leaves the business (default behavior).
     GCash balance decreases. No effect on physical cash fund.

  2. `add_to_cash_fund` — The cash out amount is added to the physical cash fund.
     GCash balance decreases, but the physical cash fund INCREASES by that amount.
     This is used when withdrawing from GCash to replenish physical cash on hand.

  ## Modified Table: transactions
  - Added `cash_out_type` (text, nullable) — 'disbursement' | 'add_to_cash_fund'
    - Only relevant for `transaction_type = 'cash_out'`
    - NULL / 'disbursement' = standard disbursement (cash leaves the business)
    - 'add_to_cash_fund' = cash moves from GCash wallet to physical cash fund

  ## Notes
  - Existing cash_out records with NULL cash_out_type are treated as 'disbursement'
  - No data loss — purely additive change
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'cash_out_type'
  ) THEN
    ALTER TABLE transactions
      ADD COLUMN cash_out_type text
      CHECK (cash_out_type IN ('disbursement', 'add_to_cash_fund'));
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS idx_transactions_cash_out_type ON transactions(cash_out_type);
