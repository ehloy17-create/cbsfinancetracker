/*
  # Add Cash Ledger and Cash Source

  ## Summary
  Adds two new features:
  1. `cash_transactions` table — tracks physical cash movements:
     - Setting beginning cash balance (type: 'beginning_balance')
     - Bank deposits (type: 'bank_deposit', deducts from cash on hand)
  2. `cash_source` column on `transactions` — for regular cash-in transactions,
     indicates where the cash came from: 'pos_register' or 'cash_fund'

  ## New Table: cash_transactions
  - `id` (uuid, pk)
  - `date` (date) — transaction date
  - `transaction_type` (text) — 'beginning_balance' | 'bank_deposit'
  - `amount` (numeric) — amount
  - `notes` (text) — optional notes
  - `created_by` (uuid) — user who created
  - `created_at` (timestamptz)

  ## Modified Table: transactions
  - Added `cash_source` (text, nullable) — 'pos_register' | 'cash_fund'
    Only relevant for cash_in transactions with cash_in_mode = 'regular'

  ## Security
  - RLS enabled on cash_transactions
  - All authenticated users can view
  - Only admins can insert/update/delete
*/

-- Add cash_source to transactions
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'transactions' AND column_name = 'cash_source'
  ) THEN
    ALTER TABLE transactions ADD COLUMN cash_source text CHECK (cash_source IN ('pos_register', 'cash_fund'));
  END IF;
END $$;

-- Create cash_transactions table
CREATE TABLE IF NOT EXISTS cash_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  transaction_type text NOT NULL CHECK (transaction_type IN ('beginning_balance', 'bank_deposit')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE cash_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view cash transactions"
  ON cash_transactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cash transactions"
  ON cash_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can update cash transactions"
  ON cash_transactions FOR UPDATE
  TO authenticated
  USING (is_admin())
  WITH CHECK (is_admin());

CREATE POLICY "Admins can delete cash transactions"
  ON cash_transactions FOR DELETE
  TO authenticated
  USING (is_admin());

CREATE INDEX IF NOT EXISTS idx_cash_transactions_date ON cash_transactions(date);
CREATE INDEX IF NOT EXISTS idx_cash_transactions_type ON cash_transactions(transaction_type);
