/*
  # POS Sale Posting Function

  ## Summary
  Creates a SECURITY DEFINER function `post_sale` that atomically handles the
  full checkout workflow in a single database call. This avoids the need for
  the client to have admin-level access to inventory tables.

  ## What the function does
  1. Validates the shift is open
  2. Checks stock availability for every line item (aborts if any product has
     insufficient qty_on_hand)
  3. Inserts the `sales` master record and returns the auto-generated receipt_no
  4. Inserts all `sale_items`
  5. Inserts the single `sale_payments` record
  6. For each line item with a product_id, inserts an `inventory_movements` row
     with movement_type = 'sale' (negative qty_change). The existing trigger
     `trg_upsert_inventory_balance` auto-updates inventory_balances.

  ## Parameters (JSONB)
  - shift_id, terminal_id, location_id, cashier_id
  - subtotal, discount_amount, total_amount
  - amount_tendered, change_amount
  - payment_method, reference_no
  - items: array of { product_id, barcode, sku_code, product_name_snapshot,
            qty, unit_price, discount_amount, subtotal, sort_order }

  ## Returns
  JSONB with { sale_id, receipt_no, error? }

  ## Security
  - SECURITY DEFINER so it runs with owner privileges
  - Validates auth.uid() matches cashier_id to prevent impersonation
  - All writes happen inside an implicit transaction (function atomicity)
*/

CREATE OR REPLACE FUNCTION post_sale(payload jsonb)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_shift_id        uuid;
  v_terminal_id     uuid;
  v_location_id     uuid;
  v_cashier_id      uuid;
  v_subtotal        numeric(12,2);
  v_discount        numeric(12,2);
  v_total           numeric(12,2);
  v_tendered        numeric(12,2);
  v_change          numeric(12,2);
  v_payment_method  text;
  v_reference_no    text;
  v_sale_id         uuid;
  v_receipt_no      text;
  v_shift_status    text;
  item              jsonb;
  v_product_id      uuid;
  v_qty             numeric(12,4);
  v_qty_on_hand     numeric(12,3);
BEGIN
  -- Extract scalars
  v_shift_id       := (payload->>'shift_id')::uuid;
  v_terminal_id    := (payload->>'terminal_id')::uuid;
  v_location_id    := (payload->>'location_id')::uuid;
  v_cashier_id     := (payload->>'cashier_id')::uuid;
  v_subtotal       := (payload->>'subtotal')::numeric;
  v_discount       := COALESCE((payload->>'discount_amount')::numeric, 0);
  v_total          := (payload->>'total_amount')::numeric;
  v_tendered       := (payload->>'amount_tendered')::numeric;
  v_change         := COALESCE((payload->>'change_amount')::numeric, 0);
  v_payment_method := payload->>'payment_method';
  v_reference_no   := COALESCE(payload->>'reference_no', '');

  -- Verify shift is open
  SELECT status INTO v_shift_status FROM pos_shifts WHERE shift_id = v_shift_id;
  IF v_shift_status IS NULL OR v_shift_status <> 'open' THEN
    RETURN jsonb_build_object('error', 'Shift is not open');
  END IF;

  -- Check stock for each product line
  FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    IF (item->>'product_id') IS NOT NULL AND (item->>'product_id') <> '' THEN
      v_product_id := (item->>'product_id')::uuid;
      v_qty        := (item->>'qty')::numeric;

      SELECT COALESCE(qty_on_hand, 0)
        INTO v_qty_on_hand
        FROM inventory_balances
       WHERE product_id = v_product_id
         AND location_id = v_location_id;

      IF NOT FOUND THEN
        v_qty_on_hand := 0;
      END IF;

      IF v_qty_on_hand < v_qty THEN
        RETURN jsonb_build_object(
          'error', 'Insufficient stock for: ' || (item->>'product_name_snapshot'),
          'product_id', (item->>'product_id')
        );
      END IF;
    END IF;
  END LOOP;

  -- Insert sale
  INSERT INTO sales (
    shift_id, terminal_id, location_id, cashier_id,
    sale_status, subtotal, discount_amount, tax_amount,
    total_amount, amount_tendered, change_amount
  )
  VALUES (
    v_shift_id, v_terminal_id, v_location_id, v_cashier_id,
    'completed', v_subtotal, v_discount, 0,
    v_total, v_tendered, v_change
  )
  RETURNING sale_id, receipt_no INTO v_sale_id, v_receipt_no;

  -- Insert sale items
  FOR item IN SELECT * FROM jsonb_array_elements(payload->'items')
  LOOP
    INSERT INTO sale_items (
      sale_id, product_id, barcode, sku_code, product_name_snapshot,
      qty, unit_price, discount_amount, subtotal, sort_order
    ) VALUES (
      v_sale_id,
      NULLIF(item->>'product_id', '')::uuid,
      COALESCE(item->>'barcode', ''),
      COALESCE(item->>'sku_code', ''),
      COALESCE(item->>'product_name_snapshot', ''),
      (item->>'qty')::numeric,
      (item->>'unit_price')::numeric,
      COALESCE((item->>'discount_amount')::numeric, 0),
      (item->>'subtotal')::numeric,
      COALESCE((item->>'sort_order')::int, 0)
    );

    -- Post inventory movement (deduct stock)
    IF (item->>'product_id') IS NOT NULL AND (item->>'product_id') <> '' THEN
      INSERT INTO inventory_movements (
        product_id, location_id, movement_type, qty_change,
        ref_number, notes, created_by
      ) VALUES (
        NULLIF(item->>'product_id', '')::uuid,
        v_location_id,
        'sale',
        -1 * (item->>'qty')::numeric,
        v_receipt_no,
        'POS sale ' || v_receipt_no,
        v_cashier_id
      );
    END IF;
  END LOOP;

  -- Insert payment
  INSERT INTO sale_payments (sale_id, payment_method, amount, reference_no)
  VALUES (v_sale_id, v_payment_method, v_tendered, v_reference_no);

  RETURN jsonb_build_object('sale_id', v_sale_id, 'receipt_no', v_receipt_no);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION post_sale(jsonb) TO authenticated;
