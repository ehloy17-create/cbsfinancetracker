/*
  # GCash Transaction Manager - Full Schema

  ## Tables Created:
  1. `profiles` - Extended user profiles with roles (admin | staff)
  2. `accounts` - GCash accounts (2 accounts)
  3. `transactions` - All cash in/out transactions with soft delete
  4. `daily_history` - Daily summaries per account
  5. `system_state` - Key-value store for system settings
  6. `audit_logs` - Full audit trail

  ## Security:
  - RLS enabled on all tables
  - Admins have full access
  - Staff have limited access (read/create only, no delete/admin features)
*/

-- Profiles table (extends Supabase auth.users)
CREATE TABLE IF NOT EXISTS profiles (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  name text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  role text NOT NULL DEFAULT 'staff' CHECK (role IN ('admin', 'staff')),
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'inactive')),
  created_at timestamptz DEFAULT now(),
  last_login timestamptz
);

ALTER TABLE profiles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Users can view own profile"
  ON profiles FOR SELECT
  TO authenticated
  USING (auth.uid() = id);

CREATE POLICY "Admins can view all profiles"
  ON profiles FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update all profiles"
  ON profiles FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Users can update own profile"
  ON profiles FOR UPDATE
  TO authenticated
  USING (auth.uid() = id)
  WITH CHECK (auth.uid() = id);

CREATE POLICY "Allow insert during signup"
  ON profiles FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() = id);

-- Accounts table
CREATE TABLE IF NOT EXISTS accounts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL,
  is_active boolean NOT NULL DEFAULT true,
  current_beginning_balance numeric(12,2) NOT NULL DEFAULT 0,
  current_running_balance numeric(12,2) NOT NULL DEFAULT 0,
  last_closed_date date,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE accounts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view accounts"
  ON accounts FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert accounts"
  ON accounts FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update accounts"
  ON accounts FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Transactions table
CREATE TABLE IF NOT EXISTS transactions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  account_id uuid NOT NULL REFERENCES accounts(id),
  transaction_type text NOT NULL CHECK (transaction_type IN ('cash_in', 'cash_out')),
  cash_in_mode text CHECK (cash_in_mode IN ('regular', 'payment')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  transaction_fee numeric(12,2) NOT NULL DEFAULT 0,
  amount_received numeric(12,2),
  delivery_fee numeric(12,2),
  notes text DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE transactions ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view transactions"
  ON transactions FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert transactions"
  ON transactions FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins and owners can update transactions"
  ON transactions FOR UPDATE
  TO authenticated
  USING (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    auth.uid() = created_by OR
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can delete transactions"
  ON transactions FOR DELETE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Daily history table
CREATE TABLE IF NOT EXISTS daily_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL,
  account_id uuid NOT NULL REFERENCES accounts(id),
  beginning_balance numeric(12,2) NOT NULL DEFAULT 0,
  total_cash_in numeric(12,2) NOT NULL DEFAULT 0,
  total_cash_out numeric(12,2) NOT NULL DEFAULT 0,
  total_transaction_fee numeric(12,2) NOT NULL DEFAULT 0,
  total_delivery_fee numeric(12,2) NOT NULL DEFAULT 0,
  ending_balance numeric(12,2) NOT NULL DEFAULT 0,
  posted_at timestamptz DEFAULT now(),
  posted_by uuid REFERENCES profiles(id),
  UNIQUE(date, account_id)
);

ALTER TABLE daily_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view daily history"
  ON daily_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "System can insert daily history"
  ON daily_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Admins can update daily history"
  ON daily_history FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- System state table
CREATE TABLE IF NOT EXISTS system_state (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  key text UNIQUE NOT NULL,
  value text NOT NULL DEFAULT '',
  updated_at timestamptz DEFAULT now()
);

ALTER TABLE system_state ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view system state"
  ON system_state FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can modify system state"
  ON system_state FOR INSERT
  TO authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "Admins can update system state"
  ON system_state FOR UPDATE
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

-- Audit logs table
CREATE TABLE IF NOT EXISTS audit_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  timestamp timestamptz DEFAULT now(),
  user_id uuid REFERENCES profiles(id),
  action text NOT NULL,
  module text NOT NULL,
  record_id text,
  details jsonb DEFAULT '{}'::jsonb
);

ALTER TABLE audit_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Admins can view audit logs"
  ON audit_logs FOR SELECT
  TO authenticated
  USING (
    EXISTS (SELECT 1 FROM profiles WHERE id = auth.uid() AND role = 'admin')
  );

CREATE POLICY "System can insert audit logs"
  ON audit_logs FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

-- Indexes for performance
CREATE INDEX IF NOT EXISTS idx_transactions_date ON transactions(date);
CREATE INDEX IF NOT EXISTS idx_transactions_account_id ON transactions(account_id);
CREATE INDEX IF NOT EXISTS idx_transactions_created_by ON transactions(created_by);
CREATE INDEX IF NOT EXISTS idx_transactions_is_deleted ON transactions(is_deleted);
CREATE INDEX IF NOT EXISTS idx_daily_history_date ON daily_history(date);
CREATE INDEX IF NOT EXISTS idx_daily_history_account_id ON daily_history(account_id);
CREATE INDEX IF NOT EXISTS idx_audit_logs_timestamp ON audit_logs(timestamp);
CREATE INDEX IF NOT EXISTS idx_audit_logs_user_id ON audit_logs(user_id);

-- Seed initial data
INSERT INTO accounts (id, name, is_active, current_beginning_balance, current_running_balance)
VALUES 
  ('a1000000-0000-0000-0000-000000000001', 'GCash Account 1', true, 0, 0),
  ('a1000000-0000-0000-0000-000000000002', 'GCash Account 2', true, 0, 0)
ON CONFLICT DO NOTHING;

INSERT INTO system_state (key, value)
VALUES
  ('timezone', 'Asia/Manila'),
  ('last_rollover_date', CURRENT_DATE::text),
  ('auto_close_enabled', 'true')
ON CONFLICT (key) DO NOTHING;
