/*
  # Add cash_fund_disbursement transaction type

  ## Summary
  Extends the cash_transactions table to support a new transaction type:
  - `cash_fund_disbursement` — records a direct cash disbursement from the physical
    cash fund (e.g., paying a supplier or expense directly from cash on hand).
    This deducts from the cash fund balance, similar to a bank deposit.

  ## Changes
  - Modified Table: cash_transactions
    - Updated `transaction_type` CHECK constraint to also allow 'cash_fund_disbursement'

  ## Notes
  - Existing data is unaffected (constraint only adds a new allowed value)
  - The cash fund running balance formula treats cash_fund_disbursement as a deduction
*/

ALTER TABLE cash_transactions
  DROP CONSTRAINT IF EXISTS cash_transactions_transaction_type_check;

ALTER TABLE cash_transactions
  ADD CONSTRAINT cash_transactions_transaction_type_check
  CHECK (transaction_type IN ('beginning_balance', 'bank_deposit', 'cash_fund_disbursement'));
