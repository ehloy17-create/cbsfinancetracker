/*
  # Create POS Foundation Schema

  ## Overview
  Establishes the core data structure for the Point of Sale module in the retail
  grocery system. This migration creates terminals, shift management, sales
  transactions, and held sale (park/recall) functionality.

  ## New Tables

  ### pos_terminals
  - Represents physical or virtual POS stations
  - Linked to an inventory location (store/branch)
  - Tracks active/inactive state

  ### pos_shifts
  - One shift per cashier per terminal per business day
  - Tracks opening cash, actual cash count, expected cash, and over/short
  - Status: open | closed
  - Enforces: only one open shift per cashier per terminal

  ### sales
  - Master record for each transaction
  - Linked to shift, terminal, location, and cashier
  - Status: completed | held | cancelled | voided
  - Stores financial summary: subtotal, discounts, tax, total, tendered, change

  ### sale_items
  - Line items for each sale
  - Snapshots product name, barcode, SKU at time of sale
  - Stores cost_at_sale for margin reporting

  ### sale_payments
  - One or more payment records per sale (supports split payment)
  - Methods: cash | gcash | card | bank
  - Stores reference_no for non-cash payments

  ### held_sales
  - Parked/held transactions awaiting recall
  - Status: held | recalled | expired | cancelled

  ### held_sale_items
  - Line items for held sales (same structure as sale_items without cost)

  ## Security
  - RLS enabled on all 7 tables
  - Authenticated users can perform all operations

  ## Notes
  1. receipt_no uses a sequence to guarantee uniqueness across terminals
  2. hold_reference uses a sequence for easy recall by number
  3. All financial amounts stored as numeric(12,2) for precision
  4. Shift enforces uniqueness: one open shift per cashier+terminal
*/

-- Receipt number sequence
CREATE SEQUENCE IF NOT EXISTS pos_receipt_seq START 1;
CREATE SEQUENCE IF NOT EXISTS pos_hold_ref_seq START 1;

-- -------------------------------------------------------
-- pos_terminals
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_terminals (
  terminal_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_name text NOT NULL,
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  is_active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_terminals_location ON pos_terminals(location_id);

ALTER TABLE pos_terminals ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pos_terminals"
  ON pos_terminals FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert pos_terminals"
  ON pos_terminals FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update pos_terminals"
  ON pos_terminals FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- pos_shifts
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_shifts (
  shift_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  terminal_id uuid NOT NULL REFERENCES pos_terminals(terminal_id),
  cashier_id uuid NOT NULL REFERENCES profiles(id),
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  business_date date NOT NULL DEFAULT CURRENT_DATE,
  shift_open_time timestamptz NOT NULL DEFAULT now(),
  shift_close_time timestamptz,
  opening_cash numeric(12,2) NOT NULL DEFAULT 0,
  actual_cash_count numeric(12,2),
  expected_cash_count numeric(12,2),
  cash_over_short numeric(12,2),
  status text NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'closed')),
  notes text NOT NULL DEFAULT '',
  closed_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_pos_shifts_terminal ON pos_shifts(terminal_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_cashier ON pos_shifts(cashier_id);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_status ON pos_shifts(status);
CREATE INDEX IF NOT EXISTS idx_pos_shifts_date ON pos_shifts(business_date);

-- Enforce: one open shift per cashier per terminal
CREATE UNIQUE INDEX IF NOT EXISTS uq_open_shift_cashier_terminal
  ON pos_shifts(cashier_id, terminal_id)
  WHERE status = 'open';

ALTER TABLE pos_shifts ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read pos_shifts"
  ON pos_shifts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert pos_shifts"
  ON pos_shifts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update pos_shifts"
  ON pos_shifts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- sales
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receipt_no text NOT NULL UNIQUE DEFAULT ('R-' || LPAD(nextval('pos_receipt_seq')::text, 8, '0')),
  shift_id uuid NOT NULL REFERENCES pos_shifts(shift_id),
  terminal_id uuid NOT NULL REFERENCES pos_terminals(terminal_id),
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  cashier_id uuid NOT NULL REFERENCES profiles(id),
  sale_datetime timestamptz NOT NULL DEFAULT now(),
  sale_status text NOT NULL DEFAULT 'completed' CHECK (sale_status IN ('completed', 'held', 'cancelled', 'voided')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  tax_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  amount_tendered numeric(12,2) NOT NULL DEFAULT 0,
  change_amount numeric(12,2) NOT NULL DEFAULT 0,
  notes text NOT NULL DEFAULT '',
  voided_by uuid REFERENCES profiles(id),
  voided_at timestamptz,
  void_reason text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sales_shift ON sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_sales_terminal ON sales(terminal_id);
CREATE INDEX IF NOT EXISTS idx_sales_cashier ON sales(cashier_id);
CREATE INDEX IF NOT EXISTS idx_sales_datetime ON sales(sale_datetime);
CREATE INDEX IF NOT EXISTS idx_sales_status ON sales(sale_status);
CREATE INDEX IF NOT EXISTS idx_sales_location ON sales(location_id);

ALTER TABLE sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sales"
  ON sales FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert sales"
  ON sales FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update sales"
  ON sales FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- sale_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_items (
  sale_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  product_id uuid REFERENCES inv_products(id),
  barcode text NOT NULL DEFAULT '',
  sku_code text NOT NULL DEFAULT '',
  product_name_snapshot text NOT NULL DEFAULT '',
  qty numeric(12,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  cost_at_sale numeric(12,2),
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX IF NOT EXISTS idx_sale_items_product ON sale_items(product_id);

ALTER TABLE sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sale_items"
  ON sale_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert sale_items"
  ON sale_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update sale_items"
  ON sale_items FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete sale_items"
  ON sale_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- sale_payments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_payments (
  sale_payment_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sale_id uuid NOT NULL REFERENCES sales(sale_id) ON DELETE CASCADE,
  payment_method text NOT NULL CHECK (payment_method IN ('cash', 'gcash', 'card', 'bank')),
  amount numeric(12,2) NOT NULL DEFAULT 0,
  reference_no text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sale_payments_sale ON sale_payments(sale_id);

ALTER TABLE sale_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read sale_payments"
  ON sale_payments FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert sale_payments"
  ON sale_payments FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update sale_payments"
  ON sale_payments FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete sale_payments"
  ON sale_payments FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- held_sales
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS held_sales (
  held_sale_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  shift_id uuid NOT NULL REFERENCES pos_shifts(shift_id),
  terminal_id uuid NOT NULL REFERENCES pos_terminals(terminal_id),
  cashier_id uuid NOT NULL REFERENCES profiles(id),
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  hold_reference text NOT NULL UNIQUE DEFAULT ('H-' || LPAD(nextval('pos_hold_ref_seq')::text, 4, '0')),
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  total_amount numeric(12,2) NOT NULL DEFAULT 0,
  status text NOT NULL DEFAULT 'held' CHECK (status IN ('held', 'recalled', 'expired', 'cancelled')),
  notes text NOT NULL DEFAULT '',
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_held_sales_shift ON held_sales(shift_id);
CREATE INDEX IF NOT EXISTS idx_held_sales_terminal ON held_sales(terminal_id);
CREATE INDEX IF NOT EXISTS idx_held_sales_status ON held_sales(status);

ALTER TABLE held_sales ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read held_sales"
  ON held_sales FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert held_sales"
  ON held_sales FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update held_sales"
  ON held_sales FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

-- -------------------------------------------------------
-- held_sale_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS held_sale_items (
  held_sale_item_id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  held_sale_id uuid NOT NULL REFERENCES held_sales(held_sale_id) ON DELETE CASCADE,
  product_id uuid REFERENCES inv_products(id),
  barcode text NOT NULL DEFAULT '',
  sku_code text NOT NULL DEFAULT '',
  product_name_snapshot text NOT NULL DEFAULT '',
  qty numeric(12,4) NOT NULL DEFAULT 1,
  unit_price numeric(12,2) NOT NULL DEFAULT 0,
  discount_amount numeric(12,2) NOT NULL DEFAULT 0,
  subtotal numeric(12,2) NOT NULL DEFAULT 0,
  sort_order int NOT NULL DEFAULT 0,
  created_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_held_sale_items_held_sale ON held_sale_items(held_sale_id);

ALTER TABLE held_sale_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read held_sale_items"
  ON held_sale_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert held_sale_items"
  ON held_sale_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update held_sale_items"
  ON held_sale_items FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete held_sale_items"
  ON held_sale_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
