-- ============================================================
-- MySQL Schema - Converted from Supabase/PostgreSQL migrations
-- Run this once against your local MySQL database:
--   mysql -u root -p your_db_name < server/schema.sql
-- ============================================================

SET FOREIGN_KEY_CHECKS = 0;

-- -------------------------------------------------------
-- profiles (replaces Supabase auth.users extension)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS profiles (
  id          CHAR(36)     PRIMARY KEY,
  name        VARCHAR(255) NOT NULL DEFAULT '',
  email       VARCHAR(255) NOT NULL DEFAULT '',
  password_hash VARCHAR(255) NOT NULL DEFAULT '',
  role        VARCHAR(20)  NOT NULL DEFAULT 'staff' CHECK (role IN ('admin','staff','cashier')),
  status      VARCHAR(20)  NOT NULL DEFAULT 'active' CHECK (status IN ('active','inactive')),
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  last_login  DATETIME     NULL
);

-- -------------------------------------------------------
-- accounts (GCash accounts)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS accounts (
  id                          CHAR(36)        PRIMARY KEY DEFAULT (UUID()),
  name                        VARCHAR(255)    NOT NULL,
  is_active                   TINYINT(1)      NOT NULL DEFAULT 1,
  current_beginning_balance   DECIMAL(12,2)   NOT NULL DEFAULT 0,
  current_running_balance     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  last_closed_date            DATE            NULL,
  created_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- transactions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS transactions (
  id                  CHAR(36)        PRIMARY KEY DEFAULT (UUID()),
  account_id          CHAR(36)        NOT NULL,
  transaction_type    VARCHAR(20)     NOT NULL CHECK (transaction_type IN ('cash_in','cash_out')),
  transaction_category VARCHAR(30)    NOT NULL DEFAULT 'regular',
  cash_in_mode        VARCHAR(20)     NULL,
  amount              DECIMAL(12,2)   NOT NULL,
  transaction_fee     DECIMAL(12,2)   NOT NULL DEFAULT 0,
  amount_received     DECIMAL(12,2)   NULL,
  fee_type            VARCHAR(20)     NOT NULL DEFAULT 'gcash' CHECK (fee_type IN ('gcash','cash')),
  delivery_fee        DECIMAL(12,2)   NOT NULL DEFAULT 0,
  cash_balance        DECIMAL(12,2)   NOT NULL DEFAULT 0,
  date                DATE            NOT NULL,
  description         TEXT            NOT NULL,
  reference_number    VARCHAR(255)    NOT NULL DEFAULT '',
  source              VARCHAR(50)     NOT NULL DEFAULT 'gcash' CHECK (source IN ('gcash','cash')),
  notes               TEXT            NULL,
  cash_source         VARCHAR(50)     NULL,
  cash_out_type       VARCHAR(50)     NULL,
  bank_account_id     CHAR(36)        NULL,
  source_module       VARCHAR(60)     NULL,
  source_reference_id CHAR(36)        NULL,
  source_sale_id      CHAR(36)        NULL,
  reversal_of_transaction_id CHAR(36) NULL,
  disbursement_id     CHAR(36)        NULL,
  is_deleted          TINYINT(1)      NOT NULL DEFAULT 0,
  is_closed           TINYINT(1)      NOT NULL DEFAULT 0,
  cleared_at          DATETIME        NULL,
  source_pos_remittance_id CHAR(36)   NULL,
  created_by          CHAR(36)        NULL,
  created_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME        NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- daily_history
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_history (
  id                    CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  account_id            CHAR(36)      NOT NULL,
  date                  DATE          NOT NULL,
  beginning_balance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cash_in         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cash_out        DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_transaction_fee DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cash_fees       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_delivery_fee    DECIMAL(12,2) NOT NULL DEFAULT 0,
  transaction_count     INT           NOT NULL DEFAULT 0,
  ending_balance        DECIMAL(12,2) NOT NULL DEFAULT 0,
  posted_by             CHAR(36)      NULL,
  shift_cash_in         DECIMAL(12,2) NOT NULL DEFAULT 0,
  shift_cash_out        DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  UNIQUE KEY uq_daily_history (account_id, date),
  FOREIGN KEY (account_id) REFERENCES accounts(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- system_state
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS system_state (
  setting_key         VARCHAR(255) PRIMARY KEY,
  value       TEXT         NOT NULL,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- audit_logs
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS audit_logs (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  user_id     CHAR(36)     NULL,
  action      VARCHAR(255) NOT NULL,
  module      VARCHAR(255) NOT NULL DEFAULT '',
  table_name  VARCHAR(255) NOT NULL DEFAULT '',
  record_id   VARCHAR(255) NOT NULL DEFAULT '',
  changes     JSON         NULL,
  details     JSON         NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- cash_transactions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_transactions (
  id              CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  transaction_type VARCHAR(20)  NOT NULL CHECK (transaction_type IN ('beginning_balance','bank_deposit','cash_fund_disbursement','pos_remittance','cash_in','cash_out')),
  transaction_category VARCHAR(30) NOT NULL DEFAULT 'regular',
  amount          DECIMAL(12,2) NOT NULL,
  date            DATE          NOT NULL,
  description     TEXT          NOT NULL,
  notes           TEXT          NULL,
  reference_number VARCHAR(255) NOT NULL DEFAULT '',
  cash_out_type   VARCHAR(50)   NULL,
  source_module   VARCHAR(60)   NULL,
  source_reference_id CHAR(36)  NULL,
  disbursement_id CHAR(36)      NULL,
  source_pos_remittance_id CHAR(36) NULL,
  is_deleted      TINYINT(1)    NOT NULL DEFAULT 0,
  is_closed       TINYINT(1)    NOT NULL DEFAULT 0,
  cleared_at      DATETIME      NULL,
  created_by      CHAR(36)      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- bank_accounts
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_accounts (
  id              CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  name            VARCHAR(255)  NOT NULL,
  bank_name       VARCHAR(255)  NOT NULL DEFAULT '',
  account_number  VARCHAR(255)  NOT NULL DEFAULT '',
  current_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active       TINYINT(1)    NOT NULL DEFAULT 1,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- bank_deposits
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_deposits (
  id                   CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  bank_account_id      CHAR(36)      NOT NULL,
  amount               DECIMAL(12,2) NOT NULL,
  date                 DATE          NOT NULL,
  description          TEXT          NOT NULL,
  reference_number     VARCHAR(255)  NOT NULL DEFAULT '',
  source_description   VARCHAR(255)  NOT NULL DEFAULT '',
  source_transaction_id CHAR(36)     NULL,
  created_by           CHAR(36)      NULL,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- bank_transactions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS bank_transactions (
  id                    CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  bank_account_id       CHAR(36)      NOT NULL,
  transaction_type      VARCHAR(30)   NOT NULL,
  amount                DECIMAL(12,2) NOT NULL,
  date                  DATE          NOT NULL,
  description           TEXT          NOT NULL,
  reference_number      VARCHAR(255)  NOT NULL DEFAULT '',
  source_transaction_id CHAR(36)      NULL,
  check_id              CHAR(36)      NULL,
  disbursement_id       CHAR(36)      NULL,
  is_deleted            TINYINT(1)    NOT NULL DEFAULT 0,
  created_by            CHAR(36)      NULL,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- suppliers (GCash module)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS suppliers (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  name        VARCHAR(255) NOT NULL,
  contact     VARCHAR(255) NOT NULL DEFAULT '',
  address     TEXT         NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- checks_issued
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS checks_issued (
  id                  CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  bank_account_id     CHAR(36)      NOT NULL,
  supplier_id         CHAR(36)      NULL,
  payable_id          CHAR(36)      NULL,
  check_number        VARCHAR(100)  NOT NULL,
  check_date          DATE          NOT NULL,
  issued_date         DATE          NULL,
  date                DATE          NULL,
  amount              DECIMAL(12,2) NOT NULL,
  payee               VARCHAR(255)  NOT NULL DEFAULT '',
  description         TEXT          NOT NULL DEFAULT '',
  notes               TEXT          NOT NULL DEFAULT '',
  status              VARCHAR(30)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','cleared','cancelled','stale')),
  cleared_date        DATE          NULL,
  disbursement_id     CHAR(36)      NULL,
  manually_set_status TINYINT(1)    NOT NULL DEFAULT 0,
  attachment_reference VARCHAR(255) NULL,
  approval_required   TINYINT(1)    NOT NULL DEFAULT 0,
  approval_status     VARCHAR(20)   NOT NULL DEFAULT 'approved',
  approved_by         CHAR(36)      NULL,
  approved_at         DATETIME      NULL,
  rejected_reason     TEXT          NULL,
  is_deleted          TINYINT(1)    NOT NULL DEFAULT 0,
  created_by          CHAR(36)      NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (bank_account_id) REFERENCES bank_accounts(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- disbursements
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS disbursements (
  id                CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  supplier_id       CHAR(36)      NULL,
  owner_id          CHAR(36)      NULL,
  date              DATE          NOT NULL,
  payee             VARCHAR(255)  NOT NULL DEFAULT '',
  purpose           TEXT          NOT NULL DEFAULT '',
  amount            DECIMAL(12,2) NOT NULL,
  payment_method    VARCHAR(50)   NOT NULL DEFAULT 'cash',
  check_id          CHAR(36)      NULL,
  owner_ledger_id   CHAR(36)      NULL,
  check_number      VARCHAR(100)  NOT NULL DEFAULT '',
  description       TEXT          NOT NULL DEFAULT '',
  reference_number  VARCHAR(255)  NOT NULL DEFAULT '',
  disbursement_type VARCHAR(50)   NOT NULL DEFAULT 'cash',
  source_module     VARCHAR(60)   NULL,
  source_reference_id CHAR(36)    NULL,
  source_account_type VARCHAR(30) NULL,
  source_account_id CHAR(36)      NULL,
  notes             TEXT          NOT NULL DEFAULT '',
  is_deleted        TINYINT(1)    NOT NULL DEFAULT 0,
  created_by        CHAR(36)      NULL,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- daily_sales
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS daily_sales (
  id              CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  date            DATE          NOT NULL UNIQUE,
  -- Manual P&L entry fields
  sales           DECIMAL(12,2) NOT NULL DEFAULT 0,
  cost_of_sales   DECIMAL(12,2) NOT NULL DEFAULT 0,
  description     TEXT          NOT NULL DEFAULT '',
  -- POS auto-sync fields (populated by sync_daily_sales_from_pos RPC on Z-close)
  total_pos_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_pos_sales  DECIMAL(12,2) NOT NULL DEFAULT 0,
  gcash_pos_sales DECIMAL(12,2) NOT NULL DEFAULT 0,
  card_pos_sales  DECIMAL(12,2) NOT NULL DEFAULT 0,
  pos_synced_at   DATETIME      NULL,
  notes           TEXT          NOT NULL DEFAULT '',
  is_deleted      TINYINT(1)    NOT NULL DEFAULT 0,
  created_by      CHAR(36)      NULL,
  created_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at      DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- cash_daily_history
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cash_daily_history (
  id                    CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  date                  DATE          NOT NULL UNIQUE,
  beginning_balance     DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cash_in         DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_cash_out        DECIMAL(12,2) NOT NULL DEFAULT 0,
  transaction_count     INT           NOT NULL DEFAULT 0,
  cash_fees_collected   DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_given_out        DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_out_to_fund      DECIMAL(12,2) NOT NULL DEFAULT 0,
  bank_deposits         DECIMAL(12,2) NOT NULL DEFAULT 0,
  cash_fund_disbursements DECIMAL(12,2) NOT NULL DEFAULT 0,
  ending_balance        DECIMAL(12,2) NOT NULL DEFAULT 0,
  posted_by             CHAR(36)      NULL,
  posted_at             DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- cashier_remittances
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS cashier_remittances (
  id                  CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  cashier_id          CHAR(36)      NOT NULL,
  shift_id            CHAR(36)      NULL,
  date                DATE          NOT NULL,
  source_type         VARCHAR(30)   NOT NULL DEFAULT 'gcash',
  source_account_id   CHAR(36)      NULL,
  destination_type    VARCHAR(30)   NOT NULL DEFAULT 'bank',
  destination_bank_id CHAR(36)      NULL,
  amount              DECIMAL(12,2) NOT NULL,
  bank_fee            DECIMAL(12,2) NOT NULL DEFAULT 0,
  description         TEXT          NOT NULL DEFAULT '',
  notes               TEXT          NOT NULL DEFAULT '',
  status              VARCHAR(30)   NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','confirmed','cancelled')),
  confirmed_by        CHAR(36)      NULL,
  confirmed_at        DATETIME      NULL,
  is_deleted          TINYINT(1)    NOT NULL DEFAULT 0,
  created_by          CHAR(36)      NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_roles
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_roles (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  name         VARCHAR(100) NOT NULL UNIQUE,
  display_name VARCHAR(255) NOT NULL,
  description  TEXT         NOT NULL,
  permissions  JSON         NOT NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_locations
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_locations (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  code         VARCHAR(50)  NOT NULL UNIQUE,
  name         VARCHAR(255) NOT NULL,
  address      TEXT         NOT NULL,
  city         VARCHAR(255) NOT NULL DEFAULT '',
  phone        VARCHAR(50)  NOT NULL DEFAULT '',
  manager_name VARCHAR(255) NOT NULL DEFAULT '',
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   CHAR(36)     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_categories
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_categories (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  code        VARCHAR(50)  NOT NULL UNIQUE,
  name        VARCHAR(255) NOT NULL,
  parent_id   CHAR(36)     NULL,
  description TEXT         NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  sort_order  INT          NOT NULL DEFAULT 0,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (parent_id) REFERENCES inv_categories(id) ON DELETE SET NULL
);

-- -------------------------------------------------------
-- inv_brands
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_brands (
  id          CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  name        VARCHAR(255) NOT NULL UNIQUE,
  description TEXT         NOT NULL,
  is_active   TINYINT(1)   NOT NULL DEFAULT 1,
  created_by  CHAR(36)     NULL,
  created_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at  DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_units
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_units (
  id           CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  code         VARCHAR(20)  NOT NULL UNIQUE,
  name         VARCHAR(100) NOT NULL,
  abbreviation VARCHAR(20)  NOT NULL DEFAULT '',
  short_name   VARCHAR(20)  NOT NULL DEFAULT '',
  description  TEXT         NULL,
  is_active    TINYINT(1)   NOT NULL DEFAULT 1,
  created_by   CHAR(36)     NULL,
  created_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at   DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_suppliers
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_suppliers (
  id             CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  code           VARCHAR(50)  NOT NULL UNIQUE,
  name           VARCHAR(255) NOT NULL,
  contact_person VARCHAR(255) NOT NULL DEFAULT '',
  phone          VARCHAR(50)  NOT NULL DEFAULT '',
  email          VARCHAR(255) NOT NULL DEFAULT '',
  address        TEXT         NOT NULL,
  payment_terms  VARCHAR(100) NOT NULL DEFAULT '',
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_by     CHAR(36)     NULL,
  created_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- inv_products
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_products (
  id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  sku_code         VARCHAR(100)  NOT NULL UNIQUE,
  barcode          VARCHAR(100)  NOT NULL DEFAULT '',
  barcode2         VARCHAR(100)  NOT NULL DEFAULT '',
  name             VARCHAR(255)  NOT NULL,
  description      TEXT          NOT NULL,
  category_id      CHAR(36)      NULL,
  brand_id         CHAR(36)      NULL,
  unit_id          CHAR(36)      NULL,
  supplier_id      CHAR(36)      NULL,
  cost_price       DECIMAL(12,2) NOT NULL DEFAULT 0,
  retail_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  wholesale_price  DECIMAL(12,2) NOT NULL DEFAULT 0,
  special_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  selling_price    DECIMAL(12,2) NOT NULL DEFAULT 0,
  reorder_point    DECIMAL(12,3) NOT NULL DEFAULT 0,
  is_expiry_tracked TINYINT(1)   NOT NULL DEFAULT 0,
  near_expiry_days  INT          NOT NULL DEFAULT 90,
  is_active        TINYINT(1)    NOT NULL DEFAULT 1,
  created_by       CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (category_id) REFERENCES inv_categories(id) ON DELETE SET NULL,
  FOREIGN KEY (brand_id)    REFERENCES inv_brands(id)     ON DELETE SET NULL,
  FOREIGN KEY (unit_id)     REFERENCES inv_units(id)      ON DELETE SET NULL,
  FOREIGN KEY (supplier_id) REFERENCES inv_suppliers(id)  ON DELETE SET NULL
);

CREATE TABLE IF NOT EXISTS inv_product_pricing_history (
  id                   CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  product_id           CHAR(36)      NOT NULL,
  old_cost             DECIMAL(12,2) NULL,
  new_cost             DECIMAL(12,2) NULL,
  old_retail_price     DECIMAL(12,2) NULL,
  new_retail_price     DECIMAL(12,2) NULL,
  old_wholesale_price  DECIMAL(12,2) NULL,
  new_wholesale_price  DECIMAL(12,2) NULL,
  old_special_price    DECIMAL(12,2) NULL,
  new_special_price    DECIMAL(12,2) NULL,
  changed_by           CHAR(36)      NULL,
  changed_by_name      VARCHAR(255)  NOT NULL DEFAULT '',
  changed_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id) REFERENCES inv_products(id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- inventory_balances
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_balances (
  id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  product_id       CHAR(36)      NOT NULL,
  location_id      CHAR(36)      NOT NULL,
  qty_on_hand      DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_available    DECIMAL(12,3) NOT NULL DEFAULT 0,
  last_movement_at DATETIME      NULL,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_inv_balance (product_id, location_id),
  FOREIGN KEY (product_id)  REFERENCES inv_products(id)  ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- inventory_movements
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inventory_movements (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  product_id    CHAR(36)      NOT NULL,
  location_id   CHAR(36)      NOT NULL,
  movement_type VARCHAR(50)   NOT NULL,
  qty_change    DECIMAL(12,3) NOT NULL,
  qty_after     DECIMAL(12,3) NOT NULL DEFAULT 0,
  ref_number    VARCHAR(255)  NOT NULL DEFAULT '',
  ref_id        CHAR(36)      NULL,
  notes         TEXT          NOT NULL,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)  REFERENCES inv_products(id)  ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- purchase_orders
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_orders (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  po_number     VARCHAR(50)   NOT NULL UNIQUE,
  supplier_id   CHAR(36)      NOT NULL,
  location_id   CHAR(36)      NOT NULL,
  status        VARCHAR(30)   NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','submitted','approved','partially_received','fully_received','cancelled')),
  order_date    DATE          NOT NULL DEFAULT (CURRENT_DATE),
  expected_date DATE          NULL,
  notes         TEXT          NOT NULL,
  total_amount  DECIMAL(12,6) NOT NULL DEFAULT 0,
  approved_by   CHAR(36)      NULL,
  approved_at   DATETIME      NULL,
  created_by    CHAR(36)      NULL,
  created_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id)  REFERENCES inv_suppliers(id)  ON DELETE RESTRICT,
  FOREIGN KEY (location_id)  REFERENCES inv_locations(id)  ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- purchase_order_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS purchase_order_items (
  id           CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  po_id        CHAR(36)      NOT NULL,
  product_id   CHAR(36)      NOT NULL,
  qty_ordered  DECIMAL(12,3) NOT NULL,
  qty_received DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_cost    DECIMAL(12,6) NOT NULL DEFAULT 0,
  subtotal     DECIMAL(12,6) NOT NULL DEFAULT 0,
  notes        TEXT          NOT NULL,
  FOREIGN KEY (po_id)       REFERENCES purchase_orders(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES inv_products(id)    ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- receivings
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS receivings (
  id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  receiving_number VARCHAR(50)  NOT NULL UNIQUE DEFAULT '',
  po_id            CHAR(36)     NOT NULL,
  supplier_id      CHAR(36)     NOT NULL,
  location_id      CHAR(36)     NOT NULL,
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  receiving_date   DATE         NOT NULL DEFAULT (CURRENT_DATE),
  invoice_number   VARCHAR(100) NOT NULL DEFAULT '',
  dr_number        VARCHAR(100) NOT NULL DEFAULT '',
  remarks          TEXT         NOT NULL,
  posted_by        CHAR(36)     NULL,
  posted_at        DATETIME     NULL,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (po_id)       REFERENCES purchase_orders(id) ON DELETE RESTRICT,
  FOREIGN KEY (supplier_id) REFERENCES inv_suppliers(id)   ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id)   ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- receiving_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS receiving_items (
  id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  receiving_id     CHAR(36)      NOT NULL,
  po_item_id       CHAR(36)      NULL,
  product_id       CHAR(36)      NOT NULL,
  qty_received     DECIMAL(12,3) NOT NULL,
  qty_rejected     DECIMAL(12,3) NOT NULL DEFAULT 0,
  unit_cost        DECIMAL(12,2) NOT NULL DEFAULT 0,
  expiry_date      DATE          NULL,
  batch_number     VARCHAR(100)  NOT NULL DEFAULT '',
  FOREIGN KEY (receiving_id) REFERENCES receivings(id)           ON DELETE CASCADE,
  FOREIGN KEY (po_item_id)   REFERENCES purchase_order_items(id) ON DELETE SET NULL,
  FOREIGN KEY (product_id)   REFERENCES inv_products(id)         ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- product_lots
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS product_lots (
  id                   CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  product_id           CHAR(36)      NOT NULL,
  location_id          CHAR(36)      NOT NULL,
  receiving_item_id    CHAR(36)      NULL,
  batch_number         VARCHAR(100)  NOT NULL DEFAULT '',
  expiry_date          DATE          NULL,
  qty_on_hand          DECIMAL(12,3) NOT NULL DEFAULT 0,
  created_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (product_id)        REFERENCES inv_products(id)   ON DELETE RESTRICT,
  FOREIGN KEY (location_id)       REFERENCES inv_locations(id)  ON DELETE RESTRICT,
  FOREIGN KEY (receiving_item_id) REFERENCES receiving_items(id) ON DELETE SET NULL
);

-- -------------------------------------------------------
-- payables
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS payables (
  id             CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  payable_number VARCHAR(50)   NOT NULL UNIQUE,
  supplier_id    CHAR(36)      NOT NULL,
  receiving_id   CHAR(36)      NULL,
  invoice_number VARCHAR(100)  NOT NULL DEFAULT '',
  amount         DECIMAL(12,2) NOT NULL,
  balance        DECIMAL(12,2) NOT NULL,
  due_date       DATE          NULL,
  status         VARCHAR(30)   NOT NULL DEFAULT 'open' CHECK (status IN ('open','partial','paid','cancelled')),
  notes          TEXT          NOT NULL,
  created_by     CHAR(36)      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (supplier_id) REFERENCES inv_suppliers(id) ON DELETE RESTRICT,
  FOREIGN KEY (receiving_id) REFERENCES receivings(id)   ON DELETE SET NULL
);

-- -------------------------------------------------------
-- payable_payments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS payable_payments (
  id             CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  payable_id     CHAR(36)      NOT NULL,
  amount         DECIMAL(12,2) NOT NULL,
  payment_date   DATE          NOT NULL DEFAULT (CURRENT_DATE),
  payment_method VARCHAR(50)   NOT NULL DEFAULT 'cash',
  reference_no   VARCHAR(100)  NOT NULL DEFAULT '',
  notes          TEXT          NOT NULL,
  owner_id       CHAR(36)      NULL,
  owner_ledger_id CHAR(36)     NULL,
  created_by     CHAR(36)      NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (payable_id) REFERENCES payables(id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- stock_transfers
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfers (
  id                      CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  transfer_number         VARCHAR(50)  NOT NULL UNIQUE,
  source_location_id      CHAR(36)     NOT NULL,
  destination_location_id CHAR(36)     NOT NULL,
  status                  VARCHAR(30)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','approved','issued','partially_received','fully_received','cancelled')),
  transfer_date           DATE         NOT NULL DEFAULT (CURRENT_DATE),
  expected_date           DATE         NULL,
  notes                   TEXT         NOT NULL,
  approved_by             CHAR(36)     NULL,
  approved_at             DATETIME     NULL,
  issued_by               CHAR(36)     NULL,
  issued_at               DATETIME     NULL,
  created_by              CHAR(36)     NULL,
  updated_by              CHAR(36)     NULL,
  created_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at              DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (source_location_id)      REFERENCES inv_locations(id) ON DELETE RESTRICT,
  FOREIGN KEY (destination_location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT,
  CHECK (source_location_id <> destination_location_id)
);

-- -------------------------------------------------------
-- stock_transfer_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS stock_transfer_items (
  id            CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  transfer_id   CHAR(36)      NOT NULL,
  product_id    CHAR(36)      NOT NULL,
  qty_requested DECIMAL(12,3) NOT NULL,
  qty_issued    DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_received  DECIMAL(12,3) NOT NULL DEFAULT 0,
  notes         TEXT          NOT NULL,
  FOREIGN KEY (transfer_id) REFERENCES stock_transfers(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)  REFERENCES inv_products(id)    ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- adjustments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS adjustments (
  id               CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  adj_number       VARCHAR(50)  NOT NULL UNIQUE,
  location_id      CHAR(36)     NOT NULL,
  adj_type         VARCHAR(30)  NOT NULL CHECK (adj_type IN ('addition','deduction','write_off','correction')),
  status           VARCHAR(20)  NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','posted','cancelled')),
  adj_date         DATE         NOT NULL DEFAULT (CURRENT_DATE),
  reason           TEXT         NOT NULL,
  posted_by        CHAR(36)     NULL,
  posted_at        DATETIME     NULL,
  created_by       CHAR(36)     NULL,
  created_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- adjustment_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS adjustment_items (
  id             CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  adjustment_id  CHAR(36)      NOT NULL,
  product_id     CHAR(36)      NOT NULL,
  qty_before     DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_adjusted   DECIMAL(12,3) NOT NULL,
  qty_after      DECIMAL(12,3) NOT NULL DEFAULT 0,
  reason         TEXT          NOT NULL,
  FOREIGN KEY (adjustment_id) REFERENCES adjustments(id)   ON DELETE CASCADE,
  FOREIGN KEY (product_id)    REFERENCES inv_products(id)  ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- physical_counts
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS physical_counts (
  id            CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  pc_number     VARCHAR(50)  NOT NULL UNIQUE,
  location_id   CHAR(36)     NOT NULL,
  status        VARCHAR(20)  NOT NULL DEFAULT 'open' CHECK (status IN ('open','posted','cancelled')),
  count_date    DATE         NOT NULL DEFAULT (CURRENT_DATE),
  notes         TEXT         NOT NULL,
  posted_by     CHAR(36)     NULL,
  posted_at     DATETIME     NULL,
  created_by    CHAR(36)     NULL,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- physical_count_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS physical_count_items (
  id              CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  physical_count_id CHAR(36)    NOT NULL,
  product_id      CHAR(36)      NOT NULL,
  qty_system      DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_counted     DECIMAL(12,3) NOT NULL DEFAULT 0,
  qty_variance    DECIMAL(12,3) GENERATED ALWAYS AS (qty_counted - qty_system) STORED,
  notes           TEXT          NOT NULL,
  FOREIGN KEY (physical_count_id) REFERENCES physical_counts(id) ON DELETE CASCADE,
  FOREIGN KEY (product_id)        REFERENCES inv_products(id)    ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- pos_terminals
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_terminals (
  terminal_id   CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  terminal_code VARCHAR(20)  NOT NULL UNIQUE,
  terminal_name VARCHAR(100) NOT NULL,
  location_id   CHAR(36)     NOT NULL,
  is_active     TINYINT(1)   NOT NULL DEFAULT 1,
  created_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- pos_shifts
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_shifts (
  shift_id        CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  terminal_id     CHAR(36)      NOT NULL,
  cashier_id      CHAR(36)      NOT NULL,
  location_id     CHAR(36)      NOT NULL,
  shift_date      DATE          NOT NULL,
  business_date   DATE          NULL,
  status          VARCHAR(10)   NOT NULL DEFAULT 'open' CHECK (status IN ('open','closed')),
  opening_cash    DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes           TEXT          NULL,
  expected_cash   DECIMAL(12,2) NOT NULL DEFAULT 0,
  actual_cash     DECIMAL(12,2) NOT NULL DEFAULT 0,
  over_short      DECIMAL(12,2) NOT NULL DEFAULT 0,
  opened_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  closed_at       DATETIME      NULL,
  closed_by       CHAR(36)      NULL,
  z_reading_posted_at DATETIME  NULL,
  z_reading_posted_by CHAR(36)  NULL,
  z_reading_reset_at  DATETIME  NULL,
  z_reading_reset_by  CHAR(36)  NULL,
  z_reading_reset_reason TEXT   NULL,
  UNIQUE KEY uq_open_shift (cashier_id, terminal_id, status, shift_date),
  FOREIGN KEY (terminal_id) REFERENCES pos_terminals(terminal_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id)          ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pos_recent_items (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  terminal_id   CHAR(36)    NOT NULL,
  location_id   CHAR(36)    NULL,
  product_id    CHAR(36)    NOT NULL,
  last_used_at  DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  use_count     INT         NOT NULL DEFAULT 1,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_pos_recent_items_terminal_product (terminal_id, product_id),
  KEY idx_pos_recent_items_terminal_last_used (terminal_id, last_used_at),
  KEY idx_pos_recent_items_product (product_id)
);

CREATE TABLE IF NOT EXISTS pos_zreading_resets (
  id            CHAR(36)    PRIMARY KEY DEFAULT (UUID()),
  shift_id      CHAR(36)    NOT NULL,
  terminal_id   CHAR(36)    NOT NULL,
  location_id   CHAR(36)    NOT NULL,
  business_date DATE        NOT NULL,
  reset_by      CHAR(36)    NOT NULL,
  reason        TEXT        NOT NULL,
  reset_at      DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  created_at    DATETIME    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pos_zreading_resets_shift (shift_id),
  KEY idx_pos_zreading_resets_date (business_date),
  KEY idx_pos_zreading_resets_reset_at (reset_at),
  FOREIGN KEY (shift_id) REFERENCES pos_shifts(shift_id) ON DELETE RESTRICT,
  FOREIGN KEY (terminal_id) REFERENCES pos_terminals(terminal_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pos_cash_pickups (
  id                CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  shift_id          CHAR(36)      NOT NULL,
  terminal_id       CHAR(36)      NOT NULL,
  location_id       CHAR(36)      NOT NULL,
  business_date     DATE          NOT NULL,
  pickup_kind       VARCHAR(30)   NOT NULL DEFAULT 'general',
  pickup_at         DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  amount            DECIMAL(12,2) NOT NULL DEFAULT 0,
  reason            VARCHAR(255)  NOT NULL DEFAULT '',
  category          VARCHAR(80)   NOT NULL DEFAULT '',
  related_reference VARCHAR(120)  NOT NULL DEFAULT '',
  notes             TEXT          NOT NULL,
  created_by        CHAR(36)      NULL,
  is_deleted        TINYINT(1)    NOT NULL DEFAULT 0,
  created_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at        DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY idx_pos_cash_pickups_shift (shift_id),
  KEY idx_pos_cash_pickups_terminal_date (terminal_id, business_date),
  KEY idx_pos_cash_pickups_pickup_at (pickup_at),
  FOREIGN KEY (shift_id) REFERENCES pos_shifts(shift_id) ON DELETE RESTRICT,
  FOREIGN KEY (terminal_id) REFERENCES pos_terminals(terminal_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id) ON DELETE RESTRICT
);

CREATE TABLE IF NOT EXISTS pos_cash_pickup_links (
  id                    CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  pickup_id             CHAR(36)      NOT NULL,
  source_transaction_id CHAR(36)      NOT NULL,
  source_sale_id        CHAR(36)      NULL,
  linked_amount         DECIMAL(12,2) NOT NULL DEFAULT 0,
  created_at            DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  KEY idx_pos_cash_pickup_links_pickup (pickup_id),
  KEY idx_pos_cash_pickup_links_txn (source_transaction_id),
  FOREIGN KEY (pickup_id) REFERENCES pos_cash_pickups(id) ON DELETE CASCADE
);

-- Receipt number counter (replaces PostgreSQL sequence)
CREATE TABLE IF NOT EXISTS pos_sequences (
  seq_name   VARCHAR(50) PRIMARY KEY,
  seq_value  BIGINT      NOT NULL DEFAULT 0
);
INSERT IGNORE INTO pos_sequences (seq_name, seq_value) VALUES ('receipt', 0), ('hold_ref', 0);

-- -------------------------------------------------------
-- sales
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sales (
  sale_id          CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  shift_id         CHAR(36)      NOT NULL,
  terminal_id      CHAR(36)      NOT NULL,
  location_id      CHAR(36)      NOT NULL,
  cashier_id       CHAR(36)      NOT NULL,
  receipt_no       VARCHAR(50)   NOT NULL UNIQUE DEFAULT '',
  sale_status      VARCHAR(20)   NOT NULL DEFAULT 'completed' CHECK (sale_status IN ('completed','held','cancelled','voided')),
  subtotal         DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount  DECIMAL(12,2) NOT NULL DEFAULT 0,
  tax_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  total_amount     DECIMAL(12,2) NOT NULL DEFAULT 0,
  amount_tendered  DECIMAL(12,2) NOT NULL DEFAULT 0,
  change_amount    DECIMAL(12,2) NOT NULL DEFAULT 0,
  customer_id      CHAR(36)      NULL,
  loyalty_points_earned DECIMAL(12,2) NOT NULL DEFAULT 0,
  loyalty_points_redeemed DECIMAL(12,2) NOT NULL DEFAULT 0,
  voided_by        CHAR(36)      NULL,
  voided_at        DATETIME      NULL,
  void_reason      TEXT          NOT NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (shift_id)    REFERENCES pos_shifts(shift_id)       ON DELETE RESTRICT,
  FOREIGN KEY (terminal_id) REFERENCES pos_terminals(terminal_id) ON DELETE RESTRICT,
  FOREIGN KEY (location_id) REFERENCES inv_locations(id)          ON DELETE RESTRICT
);

-- -------------------------------------------------------
-- sale_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_items (
  item_id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  sale_id               CHAR(36)      NOT NULL,
  product_id            CHAR(36)      NULL,
  barcode               VARCHAR(100)  NOT NULL DEFAULT '',
  sku_code              VARCHAR(100)  NOT NULL DEFAULT '',
  product_name_snapshot VARCHAR(255)  NOT NULL DEFAULT '',
  qty                   DECIMAL(12,4) NOT NULL,
  retail_unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price            DECIMAL(12,2) NOT NULL,
  wholesale_enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
  wholesale_block_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  wholesale_blocks_applied INT        NOT NULL DEFAULT 0,
  wholesale_base_qty_applied DECIMAL(18,6) NOT NULL DEFAULT 0,
  retail_remainder_base_qty DECIMAL(18,6) NOT NULL DEFAULT 0,
  pricing_breakdown     VARCHAR(255)  NOT NULL DEFAULT '',
  selected_price_level  VARCHAR(20)   NOT NULL DEFAULT 'Retail',
  applied_price_level   VARCHAR(20)   NOT NULL DEFAULT 'Retail',
  price_source          VARCHAR(30)   NOT NULL DEFAULT 'Retail',
  cost_at_sale          DECIMAL(12,2) NOT NULL DEFAULT 0,
  discount_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal              DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order            INT           NOT NULL DEFAULT 0,
  FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- sale_payments
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_payments (
  payment_id     CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  sale_id        CHAR(36)      NOT NULL,
  payment_method VARCHAR(20)   NOT NULL CHECK (payment_method IN ('cash','gcash','charge')),
  amount         DECIMAL(12,2) NOT NULL,
  reference_no   VARCHAR(100)  NOT NULL DEFAULT '',
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (sale_id) REFERENCES sales(sale_id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- held_sales
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS held_sales (
  held_sale_id   CHAR(36)     PRIMARY KEY DEFAULT (UUID()),
  shift_id       CHAR(36)     NOT NULL,
  terminal_id    CHAR(36)     NOT NULL,
  cashier_id     CHAR(36)     NOT NULL,
  hold_reference VARCHAR(20)  NOT NULL UNIQUE DEFAULT '',
  customer_id    CHAR(36)     NULL,
  customer_name_snapshot VARCHAR(255) NOT NULL DEFAULT 'Walk-in',
  customer_price_level_snapshot VARCHAR(20) NOT NULL DEFAULT 'Retail',
  status         VARCHAR(20)  NOT NULL DEFAULT 'held' CHECK (status IN ('held','recalled','expired','cancelled')),
  subtotal       DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes          TEXT          NOT NULL,
  created_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- -------------------------------------------------------
-- held_sale_items
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS held_sale_items (
  item_id               CHAR(36)      PRIMARY KEY DEFAULT (UUID()),
  held_sale_id          CHAR(36)      NOT NULL,
  product_id            CHAR(36)      NULL,
  barcode               VARCHAR(100)  NOT NULL DEFAULT '',
  sku_code              VARCHAR(100)  NOT NULL DEFAULT '',
  product_name_snapshot VARCHAR(255)  NOT NULL DEFAULT '',
  qty                   DECIMAL(12,4) NOT NULL,
  retail_unit_price     DECIMAL(12,2) NOT NULL DEFAULT 0,
  unit_price            DECIMAL(12,2) NOT NULL,
  wholesale_enabled     TINYINT(1)    NOT NULL DEFAULT 0,
  wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
  wholesale_block_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  wholesale_blocks_applied INT        NOT NULL DEFAULT 0,
  wholesale_base_qty_applied DECIMAL(18,6) NOT NULL DEFAULT 0,
  retail_remainder_base_qty DECIMAL(18,6) NOT NULL DEFAULT 0,
  pricing_breakdown     VARCHAR(255)  NOT NULL DEFAULT '',
  selected_price_level  VARCHAR(20)   NOT NULL DEFAULT 'Retail',
  applied_price_level   VARCHAR(20)   NOT NULL DEFAULT 'Retail',
  price_source          VARCHAR(30)   NOT NULL DEFAULT 'Retail',
  discount_amount       DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal              DECIMAL(12,2) NOT NULL DEFAULT 0,
  sort_order            INT           NOT NULL DEFAULT 0,
  FOREIGN KEY (held_sale_id) REFERENCES held_sales(held_sale_id) ON DELETE CASCADE
);

-- -------------------------------------------------------
-- POS permissions (supervisor override rules)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_permissions (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  role           VARCHAR(50)   NULL,
  user_id        CHAR(36)      NULL,
  permission     VARCHAR(50)   NOT NULL,
  max_discount_pct DECIMAL(5,2) NULL,
  requires_pin   TINYINT(1)   NOT NULL DEFAULT 0,
  pin_hash       VARCHAR(255)  NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- POS customers / loyalty
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_customers (
  customer_id    CHAR(36)      NOT NULL DEFAULT (UUID()),
  first_name     VARCHAR(100)  NOT NULL DEFAULT '',
  last_name      VARCHAR(100)  NOT NULL DEFAULT '',
  phone          VARCHAR(50)   NOT NULL DEFAULT '',
  email          VARCHAR(255)  NOT NULL DEFAULT '',
  address        TEXT          NULL,
  price_level    VARCHAR(20)   NOT NULL DEFAULT 'Retail',
  messenger_psid VARCHAR(255)  NOT NULL DEFAULT '',
  messenger_linked TINYINT(1)  NOT NULL DEFAULT 0,
  last_messenger_interaction_at DATETIME NULL,
  loyalty_points INT           NOT NULL DEFAULT 0,
  credit_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_active      TINYINT(1)   NOT NULL DEFAULT 1,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (customer_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS customer_credit_ledger (
  id               CHAR(36)      NOT NULL DEFAULT (UUID()),
  customer_id      CHAR(36)      NOT NULL,
  entry_type       VARCHAR(20)   NOT NULL DEFAULT 'charge',
  amount           DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_before   DECIMAL(12,2) NOT NULL DEFAULT 0,
  balance_after    DECIMAL(12,2) NOT NULL DEFAULT 0,
  payment_method   VARCHAR(20)   NOT NULL DEFAULT 'cash',
  payment_number   VARCHAR(50)   NOT NULL DEFAULT '',
  reference_number VARCHAR(100)  NOT NULL DEFAULT '',
  target_account_type VARCHAR(30) NOT NULL DEFAULT '',
  target_account_id CHAR(36) NULL,
  target_account_name VARCHAR(255) NOT NULL DEFAULT '',
  accounting_entry_id CHAR(36) NULL,
  sale_id          CHAR(36)      NULL,
  notes            TEXT          NULL,
  created_by       CHAR(36)      NULL,
  created_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_customer_credit_ledger_customer (customer_id),
  KEY idx_customer_credit_ledger_sale (sale_id),
  KEY idx_customer_credit_ledger_created_at (created_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS pos_message_logs (
  id                  CHAR(36)      NOT NULL DEFAULT (UUID()),
  held_sale_id        CHAR(36)      NOT NULL,
  customer_id         CHAR(36)      NOT NULL,
  channel             VARCHAR(30)   NOT NULL DEFAULT 'messenger',
  messenger_psid_used VARCHAR(255)  NOT NULL DEFAULT '',
  sent_at             DATETIME      NULL,
  sent_by             CHAR(36)      NULL,
  status              VARCHAR(20)   NOT NULL DEFAULT 'pending',
  error_message       TEXT          NULL,
  meta_message_id     VARCHAR(255)  NULL,
  created_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  KEY idx_pos_message_logs_hold (held_sale_id),
  KEY idx_pos_message_logs_customer (customer_id),
  KEY idx_pos_message_logs_channel (channel),
  KEY idx_pos_message_logs_sent_at (sent_at)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- POS audit log (void / return / price override events)
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS pos_audit_log (
  id             CHAR(36)      NOT NULL DEFAULT (UUID()),
  shift_id       CHAR(36)      NULL,
  terminal_id    CHAR(36)      NULL,
  sale_id        CHAR(36)      NULL,
  action         VARCHAR(100)  NOT NULL,
  actor_id       CHAR(36)      NULL,
  supervisor_id  CHAR(36)      NULL,
  details        JSON          NULL,
  created_at     TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Sale returns
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS sale_returns (
  return_id         CHAR(36)      NOT NULL DEFAULT (UUID()),
  return_no         VARCHAR(50)   NOT NULL DEFAULT '',
  original_sale_id  CHAR(36)      NOT NULL,
  shift_id          CHAR(36)      NULL,
  terminal_id       CHAR(36)      NULL,
  location_id       CHAR(36)      NULL,
  cashier_id        CHAR(36)      NULL,
  supervisor_id     CHAR(36)      NULL,
  reason            TEXT          NULL,
  refund_method     VARCHAR(50)   NOT NULL DEFAULT 'cash',
  total_return_amt  DECIMAL(12,2) NOT NULL DEFAULT 0,
  notes             TEXT          NULL,
  created_at        TIMESTAMP    NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (return_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

CREATE TABLE IF NOT EXISTS sale_return_items (
  id                     CHAR(36)      NOT NULL DEFAULT (UUID()),
  return_id              CHAR(36)      NOT NULL,
  original_sale_item_id  CHAR(36)      NOT NULL,
  product_id             CHAR(36)      NULL,
  product_name_snapshot  VARCHAR(255)  NOT NULL DEFAULT '',
  sku_code               VARCHAR(100)  NOT NULL DEFAULT '',
  qty_returned           INT           NOT NULL DEFAULT 0,
  unit_price             DECIMAL(12,2) NOT NULL DEFAULT 0,
  subtotal               DECIMAL(12,2) NOT NULL DEFAULT 0,
  PRIMARY KEY (id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Product-specific unit conversions
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_product_unit_conversions (
  id                          CHAR(36)       NOT NULL DEFAULT (UUID()),
  product_id                  CHAR(36)       NOT NULL,
  unit_id                     CHAR(36)       NOT NULL,
  equivalent_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 1,
  allow_purchase              TINYINT(1)     NOT NULL DEFAULT 0,
  allow_sale                  TINYINT(1)     NOT NULL DEFAULT 0,
  sort_order                  INT            NOT NULL DEFAULT 0,
  created_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at                  DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_unit_conversion (product_id, unit_id),
  FOREIGN KEY (product_id) REFERENCES inv_products(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES inv_units(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

-- -------------------------------------------------------
-- Product selling units / prices
-- -------------------------------------------------------
CREATE TABLE IF NOT EXISTS inv_product_selling_units (
  id               CHAR(36)       NOT NULL DEFAULT (UUID()),
  product_id       CHAR(36)       NOT NULL,
  unit_id          CHAR(36)       NOT NULL,
  qty_in_base_unit DECIMAL(18,6)  NOT NULL DEFAULT 1,
  selling_price    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  retail_price     DECIMAL(12,2)  NOT NULL DEFAULT 0,
  wholesale_price  DECIMAL(12,2)  NOT NULL DEFAULT 0,
  special_price    DECIMAL(12,2)  NOT NULL DEFAULT 0,
  wholesale_enabled TINYINT(1)    NOT NULL DEFAULT 0,
  wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
  wholesale_block_price DECIMAL(12,2) NOT NULL DEFAULT 0,
  is_default       TINYINT(1)     NOT NULL DEFAULT 0,
  sort_order       INT            NOT NULL DEFAULT 0,
  created_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  PRIMARY KEY (id),
  UNIQUE KEY uq_product_selling_unit (product_id, unit_id),
  FOREIGN KEY (product_id) REFERENCES inv_products(id) ON DELETE CASCADE,
  FOREIGN KEY (unit_id) REFERENCES inv_units(id) ON DELETE RESTRICT
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci;

SET FOREIGN_KEY_CHECKS = 1;

-- ============================================================
-- Indexes for performance
-- ============================================================
CREATE INDEX idx_transactions_account_date ON transactions(account_id, date);
CREATE INDEX idx_transactions_date ON transactions(date);
CREATE INDEX idx_audit_logs_user ON audit_logs(user_id);
CREATE INDEX idx_audit_logs_created ON audit_logs(created_at);
CREATE INDEX idx_inv_products_sku ON inv_products(sku_code);
CREATE INDEX idx_inv_products_barcode ON inv_products(barcode);
CREATE INDEX idx_inv_movements_product_location ON inventory_movements(product_id, location_id);
CREATE INDEX idx_sales_shift ON sales(shift_id);
CREATE INDEX idx_sales_created ON sales(created_at);
CREATE INDEX idx_sale_items_sale ON sale_items(sale_id);
CREATE INDEX idx_inv_product_unit_conversions_product ON inv_product_unit_conversions(product_id, unit_id);
CREATE INDEX idx_inv_product_selling_units_product ON inv_product_selling_units(product_id, is_default, sort_order);

-- ============================================================
-- Migration: ALTER TABLE statements for existing databases
-- Run these once on any database created from an older schema.
-- ============================================================

-- bank_transactions: add check/disbursement linkage + soft-delete
ALTER TABLE bank_transactions
  MODIFY COLUMN transaction_type VARCHAR(30) NOT NULL,
  ADD COLUMN IF NOT EXISTS check_id         CHAR(36)   NULL AFTER source_transaction_id,
  ADD COLUMN IF NOT EXISTS disbursement_id  CHAR(36)   NULL AFTER check_id,
  ADD COLUMN IF NOT EXISTS is_deleted       TINYINT(1) NOT NULL DEFAULT 0 AFTER disbursement_id;

-- checks_issued: add finance-link columns
ALTER TABLE checks_issued
  ADD COLUMN IF NOT EXISTS check_date          DATE        NULL AFTER check_number,
  ADD COLUMN IF NOT EXISTS notes               TEXT        NOT NULL DEFAULT '' AFTER description,
  ADD COLUMN IF NOT EXISTS disbursement_id     CHAR(36)    NULL AFTER cleared_date,
  ADD COLUMN IF NOT EXISTS manually_set_status TINYINT(1)  NOT NULL DEFAULT 0 AFTER disbursement_id,
  ADD COLUMN IF NOT EXISTS is_deleted          TINYINT(1)  NOT NULL DEFAULT 0 AFTER manually_set_status;

-- disbursements: add payee/method/notes/soft-delete
ALTER TABLE disbursements
  ADD COLUMN IF NOT EXISTS payee          VARCHAR(255) NOT NULL DEFAULT '' AFTER date,
  ADD COLUMN IF NOT EXISTS purpose        TEXT         NOT NULL DEFAULT '' AFTER payee,
  ADD COLUMN IF NOT EXISTS payment_method VARCHAR(50)  NOT NULL DEFAULT 'cash' AFTER purpose,
  ADD COLUMN IF NOT EXISTS check_number   VARCHAR(100) NOT NULL DEFAULT '' AFTER payment_method,
  ADD COLUMN IF NOT EXISTS notes          TEXT         NOT NULL DEFAULT '' AFTER check_number,
  ADD COLUMN IF NOT EXISTS is_deleted     TINYINT(1)   NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN IF NOT EXISTS source_module  VARCHAR(60)  NULL AFTER disbursement_type,
  ADD COLUMN IF NOT EXISTS source_reference_id CHAR(36) NULL AFTER source_module,
  ADD COLUMN IF NOT EXISTS source_account_type VARCHAR(30) NULL AFTER source_reference_id,
  ADD COLUMN IF NOT EXISTS source_account_id CHAR(36) NULL AFTER source_account_type;

-- daily_sales: add manual P&L + POS sync columns
ALTER TABLE daily_sales
  ADD COLUMN IF NOT EXISTS sales           DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER date,
  ADD COLUMN IF NOT EXISTS cost_of_sales   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER sales,
  ADD COLUMN IF NOT EXISTS description     TEXT          NOT NULL DEFAULT '' AFTER cost_of_sales,
  ADD COLUMN IF NOT EXISTS total_pos_sales DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER description,
  ADD COLUMN IF NOT EXISTS cash_pos_sales  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_pos_sales,
  ADD COLUMN IF NOT EXISTS gcash_pos_sales DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cash_pos_sales,
  ADD COLUMN IF NOT EXISTS card_pos_sales  DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER gcash_pos_sales,
  ADD COLUMN IF NOT EXISTS pos_synced_at   DATETIME      NULL AFTER card_pos_sales,
  ADD COLUMN IF NOT EXISTS is_deleted      TINYINT(1)    NOT NULL DEFAULT 0 AFTER pos_synced_at;

ALTER TABLE pos_shifts
  ADD COLUMN IF NOT EXISTS business_date           DATE          NULL AFTER shift_date,
  ADD COLUMN IF NOT EXISTS notes                   TEXT          NULL AFTER opening_cash,
  ADD COLUMN IF NOT EXISTS closed_by               CHAR(36)      NULL AFTER closed_at,
  ADD COLUMN IF NOT EXISTS z_reading_posted_at     DATETIME      NULL AFTER closed_by,
  ADD COLUMN IF NOT EXISTS z_reading_posted_by     CHAR(36)      NULL AFTER z_reading_posted_at,
  ADD COLUMN IF NOT EXISTS z_reading_reset_at      DATETIME      NULL AFTER z_reading_posted_by,
  ADD COLUMN IF NOT EXISTS z_reading_reset_by      CHAR(36)      NULL AFTER z_reading_reset_at,
  ADD COLUMN IF NOT EXISTS z_reading_reset_reason  TEXT          NULL AFTER z_reading_reset_by;

-- cashier_remittances: add source/dest routing + shift linkage + soft-delete
ALTER TABLE cashier_remittances
  ADD COLUMN IF NOT EXISTS source_type         VARCHAR(30)   NOT NULL DEFAULT 'gcash' AFTER cashier_id,
  ADD COLUMN IF NOT EXISTS source_account_id   CHAR(36)      NULL AFTER source_type,
  ADD COLUMN IF NOT EXISTS source_bank_id      CHAR(36)      NULL AFTER source_account_id,
  ADD COLUMN IF NOT EXISTS destination_type    VARCHAR(30)   NOT NULL DEFAULT 'bank' AFTER source_account_id,
  ADD COLUMN IF NOT EXISTS destination_bank_id CHAR(36)      NULL AFTER destination_type,
  ADD COLUMN IF NOT EXISTS destination_account_id CHAR(36)   NULL AFTER destination_bank_id,
  ADD COLUMN IF NOT EXISTS bank_fee            DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER amount,
  ADD COLUMN IF NOT EXISTS reference_number    VARCHAR(255)  NOT NULL DEFAULT '' AFTER description,
  ADD COLUMN IF NOT EXISTS attachment_reference VARCHAR(255) NULL AFTER reference_number,
  ADD COLUMN IF NOT EXISTS source_transaction_id CHAR(36)    NULL AFTER attachment_reference,
  ADD COLUMN IF NOT EXISTS destination_transaction_id CHAR(36) NULL AFTER source_transaction_id,
  ADD COLUMN IF NOT EXISTS notes               TEXT          NOT NULL DEFAULT '' AFTER bank_fee,
  ADD COLUMN IF NOT EXISTS is_deleted          TINYINT(1)    NOT NULL DEFAULT 0 AFTER updated_at,
  ADD COLUMN IF NOT EXISTS created_by          CHAR(36)      NULL AFTER is_deleted;

-- bank_accounts / bank_transactions / bank_deposits: support ledger-derived monitoring
ALTER TABLE bank_accounts
  ADD COLUMN IF NOT EXISTS beginning_balance   DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER account_number;

ALTER TABLE bank_transactions
  ADD COLUMN IF NOT EXISTS direction           VARCHAR(10)   NOT NULL DEFAULT 'debit' AFTER amount,
  ADD COLUMN IF NOT EXISTS notes               TEXT          NULL AFTER description,
  ADD COLUMN IF NOT EXISTS payable_id          CHAR(36)      NULL AFTER check_id,
  ADD COLUMN IF NOT EXISTS balance_after       DECIMAL(12,2) NULL AFTER payable_id,
  ADD COLUMN IF NOT EXISTS module_source       VARCHAR(50)   NULL AFTER balance_after,
  ADD COLUMN IF NOT EXISTS attachment_reference VARCHAR(255) NULL AFTER module_source,
  ADD COLUMN IF NOT EXISTS updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS notes               TEXT          NULL AFTER source_description,
  ADD COLUMN IF NOT EXISTS source_type         VARCHAR(50)   NOT NULL DEFAULT '' AFTER reference_number,
  ADD COLUMN IF NOT EXISTS cashier_remittance_id CHAR(36)    NULL AFTER source_transaction_id,
  ADD COLUMN IF NOT EXISTS source_module       VARCHAR(50)   NULL AFTER cashier_remittance_id,
  ADD COLUMN IF NOT EXISTS attachment_reference VARCHAR(255) NULL AFTER source_module,
  ADD COLUMN IF NOT EXISTS updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at,
  ADD COLUMN IF NOT EXISTS is_deleted          TINYINT(1)    NOT NULL DEFAULT 0 AFTER updated_at;

ALTER TABLE transactions
  ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(30)  NOT NULL DEFAULT 'regular' AFTER transaction_type,
  ADD COLUMN IF NOT EXISTS source_module       VARCHAR(60)   NULL AFTER bank_account_id,
  ADD COLUMN IF NOT EXISTS source_reference_id CHAR(36)      NULL AFTER source_module,
  ADD COLUMN IF NOT EXISTS disbursement_id     CHAR(36)      NULL AFTER reversal_of_transaction_id,
  ADD COLUMN IF NOT EXISTS cleared_at          DATETIME      NULL AFTER is_closed;

ALTER TABLE cash_transactions
  ADD COLUMN IF NOT EXISTS transaction_category VARCHAR(30)  NOT NULL DEFAULT 'regular' AFTER transaction_type,
  ADD COLUMN IF NOT EXISTS source_module       VARCHAR(60)   NULL AFTER cash_out_type,
  ADD COLUMN IF NOT EXISTS source_reference_id CHAR(36)      NULL AFTER source_module,
  ADD COLUMN IF NOT EXISTS disbursement_id     CHAR(36)      NULL AFTER source_reference_id,
  ADD COLUMN IF NOT EXISTS cleared_at          DATETIME      NULL AFTER is_closed;

ALTER TABLE daily_history
  ADD COLUMN IF NOT EXISTS transaction_count   INT           NOT NULL DEFAULT 0 AFTER total_delivery_fee;

ALTER TABLE cash_daily_history
  ADD COLUMN IF NOT EXISTS total_cash_in       DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER beginning_balance,
  ADD COLUMN IF NOT EXISTS total_cash_out      DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER total_cash_in,
  ADD COLUMN IF NOT EXISTS transaction_count   INT           NOT NULL DEFAULT 0 AFTER total_cash_out,
  ADD COLUMN IF NOT EXISTS cash_fees_collected DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER transaction_count,
  ADD COLUMN IF NOT EXISTS cash_given_out      DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cash_fees_collected,
  ADD COLUMN IF NOT EXISTS cash_out_to_fund    DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cash_given_out,
  ADD COLUMN IF NOT EXISTS bank_deposits       DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cash_out_to_fund,
  ADD COLUMN IF NOT EXISTS cash_fund_disbursements DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER bank_deposits,
  ADD COLUMN IF NOT EXISTS posted_at           DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER posted_by;

-- checks + payable payments: add payment linkage metadata for AP and bank monitoring
ALTER TABLE checks_issued
  ADD COLUMN IF NOT EXISTS payable_id          CHAR(36)      NULL AFTER supplier_id,
  ADD COLUMN IF NOT EXISTS attachment_reference VARCHAR(255) NULL AFTER notes;

ALTER TABLE payable_payments
  ADD COLUMN IF NOT EXISTS reference_number    VARCHAR(100)  NOT NULL DEFAULT '' AFTER payment_method,
  ADD COLUMN IF NOT EXISTS remarks             TEXT          NULL AFTER reference_number,
  ADD COLUMN IF NOT EXISTS bank_account_id     CHAR(36)      NULL AFTER remarks,
  ADD COLUMN IF NOT EXISTS check_id            CHAR(36)      NULL AFTER bank_account_id,
  ADD COLUMN IF NOT EXISTS bank_transaction_id CHAR(36)      NULL AFTER check_id,
  ADD COLUMN IF NOT EXISTS attachment_reference VARCHAR(255) NULL AFTER bank_transaction_id,
  ADD COLUMN IF NOT EXISTS approval_required   TINYINT(1)    NOT NULL DEFAULT 0 AFTER attachment_reference,
  ADD COLUMN IF NOT EXISTS approval_status     VARCHAR(20)   NOT NULL DEFAULT 'approved' AFTER approval_required,
  ADD COLUMN IF NOT EXISTS approved_by         CHAR(36)      NULL AFTER approval_status,
  ADD COLUMN IF NOT EXISTS approved_at         DATETIME      NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS updated_at          DATETIME      NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

ALTER TABLE bank_deposits
  ADD COLUMN IF NOT EXISTS status              VARCHAR(20)   NOT NULL DEFAULT 'verified' AFTER notes,
  ADD COLUMN IF NOT EXISTS deposited_at        DATETIME      NULL AFTER status,
  ADD COLUMN IF NOT EXISTS verified_at         DATETIME      NULL AFTER deposited_at,
  ADD COLUMN IF NOT EXISTS verified_by         CHAR(36)      NULL AFTER verified_at,
  ADD COLUMN IF NOT EXISTS cancelled_at        DATETIME      NULL AFTER verified_by;

ALTER TABLE checks_issued
  ADD COLUMN IF NOT EXISTS approval_required   TINYINT(1)    NOT NULL DEFAULT 0 AFTER manually_set_status,
  ADD COLUMN IF NOT EXISTS approval_status     VARCHAR(20)   NOT NULL DEFAULT 'approved' AFTER approval_required,
  ADD COLUMN IF NOT EXISTS approved_by         CHAR(36)      NULL AFTER approval_status,
  ADD COLUMN IF NOT EXISTS approved_at         DATETIME      NULL AFTER approved_by,
  ADD COLUMN IF NOT EXISTS rejected_reason     TEXT          NULL AFTER approved_at;

ALTER TABLE cashier_remittances
  ADD COLUMN IF NOT EXISTS approval_required   TINYINT(1)    NOT NULL DEFAULT 0 AFTER destination_transaction_id,
  ADD COLUMN IF NOT EXISTS approval_status     VARCHAR(20)   NOT NULL DEFAULT 'approved' AFTER approval_required,
  ADD COLUMN IF NOT EXISTS approved_by         CHAR(36)      NULL AFTER approval_status,
  ADD COLUMN IF NOT EXISTS approved_at         DATETIME      NULL AFTER approved_by;

CREATE TABLE IF NOT EXISTS recurring_obligations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(150) NOT NULL,
  category VARCHAR(80) NOT NULL DEFAULT 'general',
  default_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  frequency VARCHAR(20) NOT NULL DEFAULT 'monthly',
  due_date_rule VARCHAR(120) NOT NULL DEFAULT '',
  next_due_date DATE NOT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  remarks TEXT NULL,
  paid_transaction_id CHAR(36) NULL,
  paid_disbursement_id CHAR(36) NULL,
  last_paid_date DATE NULL,
  last_paid_amount DECIMAL(12,2) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS bank_reconciliations (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  bank_account_id CHAR(36) NOT NULL,
  statement_date DATE NOT NULL,
  statement_ending_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  system_book_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  uncleared_checks_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  deposits_in_transit_total DECIMAL(12,2) NOT NULL DEFAULT 0,
  adjusted_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  variance DECIMAL(12,2) NOT NULL DEFAULT 0,
  remarks TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'draft',
  created_by CHAR(36) NULL,
  reviewed_by CHAR(36) NULL,
  reviewed_at DATETIME NULL,
  finalized_by CHAR(36) NULL,
  finalized_at DATETIME NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_owners (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  name VARCHAR(120) NOT NULL,
  remarks TEXT NULL,
  is_active TINYINT(1) NOT NULL DEFAULT 1,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS finance_owner_movements (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  date DATE NOT NULL,
  movement_type VARCHAR(20) NOT NULL DEFAULT 'funding',
  target_module VARCHAR(20) NOT NULL DEFAULT 'bank',
  owner_id CHAR(36) NULL,
  bank_account_id CHAR(36) NULL,
  account_id CHAR(36) NULL,
  amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  reference_number VARCHAR(120) NOT NULL DEFAULT '',
  remarks TEXT NULL,
  attachment_reference VARCHAR(255) NULL,
  approval_required TINYINT(1) NOT NULL DEFAULT 0,
  approval_status VARCHAR(20) NOT NULL DEFAULT 'approved',
  approved_by CHAR(36) NULL,
  approved_at DATETIME NULL,
  posted_bank_transaction_id CHAR(36) NULL,
  posted_transaction_id CHAR(36) NULL,
  posted_cash_transaction_id CHAR(36) NULL,
  owner_ledger_id CHAR(36) NULL,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

CREATE TABLE IF NOT EXISTS owner_ledger (
  id CHAR(36) PRIMARY KEY DEFAULT (UUID()),
  owner_id CHAR(36) NOT NULL,
  transaction_date DATE NOT NULL,
  transaction_type VARCHAR(60) NOT NULL,
  reference_type VARCHAR(60) NOT NULL DEFAULT '',
  reference_id CHAR(36) NULL,
  source_module VARCHAR(60) NOT NULL DEFAULT '',
  description TEXT NOT NULL,
  increase_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  decrease_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
  running_balance DECIMAL(12,2) NOT NULL DEFAULT 0,
  source_account_type VARCHAR(30) NULL,
  source_account_id CHAR(36) NULL,
  reference_number VARCHAR(120) NOT NULL DEFAULT '',
  remarks TEXT NULL,
  is_deleted TINYINT(1) NOT NULL DEFAULT 0,
  created_by CHAR(36) NULL,
  created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  UNIQUE KEY uq_owner_ledger_reference (owner_id, transaction_type, reference_type, reference_id)
);

-- inv_units: add optional short label and description used by the inventory UI
ALTER TABLE inv_units
  ADD COLUMN IF NOT EXISTS short_name          VARCHAR(20)   NOT NULL DEFAULT '' AFTER abbreviation,
  ADD COLUMN IF NOT EXISTS description         TEXT          NULL AFTER short_name;

-- inv_products: add multi-unit metadata while keeping legacy unit_id/pricing columns for compatibility
ALTER TABLE inv_products
  ADD COLUMN IF NOT EXISTS base_unit_id              CHAR(36)      NULL AFTER unit_id,
  ADD COLUMN IF NOT EXISTS default_purchase_unit_id  CHAR(36)      NULL AFTER base_unit_id,
  ADD COLUMN IF NOT EXISTS default_selling_unit_id   CHAR(36)      NULL AFTER default_purchase_unit_id,
  ADD COLUMN IF NOT EXISTS default_cost              DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER cost_price;

ALTER TABLE inv_product_selling_units
  ADD COLUMN IF NOT EXISTS wholesale_enabled              TINYINT(1)     NOT NULL DEFAULT 0 AFTER special_price,
  ADD COLUMN IF NOT EXISTS wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER wholesale_enabled,
  ADD COLUMN IF NOT EXISTS wholesale_block_price          DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER wholesale_break_qty_in_base_unit;

-- purchase_order_items: keep entered purchase unit and converted base quantity/cost
ALTER TABLE purchase_order_items
  ADD COLUMN IF NOT EXISTS purchase_unit_id                 CHAR(36)       NULL AFTER product_id,
  ADD COLUMN IF NOT EXISTS purchase_unit_name               VARCHAR(100)   NOT NULL DEFAULT '' AFTER purchase_unit_id,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_purchase    DECIMAL(18,6)  NOT NULL DEFAULT 1 AFTER purchase_unit_name,
  ADD COLUMN IF NOT EXISTS qty_ordered_in_base_unit         DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_ordered,
  ADD COLUMN IF NOT EXISTS qty_received_in_base_unit        DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_received,
  ADD COLUMN IF NOT EXISTS cost_per_base_unit               DECIMAL(12,6)  NOT NULL DEFAULT 0 AFTER unit_cost,
  ADD COLUMN IF NOT EXISTS sort_order                       INT            NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN IF NOT EXISTS created_at                       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER sort_order,
  ADD COLUMN IF NOT EXISTS updated_at                       DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER created_at;

-- receiving_items: retain entered unit and accepted/rejected base conversions for posting/audit
ALTER TABLE receiving_items
  ADD COLUMN IF NOT EXISTS qty_ordered                DECIMAL(12,3)  NOT NULL DEFAULT 0 AFTER product_id,
  ADD COLUMN IF NOT EXISTS qty_prev_received          DECIMAL(12,3)  NOT NULL DEFAULT 0 AFTER qty_ordered,
  ADD COLUMN IF NOT EXISTS qty_remaining              DECIMAL(12,3)  NOT NULL DEFAULT 0 AFTER qty_prev_received,
  ADD COLUMN IF NOT EXISTS qty_accepted              DECIMAL(12,3)  NOT NULL DEFAULT 0 AFTER qty_received,
  ADD COLUMN IF NOT EXISTS purchase_unit_id          CHAR(36)       NULL AFTER qty_rejected,
  ADD COLUMN IF NOT EXISTS purchase_unit_name        VARCHAR(100)   NOT NULL DEFAULT '' AFTER purchase_unit_id,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_purchase DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER purchase_unit_name,
  ADD COLUMN IF NOT EXISTS qty_received_in_base_unit DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_in_base_unit_per_purchase,
  ADD COLUMN IF NOT EXISTS qty_accepted_in_base_unit DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_received_in_base_unit,
  ADD COLUMN IF NOT EXISTS qty_rejected_in_base_unit DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_accepted_in_base_unit,
  ADD COLUMN IF NOT EXISTS unit_cost_per_base        DECIMAL(12,6)  NOT NULL DEFAULT 0 AFTER unit_cost,
  ADD COLUMN IF NOT EXISTS notes                     TEXT           NOT NULL DEFAULT '' AFTER batch_number,
  ADD COLUMN IF NOT EXISTS sort_order                INT            NOT NULL DEFAULT 0 AFTER notes,
  ADD COLUMN IF NOT EXISTS updated_at                DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER sort_order,
  ADD COLUMN IF NOT EXISTS created_at                DATETIME       NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER updated_at;

-- inventory_movements: preserve base quantity in qty_change and add display/base unit audit fields
ALTER TABLE inventory_movements
  ADD COLUMN IF NOT EXISTS qty_before                DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_change,
  ADD COLUMN IF NOT EXISTS unit_cost                DECIMAL(12,6)  NULL AFTER qty_after,
  ADD COLUMN IF NOT EXISTS related_location_id      CHAR(36)       NULL AFTER ref_id,
  ADD COLUMN IF NOT EXISTS display_unit_id          CHAR(36)       NULL AFTER related_location_id,
  ADD COLUMN IF NOT EXISTS display_unit_name        VARCHAR(100)   NOT NULL DEFAULT '' AFTER display_unit_id,
  ADD COLUMN IF NOT EXISTS display_qty              DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER display_unit_name,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_display DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER display_qty,
  ADD COLUMN IF NOT EXISTS base_unit_id             CHAR(36)       NULL AFTER qty_in_base_unit_per_display,
  ADD COLUMN IF NOT EXISTS base_unit_name           VARCHAR(100)   NOT NULL DEFAULT '' AFTER base_unit_id;

-- sale_items / held_sale_items: persist selected selling unit and converted base quantities
ALTER TABLE sale_items
  ADD COLUMN IF NOT EXISTS selected_unit_id             CHAR(36)       NULL AFTER product_id,
  ADD COLUMN IF NOT EXISTS selected_unit_name           VARCHAR(100)   NOT NULL DEFAULT '' AFTER selected_unit_id,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_unit    DECIMAL(18,6)  NOT NULL DEFAULT 1 AFTER qty,
  ADD COLUMN IF NOT EXISTS total_base_qty_deducted      DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_in_base_unit_per_unit,
  ADD COLUMN IF NOT EXISTS base_unit_name               VARCHAR(100)   NOT NULL DEFAULT '' AFTER total_base_qty_deducted,
  ADD COLUMN IF NOT EXISTS cost_per_base_unit           DECIMAL(12,6)  NOT NULL DEFAULT 0 AFTER cost_at_sale,
  ADD COLUMN IF NOT EXISTS wholesale_enabled            TINYINT(1)     NOT NULL DEFAULT 0 AFTER unit_price,
  ADD COLUMN IF NOT EXISTS wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER wholesale_enabled,
  ADD COLUMN IF NOT EXISTS wholesale_block_price        DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER wholesale_break_qty_in_base_unit,
  ADD COLUMN IF NOT EXISTS wholesale_blocks_applied     INT            NOT NULL DEFAULT 0 AFTER wholesale_block_price,
  ADD COLUMN IF NOT EXISTS wholesale_base_qty_applied   DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER wholesale_blocks_applied,
  ADD COLUMN IF NOT EXISTS retail_remainder_base_qty    DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER wholesale_base_qty_applied,
  ADD COLUMN IF NOT EXISTS pricing_breakdown            VARCHAR(255)   NOT NULL DEFAULT '' AFTER retail_remainder_base_qty;

ALTER TABLE held_sale_items
  ADD COLUMN IF NOT EXISTS selected_unit_id             CHAR(36)       NULL AFTER product_id,
  ADD COLUMN IF NOT EXISTS selected_unit_name           VARCHAR(100)   NOT NULL DEFAULT '' AFTER selected_unit_id,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_unit    DECIMAL(18,6)  NOT NULL DEFAULT 1 AFTER qty,
  ADD COLUMN IF NOT EXISTS total_base_qty_deducted      DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_in_base_unit_per_unit,
  ADD COLUMN IF NOT EXISTS base_unit_name               VARCHAR(100)   NOT NULL DEFAULT '' AFTER total_base_qty_deducted,
  ADD COLUMN IF NOT EXISTS wholesale_enabled            TINYINT(1)     NOT NULL DEFAULT 0 AFTER unit_price,
  ADD COLUMN IF NOT EXISTS wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER wholesale_enabled,
  ADD COLUMN IF NOT EXISTS wholesale_block_price        DECIMAL(12,2)  NOT NULL DEFAULT 0 AFTER wholesale_break_qty_in_base_unit,
  ADD COLUMN IF NOT EXISTS wholesale_blocks_applied     INT            NOT NULL DEFAULT 0 AFTER wholesale_block_price,
  ADD COLUMN IF NOT EXISTS wholesale_base_qty_applied   DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER wholesale_blocks_applied,
  ADD COLUMN IF NOT EXISTS retail_remainder_base_qty    DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER wholesale_base_qty_applied,
  ADD COLUMN IF NOT EXISTS pricing_breakdown            VARCHAR(255)   NOT NULL DEFAULT '' AFTER retail_remainder_base_qty;

ALTER TABLE sale_return_items
  ADD COLUMN IF NOT EXISTS selected_unit_id             CHAR(36)       NULL AFTER product_id,
  ADD COLUMN IF NOT EXISTS selected_unit_name           VARCHAR(100)   NOT NULL DEFAULT '' AFTER selected_unit_id,
  ADD COLUMN IF NOT EXISTS qty_in_base_unit_per_unit    DECIMAL(18,6)  NOT NULL DEFAULT 1 AFTER qty_returned,
  ADD COLUMN IF NOT EXISTS total_base_qty_restored      DECIMAL(18,6)  NOT NULL DEFAULT 0 AFTER qty_in_base_unit_per_unit,
  ADD COLUMN IF NOT EXISTS base_unit_name               VARCHAR(100)   NOT NULL DEFAULT '' AFTER total_base_qty_restored;

-- Backfill authoritative unit columns from the legacy single-unit model
UPDATE inv_products
SET
  base_unit_id = COALESCE(base_unit_id, unit_id),
  default_purchase_unit_id = COALESCE(default_purchase_unit_id, unit_id),
  default_cost = CASE
    WHEN default_cost = 0 THEN COALESCE(cost_price, 0)
    ELSE default_cost
  END
WHERE base_unit_id IS NULL OR default_purchase_unit_id IS NULL OR default_cost = 0;

INSERT IGNORE INTO inv_product_unit_conversions (
  id, product_id, unit_id, equivalent_qty_in_base_unit, allow_purchase, allow_sale, sort_order
)
SELECT
  UUID(),
  p.id,
  COALESCE(p.base_unit_id, p.unit_id),
  1,
  1,
  1,
  0
FROM inv_products p
WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL;

INSERT IGNORE INTO inv_product_selling_units (
  id, product_id, unit_id, qty_in_base_unit, selling_price, retail_price, wholesale_price, special_price, is_default, sort_order
)
SELECT
  UUID(),
  p.id,
  COALESCE(p.base_unit_id, p.unit_id),
  1,
  COALESCE(NULLIF(p.retail_price, 0), p.selling_price, 0),
  COALESCE(NULLIF(p.retail_price, 0), p.selling_price, 0),
  COALESCE(p.wholesale_price, 0),
  COALESCE(p.special_price, 0),
  1,
  0
FROM inv_products p
WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL;

UPDATE inv_products p
LEFT JOIN inv_product_selling_units su
  ON su.product_id = p.id AND su.is_default = 1
SET
  p.default_selling_unit_id = COALESCE(p.default_selling_unit_id, su.id),
  p.unit_id = COALESCE(p.base_unit_id, p.unit_id)
WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL;

UPDATE purchase_order_items
SET
  purchase_unit_id = COALESCE(purchase_unit_id, (SELECT default_purchase_unit_id FROM inv_products p WHERE p.id = purchase_order_items.product_id LIMIT 1)),
  purchase_unit_name = CASE
    WHEN purchase_unit_name != '' THEN purchase_unit_name
    ELSE COALESCE((SELECT u.name FROM inv_products p LEFT JOIN inv_units u ON u.id = COALESCE(p.default_purchase_unit_id, p.unit_id) WHERE p.id = purchase_order_items.product_id LIMIT 1), '')
  END,
  qty_in_base_unit_per_purchase = CASE
    WHEN qty_in_base_unit_per_purchase > 0 THEN qty_in_base_unit_per_purchase
    ELSE 1
  END,
  qty_ordered_in_base_unit = CASE
    WHEN qty_ordered_in_base_unit > 0 THEN qty_ordered_in_base_unit
    ELSE qty_ordered * GREATEST(qty_in_base_unit_per_purchase, 1)
  END,
  qty_received_in_base_unit = CASE
    WHEN qty_received_in_base_unit > 0 THEN qty_received_in_base_unit
    ELSE qty_received * GREATEST(qty_in_base_unit_per_purchase, 1)
  END,
  cost_per_base_unit = CASE
    WHEN cost_per_base_unit > 0 THEN cost_per_base_unit
    ELSE unit_cost / GREATEST(qty_in_base_unit_per_purchase, 1)
  END;

UPDATE receiving_items
SET
  qty_accepted = CASE
    WHEN qty_accepted > 0 THEN qty_accepted
    ELSE GREATEST(qty_received - qty_rejected, 0)
  END,
  purchase_unit_id = COALESCE(purchase_unit_id, (SELECT default_purchase_unit_id FROM inv_products p WHERE p.id = receiving_items.product_id LIMIT 1)),
  purchase_unit_name = CASE
    WHEN purchase_unit_name != '' THEN purchase_unit_name
    ELSE COALESCE((SELECT u.name FROM inv_products p LEFT JOIN inv_units u ON u.id = COALESCE(p.default_purchase_unit_id, p.unit_id) WHERE p.id = receiving_items.product_id LIMIT 1), '')
  END,
  qty_in_base_unit_per_purchase = CASE
    WHEN qty_in_base_unit_per_purchase > 0 THEN qty_in_base_unit_per_purchase
    ELSE 1
  END,
  qty_received_in_base_unit = CASE
    WHEN qty_received_in_base_unit > 0 THEN qty_received_in_base_unit
    ELSE qty_received * GREATEST(qty_in_base_unit_per_purchase, 1)
  END,
  qty_accepted_in_base_unit = CASE
    WHEN qty_accepted_in_base_unit > 0 THEN qty_accepted_in_base_unit
    ELSE qty_accepted * GREATEST(qty_in_base_unit_per_purchase, 1)
  END,
  qty_rejected_in_base_unit = CASE
    WHEN qty_rejected_in_base_unit > 0 THEN qty_rejected_in_base_unit
    ELSE qty_rejected * GREATEST(qty_in_base_unit_per_purchase, 1)
  END,
  unit_cost_per_base = CASE
    WHEN unit_cost_per_base > 0 THEN unit_cost_per_base
    ELSE unit_cost / GREATEST(qty_in_base_unit_per_purchase, 1)
  END;

UPDATE sale_items
SET
  qty_in_base_unit_per_unit = CASE
    WHEN qty_in_base_unit_per_unit > 0 THEN qty_in_base_unit_per_unit
    ELSE 1
  END,
  total_base_qty_deducted = CASE
    WHEN total_base_qty_deducted > 0 THEN total_base_qty_deducted
    ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
  END,
  wholesale_enabled = COALESCE(wholesale_enabled, 0),
  wholesale_break_qty_in_base_unit = CASE WHEN wholesale_break_qty_in_base_unit > 0 THEN wholesale_break_qty_in_base_unit ELSE 0 END,
  wholesale_block_price = CASE WHEN wholesale_block_price > 0 THEN wholesale_block_price ELSE 0 END,
  wholesale_blocks_applied = CASE WHEN wholesale_blocks_applied > 0 THEN wholesale_blocks_applied ELSE 0 END,
  wholesale_base_qty_applied = CASE WHEN wholesale_base_qty_applied > 0 THEN wholesale_base_qty_applied ELSE 0 END,
  retail_remainder_base_qty = CASE
    WHEN retail_remainder_base_qty > 0 THEN retail_remainder_base_qty
    ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
  END,
  pricing_breakdown = COALESCE(pricing_breakdown, '');

UPDATE held_sale_items
SET
  qty_in_base_unit_per_unit = CASE
    WHEN qty_in_base_unit_per_unit > 0 THEN qty_in_base_unit_per_unit
    ELSE 1
  END,
  total_base_qty_deducted = CASE
    WHEN total_base_qty_deducted > 0 THEN total_base_qty_deducted
    ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
  END,
  wholesale_enabled = COALESCE(wholesale_enabled, 0),
  wholesale_break_qty_in_base_unit = CASE WHEN wholesale_break_qty_in_base_unit > 0 THEN wholesale_break_qty_in_base_unit ELSE 0 END,
  wholesale_block_price = CASE WHEN wholesale_block_price > 0 THEN wholesale_block_price ELSE 0 END,
  wholesale_blocks_applied = CASE WHEN wholesale_blocks_applied > 0 THEN wholesale_blocks_applied ELSE 0 END,
  wholesale_base_qty_applied = CASE WHEN wholesale_base_qty_applied > 0 THEN wholesale_base_qty_applied ELSE 0 END,
  retail_remainder_base_qty = CASE
    WHEN retail_remainder_base_qty > 0 THEN retail_remainder_base_qty
    ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
  END,
  pricing_breakdown = COALESCE(pricing_breakdown, '');
