/*
  # Create Cashier Remittances Table

  ## Summary
  Creates a dedicated `cashier_remittances` table to track all daily cashier remittance entries.
  Remittances represent internal fund transfers between sources (GCash accounts, POS register, cash fund)
  and destinations (cash fund or bank accounts).

  ## New Table: cashier_remittances

  ### Columns
  - `id` — UUID primary key
  - `date` — date of the remittance
  - `source_type` — where the funds come from: 'gcash1', 'gcash2', 'pos_register', 'cash_fund'
  - `source_account_id` — FK to accounts (GCash) if source is gcash1 or gcash2
  - `destination_type` — where the funds go: 'cash_fund' or 'bank'
  - `destination_bank_id` — FK to bank_accounts if destination is 'bank'
  - `amount` — remittance amount
  - `bank_fee` — bank fee deducted from source GCash account (only applies to GCash-to-bank remittances)
  - `notes` — optional notes
  - `created_by` — FK to profiles
  - `is_deleted` — soft delete flag
  - `created_at`, `updated_at` — timestamps

  ## Business Rules
  - GCash to bank: deduct (amount + bank_fee) from the GCash account; credit bank with amount
  - POS register to cash fund: add amount to cash fund; no bank fee
  - Cash fund to bank: deduct amount from cash fund; credit bank with amount; no bank fee from GCash
  - All bank-bound remittances create a deposit entry in bank_transactions

  ## Security
  - RLS enabled
  - Authenticated users can read, insert, update
*/

CREATE TABLE IF NOT EXISTS cashier_remittances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  source_type text NOT NULL CHECK (source_type IN ('gcash', 'pos_register', 'cash_fund')),
  source_account_id uuid REFERENCES accounts(id) ON DELETE SET NULL,
  destination_type text NOT NULL CHECK (destination_type IN ('cash_fund', 'bank')),
  destination_bank_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  amount numeric(12,2) NOT NULL DEFAULT 0,
  bank_fee numeric(12,2) NOT NULL DEFAULT 0,
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  is_deleted boolean NOT NULL DEFAULT false,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE cashier_remittances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cashier remittances"
  ON cashier_remittances FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cashier remittances"
  ON cashier_remittances FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update cashier remittances"
  ON cashier_remittances FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cashier_remittances_date ON cashier_remittances(date DESC);
CREATE INDEX IF NOT EXISTS idx_cashier_remittances_source_account ON cashier_remittances(source_account_id);
CREATE INDEX IF NOT EXISTS idx_cashier_remittances_dest_bank ON cashier_remittances(destination_bank_id);
CREATE INDEX IF NOT EXISTS idx_cashier_remittances_is_deleted ON cashier_remittances(is_deleted);
