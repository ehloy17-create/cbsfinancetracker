/*
  # Add POS Remittance and Move to Bank Cash Out Types

  ## Summary
  Extends the cash_out_type options on the transactions table and adds a bank_account_id
  column to link cash-out-to-bank transactions directly to a bank account record.

  ## Changes

  ### Modified Tables
  - **transactions**
    - New column: `bank_account_id` (uuid, nullable) — references bank_accounts.id for 'move_to_bank' type transactions
    - Updated constraint: `cash_out_type` now accepts 'pos_remittance' and 'move_to_bank' in addition to existing values

  ## New Cash Out Types
  - `pos_remittance`: Cash from the POS register is remitted to the physical cash fund
  - `move_to_bank`: GCash balance is moved to a bank account; transaction fee is deducted from GCash but NOT added to bank deposit

  ## Notes
  - Existing rows are unaffected; constraint is updated via drop and re-add
  - The bank_account_id foreign key is nullable to maintain backward compatibility
*/

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'bank_account_id'
  ) THEN
    ALTER TABLE transactions ADD COLUMN bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL;
  END IF;
END $$;

ALTER TABLE transactions DROP CONSTRAINT IF EXISTS transactions_cash_out_type_check;

ALTER TABLE transactions ADD CONSTRAINT transactions_cash_out_type_check
  CHECK (cash_out_type IN ('disbursement', 'add_to_cash_fund', 'pos_remittance', 'move_to_bank'));
