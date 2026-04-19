/*
  # Add Bank, Suppliers, Checks Issued, and Disbursements Tables

  ## Summary
  This migration creates four new tables to support expanded financial management:

  1. **bank_accounts** - Stores bank account information and balances
     - id, name, account_number, bank_name, beginning_balance, current_balance, is_active

  2. **bank_deposits** - Records deposits made to bank accounts
     - id, bank_account_id, date, amount, notes, created_by

  3. **suppliers** - List of suppliers/payees for check issuance
     - id, name, contact_person, phone, address, notes, is_active

  4. **checks_issued** - All checks issued (PDC and regular)
     - id, supplier_id, check_number, bank_account_id, check_date, amount, notes, status (pdc/outstanding/cleared/cancelled)
     - Status is computed from check_date but can be manually overridden (cleared/cancelled)

  5. **disbursements** - All disbursement transactions
     - id, date, payee, amount, purpose, payment_method (cash/check/gcash/creditcard/advances_to_owner)
     - check_id for linking to checks_issued when payment_method = 'check'

  ## Security
  - RLS enabled on all tables
  - Authenticated users can view all records
  - Only authenticated users can insert/update records
*/

-- Bank accounts table
CREATE TABLE IF NOT EXISTS bank_accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  account_number text NOT NULL DEFAULT '',
  bank_name text NOT NULL DEFAULT '',
  beginning_balance numeric(14,2) NOT NULL DEFAULT 0,
  current_balance numeric(14,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE bank_accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bank accounts"
  ON bank_accounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert bank accounts"
  ON bank_accounts FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bank accounts"
  ON bank_accounts FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Bank deposits table
CREATE TABLE IF NOT EXISTS bank_deposits (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  bank_account_id uuid NOT NULL REFERENCES bank_accounts(id) ON DELETE CASCADE,
  date date NOT NULL DEFAULT CURRENT_DATE,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE bank_deposits ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view bank deposits"
  ON bank_deposits FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert bank deposits"
  ON bank_deposits FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update bank deposits"
  ON bank_deposits FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

-- Suppliers table
CREATE TABLE IF NOT EXISTS suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL DEFAULT '',
  contact_person text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view suppliers"
  ON suppliers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert suppliers"
  ON suppliers FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update suppliers"
  ON suppliers FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete suppliers"
  ON suppliers FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Checks issued table
CREATE TABLE IF NOT EXISTS checks_issued (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  check_number text NOT NULL DEFAULT '',
  bank_account_id uuid REFERENCES bank_accounts(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  check_date date NOT NULL,
  amount numeric(14,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'outstanding' CHECK (status IN ('pdc', 'outstanding', 'cleared', 'cancelled')),
  manually_set_status boolean NOT NULL DEFAULT false,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE checks_issued ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view checks issued"
  ON checks_issued FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert checks issued"
  ON checks_issued FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update checks issued"
  ON checks_issued FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete checks issued"
  ON checks_issued FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Disbursements table
CREATE TABLE IF NOT EXISTS disbursements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  payee text NOT NULL DEFAULT '',
  purpose text NOT NULL DEFAULT '',
  amount numeric(14,2) NOT NULL DEFAULT 0,
  payment_method text NOT NULL DEFAULT 'cash' CHECK (payment_method IN ('cash', 'check', 'gcash', 'creditcard', 'advances_to_owner')),
  check_id uuid REFERENCES checks_issued(id) ON DELETE SET NULL,
  check_number text NOT NULL DEFAULT '',
  supplier_id uuid REFERENCES suppliers(id) ON DELETE SET NULL,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE disbursements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view disbursements"
  ON disbursements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert disbursements"
  ON disbursements FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update disbursements"
  ON disbursements FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete disbursements"
  ON disbursements FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_bank_deposits_bank_account_id ON bank_deposits(bank_account_id);
CREATE INDEX IF NOT EXISTS idx_bank_deposits_date ON bank_deposits(date);
CREATE INDEX IF NOT EXISTS idx_checks_issued_check_date ON checks_issued(check_date);
CREATE INDEX IF NOT EXISTS idx_checks_issued_supplier_id ON checks_issued(supplier_id);
CREATE INDEX IF NOT EXISTS idx_checks_issued_status ON checks_issued(status);
CREATE INDEX IF NOT EXISTS idx_disbursements_date ON disbursements(date);
CREATE INDEX IF NOT EXISTS idx_disbursements_payment_method ON disbursements(payment_method);
CREATE INDEX IF NOT EXISTS idx_disbursements_check_id ON disbursements(check_id);
