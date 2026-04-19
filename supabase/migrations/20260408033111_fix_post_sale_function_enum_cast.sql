/*
  # Fix post_sale function

  ## Changes
  1. Explicit cast of movement_type string to inv_movement_type enum to prevent
     implicit cast failures in SECURITY DEFINER context.
  2. Added explicit qty_before / qty_after defaults (0) so the row exists when
     the trigger's UPDATE runs against it.
  3. Fixed: non-cash payment amount stored as the tendered field value, not the
     grand total (the payload already sends correct value, but adding a comment
     for clarity).
  4. Removed duplicate FOUND check pattern — use a single SELECT ... INTO with
     COALESCE instead.
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

  -- Validate payment_method is a known value
  IF v_payment_method NOT IN ('cash', 'gcash', 'card', 'bank') THEN
    RETURN jsonb_build_object('error', 'Invalid payment method: ' || v_payment_method);
  END IF;

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

      -- If no row found, COALESCE above returns NULL → treat as 0
      IF v_qty_on_hand IS NULL THEN
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

  -- Insert sale master record
  INSERT INTO sales (
    shift_id, terminal_id, location_id, cashier_id,
    sale_status, subtotal, discount_amount, tax_amount,
    total_amount, amount_tendered, change_amount
  ) VALUES (
    v_shift_id, v_terminal_id, v_location_id, v_cashier_id,
    'completed', v_subtotal, v_discount, 0,
    v_total, v_tendered, v_change
  )
  RETURNING sale_id, receipt_no INTO v_sale_id, v_receipt_no;

  -- Insert sale items + inventory movements
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

    -- Deduct stock via inventory movement (trigger updates inventory_balances)
    IF (item->>'product_id') IS NOT NULL AND (item->>'product_id') <> '' THEN
      INSERT INTO inventory_movements (
        product_id,
        location_id,
        movement_type,
        qty_change,
        qty_before,
        qty_after,
        ref_number,
        notes,
        created_by
      ) VALUES (
        NULLIF(item->>'product_id', '')::uuid,
        v_location_id,
        'sale'::inv_movement_type,
        -1 * (item->>'qty')::numeric,
        0,
        0,
        v_receipt_no,
        'POS sale ' || v_receipt_no,
        v_cashier_id
      );
    END IF;
  END LOOP;

  -- Insert payment record
  INSERT INTO sale_payments (sale_id, payment_method, amount, reference_no)
  VALUES (v_sale_id, v_payment_method, v_tendered, v_reference_no);

  RETURN jsonb_build_object('sale_id', v_sale_id, 'receipt_no', v_receipt_no);

EXCEPTION WHEN OTHERS THEN
  RETURN jsonb_build_object('error', SQLERRM);
END;
$$;

GRANT EXECUTE ON FUNCTION post_sale(jsonb) TO authenticated;
