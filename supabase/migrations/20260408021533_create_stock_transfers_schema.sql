/*
  # Stock Transfers Schema

  ## Overview
  Manages movement of inventory between locations (warehouse-to-store or store-to-store).

  ## New Tables

  ### stock_transfers
  - Header record for each inter-location stock transfer.
  - Tracks source location, destination location, status, and metadata.
  - Statuses: draft → approved → issued → partially_received | fully_received, or cancelled.

  ### stock_transfer_items
  - Line items for each transfer: product, requested qty, issued qty, received qty.
  - qty_in_transit is computed as issued minus received.
  - qty_variance is computed as received minus issued (negative = shortage).

  ## RPC Functions

  ### issue_stock_transfer(p_transfer_id, p_issued_by)
  - Deducts issued quantities from source location inventory_balances.
  - Creates transfer_out inventory_movements.
  - Transitions status to 'issued'.

  ### receive_stock_transfer(p_transfer_id, p_transfer_items jsonb, p_received_by)
  - Adds received quantities to destination location inventory_balances.
  - Creates transfer_in inventory_movements.
  - Transitions status to 'partially_received' or 'fully_received'.

  ## Security
  - RLS enabled on both tables.
  - Authenticated users can read; admins can insert/update/delete.
*/

-- ============================================================
-- stock_transfers table
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                      uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_number         text UNIQUE NOT NULL,
  source_location_id      uuid NOT NULL REFERENCES inv_locations(id),
  destination_location_id uuid NOT NULL REFERENCES inv_locations(id),
  status                  text NOT NULL DEFAULT 'draft'
                            CHECK (status IN ('draft','approved','issued','partially_received','fully_received','cancelled')),
  transfer_date           date NOT NULL DEFAULT CURRENT_DATE,
  expected_date           date,
  notes                   text NOT NULL DEFAULT '',
  approved_by             uuid REFERENCES profiles(id),
  approved_at             timestamptz,
  issued_by               uuid REFERENCES profiles(id),
  issued_at               timestamptz,
  created_by              uuid REFERENCES profiles(id),
  updated_by              uuid REFERENCES profiles(id),
  created_at              timestamptz NOT NULL DEFAULT now(),
  updated_at              timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT chk_different_locations CHECK (source_location_id <> destination_location_id)
);

CREATE INDEX IF NOT EXISTS stock_transfers_source_location_idx ON stock_transfers(source_location_id);
CREATE INDEX IF NOT EXISTS stock_transfers_dest_location_idx ON stock_transfers(destination_location_id);
CREATE INDEX IF NOT EXISTS stock_transfers_status_idx ON stock_transfers(status);
CREATE INDEX IF NOT EXISTS stock_transfers_transfer_date_idx ON stock_transfers(transfer_date);

ALTER TABLE stock_transfers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_transfers"
  ON stock_transfers FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert stock_transfers"
  ON stock_transfers FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update stock_transfers"
  ON stock_transfers FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete stock_transfers"
  ON stock_transfers FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- ============================================================
-- stock_transfer_items table
-- ============================================================
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  transfer_id     uuid NOT NULL REFERENCES stock_transfers(id) ON DELETE CASCADE,
  product_id      uuid NOT NULL REFERENCES inv_products(id),
  qty_requested   numeric(12,3) NOT NULL CHECK (qty_requested > 0),
  qty_issued      numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_issued >= 0),
  qty_received    numeric(12,3) NOT NULL DEFAULT 0 CHECK (qty_received >= 0),
  qty_in_transit  numeric(12,3) GENERATED ALWAYS AS (qty_issued - qty_received) STORED,
  qty_variance    numeric(12,3) GENERATED ALWAYS AS (qty_received - qty_issued) STORED,
  unit_cost       numeric(14,2),
  notes           text NOT NULL DEFAULT '',
  sort_order      integer NOT NULL DEFAULT 0,
  source_movement_id uuid REFERENCES inventory_movements(id),
  dest_movement_id   uuid REFERENCES inventory_movements(id),
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS stock_transfer_items_transfer_id_idx ON stock_transfer_items(transfer_id);
CREATE INDEX IF NOT EXISTS stock_transfer_items_product_id_idx ON stock_transfer_items(product_id);

ALTER TABLE stock_transfer_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read stock_transfer_items"
  ON stock_transfer_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Admins can insert stock_transfer_items"
  ON stock_transfer_items FOR INSERT TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update stock_transfer_items"
  ON stock_transfer_items FOR UPDATE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete stock_transfer_items"
  ON stock_transfer_items FOR DELETE TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- ============================================================
-- Sequence for transfer_number
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS transfer_number_seq START 1;

-- ============================================================
-- Function: issue_stock_transfer
-- Deducts from source, creates transfer_out movements, sets status to 'issued'
-- ============================================================
CREATE OR REPLACE FUNCTION issue_stock_transfer(
  p_transfer_id uuid,
  p_issued_by   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer      RECORD;
  v_item          RECORD;
  v_balance_before numeric(12,3);
  v_movement_id   uuid;
  v_ref           text;
  v_dest_name     text;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status <> 'approved' THEN
    RAISE EXCEPTION 'Transfer must be approved before issuing. Current status: %', v_transfer.status;
  END IF;

  v_ref := v_transfer.transfer_number;
  SELECT name INTO v_dest_name FROM inv_locations WHERE id = v_transfer.destination_location_id;

  FOR v_item IN
    SELECT * FROM stock_transfer_items WHERE transfer_id = p_transfer_id
  LOOP
    SELECT COALESCE(qty_on_hand, 0) INTO v_balance_before
    FROM inventory_balances
    WHERE product_id = v_item.product_id AND location_id = v_transfer.source_location_id;

    IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;

    IF v_balance_before < v_item.qty_requested THEN
      RAISE EXCEPTION 'Insufficient stock for product %. Available: %, Requested: %',
        v_item.product_id, v_balance_before, v_item.qty_requested;
    END IF;

    INSERT INTO inventory_movements (
      product_id, location_id, movement_type,
      qty_change, qty_before, qty_after,
      unit_cost, ref_number, notes,
      related_location_id, created_by, created_at
    ) VALUES (
      v_item.product_id,
      v_transfer.source_location_id,
      'transfer_out',
      -v_item.qty_requested,
      v_balance_before,
      v_balance_before - v_item.qty_requested,
      v_item.unit_cost,
      v_ref,
      'Transfer to ' || v_dest_name,
      v_transfer.destination_location_id,
      p_issued_by,
      now()
    ) RETURNING id INTO v_movement_id;

    INSERT INTO inventory_balances (product_id, location_id, qty_on_hand, qty_available, last_movement_at)
    VALUES (v_item.product_id, v_transfer.source_location_id,
            v_balance_before - v_item.qty_requested,
            v_balance_before - v_item.qty_requested, now())
    ON CONFLICT (product_id, location_id) DO UPDATE
      SET qty_on_hand    = inventory_balances.qty_on_hand - v_item.qty_requested,
          qty_available  = inventory_balances.qty_available - v_item.qty_requested,
          last_movement_at = now(),
          updated_at     = now();

    UPDATE stock_transfer_items
    SET qty_issued = v_item.qty_requested,
        source_movement_id = v_movement_id,
        updated_at = now()
    WHERE id = v_item.id;
  END LOOP;

  UPDATE stock_transfers
  SET status     = 'issued',
      issued_by  = p_issued_by,
      issued_at  = now(),
      updated_by = p_issued_by,
      updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;

-- ============================================================
-- Function: receive_stock_transfer
-- Adds to destination, creates transfer_in movements, updates status
-- p_receive_items: [{transfer_item_id, qty_received}]
-- ============================================================
CREATE OR REPLACE FUNCTION receive_stock_transfer(
  p_transfer_id   uuid,
  p_receive_items jsonb,
  p_received_by   uuid DEFAULT NULL
)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_transfer       RECORD;
  v_item           RECORD;
  v_ri             RECORD;
  v_balance_before numeric(12,3);
  v_movement_id    uuid;
  v_ref            text;
  v_qty_recv       numeric(12,3);
  v_all_received   boolean;
  v_src_name       text;
BEGIN
  SELECT * INTO v_transfer FROM stock_transfers WHERE id = p_transfer_id FOR UPDATE;
  IF NOT FOUND THEN RAISE EXCEPTION 'Transfer % not found', p_transfer_id; END IF;
  IF v_transfer.status NOT IN ('issued','partially_received') THEN
    RAISE EXCEPTION 'Transfer must be issued to receive. Current status: %', v_transfer.status;
  END IF;

  v_ref := v_transfer.transfer_number;
  SELECT name INTO v_src_name FROM inv_locations WHERE id = v_transfer.source_location_id;

  FOR v_ri IN
    SELECT (elem->>'transfer_item_id')::uuid AS transfer_item_id,
           (elem->>'qty_received')::numeric   AS qty_received
    FROM jsonb_array_elements(p_receive_items) AS elem
  LOOP
    SELECT * INTO v_item
    FROM stock_transfer_items
    WHERE id = v_ri.transfer_item_id AND transfer_id = p_transfer_id;
    IF NOT FOUND THEN CONTINUE; END IF;

    v_qty_recv := v_ri.qty_received;
    IF v_qty_recv <= 0 THEN CONTINUE; END IF;
    IF v_qty_recv > v_item.qty_in_transit THEN
      v_qty_recv := v_item.qty_in_transit;
    END IF;
    IF v_qty_recv <= 0 THEN CONTINUE; END IF;

    SELECT COALESCE(qty_on_hand, 0) INTO v_balance_before
    FROM inventory_balances
    WHERE product_id = v_item.product_id AND location_id = v_transfer.destination_location_id;
    IF v_balance_before IS NULL THEN v_balance_before := 0; END IF;

    INSERT INTO inventory_movements (
      product_id, location_id, movement_type,
      qty_change, qty_before, qty_after,
      unit_cost, ref_number, notes,
      related_location_id, created_by, created_at
    ) VALUES (
      v_item.product_id,
      v_transfer.destination_location_id,
      'transfer_in',
      v_qty_recv,
      v_balance_before,
      v_balance_before + v_qty_recv,
      v_item.unit_cost,
      v_ref,
      'Transfer from ' || v_src_name,
      v_transfer.source_location_id,
      p_received_by,
      now()
    ) RETURNING id INTO v_movement_id;

    INSERT INTO inventory_balances (product_id, location_id, qty_on_hand, qty_available, last_movement_at)
    VALUES (v_item.product_id, v_transfer.destination_location_id,
            v_balance_before + v_qty_recv, v_balance_before + v_qty_recv, now())
    ON CONFLICT (product_id, location_id) DO UPDATE
      SET qty_on_hand    = inventory_balances.qty_on_hand + v_qty_recv,
          qty_available  = inventory_balances.qty_available + v_qty_recv,
          last_movement_at = now(),
          updated_at     = now();

    UPDATE stock_transfer_items
    SET qty_received   = qty_received + v_qty_recv,
        dest_movement_id = v_movement_id,
        updated_at     = now()
    WHERE id = v_item.id;
  END LOOP;

  SELECT bool_and(qty_in_transit <= 0) INTO v_all_received
  FROM stock_transfer_items WHERE transfer_id = p_transfer_id;

  UPDATE stock_transfers
  SET status     = CASE WHEN v_all_received THEN 'fully_received' ELSE 'partially_received' END,
      updated_by = p_received_by,
      updated_at = now()
  WHERE id = p_transfer_id;
END;
$$;
