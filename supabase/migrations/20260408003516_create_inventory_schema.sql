/*
  # Inventory Module Schema - Phase 1

  ## Summary
  Creates the complete foundation for a retail grocery inventory and POS system.

  ## New Tables
  1. `inv_roles` - Inventory-specific roles (admin, manager, cashier, stock_clerk, viewer)
  2. `inv_locations` - Store branches/locations
  3. `inv_categories` - Product categories (supports parent-child hierarchy)
  4. `inv_brands` - Product brands
  5. `inv_units` - Units of measure
  6. `inv_suppliers` - Inventory suppliers (separate from GCash suppliers)
  7. `inv_products` - Main product catalog

  ## Security
  - RLS enabled on all tables
  - Admin-level access required for mutations
  - All authenticated users can read reference data

  ## Notes
  - Products support SKU, dual barcodes, expiry tracking, active status
  - Categories support parent hierarchy for nested category trees
  - All tables include soft-delete via is_active or is_deleted flags
  - Seed data included for roles, sample locations, categories, brands, units
*/

-- -----------------------------------------------
-- inv_roles
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_roles (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  display_name text NOT NULL,
  description text NOT NULL DEFAULT '',
  permissions jsonb NOT NULL DEFAULT '{}',
  is_active boolean NOT NULL DEFAULT true,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_roles ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_roles"
  ON inv_roles FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_roles"
  ON inv_roles FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_roles"
  ON inv_roles FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_roles"
  ON inv_roles FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_locations
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_locations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  manager_name text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_locations ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_locations"
  ON inv_locations FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_locations"
  ON inv_locations FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_locations"
  ON inv_locations FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_locations"
  ON inv_locations FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_categories
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_categories (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  parent_id uuid REFERENCES inv_categories(id) ON DELETE SET NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  sort_order integer NOT NULL DEFAULT 0,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_categories ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_categories"
  ON inv_categories FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_categories"
  ON inv_categories FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_categories"
  ON inv_categories FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_categories"
  ON inv_categories FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_brands
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_brands (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  name text NOT NULL UNIQUE,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_brands ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_brands"
  ON inv_brands FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_brands"
  ON inv_brands FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_brands"
  ON inv_brands FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_brands"
  ON inv_brands FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_units
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_units (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  description text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_units ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_units"
  ON inv_units FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_units"
  ON inv_units FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_units"
  ON inv_units FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_units"
  ON inv_units FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_suppliers
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_suppliers (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  code text NOT NULL UNIQUE,
  name text NOT NULL,
  contact_person text NOT NULL DEFAULT '',
  phone text NOT NULL DEFAULT '',
  email text NOT NULL DEFAULT '',
  address text NOT NULL DEFAULT '',
  city text NOT NULL DEFAULT '',
  terms text NOT NULL DEFAULT '',
  notes text NOT NULL DEFAULT '',
  is_active boolean NOT NULL DEFAULT true,
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE inv_suppliers ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_suppliers"
  ON inv_suppliers FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_suppliers"
  ON inv_suppliers FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_suppliers"
  ON inv_suppliers FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_suppliers"
  ON inv_suppliers FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- inv_products
-- -----------------------------------------------
CREATE TABLE IF NOT EXISTS inv_products (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sku text NOT NULL UNIQUE,
  barcode text,
  barcode_alt text,
  name text NOT NULL,
  short_name text NOT NULL DEFAULT '',
  category_id uuid REFERENCES inv_categories(id) ON DELETE SET NULL,
  brand_id uuid REFERENCES inv_brands(id) ON DELETE SET NULL,
  unit_id uuid REFERENCES inv_units(id) ON DELETE SET NULL,
  supplier_id uuid REFERENCES inv_suppliers(id) ON DELETE SET NULL,
  cost numeric(12,2) NOT NULL DEFAULT 0,
  selling_price numeric(12,2) NOT NULL DEFAULT 0,
  reorder_level integer NOT NULL DEFAULT 0,
  expiry_tracked boolean NOT NULL DEFAULT false,
  is_active boolean NOT NULL DEFAULT true,
  notes text NOT NULL DEFAULT '',
  created_by uuid REFERENCES profiles(id) ON DELETE SET NULL,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_inv_products_sku ON inv_products(sku);
CREATE INDEX IF NOT EXISTS idx_inv_products_barcode ON inv_products(barcode) WHERE barcode IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_inv_products_category ON inv_products(category_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_brand ON inv_products(brand_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_supplier ON inv_products(supplier_id);
CREATE INDEX IF NOT EXISTS idx_inv_products_active ON inv_products(is_active);
CREATE INDEX IF NOT EXISTS idx_inv_products_name ON inv_products USING gin(to_tsvector('english', name));

ALTER TABLE inv_products ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Authenticated users can read inv_products"
  ON inv_products FOR SELECT
  TO authenticated
  USING (true);

CREATE POLICY "Admins can insert inv_products"
  ON inv_products FOR INSERT
  TO authenticated
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can update inv_products"
  ON inv_products FOR UPDATE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin')
  WITH CHECK ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

CREATE POLICY "Admins can delete inv_products"
  ON inv_products FOR DELETE
  TO authenticated
  USING ((SELECT role FROM profiles WHERE id = auth.uid()) = 'admin');

-- -----------------------------------------------
-- SEED DATA
-- -----------------------------------------------

-- Roles
INSERT INTO inv_roles (name, display_name, description, permissions) VALUES
  ('inventory_admin', 'Inventory Admin', 'Full access to inventory module', '{"products":{"create":true,"read":true,"update":true,"delete":true},"suppliers":{"create":true,"read":true,"update":true,"delete":true},"categories":{"create":true,"read":true,"update":true,"delete":true},"locations":{"create":true,"read":true,"update":true,"delete":true},"users":{"create":true,"read":true,"update":true,"delete":true},"reports":{"read":true}}'),
  ('inventory_manager', 'Inventory Manager', 'Manage products and suppliers, view reports', '{"products":{"create":true,"read":true,"update":true,"delete":false},"suppliers":{"create":true,"read":true,"update":true,"delete":false},"categories":{"create":false,"read":true,"update":false,"delete":false},"locations":{"create":false,"read":true,"update":false,"delete":false},"users":{"create":false,"read":true,"update":false,"delete":false},"reports":{"read":true}}'),
  ('cashier', 'Cashier', 'POS access only, read product data', '{"products":{"create":false,"read":true,"update":false,"delete":false},"suppliers":{"create":false,"read":false,"update":false,"delete":false},"categories":{"create":false,"read":true,"update":false,"delete":false},"locations":{"create":false,"read":false,"update":false,"delete":false},"users":{"create":false,"read":false,"update":false,"delete":false},"reports":{"read":false}}'),
  ('stock_clerk', 'Stock Clerk', 'Stock management and product lookup', '{"products":{"create":false,"read":true,"update":true,"delete":false},"suppliers":{"create":false,"read":true,"update":false,"delete":false},"categories":{"create":false,"read":true,"update":false,"delete":false},"locations":{"create":false,"read":true,"update":false,"delete":false},"users":{"create":false,"read":false,"update":false,"delete":false},"reports":{"read":false}}'),
  ('viewer', 'Viewer', 'Read-only access to inventory data', '{"products":{"create":false,"read":true,"update":false,"delete":false},"suppliers":{"create":false,"read":true,"update":false,"delete":false},"categories":{"create":false,"read":true,"update":false,"delete":false},"locations":{"create":false,"read":true,"update":false,"delete":false},"users":{"create":false,"read":false,"update":false,"delete":false},"reports":{"read":true}}')
ON CONFLICT (name) DO NOTHING;

-- Locations
INSERT INTO inv_locations (code, name, address, city, phone, manager_name) VALUES
  ('MAIN', 'Main Branch', '123 Rizal Street', 'Manila', '02-8123-4567', 'Juan dela Cruz'),
  ('BR01', 'Branch 1 - Quezon City', '456 Commonwealth Ave', 'Quezon City', '02-8234-5678', 'Maria Santos'),
  ('BR02', 'Branch 2 - Makati', '789 Ayala Ave', 'Makati', '02-8345-6789', 'Pedro Reyes')
ON CONFLICT (code) DO NOTHING;

-- Categories
INSERT INTO inv_categories (code, name, description, sort_order) VALUES
  ('BVRD', 'Beverages', 'Drinks and liquid refreshments', 1),
  ('FOOD', 'Food & Grocery', 'General food and grocery items', 2),
  ('DAIRY', 'Dairy & Eggs', 'Milk, cheese, eggs, yogurt', 3),
  ('MEAT', 'Meat & Poultry', 'Fresh and frozen meat products', 4),
  ('PRODUCE', 'Fresh Produce', 'Fruits and vegetables', 5),
  ('SNACKS', 'Snacks & Confectionery', 'Chips, chocolates, candies', 6),
  ('CONDMNT', 'Condiments & Sauces', 'Sauces, seasonings, spreads', 7),
  ('CANND', 'Canned & Packaged', 'Canned goods and packaged meals', 8),
  ('HCARE', 'Health & Beauty', 'Personal care and hygiene products', 9),
  ('CLNNG', 'Cleaning Supplies', 'Household cleaning products', 10),
  ('FROZEN', 'Frozen Foods', 'Frozen meals, ice cream, frozen veg', 11),
  ('BAKERY', 'Bakery & Bread', 'Bread, pastries, baked goods', 12)
ON CONFLICT (code) DO NOTHING;

-- Sub-categories (Beverages)
DO $$
DECLARE bvrd_id uuid;
BEGIN
  SELECT id INTO bvrd_id FROM inv_categories WHERE code = 'BVRD';
  IF bvrd_id IS NOT NULL THEN
    INSERT INTO inv_categories (code, name, parent_id, description, sort_order) VALUES
      ('BVRD-SOFT', 'Soft Drinks', bvrd_id, 'Carbonated beverages', 1),
      ('BVRD-JUICE', 'Juices', bvrd_id, 'Fruit juices and drinks', 2),
      ('BVRD-WATER', 'Water', bvrd_id, 'Bottled and purified water', 3),
      ('BVRD-COFFEE', 'Coffee & Tea', bvrd_id, 'Hot and cold coffee and tea', 4)
    ON CONFLICT (code) DO NOTHING;
  END IF;
END $$;

-- Brands
INSERT INTO inv_brands (name, description) VALUES
  ('San Miguel', 'San Miguel Corporation products'),
  ('Nestlé', 'Nestlé Philippines products'),
  ('Unilever', 'Unilever Philippines products'),
  ('Procter & Gamble', 'P&G Philippines products'),
  ('Universal Robina', 'URC food and beverage products'),
  ('Monde Nissin', 'Monde Nissin Corporation products'),
  ('Century Pacific', 'Century Pacific Food Inc products'),
  ('Magnolia', 'Magnolia dairy and poultry products'),
  ('Del Monte', 'Del Monte Philippines products'),
  ('Ajinomoto', 'Ajinomoto Philippines products'),
  ('Rebisco', 'Rebisco snacks and biscuits'),
  ('Selecta', 'Selecta ice cream and dairy'),
  ('No Brand', 'Generic / unbranded products')
ON CONFLICT (name) DO NOTHING;

-- Units
INSERT INTO inv_units (code, name, description) VALUES
  ('PC', 'Piece', 'Individual unit'),
  ('PKT', 'Packet', 'Sealed packet or pouch'),
  ('BOX', 'Box', 'Cardboard box'),
  ('CAN', 'Can', 'Metal or tin can'),
  ('BTL', 'Bottle', 'Glass or plastic bottle'),
  ('BAG', 'Bag', 'Plastic or paper bag'),
  ('SACHET', 'Sachet', 'Small single-use sachet'),
  ('KG', 'Kilogram', 'Weight in kilograms'),
  ('GRAM', 'Gram', 'Weight in grams'),
  ('LITER', 'Liter', 'Volume in liters'),
  ('ML', 'Milliliter', 'Volume in milliliters'),
  ('DOZ', 'Dozen', 'Set of twelve'),
  ('TRAY', 'Tray', 'Tray packaging'),
  ('ROLL', 'Roll', 'Roll packaging')
ON CONFLICT (code) DO NOTHING;

-- Suppliers
INSERT INTO inv_suppliers (code, name, contact_person, phone, email, address, city, terms) VALUES
  ('SUP-001', 'Metro Wholesale Distributors', 'Jose Mercado', '0917-123-4567', 'orders@metrowholesale.ph', '100 Wholesale Blvd', 'Manila', 'Net 30'),
  ('SUP-002', 'Sunrise Trading Corp', 'Ana Reyes', '0918-234-5678', 'purchasing@sunrisetrading.ph', '200 Commerce St', 'Quezon City', 'Net 15'),
  ('SUP-003', 'GrocersPrime Inc', 'Ricardo Lim', '0919-345-6789', 'supply@grocersprime.ph', '300 Trade Ave', 'Makati', 'COD'),
  ('SUP-004', 'FreshFarm Distributors', 'Lilia Cruz', '0920-456-7890', 'fresh@freshfarm.ph', '400 Farm Road', 'Bulacan', 'Net 7'),
  ('SUP-005', 'National Grocery Traders', 'Manuel Sy', '0921-567-8901', 'sales@nationalgrocery.ph', '500 National Hwy', 'Pasig', 'Net 30')
ON CONFLICT (code) DO NOTHING;

-- Sample Products
DO $$
DECLARE
  cat_bvrd uuid; cat_snacks uuid; cat_dairy uuid; cat_condmnt uuid; cat_cannd uuid;
  cat_bvrd_soft uuid; cat_bvrd_juice uuid; cat_bvrd_water uuid;
  br_urc uuid; br_nestle uuid; br_nobrand uuid; br_delmonte uuid; br_magnolia uuid;
  un_btl uuid; un_can uuid; un_pkt uuid; un_sachet uuid; un_pc uuid;
  sup1 uuid;
BEGIN
  SELECT id INTO cat_bvrd FROM inv_categories WHERE code = 'BVRD';
  SELECT id INTO cat_snacks FROM inv_categories WHERE code = 'SNACKS';
  SELECT id INTO cat_dairy FROM inv_categories WHERE code = 'DAIRY';
  SELECT id INTO cat_condmnt FROM inv_categories WHERE code = 'CONDMNT';
  SELECT id INTO cat_cannd FROM inv_categories WHERE code = 'CANND';
  SELECT id INTO cat_bvrd_soft FROM inv_categories WHERE code = 'BVRD-SOFT';
  SELECT id INTO cat_bvrd_juice FROM inv_categories WHERE code = 'BVRD-JUICE';
  SELECT id INTO cat_bvrd_water FROM inv_categories WHERE code = 'BVRD-WATER';

  SELECT id INTO br_urc FROM inv_brands WHERE name = 'Universal Robina';
  SELECT id INTO br_nestle FROM inv_brands WHERE name = 'Nestlé';
  SELECT id INTO br_nobrand FROM inv_brands WHERE name = 'No Brand';
  SELECT id INTO br_delmonte FROM inv_brands WHERE name = 'Del Monte';
  SELECT id INTO br_magnolia FROM inv_brands WHERE name = 'Magnolia';

  SELECT id INTO un_btl FROM inv_units WHERE code = 'BTL';
  SELECT id INTO un_can FROM inv_units WHERE code = 'CAN';
  SELECT id INTO un_pkt FROM inv_units WHERE code = 'PKT';
  SELECT id INTO un_sachet FROM inv_units WHERE code = 'SACHET';
  SELECT id INTO un_pc FROM inv_units WHERE code = 'PC';

  SELECT id INTO sup1 FROM inv_suppliers WHERE code = 'SUP-001';

  INSERT INTO inv_products (sku, barcode, name, short_name, category_id, brand_id, unit_id, supplier_id, cost, selling_price, reorder_level, expiry_tracked) VALUES
    ('BEV-0001', '4800000001001', 'Cobra Energy Drink 250ml', 'Cobra 250ml', cat_bvrd_soft, br_urc, un_can, sup1, 18.00, 25.00, 50, true),
    ('BEV-0002', '4800000001002', 'C2 Green Tea Apple 500ml', 'C2 Apple 500ml', cat_bvrd, br_urc, un_btl, sup1, 20.00, 28.00, 40, true),
    ('BEV-0003', '4800000001003', 'Absolute Distilled Water 1L', 'Absolute Water 1L', cat_bvrd_water, br_nobrand, un_btl, sup1, 12.00, 18.00, 100, true),
    ('SNK-0001', '4800000002001', 'Nova Country Cheddar 78g', 'Nova Cheddar 78g', cat_snacks, br_urc, un_pkt, sup1, 22.00, 30.00, 30, true),
    ('SNK-0002', '4800000002002', 'Piattos Cheese 85g', 'Piattos Cheese 85g', cat_snacks, br_urc, un_pkt, sup1, 24.00, 33.00, 30, true),
    ('DAIRY-001', '4800000003001', 'Bear Brand Fortified Milk 300ml', 'Bear Brand 300ml', cat_dairy, br_nestle, un_btl, sup1, 28.00, 38.00, 20, true),
    ('COND-001', '4800000004001', 'Del Monte Tomato Ketchup 320g', 'Del Monte Ketchup 320g', cat_condmnt, br_delmonte, un_btl, sup1, 38.00, 52.00, 15, true),
    ('CAN-0001', '4800000005001', 'Magnolia All Purpose Cream 250ml', 'Magnolia Cream 250ml', cat_cannd, br_magnolia, un_can, sup1, 32.00, 44.00, 25, true),
    ('CAN-0002', '4800000005002', 'Del Monte Fruit Cocktail 432g', 'Del Monte FC 432g', cat_cannd, br_delmonte, un_can, sup1, 52.00, 70.00, 20, true),
    ('BEV-0004', '4800000001004', 'Tropicana 100% Orange 1L', 'Tropicana OJ 1L', cat_bvrd_juice, br_nobrand, un_btl, sup1, 75.00, 99.00, 15, true)
  ON CONFLICT (sku) DO NOTHING;
END $$;
