/*
  # Create Physical Count Schema

  ## Overview
  Adds a physical inventory count module that allows warehouse staff to perform
  stock counts and reconcile variances against the system book quantities.

  ## New Tables

  ### physical_counts
  - `id` - Primary key
  - `count_number` - Auto-generated reference (e.g. PC-000001)
  - `location_id` - Which location is being counted
  - `count_date` - Date of the physical count
  - `filter_type` - Whether counting all products, by category, or by brand
  - `filter_id` - Category or brand ID when filter_type is category/brand
  - `remarks` - Optional description
  - `status` - draft | counted | posted | cancelled
  - `posted_by` / `posted_at` - Tracks who posted and when
  - `created_by` / `updated_by` - Audit fields
  - Timestamps

  ### physical_count_items
  - `id` - Primary key
  - `count_id` - FK to physical_counts
  - `product_id` - Which product
  - `system_qty` - Snapshot of qty_on_hand at time of count creation
  - `counted_qty` - Actual physical count entered by user (null = not yet counted)
  - `variance` - Computed column: counted_qty - system_qty (null when not counted)
  - `unit_cost` - Cost snapshot for variance valuation
  - `notes` - Line-level notes
  - `sort_order` - Display order
  - `movement_id` - FK to inventory_movements once posted

  ## Security
  - RLS enabled on both tables
  - Authenticated users can read/write

  ## Notes
  1. When a count session is created, items are populated from inventory_balances
     for the selected location (filtered by category/brand if specified)
  2. Posting creates inventory_movements (physical_count type) for each variance != 0
     and updates inventory_balances accordingly
  3. system_qty is a snapshot — changes after count creation are shown as variance
*/

CREATE SEQUENCE IF NOT EXISTS pc_number_seq START 1;

CREATE TABLE IF NOT EXISTS physical_counts (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_number text NOT NULL UNIQUE DEFAULT ('PC-' || LPAD(nextval('pc_number_seq')::text, 6, '0')),
  location_id uuid NOT NULL REFERENCES inv_locations(id),
  count_date date NOT NULL DEFAULT CURRENT_DATE,
  filter_type text NOT NULL DEFAULT 'all' CHECK (filter_type IN ('all', 'category', 'brand')),
  filter_id uuid,
  remarks text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'counted', 'posted', 'cancelled')),
  posted_by uuid REFERENCES profiles(id),
  posted_at timestamptz,
  created_by uuid REFERENCES profiles(id),
  updated_by uuid REFERENCES profiles(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

CREATE TABLE IF NOT EXISTS physical_count_items (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  count_id uuid NOT NULL REFERENCES physical_counts(id) ON DELETE CASCADE,
  product_id uuid NOT NULL REFERENCES inv_products(id),
  system_qty numeric(12,4) NOT NULL DEFAULT 0,
  counted_qty numeric(12,4),
  unit_cost numeric(12,4),
  notes text NOT NULL DEFAULT '',
  sort_order int NOT NULL DEFAULT 0,
  movement_id uuid REFERENCES inventory_movements(id),
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now(),
  UNIQUE(count_id, product_id)
);

CREATE INDEX IF NOT EXISTS idx_physical_counts_location ON physical_counts(location_id);
CREATE INDEX IF NOT EXISTS idx_physical_counts_status ON physical_counts(status);
CREATE INDEX IF NOT EXISTS idx_physical_counts_date ON physical_counts(count_date);
CREATE INDEX IF NOT EXISTS idx_physical_count_items_count ON physical_count_items(count_id);
CREATE INDEX IF NOT EXISTS idx_physical_count_items_product ON physical_count_items(product_id);

ALTER TABLE physical_counts ENABLE ROW LEVEL SECURITY;
ALTER TABLE physical_count_items ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read physical_counts"
  ON physical_counts FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert physical_counts"
  ON physical_counts FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update physical_counts"
  ON physical_counts FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can read physical_count_items"
  ON physical_count_items FOR SELECT TO authenticated USING (true);

CREATE POLICY "Authenticated users can insert physical_count_items"
  ON physical_count_items FOR INSERT TO authenticated WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can update physical_count_items"
  ON physical_count_items FOR UPDATE TO authenticated
  USING (auth.uid() IS NOT NULL) WITH CHECK (auth.uid() IS NOT NULL);

CREATE POLICY "Authenticated users can delete physical_count_items"
  ON physical_count_items FOR DELETE TO authenticated USING (auth.uid() IS NOT NULL);
