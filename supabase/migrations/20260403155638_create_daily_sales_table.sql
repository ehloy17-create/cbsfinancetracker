/*
  # Create Daily Sales Table

  ## Summary
  Creates a table to record daily sales entries including sales amount, cost of sales, and gross profit.

  ## New Tables

  ### daily_sales
  - `id` (uuid, primary key)
  - `date` (date) - the sales date
  - `description` (text) - optional description or note
  - `sales` (numeric) - total sales amount
  - `cost_of_sales` (numeric) - total cost of goods sold
  - `gross_profit` (numeric, computed as sales - cost_of_sales) - auto-calculated
  - `created_by` (uuid) - references auth.users
  - `created_at`, `updated_at` (timestamptz)
  - `is_deleted` (boolean, default false) - soft delete

  ## Security
  - RLS enabled
  - Authenticated users can view all records
  - Authenticated users can insert and update records
*/

CREATE TABLE IF NOT EXISTS daily_sales (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  date date NOT NULL DEFAULT CURRENT_DATE,
  description text NOT NULL DEFAULT '',
  sales numeric(14,2) NOT NULL DEFAULT 0,
  cost_of_sales numeric(14,2) NOT NULL DEFAULT 0,
  gross_profit numeric(14,2) GENERATED ALWAYS AS (sales - cost_of_sales) STORED,
  created_by uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  is_deleted boolean NOT NULL DEFAULT false
);

ALTER TABLE daily_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can view daily sales"
  ON daily_sales FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert daily sales"
  ON daily_sales FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update daily sales"
  ON daily_sales FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete daily sales"
  ON daily_sales FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);

CREATE INDEX IF NOT EXISTS idx_daily_sales_date ON daily_sales(date);
CREATE INDEX IF NOT EXISTS idx_daily_sales_is_deleted ON daily_sales(is_deleted);
