/*
  # Inventory Balances & Movements

  ## Summary
  Extends the inventory module with a full stock ledger system.
  Tracks stock per product per location, records every movement
  that affects inventory levels, and auto-maintains running balances.

  ## New Tables

  ### inventory_balances
  - One row per product per location
  - qty_on_hand auto-updated by trigger after every movement

  ### inventory_movements
  - Immutable ledger of every stock change
  - Supports 11 movement types
  - Stores qty_before, qty_after per movement

  ## Movement Types
  opening_balance, receiving, sale, transfer_out, transfer_in,
  adjustment_add, adjustment_deduct, physical_count, expired, damaged, loss

  ## Security
  - RLS enabled, authenticated users can read, admins can write
*/

-- -----------------------------------------------
-- Create enum type (idempotent via DO block)
-- -----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'inv_movement_type') THEN
    CREATE TYPE inv_movement_type AS ENUM (
      'opening_balance',
      'receiving',
      'sale',
      'transfer_out',
      'transfer_in',
      'adjustment_add',
      'adjustment_deduct',
      'physical_count',
      'expired',
      'damaged',
      'loss'
    );
  END IF;
END $$;

-- -----------------------------------------------
-- inventory_balances
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_balances (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES inv_products(id) ON DELETE CASCADE,
  location_id uuid NOT NULL REFERENCES inv_locations(id) ON DELETE CASCADE,
  qty_on_hand numeric(12,3) NOT NULL DEFAULT 0,
  qty_available numeric(12,3) NOT NULL DEFAULT 0,
  last_movement_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE(product_id, location_id)
);

CREATE INDEX IF NOT EXISTS idx_inv_bal_product ON inventory_balances(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_location ON inventory_balances(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_bal_qty ON inventory_balances(qty_on_hand);

ALTER TABLE inventory_balances ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inventory_balances"
  ON inventory_balances FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inventory_balances"
  ON inventory_balances FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inventory_balances"
  ON inventory_balances FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inventory_balances"
  ON inventory_balances FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inventory_movements
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES inv_products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES inv_locations(id) ON DELETE RESTRICT,
  movement_type inv_movement_type NOT NULL,
  qty_change numeric(12,3) NOT NULL,
  qty_before numeric(12,3) NOT NULL DEFAULT 0,
  qty_after numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2),
  ref_number text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  related_location_id uuid REFERENCES inv_locations(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_mov_product ON inventory_movements(product_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_location ON inventory_movements(location_id);
CREATE INDEX IF NOT EXISTS idx_inv_mov_type ON inventory_movements(movement_type);
CREATE INDEX IF NOT EXISTS idx_inv_mov_created_at ON inventory_movements(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_inv_mov_product_location ON inventory_movements(product_id, location_id, created_at DESC);

ALTER TABLE inventory_movements ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inventory_movements"
  ON inventory_movements FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inventory_movements"
  ON inventory_movements FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inventory_movements"
  ON inventory_movements FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inventory_movements"
  ON inventory_movements FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- Function: upsert_inventory_balance (trigger fn)
-- Fires after INSERT on inventory_movements
-- Updates qty_before/qty_after on the movement row
-- and upserts the running balance
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION upsert_inventory_balance()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  current_qty numeric(12,3);
  new_qty     numeric(12,3);
BEGIN
  SELECT COALESCE(qty_on_hand, 0)
    INTO current_qty
    FROM inventory_balances
   WHERE product_id = NEW.product_id
     AND location_id = NEW.location_id;

  IF NOT FOUND THEN
    current_qty := 0;
  END IF;

  new_qty := current_qty + NEW.qty_change;

  UPDATE inventory_movements
     SET qty_before = current_qty,
         qty_after  = new_qty
   WHERE id = NEW.id;

  INSERT INTO inventory_balances (product_id, location_id, qty_on_hand, qty_available, last_movement_at, updated_at)
  VALUES (NEW.product_id, NEW.location_id, new_qty, new_qty, NEW.created_at, now())
  ON CONFLICT (product_id, location_id)
  DO UPDATE SET
    qty_on_hand       = new_qty,
    qty_available     = new_qty,
    last_movement_at  = NEW.created_at,
    updated_at        = now();

  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_upsert_inventory_balance ON inventory_movements;
CREATE TRIGGER trg_upsert_inventory_balance
  AFTER INSERT ON inventory_movements
  FOR EACH ROW
  EXECUTE FUNCTION upsert_inventory_balance();
