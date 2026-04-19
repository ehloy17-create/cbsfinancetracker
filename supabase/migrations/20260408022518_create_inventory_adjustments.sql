/*
  # Create Inventory Adjustments Schema

  ## Overview
  Adds inventory adjustment functionality to track stock discrepancies with a full approval workflow.

  ## New Tables

  ### adjustments
  - `id` - Primary key (UUID)
  - `adjustment_number` - Auto-generated human-readable reference (e.g. ADJ-000001)
  - `location_id` - Which location the adjustment applies to
  - `adjustment_date` - Date of adjustment
  - `reason` - Reason for adjustment: damaged, expired, loss, spoilage, found_stock, system_correction
  - `direction` - Whether adjustment adds or deducts stock: 'add' | 'deduct'
  - `remarks` - Required explanation text
  - `status` - Workflow status: draft | pending_approval | approved | posted | rejected | cancelled
  - `approved_by` / `approved_at` - Approval tracking
  - `rejected_by` / `rejected_at` / `rejection_reason` - Rejection tracking
  - `posted_by` / `posted_at` - Posting tracking (creates movements)
  - `created_by` / `updated_by` - Audit tracking
  - Timestamps

  ### adjustment_items
  - `id` - Primary key
  - `adjustment_id` - Foreign key to adjustments (cascade delete)
  - `product_id` - Which product to adjust
  - `qty` - Quantity to adjust (always positive; direction is on the parent)
  - `unit_cost` - Optional cost per unit for valuation
  - `notes` - Line-level notes
  - `sort_order` - Display order
  - `movement_id` - FK to inventory_movements once posted

  ## Security
  - RLS enabled on both tables
  - Policies allow authenticated users to read/write (admin gate enforced at app level via AdminRoute)

  ## Notes
  1. Posting creates inventory_movements entries (adjustment_add or adjustment_deduct)
  2. The direction field applies uniformly to all line items in the adjustment
  3. Sequence generates adjustment_number automatically
*/

CREATE SEQUENCE IF NOT EXISTS adj_number_seq START 1;

CREATE TABLE IF NOT EXISTS adjustments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_number text NOT NULL UNIQUE DEFAULT ('ADJ-' || LPAD(nextval('adj_number_seq')::text, 6, '0')),
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  adjustment_date date NOT NULL DEFAULT CURRENT_DATE,
  reason text NOT NULL CHECK (reason IN ('damaged', 'expired', 'loss', 'spoilage', 'found_stock', 'system_correction')),
  direction text NOT NULL DEFAULT 'deduct' CHECK (direction IN ('add', 'deduct')),
  remarks text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'pending_approval', 'approved', 'posted', 'rejected', 'cancelled')),
  approved_by uuid REFERENCES profiles(id),
  approved_at timestamptz,
  rejected_by uuid REFERENCES profiles(id),
  rejected_at timestamptz,
  rejection_reason text,
  posted_by uuid REFERENCES profiles(id),
  posted_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS adjustment_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  adjustment_id uuid NOT NULL REFERENCES adjustments(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES inv_products(id),
  qty numeric(12,4) NOT NULL DEFAULT 0 CHECK (qty >= 0),
  unit_cost numeric(12,4),
  notes text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  movement_id uuid REFERENCES inventory_movements(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_adjustments_location ON adjustments(location_id);
CREATE INDEX IF NOT EXISTS idx_adjustments_status ON adjustments(status);
CREATE INDEX IF NOT EXISTS idx_adjustments_date ON adjustments(adjustment_date);
CREATE INDEX IF NOT EXISTS idx_adjustments_reason ON adjustments(reason);
CREATE INDEX IF NOT EXISTS idx_adjustments_created_by ON adjustments(created_by);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_adjustment ON adjustment_items(adjustment_id);
CREATE INDEX IF NOT EXISTS idx_adjustment_items_product ON adjustment_items(product_id);

ALTER TABLE adjustments ENABLE ROW LEVEL SECURITY;
ALTER TABLE adjustment_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read adjustments"
  ON adjustments FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert adjustments"
  ON adjustments FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update adjustments"
  ON adjustments FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read adjustment_items"
  ON adjustment_items FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Authenticated users can insert adjustment_items"
  ON adjustment_items FOR INSERT
  TO authenticated
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update adjustment_items"
  ON adjustment_items FOR UPDATE
  TO authenticated
  USING (auth.uid() IS NOT NULL)
  WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete adjustment_items"
  ON adjustment_items FOR DELETE
  TO authenticated
  USING (auth.uid() IS NOT NULL);
