/*
  # Add Cash Daily History Table

  1. New Tables
    - `cash_daily_history`
      - `id` (uuid, primary key)
      - `date` (date, unique per day — one record per day)
      - `beginning_balance` (numeric) — opening physical cash on hand
      - `cash_fees_collected` (numeric) — cash fees earned from GCash transactions
      - `cash_given_out` (numeric) — cash paid out for GCash cash-ins from fund
      - `bank_deposits` (numeric) — cash deposited to bank
      - `cash_fund_disbursements` (numeric) — direct disbursements from fund
      - `ending_balance` (numeric) — closing cash on hand
      - `posted_at` (timestamptz)
      - `posted_by` (uuid, references profiles)

  2. Security
    - Enable RLS
    - Authenticated users can read
    - Only admins can insert/update
*/

CREATE TABLE IF NOT EXISTS cash_daily_history (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL UNIQUE,
  beginning_balance numeric(12,2) NOT NULL DEFAULT 0,
  cash_fees_collected numeric(12,2) NOT NULL DEFAULT 0,
  cash_given_out numeric(12,2) NOT NULL DEFAULT 0,
  bank_deposits numeric(12,2) NOT NULL DEFAULT 0,
  cash_fund_disbursements numeric(12,2) NOT NULL DEFAULT 0,
  ending_balance numeric(12,2) NOT NULL DEFAULT 0,
  posted_at timestamptz NOT NULL DEFAULT now(),
  posted_by uuid REFERENCES profiles(id) ON DELETE SET NULL
);

ALTER TABLE cash_daily_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read cash daily history"
  ON cash_daily_history FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert cash daily history"
  ON cash_daily_history FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update cash daily history"
  ON cash_daily_history FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_cash_daily_history_date ON cash_daily_history(date DESC);
