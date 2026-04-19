/*
  # Add Bank Transactions Ledger Table

  ## Overview
  Replaces the simple bank_deposits table with a comprehensive bank_transactions ledger
  that supports all transaction types for passbook-style bank reconciliation.

  ## New Tables

  ### bank_transactions
  A unified bank ledger table where every movement that affects a bank account balance
  is recorded as a row. This enables a passbook-style running balance view.

  Columns:
  - `id` (uuid, pk) - unique identifier
  - `bank_account_id` (uuid, fk) - links to bank_accounts
  - `date` (date) - transaction date
  - `tx_type` (text) - type: 'deposit', 'interest_income', 'bank_fee', 'check_payment', 'disbursement', 'adjustment'
  - `description` (text) - transaction description / payee / purpose
  - `ref_number` (text) - check number, reference, slip number
  - `amount` (numeric) - always positive
  - `direction` (text) - 'credit' (adds to balance) or 'debit' (deducts from balance)
  - `disbursement_id` (uuid, nullable) - links to disbursements if applicable
  - `check_id` (uuid, nullable) - links to checks_issued if applicable
  - `notes` (text)
  - `created_by` (uuid, fk to auth.users)
  - `is_deleted` (boolean, soft delete)
  - `created_at`, `updated_at` timestamps

  ## Security
  - RLS enabled with authenticated-only access policies
  - Indexes on bank_account_id, date, tx_type for performance
*/

CREATE TABLE IF NOT EXISTS bank_transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE RESTRICT,
  date date NOT NULL DEFAULT CURRENT_DATE,
  tx_type text NOT NULL CHECK (tx_type IN ('deposit', 'interest_income', 'bank_fee', 'check_payment', 'disbursement', 'adjustment')),
  description text NOT NULL DEFAULT '',
  ref_number text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  direction text NOT NULL CHECK (direction IN ('credit', 'debit')),
  disbursement_id uuid REFERENCES disbursements(id) ON DELETE SET NULL,
  check_id uuid REFERENCES checks_issued(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE bank_transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can select bank_transactions"
  ON bank_transactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert bank_transactions"
  ON bank_transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bank_transactions"
  ON bank_transactions FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_bank_transactions_account ON bank_transactions(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_date ON bank_transactions(date);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_type ON bank_transactions(tx_type);
CREATE INDEX IF NOT EXISTS idx_bank_transactions_deleted ON bank_transactions(is_deleted);

/*
  Migrate existing bank_deposits rows into the new bank_transactions table
  as 'deposit' / 'credit' entries, preserving history.
*/
INSERT INTO bank_transactions (
  bank_account_id, date, tx_type, description, amount, direction,
  notes, created_by, is_deleted, created_at, updated_at
)
SELECT
  bank_account_id,
  date,
  'deposit',
  'Deposit',
  amount,
  'credit',
  COALESCE(notes, ''),
  created_by,
  is_deleted,
  created_at,
  updated_at
FROM bank_deposits
WHERE is_deleted = false;
