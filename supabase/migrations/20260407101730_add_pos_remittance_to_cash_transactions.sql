/*
  # Add pos_remittance type to cash_transactions

  ## Summary
  Extends the cash_transactions table to support a new transaction type
  `pos_remittance` which represents POS register cash being transferred
  to the cash fund during a shift.

  ## Changes
  - Drops and recreates the check constraint on `transaction_type` to add 'pos_remittance'
*/

ALTER TABLE cash_transactions
  DROP CONSTRAINT IF EXISTS cash_transactions_transaction_type_check;

ALTER TABLE cash_transactions
  ADD CONSTRAINT cash_transactions_transaction_type_check
  CHECK (transaction_type IN ('beginning_balance', 'bank_deposit', 'cash_fund_disbursement', 'pos_remittance'));
