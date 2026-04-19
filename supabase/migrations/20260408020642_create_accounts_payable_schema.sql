/*
  # Accounts Payable Schema

  ## New Tables

  ### payables
  - Central accounts payable ledger. Each row represents a bill owed to a supplier,
    typically generated from a posted goods receiving.
  - Fields: supplier, PO reference, receiving reference, invoice details, amounts,
    payment status, due date, aging bucket.

  ### payable_payments
  - Records each payment or partial payment applied to a payable.
  - Fields: payment date, amount, payment method, reference number, remarks.

  ## Security
  - RLS enabled on both tables.
  - Authenticated users can read all payables (view-only for staff).
  - Only admins can insert/update/delete.

  ## Notes
  1. payment_status is computed as: unpaid | partial | paid | overdue
  2. amount_paid and balance_due are maintained via trigger on payable_payments.
  3. A trigger on receivings creates a payable when a receiving is posted (status → posted).
  4. created_from_receiving_id links back to the originating receiving record.
*/

-- ============================================================
-- payables table
-- ============================================================
CREATE TABLE IF NOT EXISTS payables (
  id                        uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_number            text UNIQUE NOT NULL,

  -- references
  supplier_id               uuid NOT NULL REFERENCES inv_suppliers(id),
  po_id                     uuid REFERENCES purchase_orders(id),
  receiving_id              uuid REFERENCES receivings(id),

  -- invoice info
  invoice_number            text NOT NULL DEFAULT '',
  invoice_date              date NOT NULL,
  due_date                  date NOT NULL,

  -- amounts
  total_amount              numeric(14,2) NOT NULL DEFAULT 0 CHECK (total_amount >= 0),
  amount_paid               numeric(14,2) NOT NULL DEFAULT 0 CHECK (amount_paid >= 0),
  balance_due               numeric(14,2) GENERATED ALWAYS AS (total_amount - amount_paid) STORED,

  -- status: unpaid | partial | paid | voided
  payment_status            text NOT NULL DEFAULT 'unpaid'
                              CHECK (payment_status IN ('unpaid','partial','paid','voided')),

  -- metadata
  remarks                   text NOT NULL DEFAULT '',
  created_by                uuid REFERENCES profiles(id),
  updated_by                uuid REFERENCES profiles(id),
  created_at                timestamptz NOT NULL DEFAULT now(),
  updated_at                timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS payables_receiving_id_unique ON payables(receiving_id)
  WHERE receiving_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS payables_supplier_id_idx ON payables(supplier_id);
CREATE INDEX IF NOT EXISTS payables_due_date_idx ON payables(due_date);
CREATE INDEX IF NOT EXISTS payables_payment_status_idx ON payables(payment_status);

ALTER TABLE payables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read payables"
  ON payables FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert payables"
  ON payables FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update payables"
  ON payables FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can delete payables"
  ON payables FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ============================================================
-- payable_payments table
-- ============================================================
CREATE TABLE IF NOT EXISTS payable_payments (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  payable_id       uuid NOT NULL REFERENCES payables(id) ON DELETE CASCADE,
  payment_date     date NOT NULL DEFAULT CURRENT_DATE,
  amount           numeric(14,2) NOT NULL CHECK (amount > 0),
  payment_method   text NOT NULL DEFAULT 'cash'
                     CHECK (payment_method IN ('cash','check','bank_transfer','gcash','other')),
  reference_number text NOT NULL DEFAULT '',
  remarks          text NOT NULL DEFAULT '',
  created_by       uuid REFERENCES profiles(id),
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS payable_payments_payable_id_idx ON payable_payments(payable_id);
CREATE INDEX IF NOT EXISTS payable_payments_payment_date_idx ON payable_payments(payment_date);

ALTER TABLE payable_payments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read payable_payments"
  ON payable_payments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert payable_payments"
  ON payable_payments FOR INSERT
  TO authenticated
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can update payable_payments"
  ON payable_payments FOR UPDATE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  )
  WITH CHECK (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

CREATE POLICY "Admins can delete payable_payments"
  ON payable_payments FOR DELETE
  TO authenticated
  USING (
    (SELECT role FROM profiles WHERE id = auth.uid()) = 'admin'
  );

-- ============================================================
-- Sequence for payable_number
-- ============================================================
CREATE SEQUENCE IF NOT EXISTS payable_number_seq START 1;

-- ============================================================
-- Function: recompute amount_paid and payment_status on payable
-- ============================================================
CREATE OR REPLACE FUNCTION recalc_payable_amounts(p_payable_id uuid)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_total     numeric(14,2);
  v_paid      numeric(14,2);
  v_status    text;
BEGIN
  SELECT total_amount INTO v_total FROM payables WHERE id = p_payable_id;
  SELECT COALESCE(SUM(amount), 0) INTO v_paid FROM payable_payments WHERE payable_id = p_payable_id;

  IF v_paid >= v_total THEN
    v_status := 'paid';
  ELSIF v_paid > 0 THEN
    v_status := 'partial';
  ELSE
    v_status := 'unpaid';
  END IF;

  UPDATE payables
  SET amount_paid = v_paid,
      payment_status = v_status,
      updated_at = now()
  WHERE id = p_payable_id;
END;
$$;

-- ============================================================
-- Trigger: after insert/update/delete on payable_payments
-- ============================================================
CREATE OR REPLACE FUNCTION trg_payable_payments_recalc()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
BEGIN
  IF TG_OP = 'DELETE' THEN
    PERFORM recalc_payable_amounts(OLD.payable_id);
  ELSE
    PERFORM recalc_payable_amounts(NEW.payable_id);
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_after_payable_payment ON payable_payments;
CREATE TRIGGER trg_after_payable_payment
  AFTER INSERT OR UPDATE OR DELETE ON payable_payments
  FOR EACH ROW EXECUTE FUNCTION trg_payable_payments_recalc();

-- ============================================================
-- Function: create payable from a posted receiving
-- Called manually from application when posting
-- ============================================================
CREATE OR REPLACE FUNCTION create_payable_from_receiving(
  p_receiving_id uuid,
  p_created_by   uuid DEFAULT NULL
)
RETURNS uuid
LANGUAGE plpgsql
SECURITY DEFINER
AS $$
DECLARE
  v_recv         RECORD;
  v_total        numeric(14,2);
  v_payable_id   uuid;
  v_number       text;
  v_seq          bigint;
BEGIN
  -- Load receiving
  SELECT r.*, p.po_number, s.id AS s_id
  INTO v_recv
  FROM receivings r
  LEFT JOIN purchase_orders p ON p.id = r.po_id
  LEFT JOIN inv_suppliers s ON s.id = r.supplier_id
  WHERE r.id = p_receiving_id;

  IF NOT FOUND THEN
    RAISE EXCEPTION 'Receiving % not found', p_receiving_id;
  END IF;

  -- Skip if already has a payable
  IF EXISTS (SELECT 1 FROM payables WHERE receiving_id = p_receiving_id) THEN
    SELECT id INTO v_payable_id FROM payables WHERE receiving_id = p_receiving_id;
    RETURN v_payable_id;
  END IF;

  -- Compute total from receiving_items
  SELECT COALESCE(SUM(qty_accepted * unit_cost), 0)
  INTO v_total
  FROM receiving_items
  WHERE receiving_id = p_receiving_id;

  IF v_total <= 0 THEN
    RETURN NULL;
  END IF;

  -- Generate payable number: PAY-YYYYMMDD-NNNN
  SELECT nextval('payable_number_seq') INTO v_seq;
  v_number := 'PAY-' || to_char(now(), 'YYYYMMDD') || '-' || lpad(v_seq::text, 4, '0');

  INSERT INTO payables (
    payable_number,
    supplier_id,
    po_id,
    receiving_id,
    invoice_number,
    invoice_date,
    due_date,
    total_amount,
    amount_paid,
    payment_status,
    created_by,
    updated_by
  ) VALUES (
    v_number,
    v_recv.supplier_id,
    v_recv.po_id,
    p_receiving_id,
    COALESCE(v_recv.invoice_number, ''),
    COALESCE(v_recv.receiving_date, CURRENT_DATE),
    COALESCE(v_recv.receiving_date, CURRENT_DATE) + INTERVAL '30 days',
    v_total,
    0,
    'unpaid',
    p_created_by,
    p_created_by
  )
  RETURNING id INTO v_payable_id;

  RETURN v_payable_id;
END;
$$;
