/*
  # Receiving Module

  ## Summary
  Adds a full goods-receiving system linked to the purchase order module.
  Supports partial and multiple receiving transactions per PO, lot tracking
  for expiry-enabled products, and automatic inventory movement creation.

  ## New Tables

  ### receivings
  - Header record per receiving transaction
  - Always linked to an approved/partially-received PO
  - Fields: supplier, location, invoice_number, dr_number, receiving_date, remarks
  - Statuses: draft (being entered), posted (inventory updated)

  ### receiving_items
  - One row per product received per transaction
  - Tracks: qty_received (accepted), qty_rejected, unit_cost
  - Expiry date and batch_number for lot-tracked products

  ### product_lots
  - Created for each receiving_item where expiry_tracked = true
  - Stores batch_number, expiry_date, qty_on_hand per lot
  - near_expiry_days configurable per product (default 90 days)
  - Links to receiving_item and inventory_movement

  ## Triggers / Functions
  - post_receiving: when status changes to 'posted', inserts inventory_movements
    and updates PO line qty_received (which auto-updates PO status via existing trigger)
  - Prevents posting if any item would exceed remaining PO qty (unless admin_override = true)

  ## Security
  - RLS on all new tables
  - Authenticated users can read
  - Admins can write

  ## Notes
  - Only approved/partially_received POs can be received against
  - Cancelling a posted receiving reverses movements (future enhancement placeholder)
  - near_expiry_days stored on inv_products table via new column
*/

-- -----------------------------------------------
-- Add near_expiry_days to inv_products
-- -----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_name = 'inv_products' AND column_name = 'near_expiry_days'
  ) THEN
    ALTER TABLE inv_products ADD COLUMN near_expiry_days int NOT NULL DEFAULT 90;
  END IF;
END $$;

-- -----------------------------------------------
-- receiving_status enum
-- -----------------------------------------------
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'receiving_status') THEN
    CREATE TYPE receiving_status AS ENUM ('draft', 'posted', 'cancelled');
  END IF;
END $$;

-- -----------------------------------------------
-- receivings
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS receivings (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_number text UNIQUE NOT NULL DEFAULT '',
  po_id uuid NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  supplier_id uuid NOT NULL REFERENCES inv_suppliers(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES inv_locations(id) ON DELETE RESTRICT,
  status receiving_status NOT NULL DEFAULT 'draft',
  receiving_date date NOT NULL DEFAULT CURRENT_DATE,
  invoice_number text NOT NULL DEFAULT '',
  dr_number text NOT NULL DEFAULT '',
  remarks text NOT NULL DEFAULT '',
  admin_override boolean NOT NULL DEFAULT false,
  posted_at timestamptz,
  posted_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  updated_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_recv_po ON receivings(po_id);
CREATE INDEX IF NOT EXISTS idx_recv_supplier ON receivings(supplier_id);
CREATE INDEX IF NOT EXISTS idx_recv_location ON receivings(location_id);
CREATE INDEX IF NOT EXISTS idx_recv_status ON receivings(status);
CREATE INDEX IF NOT EXISTS idx_recv_date ON receivings(receiving_date DESC);

ALTER TABLE receivings ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read receivings"
  ON receivings FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert receivings"
  ON receivings FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update receivings"
  ON receivings FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete receivings"
  ON receivings FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- receiving_items
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS receiving_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  receiving_id uuid NOT NULL REFERENCES receivings(id) ON DELETE CASCADE,
  po_item_id uuid REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  product_id uuid NOT NULL REFERENCES inv_products(id) ON DELETE RESTRICT,
  qty_ordered numeric(12,3) NOT NULL DEFAULT 0,
  qty_prev_received numeric(12,3) NOT NULL DEFAULT 0,
  qty_remaining numeric(12,3) NOT NULL DEFAULT 0,
  qty_received numeric(12,3) NOT NULL DEFAULT 0,
  qty_accepted numeric(12,3) NOT NULL DEFAULT 0,
  qty_rejected numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  expiry_date date,
  batch_number text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  movement_id uuid REFERENCES inventory_movements(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_ri_receiving ON receiving_items(receiving_id);
CREATE INDEX IF NOT EXISTS idx_ri_product ON receiving_items(product_id);
CREATE INDEX IF NOT EXISTS idx_ri_po_item ON receiving_items(po_item_id);

ALTER TABLE receiving_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read receiving_items"
  ON receiving_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert receiving_items"
  ON receiving_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update receiving_items"
  ON receiving_items FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete receiving_items"
  ON receiving_items FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- product_lots
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS product_lots (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  product_id uuid NOT NULL REFERENCES inv_products(id) ON DELETE RESTRICT,
  location_id uuid NOT NULL REFERENCES inv_locations(id) ON DELETE RESTRICT,
  receiving_item_id uuid REFERENCES receiving_items(id) ON DELETE SET NULL,
  movement_id uuid REFERENCES inventory_movements(id) ON DELETE SET NULL,
  batch_number text NOT NULL DEFAULT '',
  expiry_date date NOT NULL,
  qty_received numeric(12,3) NOT NULL DEFAULT 0,
  qty_on_hand numeric(12,3) NOT NULL DEFAULT 0,
  unit_cost numeric(12,2) NOT NULL DEFAULT 0,
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_lots_product ON product_lots(product_id);
CREATE INDEX IF NOT EXISTS idx_lots_location ON product_lots(location_id);
CREATE INDEX IF NOT EXISTS idx_lots_expiry ON product_lots(expiry_date ASC);
CREATE INDEX IF NOT EXISTS idx_lots_active ON product_lots(is_active) WHERE is_active = true;

ALTER TABLE product_lots ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read product_lots"
  ON product_lots FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert product_lots"
  ON product_lots FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update product_lots"
  ON product_lots FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete product_lots"
  ON product_lots FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- Function: generate_receiving_number
-- Format: RCV-YYYYMMDD-NNNN
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION generate_receiving_number()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  today_str text;
  seq_num   int;
BEGIN
  today_str := to_char(CURRENT_DATE, 'YYYYMMDD');
  SELECT COUNT(*) + 1 INTO seq_num
    FROM receivings
   WHERE receiving_number LIKE 'RCV-' || today_str || '-%';
  NEW.receiving_number := 'RCV-' || today_str || '-' || LPAD(seq_num::text, 4, '0');
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_generate_receiving_number ON receivings;
CREATE TRIGGER trg_generate_receiving_number
  BEFORE INSERT ON receivings
  FOR EACH ROW
  WHEN (NEW.receiving_number = '')
  EXECUTE FUNCTION generate_receiving_number();

-- -----------------------------------------------
-- Function: post_receiving
-- Called when status is set to 'posted'.
-- 1. Validates no item exceeds remaining qty (unless admin_override)
-- 2. Inserts inventory_movements for accepted qty
-- 3. Creates product_lots for expiry-tracked items
-- 4. Updates purchase_order_items.qty_received
--    (which auto-triggers PO status update)
-- 5. Sets posted_at
-- -----------------------------------------------
CREATE OR REPLACE FUNCTION post_receiving(p_receiving_id uuid, p_posted_by uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recv     receivings%ROWTYPE;
  v_item     receiving_items%ROWTYPE;
  v_prod     inv_products%ROWTYPE;
  v_override boolean;
  v_remaining numeric(12,3);
  v_move_id  uuid;
BEGIN
  SELECT * INTO v_recv FROM receivings WHERE id = p_receiving_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Receiving not found'; END IF;
  IF v_recv.status <> 'draft' THEN RAISE EXCEPTION 'Only draft receivings can be posted'; END IF;

  v_override := v_recv.admin_override;

  -- Validate quantities
  FOR v_item IN SELECT * FROM receiving_items WHERE receiving_id = p_receiving_id LOOP
    IF v_item.po_item_id IS NOT NULL THEN
      SELECT qty_ordered - qty_received INTO v_remaining
        FROM purchase_order_items WHERE id = v_item.po_item_id;
      IF v_item.qty_accepted > v_remaining AND NOT v_override THEN
        RAISE EXCEPTION 'Item % accepted qty (%) exceeds remaining PO qty (%)',
          v_item.product_id, v_item.qty_accepted, v_remaining;
      END IF;
    END IF;
  END LOOP;

  -- Process each item
  FOR v_item IN SELECT * FROM receiving_items WHERE receiving_id = p_receiving_id LOOP
    SELECT * INTO v_prod FROM inv_products WHERE id = v_item.product_id;

    IF v_item.qty_accepted > 0 THEN
      -- Insert inventory movement
      INSERT INTO inventory_movements (
        product_id, location_id, movement_type,
        qty_change, unit_cost, ref_number, notes, created_by
      ) VALUES (
        v_item.product_id,
        v_recv.location_id,
        'receiving',
        v_item.qty_accepted,
        v_item.unit_cost,
        v_recv.receiving_number,
        CASE WHEN v_recv.invoice_number <> '' THEN 'Invoice: ' || v_recv.invoice_number ELSE '' END,
        p_posted_by
      ) RETURNING id INTO v_move_id;

      -- Link movement to item
      UPDATE receiving_items SET movement_id = v_move_id WHERE id = v_item.id;

      -- Create lot if expiry-tracked
      IF v_prod.expiry_tracked AND v_item.expiry_date IS NOT NULL THEN
        INSERT INTO product_lots (
          product_id, location_id, receiving_item_id, movement_id,
          batch_number, expiry_date, qty_received, qty_on_hand, unit_cost
        ) VALUES (
          v_item.product_id,
          v_recv.location_id,
          v_item.id,
          v_move_id,
          v_item.batch_number,
          v_item.expiry_date,
          v_item.qty_accepted,
          v_item.qty_accepted,
          v_item.unit_cost
        );
      END IF;

      -- Update PO line qty_received
      IF v_item.po_item_id IS NOT NULL THEN
        UPDATE purchase_order_items
           SET qty_received = qty_received + v_item.qty_accepted,
               updated_at   = now()
         WHERE id = v_item.po_item_id;
      END IF;
    END IF;
  END LOOP;

  -- Mark as posted
  UPDATE receivings
     SET status     = 'posted',
         posted_at  = now(),
         posted_by  = p_posted_by,
         updated_at = now()
   WHERE id = p_receiving_id;
END;
$$;
