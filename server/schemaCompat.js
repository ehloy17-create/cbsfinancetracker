import { v4 as uuidv4 } from 'uuid';
import pool from './db.js';

async function tableExists(tableName) {
  const [rows] = await pool.query(
    `SELECT 1
       FROM information_schema.tables
      WHERE table_schema = DATABASE()
        AND table_name = ?
      LIMIT 1`,
    [tableName]
  );
  return rows.length > 0;
}

async function columnExists(tableName, columnName) {
  const [rows] = await pool.query(
    `SELECT 1
       FROM information_schema.columns
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND column_name = ?
      LIMIT 1`,
    [tableName, columnName]
  );
  return rows.length > 0;
}

async function ensureTable(tableName, createSql) {
  if (await tableExists(tableName)) return;
  await pool.query(createSql);
}

async function ensureColumn(tableName, columnName, definition) {
  if (await columnExists(tableName, columnName)) return;

  try {
    await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${definition}`);
  } catch (error) {
    const fallbackDefinition = String(definition)
      .replace(/\s+AFTER\s+`?[^`]+`?\s*$/i, '')
      .replace(/\s+FIRST\s*$/i, '')
      .trim();

    if (
      fallbackDefinition
      && fallbackDefinition !== definition
      && (error?.code === 'ER_BAD_FIELD_ERROR' || error?.code === 'ER_CANT_DROP_FIELD_OR_KEY')
    ) {
      await pool.query(`ALTER TABLE \`${tableName}\` ADD COLUMN \`${columnName}\` ${fallbackDefinition}`);
      return;
    }

    throw error;
  }
}

async function ensureSalePaymentMethodConstraint() {
  if (!(await tableExists('sale_payments'))) return;

  try {
    const [rows] = await pool.query(
      `SELECT CONSTRAINT_NAME
         FROM information_schema.TABLE_CONSTRAINTS
        WHERE TABLE_SCHEMA = DATABASE()
          AND TABLE_NAME = 'sale_payments'
          AND CONSTRAINT_TYPE = 'CHECK'`
    );

    for (const row of rows) {
      const constraintName = String(row.CONSTRAINT_NAME ?? '').trim();
      if (!constraintName) continue;
      try {
        await pool.query(`ALTER TABLE sale_payments DROP CONSTRAINT \`${constraintName}\``);
      } catch {
        try {
          await pool.query(`ALTER TABLE sale_payments DROP CHECK \`${constraintName}\``);
        } catch {
          // ignore incompatible syntax across MySQL/MariaDB variants
        }
      }
    }

    await pool.query('ALTER TABLE sale_payments MODIFY COLUMN payment_method VARCHAR(20) NOT NULL');

    try {
      await pool.query(`
        ALTER TABLE sale_payments
        ADD CONSTRAINT chk_sale_payments_method
        CHECK (payment_method IN ('cash', 'gcash', 'charge'))
      `);
    } catch {
      // already exists or not supported; ignore
    }
  } catch (error) {
    console.warn(`[schemaCompat] Could not refresh sale_payments method constraint: ${error.message}`);
  }
}

// Converts a table's character set/collation to utf8mb4_unicode_ci if it
// is not already correct.  This fixes "illegal mix of collations" errors that
// occur when tables are created with the server default (which on MariaDB 10.6+
// is utf8mb4_uca1400_ai_ci) and JOINed against tables that have explicit
// utf8mb4_unicode_ci collation.  Safe to run repeatedly.
async function ensureTableUtf8mb4(tableName) {
  if (!(await tableExists(tableName))) return;
  const [rows] = await pool.query(
    `SELECT T.TABLE_COLLATION
       FROM information_schema.TABLES T
      WHERE T.TABLE_SCHEMA = DATABASE()
        AND T.TABLE_NAME = ?
      LIMIT 1`,
    [tableName]
  );
  if (!rows.length || rows[0].TABLE_COLLATION === 'utf8mb4_unicode_ci') return;

  try {
    await pool.query(
      `ALTER TABLE \`${tableName}\` CONVERT TO CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
    );
  } catch (error) {
    if (
      error?.code === 'ER_FK_INCOMPATIBLE_COLUMNS'
      || error?.code === 'ER_FK_CANNOT_OPEN_PARENT'
      || error?.code === 'ER_CANNOT_ADD_FOREIGN'
      || error?.code === 'ER_LOCK_DEADLOCK'
      || error?.code === 'ER_LOCK_WAIT_TIMEOUT'
    ) {
      console.warn(`[schemaCompat] Skipped utf8mb4 conversion for ${tableName}: ${error.message}`);
      return;
    }

    throw error;
  }
}

async function generateCompatPayableNumber() {
  const now = new Date();
  const yyyy = now.getFullYear();
  const mm = String(now.getMonth() + 1).padStart(2, '0');
  const dd = String(now.getDate()).padStart(2, '0');
  const prefix = `PAY-${yyyy}${mm}${dd}-`;
  const [rows] = await pool.query(
    `SELECT MAX(CAST(SUBSTRING(\`payable_number\`, ?) AS UNSIGNED)) AS max_suffix
       FROM \`payables\`
      WHERE \`payable_number\` LIKE ?`,
    [prefix.length + 1, `${prefix}%`]
  );
  const nextNumber = Number(rows[0]?.max_suffix ?? 0) + 1;
  return `${prefix}${String(nextNumber).padStart(4, '0')}`;
}

function addDaysToDate(dateString, days) {
  const date = new Date(`${String(dateString).slice(0, 10)}T00:00:00`);
  if (Number.isNaN(date.getTime())) return String(dateString).slice(0, 10);
  date.setDate(date.getDate() + days);
  return date.toISOString().slice(0, 10);
}

function derivePayableDueDate(receivingDate, paymentTerms) {
  const baseDate = String(receivingDate ?? '').slice(0, 10);
  if (!baseDate) return null;
  const match = String(paymentTerms ?? '').match(/(\d{1,3})/);
  if (!match) return baseDate;
  return addDaysToDate(baseDate, Number(match[1]));
}

async function ensurePostedReceivingPayables() {
  if (!(await tableExists('receivings'))) return;
  if (!(await tableExists('receiving_items'))) return;
  if (!(await tableExists('payables'))) return;

  const [receivingRows] = await pool.query(`
    SELECT
      r.id,
      r.receiving_number,
      r.po_id,
      r.supplier_id,
      r.receiving_date,
      r.invoice_number,
      r.remarks,
      r.created_by,
      r.created_at,
      COALESCE(SUM(COALESCE(ri.qty_accepted, ri.qty_received) * COALESCE(ri.unit_cost, 0)), 0) AS payable_amount
    FROM receivings r
    JOIN receiving_items ri
      ON ri.receiving_id = r.id
    LEFT JOIN payables p
      ON p.receiving_id = r.id
    WHERE r.status = 'posted'
      AND p.id IS NULL
    GROUP BY
      r.id, r.receiving_number, r.po_id, r.supplier_id, r.receiving_date,
      r.invoice_number, r.remarks, r.created_by, r.created_at
    HAVING payable_amount > 0
  `);

  if (!receivingRows.length) return;

  const supplierIds = [...new Set(receivingRows.map((row) => String(row.supplier_id ?? '')).filter(Boolean))];
  const supplierTermsMap = new Map();

  if (supplierIds.length > 0 && await tableExists('inv_suppliers')) {
    const placeholders = supplierIds.map(() => '?').join(', ');
    const [supplierRows] = await pool.query(
      `SELECT id, payment_terms FROM inv_suppliers WHERE id IN (${placeholders})`,
      supplierIds
    );
    for (const supplier of supplierRows) {
      supplierTermsMap.set(String(supplier.id), String(supplier.payment_terms ?? ''));
    }
  }

  for (const row of receivingRows) {
    const dueDate = derivePayableDueDate(row.receiving_date, supplierTermsMap.get(String(row.supplier_id)));
    await pool.query(
      `INSERT INTO payables
         (id, payable_number, supplier_id, receiving_id, invoice_number, amount, balance, due_date, status, notes, created_by, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?)` ,
      [
        uuidv4(),
        await generateCompatPayableNumber(),
        row.supplier_id,
        row.id,
        row.invoice_number ?? '',
        Number(row.payable_amount ?? 0),
        Number(row.payable_amount ?? 0),
        dueDate,
        row.remarks ?? '',
        row.created_by ?? null,
        row.created_at ?? new Date(),
        row.created_at ?? new Date(),
      ]
    );
  }
}

async function ensurePurchaseOrderPrecision() {
  if (await tableExists('purchase_orders')) {
    await pool.query(`
      ALTER TABLE \`purchase_orders\`
      MODIFY COLUMN \`total_amount\` DECIMAL(12,6) NOT NULL DEFAULT 0
    `);
  }

  if (await tableExists('purchase_order_items')) {
    await pool.query(`
      ALTER TABLE \`purchase_order_items\`
      MODIFY COLUMN \`unit_cost\` DECIMAL(12,6) NOT NULL DEFAULT 0,
      MODIFY COLUMN \`subtotal\` DECIMAL(12,6) NOT NULL DEFAULT 0
    `);
  }
}

async function listCheckConstraints(tableName) {
  const [rows] = await pool.query(
    `SELECT constraint_name AS name
       FROM information_schema.table_constraints
      WHERE table_schema = DATABASE()
        AND table_name = ?
        AND constraint_type = 'CHECK'`,
    [tableName]
  );
  return rows.map(row => row.name).filter(Boolean);
}

async function dropCheckConstraint(tableName, constraintName) {
  const statements = [
    `ALTER TABLE \`${tableName}\` DROP CONSTRAINT \`${constraintName}\``,
    `ALTER TABLE \`${tableName}\` DROP CHECK \`${constraintName}\``,
  ];

  for (const statement of statements) {
    try {
      await pool.query(statement);
      return;
    } catch (error) {
      if (error?.code === 'ER_CHECK_CONSTRAINT_NOT_FOUND') {
        return;
      }

      if (
        error?.code === 'ER_CONSTRAINT_NOT_FOUND'
        || error?.code === 'ER_CANT_DROP_FIELD_OR_KEY'
        || error?.code === 'ER_PARSE_ERROR'
      ) {
        continue;
      }

      throw error;
    }
  }
}

async function ensureChecksIssuedStatusConstraint() {
  if (!(await tableExists('checks_issued'))) return;

  const existingConstraints = await listCheckConstraints('checks_issued');
  for (const constraintName of existingConstraints) {
    if (!constraintName) continue;
    await dropCheckConstraint('checks_issued', constraintName);
  }

  await pool.query(`
    ALTER TABLE \`checks_issued\`
    MODIFY COLUMN \`status\` VARCHAR(30) NOT NULL DEFAULT 'draft'
  `);

  try {
    await pool.query(`
      ALTER TABLE \`checks_issued\`
      ADD CONSTRAINT \`checks_issued_status_chk\`
      CHECK (\`status\` IN ('draft', 'pending', 'pdc', 'outstanding', 'cleared', 'cancelled', 'bounced', 'stale'))
    `);
  } catch (error) {
    if (error?.code !== 'ER_DUP_KEYNAME') throw error;
  }
}

async function ensureSupplierBridge() {
  await ensureTable(
    'inv_suppliers',
    `CREATE TABLE IF NOT EXISTS inv_suppliers (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      code VARCHAR(50) NOT NULL,
      name VARCHAR(255) NOT NULL,
      contact_person VARCHAR(255) NOT NULL DEFAULT '',
      phone VARCHAR(50) NOT NULL DEFAULT '',
      email VARCHAR(255) NOT NULL DEFAULT '',
      address TEXT NOT NULL,
      city VARCHAR(255) NOT NULL DEFAULT '',
      payment_terms VARCHAR(100) NOT NULL DEFAULT '',
      notes TEXT NOT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_inv_suppliers_code (code)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('inv_suppliers', 'city', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `address`");
  await ensureColumn('inv_suppliers', 'notes', 'TEXT NOT NULL AFTER `payment_terms`');

  // Ensure the legacy `suppliers` table always exists so that `search_products`
  // LEFT JOIN never throws "Table doesn't exist" on upgraded installations.
  await ensureTable(
    'suppliers',
    `CREATE TABLE IF NOT EXISTS suppliers (
      id         CHAR(36)     NOT NULL DEFAULT (UUID()),
      name       VARCHAR(255) NOT NULL,
      contact    VARCHAR(255) NOT NULL DEFAULT '',
      address    TEXT         NOT NULL,
      is_active  TINYINT(1)   NOT NULL DEFAULT 1,
      created_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME     NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB`
  );

  if (!(await tableExists('suppliers'))) return;

  await ensureColumn('suppliers', 'code', "VARCHAR(50) NOT NULL DEFAULT '' AFTER `id`");
  await ensureColumn('suppliers', 'contact_person', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `name`");
  await ensureColumn('suppliers', 'phone', "VARCHAR(50) NOT NULL DEFAULT '' AFTER `contact_person`");
  await ensureColumn('suppliers', 'email', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `phone`");
  await ensureColumn('suppliers', 'notes', 'TEXT NOT NULL AFTER `address`');
  await ensureColumn('suppliers', 'city', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `address`");
  await ensureColumn('suppliers', 'terms', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `notes`");
  await ensureColumn('suppliers', 'created_by', 'CHAR(36) NULL AFTER `is_active`');

  await pool.query(`
    INSERT INTO \`inv_suppliers\`
      (\`id\`, \`code\`, \`name\`, \`contact_person\`, \`phone\`, \`email\`, \`address\`, \`city\`, \`payment_terms\`, \`notes\`, \`is_active\`, \`created_by\`, \`created_at\`, \`updated_at\`)
    SELECT
      s.\`id\`,
      CASE
        WHEN NULLIF(TRIM(s.\`code\`), '') IS NOT NULL THEN UPPER(TRIM(s.\`code\`))
        ELSE CONCAT('SUP-', UPPER(LEFT(REPLACE(s.\`id\`, '-', ''), 8)))
      END,
      TRIM(COALESCE(s.\`name\`, '')),
      TRIM(COALESCE(NULLIF(s.\`contact_person\`, ''), s.\`contact\`, '')),
      TRIM(COALESCE(s.\`phone\`, '')),
      '',
      COALESCE(s.\`address\`, ''),
      '',
      COALESCE(s.\`terms\`, ''),
      COALESCE(s.\`notes\`, ''),
      COALESCE(s.\`is_active\`, 1),
      s.\`created_by\`,
      COALESCE(s.\`created_at\`, CURRENT_TIMESTAMP),
      COALESCE(s.\`updated_at\`, CURRENT_TIMESTAMP)
    FROM \`suppliers\` s
    ON DUPLICATE KEY UPDATE
      \`name\` = VALUES(\`name\`),
      \`contact_person\` = VALUES(\`contact_person\`),
      \`phone\` = VALUES(\`phone\`),
      \`address\` = VALUES(\`address\`),
      \`payment_terms\` = VALUES(\`payment_terms\`),
      \`notes\` = VALUES(\`notes\`),
      \`is_active\` = VALUES(\`is_active\`),
      \`updated_at\` = VALUES(\`updated_at\`)
  `);
}

async function ensureBankTransactionsTypeConstraint() {
  if (!(await tableExists('bank_transactions'))) return;

  const existingConstraints = await listCheckConstraints('bank_transactions');
  for (const constraintName of existingConstraints) {
    if (!constraintName) continue;
    await dropCheckConstraint('bank_transactions', constraintName);
  }

  await pool.query(`
    ALTER TABLE \`bank_transactions\`
    MODIFY COLUMN \`transaction_type\` VARCHAR(30) NOT NULL
  `);

  try {
    await pool.query(`
      ALTER TABLE \`bank_transactions\`
      ADD CONSTRAINT \`bank_transactions_type_chk\`
      CHECK (\`transaction_type\` IN (
        'deposit',
        'withdrawal',
        'interest_income',
        'bank_fee',
        'check_payment',
        'disbursement',
        'adjustment',
        'transfer_in',
        'transfer_out',
        'owner_funding',
        'owner_withdrawal'
      ))
    `);
  } catch (error) {
    if (error?.code !== 'ER_DUP_KEYNAME' && error?.code !== 'ER_CHECK_CONSTRAINT_DUP_NAME') throw error;
  }
}

async function ensureProfilesRoleConstraint() {
  if (!(await tableExists('profiles'))) return;

  const existingConstraints = await listCheckConstraints('profiles');
  for (const constraintName of existingConstraints) {
    if (!constraintName) continue;
    await dropCheckConstraint('profiles', constraintName);
  }

  await pool.query(`
    ALTER TABLE \`profiles\`
    MODIFY COLUMN \`role\` VARCHAR(20) NOT NULL DEFAULT 'staff'
  `);

  try {
    await pool.query(`
      ALTER TABLE \`profiles\`
      ADD CONSTRAINT \`profiles_role_chk\`
      CHECK (\`role\` IN ('admin', 'accounting', 'staff', 'cashier'))
    `);
  } catch (error) {
    if (error?.code !== 'ER_DUP_KEYNAME' && error?.code !== 'ER_CHECK_CONSTRAINT_DUP_NAME') throw error;
  }
}

async function ensurePosMultiPricingSchema() {
  await ensureProfilesRoleConstraint();
  await ensurePurchaseOrderPrecision();

  // Ensure core tables use utf8mb4_unicode_ci so JOINs don't throw
  // "illegal mix of collations". Convert parent tables before children so
  // foreign-key-backed CHAR columns stay compatible during upgrades.
  for (const t of [
    'inv_categories', 'inv_brands', 'inv_units', 'inv_locations',
    'inv_suppliers', 'suppliers', 'profiles', 'inv_products',
    'inv_product_selling_units',
    'pos_customers', 'pos_terminals', 'pos_shifts', 'pos_recent_items',
    'inventory_balances', 'inventory_movements',
    'purchases', 'purchase_order_items', 'receiving_reports', 'receiving_items',
    'payables', 'payable_payments',
    'checks_issued', 'disbursements',
    'bank_accounts', 'bank_transactions',
    'transactions', 'cash_transactions',
    'accounts', 'daily_history', 'cash_daily_history',
    'audit_logs',
  ]) {
    await ensureTableUtf8mb4(t);
  }

  await ensureSupplierBridge();

  await ensureTable(
    'pos_zreading_resets',
    `CREATE TABLE IF NOT EXISTS pos_zreading_resets (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      shift_id CHAR(36) NOT NULL,
      terminal_id CHAR(36) NOT NULL,
      location_id CHAR(36) NOT NULL,
      business_date DATE NOT NULL,
      reset_by CHAR(36) NOT NULL,
      reason TEXT NOT NULL,
      reset_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pos_zreading_resets_shift (shift_id),
      KEY idx_pos_zreading_resets_date (business_date),
      KEY idx_pos_zreading_resets_reset_at (reset_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureTable(
    'pos_cash_pickups',
    `CREATE TABLE IF NOT EXISTS pos_cash_pickups (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      shift_id CHAR(36) NOT NULL,
      terminal_id CHAR(36) NOT NULL,
      location_id CHAR(36) NOT NULL,
      business_date DATE NOT NULL,
      pickup_kind VARCHAR(30) NOT NULL DEFAULT 'general',
      pickup_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      reason VARCHAR(255) NOT NULL DEFAULT '',
      category VARCHAR(80) NOT NULL DEFAULT '',
      related_reference VARCHAR(120) NOT NULL DEFAULT '',
      notes TEXT NOT NULL,
      created_by CHAR(36) NULL,
      is_deleted TINYINT(1) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pos_cash_pickups_shift (shift_id),
      KEY idx_pos_cash_pickups_terminal_date (terminal_id, business_date),
      KEY idx_pos_cash_pickups_pickup_at (pickup_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureTable(
    'pos_cash_pickup_links',
    `CREATE TABLE IF NOT EXISTS pos_cash_pickup_links (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      pickup_id CHAR(36) NOT NULL,
      source_transaction_id CHAR(36) NOT NULL,
      source_sale_id CHAR(36) NULL,
      linked_amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pos_cash_pickup_links_pickup (pickup_id),
      KEY idx_pos_cash_pickup_links_txn (source_transaction_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureTable(
    'pos_recent_items',
    `CREATE TABLE IF NOT EXISTS pos_recent_items (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      terminal_id CHAR(36) NOT NULL,
      location_id CHAR(36) NULL,
      product_id CHAR(36) NOT NULL,
      last_used_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      use_count INT NOT NULL DEFAULT 1,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_pos_recent_items_terminal_product (terminal_id, product_id),
      KEY idx_pos_recent_items_terminal_last_used (terminal_id, last_used_at),
      KEY idx_pos_recent_items_product (product_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureTable(
    'inv_product_unit_conversions',
    `CREATE TABLE IF NOT EXISTS inv_product_unit_conversions (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      product_id CHAR(36) NOT NULL,
      unit_id CHAR(36) NOT NULL,
      equivalent_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 1,
      allow_purchase TINYINT(1) NOT NULL DEFAULT 0,
      allow_sale TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_product_unit_conversion (product_id, unit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'inv_product_selling_units',
    `CREATE TABLE IF NOT EXISTS inv_product_selling_units (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      product_id CHAR(36) NOT NULL,
      unit_id CHAR(36) NOT NULL,
      qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 1,
      selling_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      retail_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      wholesale_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      special_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      wholesale_enabled TINYINT(1) NOT NULL DEFAULT 0,
      wholesale_break_qty_in_base_unit DECIMAL(18,6) NOT NULL DEFAULT 0,
      wholesale_block_price DECIMAL(12,2) NOT NULL DEFAULT 0,
      is_default TINYINT(1) NOT NULL DEFAULT 0,
      sort_order INT NOT NULL DEFAULT 0,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      UNIQUE KEY uq_product_selling_unit (product_id, unit_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'inv_product_pricing_history',
    `CREATE TABLE IF NOT EXISTS inv_product_pricing_history (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      product_id CHAR(36) NOT NULL,
      old_cost DECIMAL(12,2) NULL,
      new_cost DECIMAL(12,2) NULL,
      old_retail_price DECIMAL(12,2) NULL,
      new_retail_price DECIMAL(12,2) NULL,
      old_wholesale_price DECIMAL(12,2) NULL,
      new_wholesale_price DECIMAL(12,2) NULL,
      old_special_price DECIMAL(12,2) NULL,
      new_special_price DECIMAL(12,2) NULL,
      changed_by CHAR(36) NULL,
      changed_by_name VARCHAR(255) NOT NULL DEFAULT '',
      changed_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_inv_product_pricing_history_product (product_id),
      KEY idx_inv_product_pricing_history_changed_at (changed_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('inv_units', 'short_name', "VARCHAR(20) NOT NULL DEFAULT '' AFTER `abbreviation`");
  await ensureColumn('inv_units', 'description', 'TEXT NULL AFTER `short_name`');

  await ensureColumn('inv_products', 'retail_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `cost_price`');
  await ensureColumn('inv_products', 'wholesale_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `retail_price`');
  await ensureColumn('inv_products', 'special_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `wholesale_price`');
  await ensureColumn('inv_products', 'base_unit_id', 'CHAR(36) NULL AFTER `unit_id`');
  await ensureColumn('inv_products', 'default_purchase_unit_id', 'CHAR(36) NULL AFTER `base_unit_id`');
  await ensureColumn('inv_products', 'default_selling_unit_id', 'CHAR(36) NULL AFTER `default_purchase_unit_id`');
  await ensureColumn('inv_products', 'default_cost', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `cost_price`');

  await ensureColumn('purchase_order_items', 'purchase_unit_id', 'CHAR(36) NULL AFTER `product_id`');
  await ensureColumn('purchase_order_items', 'purchase_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `purchase_unit_id`");
  await ensureColumn('purchase_order_items', 'qty_in_base_unit_per_purchase', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `purchase_unit_name`');
  await ensureColumn('purchase_order_items', 'qty_ordered_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_ordered`');
  await ensureColumn('purchase_order_items', 'qty_received_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_received`');
  await ensureColumn('purchase_order_items', 'cost_per_base_unit', 'DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER `unit_cost`');
  await ensureColumn('purchase_order_items', 'sort_order', 'INT NOT NULL DEFAULT 0 AFTER `notes`');
  await ensureColumn('purchase_order_items', 'created_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `sort_order`');
  await ensureColumn('purchase_order_items', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');

  await ensureColumn('receiving_items', 'qty_ordered', 'DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `product_id`');
  await ensureColumn('receiving_items', 'qty_prev_received', 'DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `qty_ordered`');
  await ensureColumn('receiving_items', 'qty_remaining', 'DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `qty_prev_received`');
  await ensureColumn('receiving_items', 'qty_accepted', 'DECIMAL(12,3) NOT NULL DEFAULT 0 AFTER `qty_received`');
  await ensureColumn('receiving_items', 'purchase_unit_id', 'CHAR(36) NULL AFTER `qty_rejected`');
  await ensureColumn('receiving_items', 'purchase_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `purchase_unit_id`");
  await ensureColumn('receiving_items', 'qty_in_base_unit_per_purchase', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `purchase_unit_name`');
  await ensureColumn('receiving_items', 'qty_received_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_in_base_unit_per_purchase`');
  await ensureColumn('receiving_items', 'qty_accepted_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_received_in_base_unit`');
  await ensureColumn('receiving_items', 'qty_rejected_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_accepted_in_base_unit`');
  await ensureColumn('receiving_items', 'unit_cost_per_base', 'DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER `unit_cost`');

  await ensureColumn('pos_customers', 'price_level', "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `email`");
  await ensureColumn('pos_customers', 'address', 'TEXT NULL AFTER `email`');
  await ensureColumn('pos_customers', 'messenger_psid', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `price_level`");
  await ensureColumn('pos_customers', 'credit_balance', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `loyalty_points`');

  await ensureColumn('inventory_balances', 'qty_available', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_on_hand`');
  await ensureColumn('inventory_balances', 'last_movement_at', 'DATETIME NULL AFTER `qty_available`');
  await ensureColumn('inventory_movements', 'qty_before', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_change`');
  await ensureColumn('inventory_movements', 'qty_after', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_before`');
  await ensureColumn('inventory_movements', 'unit_cost', 'DECIMAL(12,6) NULL AFTER `qty_after`');
  await ensureColumn('inventory_movements', 'ref_id', 'CHAR(36) NULL AFTER `ref_number`');
  await ensureColumn('inventory_movements', 'related_location_id', 'CHAR(36) NULL AFTER `ref_id`');
  await ensureColumn('inventory_movements', 'display_unit_id', 'CHAR(36) NULL AFTER `related_location_id`');
  await ensureColumn('inventory_movements', 'display_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `display_unit_id`");
  await ensureColumn('inventory_movements', 'display_qty', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `display_unit_name`');
  await ensureColumn('inventory_movements', 'qty_in_base_unit_per_display', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `display_qty`');
  await ensureColumn('inventory_movements', 'base_unit_id', 'CHAR(36) NULL AFTER `qty_in_base_unit_per_display`');
  await ensureColumn('inventory_movements', 'base_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `base_unit_id`");
  await ensureColumn('pos_customers', 'messenger_linked', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `messenger_psid`');
  await ensureColumn('pos_customers', 'last_messenger_interaction_at', 'DATETIME NULL AFTER `messenger_linked`');

  await ensureTable(
    'pos_message_logs',
    `CREATE TABLE IF NOT EXISTS pos_message_logs (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      held_sale_id CHAR(36) NOT NULL,
      customer_id CHAR(36) NOT NULL,
      channel VARCHAR(30) NOT NULL DEFAULT 'messenger',
      messenger_psid_used VARCHAR(255) NOT NULL DEFAULT '',
      sent_at DATETIME NULL,
      sent_by CHAR(36) NULL,
      status VARCHAR(20) NOT NULL DEFAULT 'pending',
      error_message TEXT NULL,
      meta_message_id VARCHAR(255) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_pos_message_logs_hold (held_sale_id),
      KEY idx_pos_message_logs_customer (customer_id),
      KEY idx_pos_message_logs_channel (channel),
      KEY idx_pos_message_logs_sent_at (sent_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureTable(
    'customer_credit_ledger',
    `CREATE TABLE IF NOT EXISTS customer_credit_ledger (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      customer_id CHAR(36) NOT NULL,
      entry_type VARCHAR(20) NOT NULL DEFAULT 'charge',
      amount DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance_before DECIMAL(12,2) NOT NULL DEFAULT 0,
      balance_after DECIMAL(12,2) NOT NULL DEFAULT 0,
      payment_method VARCHAR(20) NOT NULL DEFAULT 'cash',
      payment_number VARCHAR(50) NOT NULL DEFAULT '',
      reference_number VARCHAR(100) NOT NULL DEFAULT '',
      target_account_type VARCHAR(30) NOT NULL DEFAULT '',
      target_account_id CHAR(36) NULL,
      target_account_name VARCHAR(255) NOT NULL DEFAULT '',
      accounting_entry_id CHAR(36) NULL,
      sale_id CHAR(36) NULL,
      notes TEXT NULL,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id),
      KEY idx_customer_credit_ledger_customer (customer_id),
      KEY idx_customer_credit_ledger_sale (sale_id),
      KEY idx_customer_credit_ledger_created_at (created_at)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('sales', 'customer_id', 'CHAR(36) NULL AFTER `change_amount`');
  await ensureColumn('sales', 'loyalty_points_earned', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `customer_id`');
  await ensureColumn('sales', 'loyalty_points_redeemed', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `loyalty_points_earned`');
  await ensureColumn('pos_shifts', 'business_date', 'DATE NULL AFTER `shift_date`');
  await ensureColumn('pos_shifts', 'notes', 'TEXT NULL AFTER `opening_cash`');
  await ensureColumn('pos_shifts', 'closed_by', 'CHAR(36) NULL AFTER `closed_at`');
  await ensureColumn('pos_shifts', 'z_reading_posted_at', 'DATETIME NULL AFTER `closed_by`');
  await ensureColumn('pos_shifts', 'z_reading_posted_by', 'CHAR(36) NULL AFTER `z_reading_posted_at`');
  await ensureColumn('pos_shifts', 'z_reading_reset_at', 'DATETIME NULL AFTER `z_reading_posted_by`');
  await ensureColumn('pos_shifts', 'z_reading_reset_by', 'CHAR(36) NULL AFTER `z_reading_reset_at`');
  await ensureColumn('pos_shifts', 'z_reading_reset_reason', 'TEXT NULL AFTER `z_reading_reset_by`');

  await ensureColumn('sale_items', 'retail_unit_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `qty`');
  await ensureColumn('sale_items', 'selected_unit_id', 'CHAR(36) NULL AFTER `product_id`');
  await ensureColumn('sale_items', 'selected_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `selected_unit_id`");
  await ensureColumn('sale_items', 'qty_in_base_unit_per_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `qty`');
  await ensureColumn('sale_items', 'total_base_qty_deducted', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_in_base_unit_per_unit`');
  await ensureColumn('sale_items', 'base_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `total_base_qty_deducted`");
  await ensureColumn('sale_items', 'cost_per_base_unit', 'DECIMAL(12,6) NOT NULL DEFAULT 0 AFTER `cost_at_sale`');
  await ensureColumn('sale_items', 'selected_price_level', "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `unit_price`");
  await ensureColumn('sale_items', 'applied_price_level', "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `selected_price_level`");
  await ensureColumn('sale_items', 'price_source', "VARCHAR(30) NOT NULL DEFAULT 'Retail' AFTER `applied_price_level`");
  await ensureColumn('sale_items', 'wholesale_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `unit_price`');
  await ensureColumn('sale_items', 'wholesale_break_qty_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_enabled`');
  await ensureColumn('sale_items', 'wholesale_block_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `wholesale_break_qty_in_base_unit`');
  await ensureColumn('sale_items', 'wholesale_blocks_applied', 'INT NOT NULL DEFAULT 0 AFTER `wholesale_block_price`');
  await ensureColumn('sale_items', 'wholesale_base_qty_applied', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_blocks_applied`');
  await ensureColumn('sale_items', 'retail_remainder_base_qty', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_base_qty_applied`');
  await ensureColumn('sale_items', 'pricing_breakdown', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `retail_remainder_base_qty`");

  await ensureColumn('customer_credit_ledger', 'payment_number', "VARCHAR(50) NOT NULL DEFAULT '' AFTER `payment_method`");
  await ensureColumn('customer_credit_ledger', 'target_account_type', "VARCHAR(30) NOT NULL DEFAULT '' AFTER `reference_number`");
  await ensureColumn('customer_credit_ledger', 'target_account_id', 'CHAR(36) NULL AFTER `target_account_type`');
  await ensureColumn('customer_credit_ledger', 'target_account_name', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `target_account_id`");
  await ensureColumn('customer_credit_ledger', 'accounting_entry_id', 'CHAR(36) NULL AFTER `target_account_name`');

  await ensureSalePaymentMethodConstraint();

  await ensureColumn('held_sales', 'customer_id', 'CHAR(36) NULL AFTER `hold_reference`');
  await ensureColumn(
    'held_sales',
    'customer_price_level_snapshot',
    "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `customer_name_snapshot`"
  );

  await ensureColumn('held_sale_items', 'retail_unit_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `qty`');
  await ensureColumn('held_sale_items', 'selected_unit_id', 'CHAR(36) NULL AFTER `product_id`');
  await ensureColumn('held_sale_items', 'selected_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `selected_unit_id`");
  await ensureColumn('held_sale_items', 'qty_in_base_unit_per_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `qty`');
  await ensureColumn('held_sale_items', 'total_base_qty_deducted', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_in_base_unit_per_unit`');
  await ensureColumn('held_sale_items', 'base_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `total_base_qty_deducted`");
  await ensureColumn('held_sale_items', 'selected_price_level', "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `unit_price`");
  await ensureColumn('held_sale_items', 'applied_price_level', "VARCHAR(20) NOT NULL DEFAULT 'Retail' AFTER `selected_price_level`");
  await ensureColumn('held_sale_items', 'price_source', "VARCHAR(30) NOT NULL DEFAULT 'Retail' AFTER `applied_price_level`");
  await ensureColumn('held_sale_items', 'wholesale_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `unit_price`');
  await ensureColumn('held_sale_items', 'wholesale_break_qty_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_enabled`');
  await ensureColumn('held_sale_items', 'wholesale_block_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `wholesale_break_qty_in_base_unit`');
  await ensureColumn('held_sale_items', 'wholesale_blocks_applied', 'INT NOT NULL DEFAULT 0 AFTER `wholesale_block_price`');
  await ensureColumn('held_sale_items', 'wholesale_base_qty_applied', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_blocks_applied`');
  await ensureColumn('held_sale_items', 'retail_remainder_base_qty', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_base_qty_applied`');
  await ensureColumn('held_sale_items', 'pricing_breakdown', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `retail_remainder_base_qty`");
  await ensureColumn('inv_product_selling_units', 'wholesale_enabled', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `special_price`');
  await ensureColumn('inv_product_selling_units', 'wholesale_break_qty_in_base_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `wholesale_enabled`');
  await ensureColumn('inv_product_selling_units', 'wholesale_block_price', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `wholesale_break_qty_in_base_unit`');
  await ensureColumn('sale_return_items', 'selected_unit_id', 'CHAR(36) NULL AFTER `product_id`');
  await ensureColumn('sale_return_items', 'selected_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `selected_unit_id`");
  await ensureColumn('sale_return_items', 'qty_in_base_unit_per_unit', 'DECIMAL(18,6) NOT NULL DEFAULT 1 AFTER `qty_returned`');
  await ensureColumn('sale_return_items', 'total_base_qty_restored', 'DECIMAL(18,6) NOT NULL DEFAULT 0 AFTER `qty_in_base_unit_per_unit`');
  await ensureColumn('sale_return_items', 'base_unit_name', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `total_base_qty_restored`");

  await pool.query(`
    UPDATE inv_products
       SET retail_price = CASE
             WHEN retail_price = 0 AND selling_price <> 0 THEN selling_price
             ELSE retail_price
           END,
           selling_price = CASE
             WHEN retail_price <> 0 THEN retail_price
             ELSE selling_price
           END
  `);

  await pool.query(`
    UPDATE pos_customers
       SET price_level = 'Retail'
     WHERE price_level IS NULL
        OR price_level = ''
  `);

  await pool.query(`
    UPDATE inv_products
       SET base_unit_id = COALESCE(base_unit_id, unit_id),
           default_purchase_unit_id = COALESCE(default_purchase_unit_id, unit_id),
           default_cost = CASE
             WHEN default_cost = 0 THEN COALESCE(cost_price, 0)
             ELSE default_cost
           END
     WHERE base_unit_id IS NULL
        OR default_purchase_unit_id IS NULL
        OR default_cost = 0
  `);

  await pool.query(`
    INSERT IGNORE INTO inv_product_unit_conversions (
      id, product_id, unit_id, equivalent_qty_in_base_unit, allow_purchase, allow_sale, sort_order
    )
    SELECT UUID(), p.id, COALESCE(p.base_unit_id, p.unit_id), 1, 1, 1, 0
      FROM inv_products p
     WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL
  `);

  await pool.query(`
    INSERT IGNORE INTO inv_product_selling_units (
      id, product_id, unit_id, qty_in_base_unit, selling_price, retail_price, wholesale_price, special_price, is_default, sort_order
    )
    SELECT UUID(), p.id, COALESCE(p.base_unit_id, p.unit_id), 1,
           COALESCE(NULLIF(p.retail_price, 0), p.selling_price, 0),
           COALESCE(NULLIF(p.retail_price, 0), p.selling_price, 0),
           COALESCE(p.wholesale_price, 0),
           COALESCE(p.special_price, 0),
           1,
           0
      FROM inv_products p
     WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL
  `);

  await pool.query(`
    UPDATE inv_products p
    LEFT JOIN inv_product_selling_units su
      ON CONVERT(su.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci
     AND su.is_default = 1
       SET p.default_selling_unit_id = COALESCE(p.default_selling_unit_id, su.id),
           p.unit_id = COALESCE(p.base_unit_id, p.unit_id)
     WHERE COALESCE(p.base_unit_id, p.unit_id) IS NOT NULL
  `);

  await pool.query(`
    UPDATE sale_items
       SET retail_unit_price = CASE
             WHEN retail_unit_price = 0 AND unit_price <> 0 THEN unit_price
             ELSE retail_unit_price
           END,
           selected_price_level = CASE
             WHEN selected_price_level IS NULL OR selected_price_level = '' THEN 'Retail'
             ELSE selected_price_level
           END,
           applied_price_level = CASE
             WHEN applied_price_level IS NULL OR applied_price_level = '' THEN 'Retail'
             ELSE applied_price_level
           END,
           price_source = CASE
              WHEN price_source IS NULL OR price_source = '' THEN 'Retail'
              ELSE price_source
            END,
           qty_in_base_unit_per_unit = CASE
             WHEN qty_in_base_unit_per_unit > 0 THEN qty_in_base_unit_per_unit
             ELSE 1
           END,
            total_base_qty_deducted = CASE
              WHEN total_base_qty_deducted > 0 THEN total_base_qty_deducted
              ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
            END,
            wholesale_enabled = CASE WHEN wholesale_enabled IS NULL THEN 0 ELSE wholesale_enabled END,
            wholesale_break_qty_in_base_unit = CASE WHEN wholesale_break_qty_in_base_unit > 0 THEN wholesale_break_qty_in_base_unit ELSE 0 END,
            wholesale_block_price = CASE WHEN wholesale_block_price > 0 THEN wholesale_block_price ELSE 0 END,
            wholesale_blocks_applied = CASE WHEN wholesale_blocks_applied > 0 THEN wholesale_blocks_applied ELSE 0 END,
            wholesale_base_qty_applied = CASE WHEN wholesale_base_qty_applied > 0 THEN wholesale_base_qty_applied ELSE 0 END,
            retail_remainder_base_qty = CASE
              WHEN retail_remainder_base_qty > 0 THEN retail_remainder_base_qty
              ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
            END,
            pricing_breakdown = CASE
              WHEN pricing_breakdown IS NULL THEN ''
              ELSE pricing_breakdown
            END
  `);

  await pool.query(`
    UPDATE held_sales
       SET customer_price_level_snapshot = CASE
             WHEN customer_price_level_snapshot IS NULL OR customer_price_level_snapshot = '' THEN 'Retail'
             ELSE customer_price_level_snapshot
           END
  `);

  await pool.query(`
    UPDATE held_sale_items
       SET retail_unit_price = CASE
             WHEN retail_unit_price = 0 AND unit_price <> 0 THEN unit_price
             ELSE retail_unit_price
           END,
           selected_price_level = CASE
             WHEN selected_price_level IS NULL OR selected_price_level = '' THEN 'Retail'
             ELSE selected_price_level
           END,
           applied_price_level = CASE
             WHEN applied_price_level IS NULL OR applied_price_level = '' THEN 'Retail'
             ELSE applied_price_level
           END,
           price_source = CASE
              WHEN price_source IS NULL OR price_source = '' THEN 'Retail'
              ELSE price_source
            END,
           qty_in_base_unit_per_unit = CASE
             WHEN qty_in_base_unit_per_unit > 0 THEN qty_in_base_unit_per_unit
             ELSE 1
           END,
            total_base_qty_deducted = CASE
              WHEN total_base_qty_deducted > 0 THEN total_base_qty_deducted
              ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
            END,
            wholesale_enabled = CASE WHEN wholesale_enabled IS NULL THEN 0 ELSE wholesale_enabled END,
            wholesale_break_qty_in_base_unit = CASE WHEN wholesale_break_qty_in_base_unit > 0 THEN wholesale_break_qty_in_base_unit ELSE 0 END,
            wholesale_block_price = CASE WHEN wholesale_block_price > 0 THEN wholesale_block_price ELSE 0 END,
            wholesale_blocks_applied = CASE WHEN wholesale_blocks_applied > 0 THEN wholesale_blocks_applied ELSE 0 END,
            wholesale_base_qty_applied = CASE WHEN wholesale_base_qty_applied > 0 THEN wholesale_base_qty_applied ELSE 0 END,
            retail_remainder_base_qty = CASE
              WHEN retail_remainder_base_qty > 0 THEN retail_remainder_base_qty
              ELSE qty * GREATEST(qty_in_base_unit_per_unit, 1)
            END,
            pricing_breakdown = CASE
              WHEN pricing_breakdown IS NULL THEN ''
              ELSE pricing_breakdown
            END
  `);

  await pool.query(`
    UPDATE purchase_order_items
        SET purchase_unit_id = COALESCE(purchase_unit_id, (
              SELECT default_purchase_unit_id
                FROM inv_products p
               WHERE CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(purchase_order_items.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
               LIMIT 1
            )),
            purchase_unit_name = CASE
              WHEN purchase_unit_name != '' THEN purchase_unit_name
              ELSE COALESCE((
                SELECT u.name
                  FROM inv_products p
                  LEFT JOIN inv_units u
                    ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(COALESCE(p.default_purchase_unit_id, p.unit_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 WHERE CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(purchase_order_items.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 LIMIT 1
              ), '')
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
           END
  `);

  await pool.query(`
    UPDATE receiving_items
       SET qty_accepted = CASE
             WHEN qty_accepted > 0 THEN qty_accepted
             ELSE GREATEST(qty_received - qty_rejected, 0)
            END,
            purchase_unit_id = COALESCE(purchase_unit_id, (
              SELECT default_purchase_unit_id
                FROM inv_products p
               WHERE CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(receiving_items.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
               LIMIT 1
            )),
            purchase_unit_name = CASE
              WHEN purchase_unit_name != '' THEN purchase_unit_name
              ELSE COALESCE((
                SELECT u.name
                  FROM inv_products p
                  LEFT JOIN inv_units u
                    ON CONVERT(u.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(COALESCE(p.default_purchase_unit_id, p.unit_id) USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 WHERE CONVERT(p.id USING utf8mb4) COLLATE utf8mb4_unicode_ci = CONVERT(receiving_items.product_id USING utf8mb4) COLLATE utf8mb4_unicode_ci
                 LIMIT 1
              ), '')
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
            END
  `);
}

async function ensureFinanceMonitoringSchema() {
  await ensureTable(
    'recurring_obligations',
    `CREATE TABLE IF NOT EXISTS recurring_obligations (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'bank_reconciliations',
    `CREATE TABLE IF NOT EXISTS bank_reconciliations (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'finance_owners',
    `CREATE TABLE IF NOT EXISTS finance_owners (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
      name VARCHAR(120) NOT NULL,
      remarks TEXT NULL,
      is_active TINYINT(1) NOT NULL DEFAULT 1,
      created_by CHAR(36) NULL,
      created_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'finance_owner_movements',
    `CREATE TABLE IF NOT EXISTS finance_owner_movements (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
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
      updated_at DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );
  await ensureTable(
    'owner_ledger',
    `CREATE TABLE IF NOT EXISTS owner_ledger (
      id CHAR(36) NOT NULL DEFAULT (UUID()),
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
      PRIMARY KEY (id),
      UNIQUE KEY uq_owner_ledger_reference (owner_id, transaction_type, reference_type, reference_id)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('bank_accounts', 'beginning_balance', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `account_number`');

  await ensureColumn('bank_transactions', 'direction', "VARCHAR(10) NOT NULL DEFAULT 'debit' AFTER `amount`");
  await ensureColumn('bank_transactions', 'notes', 'TEXT NULL AFTER `description`');
  await ensureColumn('bank_transactions', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');
  await ensureColumn('bank_transactions', 'payable_id', 'CHAR(36) NULL AFTER `check_id`');
  await ensureColumn('bank_transactions', 'balance_after', 'DECIMAL(12,2) NULL AFTER `payable_id`');
  await ensureColumn('bank_transactions', 'module_source', "VARCHAR(50) NULL AFTER `balance_after`");
  await ensureColumn('bank_transactions', 'attachment_reference', "VARCHAR(255) NULL AFTER `module_source`");
  await ensureBankTransactionsTypeConstraint();

  await ensureColumn('bank_deposits', 'notes', 'TEXT NULL AFTER `source_description`');
  await ensureColumn('bank_deposits', 'source_type', "VARCHAR(50) NOT NULL DEFAULT '' AFTER `reference_number`");
  await ensureColumn('bank_deposits', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `created_at`');
  await ensureColumn('bank_deposits', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');
  await ensureColumn('bank_deposits', 'cashier_remittance_id', 'CHAR(36) NULL AFTER `source_transaction_id`');
  await ensureColumn('bank_deposits', 'source_module', "VARCHAR(50) NULL AFTER `cashier_remittance_id`");
  await ensureColumn('bank_deposits', 'attachment_reference', "VARCHAR(255) NULL AFTER `source_module`");
  await ensureColumn('bank_deposits', 'status', "VARCHAR(20) NOT NULL DEFAULT 'verified' AFTER `notes`");
  await ensureColumn('bank_deposits', 'deposited_at', 'DATETIME NULL AFTER `status`');
  await ensureColumn('bank_deposits', 'verified_at', 'DATETIME NULL AFTER `deposited_at`');
  await ensureColumn('bank_deposits', 'verified_by', 'CHAR(36) NULL AFTER `verified_at`');
  await ensureColumn('bank_deposits', 'cancelled_at', 'DATETIME NULL AFTER `verified_by`');

  await ensureColumn('checks_issued', 'payable_id', 'CHAR(36) NULL AFTER `supplier_id`');
  await ensureColumn('checks_issued', 'date', 'DATE NULL AFTER `issued_date`');
  await ensureColumn('checks_issued', 'attachment_reference', "VARCHAR(255) NULL AFTER `notes`");
  await ensureColumn('checks_issued', 'approval_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `manually_set_status`');
  await ensureColumn('checks_issued', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER `approval_required`");
  await ensureColumn('checks_issued', 'approved_by', 'CHAR(36) NULL AFTER `approval_status`');
  await ensureColumn('checks_issued', 'approved_at', 'DATETIME NULL AFTER `approved_by`');
  await ensureColumn('checks_issued', 'rejected_reason', 'TEXT NULL AFTER `approved_at`');
  await ensureChecksIssuedStatusConstraint();

  await ensureColumn('payable_payments', 'reference_number', "VARCHAR(100) NOT NULL DEFAULT '' AFTER `payment_method`");
  await ensureColumn('payable_payments', 'remarks', 'TEXT NULL AFTER `reference_number`');
  await ensureColumn('payable_payments', 'owner_id', 'CHAR(36) NULL AFTER `remarks`');
  await ensureColumn('payable_payments', 'bank_account_id', 'CHAR(36) NULL AFTER `remarks`');
  await ensureColumn('payable_payments', 'check_id', 'CHAR(36) NULL AFTER `bank_account_id`');
  await ensureColumn('payable_payments', 'bank_transaction_id', 'CHAR(36) NULL AFTER `check_id`');
  await ensureColumn('payable_payments', 'owner_ledger_id', 'CHAR(36) NULL AFTER `bank_transaction_id`');
  await ensureColumn('payable_payments', 'attachment_reference', "VARCHAR(255) NULL AFTER `bank_transaction_id`");
  await ensureColumn('payable_payments', 'updated_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP AFTER `created_at`');
  await ensureColumn('payable_payments', 'approval_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `attachment_reference`');
  await ensureColumn('payable_payments', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER `approval_required`");
  await ensureColumn('payable_payments', 'approved_by', 'CHAR(36) NULL AFTER `approval_status`');
  await ensureColumn('payable_payments', 'approved_at', 'DATETIME NULL AFTER `approved_by`');

  await ensureColumn('disbursements', 'owner_id', 'CHAR(36) NULL AFTER `supplier_id`');
  await ensureColumn('disbursements', 'affects_cashflow', 'TINYINT(1) NOT NULL DEFAULT 1 AFTER `amount`');
  await ensureColumn('disbursements', 'owner_ledger_id', 'CHAR(36) NULL AFTER `check_id`');
  await ensureColumn('disbursements', 'source_module', 'VARCHAR(60) NULL AFTER `disbursement_type`');
  await ensureColumn('disbursements', 'source_reference_id', 'CHAR(36) NULL AFTER `source_module`');
  await ensureColumn('disbursements', 'source_account_type', 'VARCHAR(30) NULL AFTER `source_reference_id`');
  await ensureColumn('disbursements', 'source_account_id', 'CHAR(36) NULL AFTER `source_account_type`');
  await ensureColumn('pos_cash_pickups', 'pickup_kind', "VARCHAR(30) NOT NULL DEFAULT 'general' AFTER `business_date`");
  await ensureColumn('pos_cash_pickups', 'pickup_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `pickup_kind`');
  await ensureColumn('pos_cash_pickups', 'reason', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `amount`");
  await ensureColumn('pos_cash_pickups', 'category', "VARCHAR(80) NOT NULL DEFAULT '' AFTER `reason`");
  await ensureColumn('pos_cash_pickups', 'related_reference', "VARCHAR(120) NOT NULL DEFAULT '' AFTER `category`");
  await ensureColumn('pos_cash_pickups', 'notes', "TEXT NOT NULL AFTER `related_reference`");
  await ensureColumn('pos_cash_pickups', 'created_by', 'CHAR(36) NULL AFTER `notes`');
  await ensureColumn('pos_cash_pickups', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `created_by`');
  await ensureColumn('pos_cash_pickup_links', 'source_sale_id', 'CHAR(36) NULL AFTER `source_transaction_id`');
  await ensureColumn('pos_cash_pickup_links', 'linked_amount', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `source_sale_id`');
  await ensureColumn('finance_owner_movements', 'owner_id', 'CHAR(36) NULL AFTER `target_module`');
  await ensureColumn('finance_owner_movements', 'owner_ledger_id', 'CHAR(36) NULL AFTER `posted_cash_transaction_id`');
  await ensureColumn('owner_ledger', 'reference_number', "VARCHAR(120) NOT NULL DEFAULT '' AFTER `source_account_id`");
  await ensureColumn('owner_ledger', 'is_deleted', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `remarks`');

  await ensureColumn('cashier_remittances', 'source_bank_id', 'CHAR(36) NULL AFTER `source_account_id`');
  await ensureColumn('cashier_remittances', 'destination_account_id', 'CHAR(36) NULL AFTER `destination_bank_id`');
  await ensureColumn('cashier_remittances', 'reference_number', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `description`");
  await ensureColumn('cashier_remittances', 'attachment_reference', "VARCHAR(255) NULL AFTER `reference_number`");
  await ensureColumn('cashier_remittances', 'source_transaction_id', 'CHAR(36) NULL AFTER `attachment_reference`');
  await ensureColumn('cashier_remittances', 'destination_transaction_id', 'CHAR(36) NULL AFTER `source_transaction_id`');
  await ensureColumn('cashier_remittances', 'approval_required', 'TINYINT(1) NOT NULL DEFAULT 0 AFTER `destination_transaction_id`');
  await ensureColumn('cashier_remittances', 'approval_status', "VARCHAR(20) NOT NULL DEFAULT 'approved' AFTER `approval_required`");
  await ensureColumn('cashier_remittances', 'approved_by', 'CHAR(36) NULL AFTER `approval_status`');
  await ensureColumn('cashier_remittances', 'approved_at', 'DATETIME NULL AFTER `approved_by`');
  await ensureColumn('transactions', 'transaction_category', "VARCHAR(30) NOT NULL DEFAULT 'regular' AFTER `transaction_type`");
  await ensureColumn('transactions', 'source_module', 'VARCHAR(60) NULL AFTER `bank_account_id`');
  await ensureColumn('transactions', 'source_reference_id', 'CHAR(36) NULL AFTER `source_module`');
  await ensureColumn('transactions', 'source_sale_id', 'CHAR(36) NULL AFTER `bank_account_id`');
  await ensureColumn('transactions', 'reversal_of_transaction_id', 'CHAR(36) NULL AFTER `source_sale_id`');
  await ensureColumn('transactions', 'disbursement_id', 'CHAR(36) NULL AFTER `reversal_of_transaction_id`');
  await ensureColumn('transactions', 'cleared_at', 'DATETIME NULL AFTER `is_closed`');
  await ensureColumn('cash_transactions', 'transaction_category', "VARCHAR(30) NOT NULL DEFAULT 'regular' AFTER `transaction_type`");
  await ensureColumn('cash_transactions', 'source_module', 'VARCHAR(60) NULL AFTER `cash_out_type`');
  await ensureColumn('cash_transactions', 'source_reference_id', 'CHAR(36) NULL AFTER `source_module`');
  await ensureColumn('cash_transactions', 'disbursement_id', 'CHAR(36) NULL AFTER `source_reference_id`');
  await ensureColumn('cash_transactions', 'cleared_at', 'DATETIME NULL AFTER `is_closed`');
  await ensureColumn('daily_history', 'transaction_count', 'INT NOT NULL DEFAULT 0 AFTER `total_delivery_fee`');
  await ensureColumn('cash_daily_history', 'total_cash_in', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `beginning_balance`');
  await ensureColumn('cash_daily_history', 'total_cash_out', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `total_cash_in`');
  await ensureColumn('cash_daily_history', 'transaction_count', 'INT NOT NULL DEFAULT 0 AFTER `total_cash_out`');
  await ensureColumn('cash_daily_history', 'cash_fees_collected', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `transaction_count`');
  await ensureColumn('cash_daily_history', 'cash_given_out', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `cash_fees_collected`');
  await ensureColumn('cash_daily_history', 'cash_out_to_fund', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `cash_given_out`');
  await ensureColumn('cash_daily_history', 'bank_deposits', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `cash_out_to_fund`');
  await ensureColumn('cash_daily_history', 'cash_fund_disbursements', 'DECIMAL(12,2) NOT NULL DEFAULT 0 AFTER `bank_deposits`');
  await ensureColumn('cash_daily_history', 'posted_at', 'DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP AFTER `posted_by`');

  await ensureColumn('audit_logs', 'module', "VARCHAR(255) NOT NULL DEFAULT '' AFTER `action`");
  await ensureColumn('audit_logs', 'details', 'JSON NULL AFTER `changes`');

  try {
    await pool.query("ALTER TABLE `audit_logs` MODIFY COLUMN `module` VARCHAR(255) NOT NULL DEFAULT ''");
  } catch {
  }
  try {
    await pool.query("ALTER TABLE `audit_logs` MODIFY COLUMN `record_id` VARCHAR(255) NOT NULL DEFAULT ''");
  } catch {
  }

  await pool.query(`
    UPDATE bank_accounts
       SET beginning_balance = COALESCE(beginning_balance, current_balance, 0)
     WHERE beginning_balance IS NULL
  `);

  await pool.query(`
    UPDATE bank_transactions
       SET direction = CASE
             WHEN direction IN ('credit', 'debit') THEN direction
             WHEN LOWER(COALESCE(transaction_type, '')) IN ('deposit', 'interest_income', 'transfer_in') THEN 'credit'
             ELSE 'debit'
           END,
            notes = COALESCE(notes, ''),
            module_source = COALESCE(module_source, '')
      WHERE direction IS NULL
         OR direction = ''
         OR notes IS NULL
         OR module_source IS NULL
  `);

  await pool.query(`
    UPDATE bank_deposits
       SET status = CASE
             WHEN status IN ('pending', 'deposited', 'verified', 'cancelled') THEN status
             WHEN is_deleted = 1 THEN 'cancelled'
             ELSE 'verified'
           END,
           verified_at = CASE
             WHEN status = 'verified' AND verified_at IS NULL THEN created_at
             ELSE verified_at
           END
     WHERE status IS NULL
        OR status = ''
        OR verified_at IS NULL
  `);

  await pool.query(`
    UPDATE payable_payments
       SET reference_number = CASE
              WHEN reference_number != '' THEN reference_number
              ELSE COALESCE(reference_no, '')
            END,
            remarks = COALESCE(remarks, notes),
            approval_status = CASE
              WHEN approval_status IN ('pending', 'approved', 'rejected') THEN approval_status
             ELSE 'approved'
            END
  `);

  await ensurePostedReceivingPayables();

  const [[legacyOwnerCountRow]] = await pool.query(`
    SELECT COUNT(*) AS count
    FROM finance_owner_movements
    WHERE owner_id IS NULL
  `);
  if (Number(legacyOwnerCountRow?.count ?? 0) > 0) {
    const [[legacyOwnerRow]] = await pool.query(`
      SELECT id
      FROM finance_owners
      WHERE name = 'Legacy Owner'
      LIMIT 1
    `);
    let legacyOwnerId = legacyOwnerRow?.id ?? null;
    if (!legacyOwnerId) {
      const newLegacyOwnerId = uuidv4();
      await pool.query(
        `INSERT INTO finance_owners (id, name, remarks, is_active)
         VALUES (?, 'Legacy Owner', 'Auto-created to preserve historical owner movement records posted before per-owner tracking was introduced.', 1)`,
        [newLegacyOwnerId]
      );
      legacyOwnerId = newLegacyOwnerId;
    }
    await pool.query(
      `UPDATE finance_owner_movements
          SET owner_id = ?
        WHERE owner_id IS NULL`,
      [legacyOwnerId]
    );
  }

  await pool.query(`
    UPDATE checks_issued
       SET approval_status = CASE
             WHEN approval_status IN ('pending', 'approved', 'rejected') THEN approval_status
             ELSE 'approved'
           END
  `);

  await pool.query(`
    UPDATE cashier_remittances
       SET approval_status = CASE
             WHEN approval_status IN ('pending', 'approved', 'rejected') THEN approval_status
             ELSE 'approved'
           END
  `);
}

async function ensurePayrollTables() {
  await ensureTable('hr_departments', `
    CREATE TABLE \`hr_departments\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`name\` VARCHAR(100) NOT NULL,
      \`description\` TEXT,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('hr_positions', `
    CREATE TABLE \`hr_positions\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`name\` VARCHAR(100) NOT NULL,
      \`department_id\` VARCHAR(36),
      \`description\` TEXT,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('hr_employees', `
    CREATE TABLE \`hr_employees\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`employee_code\` VARCHAR(50) NOT NULL UNIQUE,
      \`first_name\` VARCHAR(100) NOT NULL,
      \`middle_name\` VARCHAR(100),
      \`last_name\` VARCHAR(100) NOT NULL,
      \`gender\` ENUM('Male','Female','Other') DEFAULT 'Male',
      \`birthdate\` DATE,
      \`civil_status\` ENUM('Single','Married','Widowed','Separated') DEFAULT 'Single',
      \`address\` TEXT,
      \`mobile\` VARCHAR(30),
      \`email\` VARCHAR(150),
      \`emergency_contact_name\` VARCHAR(150),
      \`emergency_contact_phone\` VARCHAR(30),
      \`date_hired\` DATE,
      \`employment_status\` ENUM('Regular','Probationary','Contractual','Part-time') DEFAULT 'Regular',
      \`department_id\` VARCHAR(36),
      \`position_id\` VARCHAR(36),
      \`branch\` VARCHAR(100),
      \`payroll_type\` ENUM('Monthly','Daily') DEFAULT 'Monthly',
      \`basic_monthly_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`daily_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`hourly_rate\` DECIMAL(12,4) DEFAULT 0.0000,
      \`rest_day\` ENUM('Sunday','Monday','Tuesday','Wednesday','Thursday','Friday','Saturday') DEFAULT 'Sunday',
      \`tax_type\` ENUM('Taxable','Non-taxable','Minimum Wage') DEFAULT 'Taxable',
      \`sss_number\` VARCHAR(30),
      \`philhealth_number\` VARCHAR(30),
      \`pagibig_number\` VARCHAR(30),
      \`tin\` VARCHAR(30),
      \`bank_account\` VARCHAR(100),
      \`payment_method\` ENUM('Cash','ATM/Bank','GCash','Check') DEFAULT 'Cash',
      \`overtime_eligible\` TINYINT(1) DEFAULT 1,
      \`holiday_pay_eligible\` TINYINT(1) DEFAULT 1,
      \`fixed_allowance\` DECIMAL(12,2) DEFAULT 0.00,
      \`notes\` TEXT,
      \`is_active\` TINYINT(1) NOT NULL DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('hr_rate_history', `
    CREATE TABLE \`hr_rate_history\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`employee_id\` VARCHAR(36) NOT NULL,
      \`effective_date\` DATE NOT NULL,
      \`old_monthly_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`new_monthly_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`old_daily_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`new_daily_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`reason\` TEXT,
      \`updated_by\` VARCHAR(150),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_cutoffs', `
    CREATE TABLE \`payroll_cutoffs\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`period_name\` VARCHAR(100) NOT NULL,
      \`date_from\` DATE NOT NULL,
      \`date_to\` DATE NOT NULL,
      \`payroll_month\` INT NOT NULL,
      \`payroll_year\` INT NOT NULL,
      \`cutoff_seq\` TINYINT NOT NULL COMMENT '1=first half, 2=second half',
      \`status\` ENUM('Open','Processing','Finalized') NOT NULL DEFAULT 'Open',
      \`notes\` TEXT,
      \`created_by\` VARCHAR(150),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_attendance', `
    CREATE TABLE \`payroll_attendance\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`employee_id\` VARCHAR(36) NOT NULL,
      \`cutoff_id\` VARCHAR(36),
      \`work_date\` DATE NOT NULL,
      \`time_in\` TIME,
      \`time_out\` TIME,
      \`hours_worked\` DECIMAL(5,2) DEFAULT 0.00,
      \`late_minutes\` DECIMAL(6,2) DEFAULT 0.00,
      \`undertime_minutes\` DECIMAL(6,2) DEFAULT 0.00,
      \`overtime_hours\` DECIMAL(5,2) DEFAULT 0.00,
      \`is_absent\` TINYINT(1) DEFAULT 0,
      \`is_rest_day\` TINYINT(1) DEFAULT 0,
      \`holiday_type\` ENUM('None','Legal','Special') DEFAULT 'None',
      \`holiday_name\` VARCHAR(100),
      \`remarks\` VARCHAR(255),
      \`source\` ENUM('Manual','Biometrics') DEFAULT 'Manual',
      \`batch_id\` VARCHAR(36),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      UNIQUE KEY \`uq_emp_date\` (\`employee_id\`, \`work_date\`)
    )
  `);

  await ensureTable('payroll_biometrics_batches', `
    CREATE TABLE \`payroll_biometrics_batches\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`batch_name\` VARCHAR(200) NOT NULL,
      \`cutoff_id\` VARCHAR(36),
      \`file_name\` VARCHAR(255),
      \`row_count\` INT DEFAULT 0,
      \`imported_count\` INT DEFAULT 0,
      \`skipped_count\` INT DEFAULT 0,
      \`error_count\` INT DEFAULT 0,
      \`status\` ENUM('Preview','Imported','Error') DEFAULT 'Preview',
      \`created_by\` VARCHAR(150),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_holidays', `
    CREATE TABLE \`payroll_holidays\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`holiday_name\` VARCHAR(200) NOT NULL,
      \`holiday_date\` DATE NOT NULL,
      \`holiday_type\` ENUM('Legal','Special') NOT NULL DEFAULT 'Legal',
      \`is_recurring\` TINYINT(1) DEFAULT 0,
      \`year\` INT,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('sss_table', `
    CREATE TABLE \`sss_table\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`range_from\` DECIMAL(12,2) NOT NULL,
      \`range_to\` DECIMAL(12,2) NOT NULL,
      \`monthly_salary_credit\` DECIMAL(12,2) NOT NULL,
      \`employee_share\` DECIMAL(10,2) NOT NULL,
      \`employer_share\` DECIMAL(10,2) NOT NULL,
      \`total_contribution\` DECIMAL(10,2) NOT NULL,
      \`effective_year\` INT NOT NULL DEFAULT 2024,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('philhealth_table', `
    CREATE TABLE \`philhealth_table\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`year\` INT NOT NULL,
      \`rate_percent\` DECIMAL(5,2) NOT NULL DEFAULT 5.00,
      \`min_monthly_basic\` DECIMAL(12,2) NOT NULL DEFAULT 10000.00,
      \`max_monthly_basic\` DECIMAL(12,2) NOT NULL DEFAULT 100000.00,
      \`min_contribution\` DECIMAL(10,2) NOT NULL DEFAULT 500.00,
      \`max_contribution\` DECIMAL(10,2) NOT NULL DEFAULT 5000.00,
      \`employee_share_percent\` DECIMAL(5,2) NOT NULL DEFAULT 50.00,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('pagibig_table', `
    CREATE TABLE \`pagibig_table\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`year\` INT NOT NULL,
      \`employee_rate_percent\` DECIMAL(5,2) NOT NULL DEFAULT 2.00,
      \`employer_rate_percent\` DECIMAL(5,2) NOT NULL DEFAULT 2.00,
      \`max_employee_contribution\` DECIMAL(10,2) NOT NULL DEFAULT 100.00,
      \`max_employer_contribution\` DECIMAL(10,2) NOT NULL DEFAULT 100.00,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_earnings_types', `
    CREATE TABLE \`payroll_earnings_types\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`code\` VARCHAR(30) NOT NULL UNIQUE,
      \`name\` VARCHAR(100) NOT NULL,
      \`is_taxable\` TINYINT(1) DEFAULT 1,
      \`is_system\` TINYINT(1) DEFAULT 0 COMMENT 'System types cannot be deleted',
      \`sort_order\` INT DEFAULT 0,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_deduction_types', `
    CREATE TABLE \`payroll_deduction_types\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`code\` VARCHAR(30) NOT NULL UNIQUE,
      \`name\` VARCHAR(100) NOT NULL,
      \`is_statutory\` TINYINT(1) DEFAULT 0 COMMENT '1=SSS/PhilHealth/PagIBIG/Tax',
      \`is_system\` TINYINT(1) DEFAULT 0,
      \`sort_order\` INT DEFAULT 0,
      \`is_active\` TINYINT(1) DEFAULT 1,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_cash_advances', `
    CREATE TABLE \`payroll_cash_advances\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`employee_id\` VARCHAR(36) NOT NULL,
      \`date_granted\` DATE NOT NULL,
      \`amount\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      \`balance\` DECIMAL(12,2) NOT NULL DEFAULT 0.00,
      \`deduction_per_cutoff\` DECIMAL(12,2) DEFAULT 0.00,
      \`deduction_mode\` ENUM('every_cutoff','every_other','every_other_2nd','manual') NOT NULL DEFAULT 'every_cutoff',
      \`status\` ENUM('Active','Settled','Cancelled') DEFAULT 'Active',
      \`remarks\` TEXT,
      \`created_by\` VARCHAR(150),
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);
  await ensureColumn('payroll_cash_advances', 'deduction_mode', "ENUM('every_cutoff','every_other','manual') NOT NULL DEFAULT 'every_cutoff' AFTER `deduction_per_cutoff`");
  // Widen enum to include every_other_2nd if not already present
  try {
    await pool.query("ALTER TABLE `payroll_cash_advances` MODIFY `deduction_mode` ENUM('every_cutoff','every_other','every_other_2nd','manual') NOT NULL DEFAULT 'every_cutoff'");
  } catch (_) { /* already widened */ }

  await ensureTable('employee_time_logs', `
    CREATE TABLE \`employee_time_logs\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`employee_id\` VARCHAR(36) NOT NULL,
      \`log_date\` DATE NOT NULL,
      \`log_time\` TIME NOT NULL,
      \`log_type\` ENUM('TIME_IN','TIME_OUT') NOT NULL,
      \`device_name\` VARCHAR(100) DEFAULT NULL,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      INDEX \`idx_etl_employee_date\` (\`employee_id\`, \`log_date\`),
      INDEX \`idx_etl_log_date\` (\`log_date\`)
    )
  `);

  await ensureTable('payroll_runs', `
    CREATE TABLE \`payroll_runs\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`cutoff_id\` VARCHAR(36) NOT NULL,
      \`run_number\` VARCHAR(50),
      \`status\` ENUM('Draft','Processing','Finalized') DEFAULT 'Draft',
      \`total_employees\` INT DEFAULT 0,
      \`total_gross\` DECIMAL(14,2) DEFAULT 0.00,
      \`total_deductions\` DECIMAL(14,2) DEFAULT 0.00,
      \`total_net\` DECIMAL(14,2) DEFAULT 0.00,
      \`processed_by\` VARCHAR(150),
      \`processed_at\` DATETIME,
      \`finalized_by\` VARCHAR(150),
      \`finalized_at\` DATETIME,
      \`notes\` TEXT,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_run_items', `
    CREATE TABLE \`payroll_run_items\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`run_id\` VARCHAR(36) NOT NULL,
      \`cutoff_id\` VARCHAR(36) NOT NULL,
      \`employee_id\` VARCHAR(36) NOT NULL,
      \`employee_code\` VARCHAR(50),
      \`employee_name\` VARCHAR(255),
      \`department\` VARCHAR(100),
      \`position\` VARCHAR(100),
      \`payroll_type\` VARCHAR(20),
      \`basic_monthly_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`daily_rate\` DECIMAL(12,2) DEFAULT 0.00,
      \`days_in_period\` DECIMAL(5,2) DEFAULT 0.00,
      \`days_worked\` DECIMAL(5,2) DEFAULT 0.00,
      \`days_absent\` DECIMAL(5,2) DEFAULT 0.00,
      \`hours_late\` DECIMAL(6,2) DEFAULT 0.00,
      \`hours_undertime\` DECIMAL(6,2) DEFAULT 0.00,
      \`overtime_hours\` DECIMAL(6,2) DEFAULT 0.00,
      \`basic_pay\` DECIMAL(12,2) DEFAULT 0.00,
      \`overtime_pay\` DECIMAL(12,2) DEFAULT 0.00,
      \`holiday_pay\` DECIMAL(12,2) DEFAULT 0.00,
      \`allowances\` DECIMAL(12,2) DEFAULT 0.00,
      \`other_earnings\` DECIMAL(12,2) DEFAULT 0.00,
      \`gross_pay\` DECIMAL(12,2) DEFAULT 0.00,
      \`sss_deduction\` DECIMAL(10,2) DEFAULT 0.00,
      \`philhealth_deduction\` DECIMAL(10,2) DEFAULT 0.00,
      \`pagibig_deduction\` DECIMAL(10,2) DEFAULT 0.00,
      \`cash_advance_deduction\` DECIMAL(12,2) DEFAULT 0.00,
      \`other_deductions\` DECIMAL(12,2) DEFAULT 0.00,
      \`total_deductions\` DECIMAL(12,2) DEFAULT 0.00,
      \`net_pay\` DECIMAL(12,2) DEFAULT 0.00,
      \`remarks\` TEXT,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
    )
  `);

  await ensureTable('payroll_run_item_lines', `
    CREATE TABLE \`payroll_run_item_lines\` (
      \`id\` VARCHAR(36) NOT NULL PRIMARY KEY,
      \`run_item_id\` VARCHAR(36) NOT NULL,
      \`run_id\` VARCHAR(36) NOT NULL,
      \`line_type\` ENUM('Earning','Deduction') NOT NULL,
      \`code\` VARCHAR(30) NOT NULL,
      \`name\` VARCHAR(150) NOT NULL,
      \`amount\` DECIMAL(12,2) DEFAULT 0.00,
      \`sort_order\` INT DEFAULT 0,
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
    )
  `);

  // Seed SSS table (2024 rates - simplified brackets)
  const [[sssCount]] = await pool.query('SELECT COUNT(*) as c FROM sss_table');
  if (sssCount.c === 0) {
    const sssBrackets = [
      [1000, 4249.99, 4000, 180.00, 380.00, 560.00],
      [4250, 4749.99, 4500, 202.50, 427.50, 630.00],
      [4750, 5249.99, 5000, 225.00, 475.00, 700.00],
      [5250, 5749.99, 5500, 247.50, 522.50, 770.00],
      [5750, 6249.99, 6000, 270.00, 570.00, 840.00],
      [6250, 6749.99, 6500, 292.50, 617.50, 910.00],
      [6750, 7249.99, 7000, 315.00, 665.00, 980.00],
      [7250, 7749.99, 7500, 337.50, 712.50, 1050.00],
      [7750, 8249.99, 8000, 360.00, 760.00, 1120.00],
      [8250, 8749.99, 8500, 382.50, 807.50, 1190.00],
      [8750, 9249.99, 9000, 405.00, 855.00, 1260.00],
      [9250, 9749.99, 9500, 427.50, 902.50, 1330.00],
      [9750, 10249.99, 10000, 450.00, 950.00, 1400.00],
      [10250, 10749.99, 10500, 472.50, 997.50, 1470.00],
      [10750, 11249.99, 11000, 495.00, 1045.00, 1540.00],
      [11250, 11749.99, 11500, 517.50, 1092.50, 1610.00],
      [11750, 12249.99, 12000, 540.00, 1140.00, 1680.00],
      [12250, 12749.99, 12500, 562.50, 1187.50, 1750.00],
      [12750, 13249.99, 13000, 585.00, 1235.00, 1820.00],
      [13250, 13749.99, 13500, 607.50, 1282.50, 1890.00],
      [13750, 14249.99, 14000, 630.00, 1330.00, 1960.00],
      [14250, 14749.99, 14500, 652.50, 1377.50, 2030.00],
      [14750, 15249.99, 15000, 675.00, 1425.00, 2100.00],
      [15250, 15749.99, 15500, 697.50, 1472.50, 2170.00],
      [15750, 16249.99, 16000, 720.00, 1520.00, 2240.00],
      [16250, 16749.99, 16500, 742.50, 1567.50, 2310.00],
      [16750, 17249.99, 17000, 765.00, 1615.00, 2380.00],
      [17250, 17749.99, 17500, 787.50, 1662.50, 2450.00],
      [17750, 18249.99, 18000, 810.00, 1710.00, 2520.00],
      [18250, 18749.99, 18500, 832.50, 1757.50, 2590.00],
      [18750, 19249.99, 19000, 855.00, 1805.00, 2660.00],
      [19250, 19749.99, 19500, 877.50, 1852.50, 2730.00],
      [19750, 20249.99, 20000, 900.00, 1900.00, 2800.00],
      [20250, 20749.99, 20500, 922.50, 1947.50, 2870.00],
      [20750, 9999999.99, 20000, 900.00, 1900.00, 2800.00],
    ];
    for (const b of sssBrackets) {
      await pool.query(
        'INSERT INTO sss_table (id, range_from, range_to, monthly_salary_credit, employee_share, employer_share, total_contribution, effective_year) VALUES (?, ?, ?, ?, ?, ?, ?, 2024)',
        [uuidv4(), b[0], b[1], b[2], b[3], b[4], b[5]]
      );
    }
  }

  // Seed PhilHealth table (2024)
  const [[phCount]] = await pool.query('SELECT COUNT(*) as c FROM philhealth_table');
  if (phCount.c === 0) {
    await pool.query(
      'INSERT INTO philhealth_table (id, year, rate_percent, min_monthly_basic, max_monthly_basic, min_contribution, max_contribution, employee_share_percent) VALUES (?, 2024, 5.00, 10000.00, 100000.00, 500.00, 5000.00, 50.00)',
      [uuidv4()]
    );
  }

  // Seed PagIBIG table (2024)
  const [[piCount]] = await pool.query('SELECT COUNT(*) as c FROM pagibig_table');
  if (piCount.c === 0) {
    await pool.query(
      'INSERT INTO pagibig_table (id, year, employee_rate_percent, employer_rate_percent, max_employee_contribution, max_employer_contribution) VALUES (?, 2024, 2.00, 2.00, 100.00, 100.00)',
      [uuidv4()]
    );
  }

  // Seed default earnings types
  const [[etCount]] = await pool.query('SELECT COUNT(*) as c FROM payroll_earnings_types');
  if (etCount.c === 0) {
    const earningsTypes = [
      ['BASIC', 'Basic Pay', 1, 1, 1],
      ['OT', 'Overtime Pay', 1, 1, 2],
      ['HOLIDAY', 'Holiday Pay', 1, 1, 3],
      ['RESTDAY', 'Rest Day Pay', 1, 1, 4],
      ['ALLOWANCE', 'Allowances', 0, 1, 5],
      ['BONUS', 'Bonus', 1, 0, 6],
      ['ADJUSTMENT', 'Earnings Adjustment', 1, 0, 7],
    ];
    for (const [code, name, taxable, system, sort] of earningsTypes) {
      await pool.query(
        'INSERT INTO payroll_earnings_types (id, code, name, is_taxable, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), code, name, taxable, system, sort]
      );
    }
  }

  // Seed default deduction types
  const [[dtCount]] = await pool.query('SELECT COUNT(*) as c FROM payroll_deduction_types');
  if (dtCount.c === 0) {
    const deductionTypes = [
      ['SSS', 'SSS Contribution', 1, 1, 1],
      ['PHILHEALTH', 'PhilHealth Contribution', 1, 1, 2],
      ['PAGIBIG', 'Pag-IBIG Contribution', 1, 1, 3],
      ['TAX', 'Withholding Tax', 1, 1, 4],
      ['CA', 'Cash Advance', 0, 1, 5],
      ['ABSENT', 'Absent Deduction', 0, 1, 6],
      ['LATE', 'Late/Tardiness', 0, 1, 7],
      ['UNDERTIME', 'Undertime', 0, 1, 8],
      ['LOAN', 'Loan Deduction', 0, 0, 9],
      ['ADJ_DED', 'Deduction Adjustment', 0, 0, 10],
    ];
    for (const [code, name, statutory, system, sort] of deductionTypes) {
      await pool.query(
        'INSERT INTO payroll_deduction_types (id, code, name, is_statutory, is_system, sort_order) VALUES (?, ?, ?, ?, ?, ?)',
        [uuidv4(), code, name, statutory, system, sort]
      );
    }
  }
}

async function ensureCompanySettings() {
  await ensureTable(
    'company_settings',
    `CREATE TABLE IF NOT EXISTS \`company_settings\` (
      \`id\` INT NOT NULL DEFAULT 1,
      \`company_name\` VARCHAR(255) NOT NULL DEFAULT 'My Business',
      \`company_address\` TEXT NULL,
      \`contact_number\` VARCHAR(50) NOT NULL DEFAULT '',
      \`email\` VARCHAR(255) NOT NULL DEFAULT '',
      \`website\` VARCHAR(255) NOT NULL DEFAULT '',
      \`tin\` VARCHAR(50) NOT NULL DEFAULT '',
      \`business_type\` VARCHAR(100) NOT NULL DEFAULT '',
      \`branch_name\` VARCHAR(100) NOT NULL DEFAULT '',
      \`default_currency\` VARCHAR(10) NOT NULL DEFAULT 'PHP',
      \`app_title\` VARCHAR(255) NOT NULL DEFAULT '',
      \`show_company_header_in_reports\` TINYINT(1) NOT NULL DEFAULT 1,
      \`show_logo_in_reports\` TINYINT(1) NOT NULL DEFAULT 1,
      \`logo_url\` VARCHAR(500) NOT NULL DEFAULT '',
      \`footer_notes\` TEXT NULL,
      \`receipt_notes\` TEXT NULL,
      \`payslip_footer_notes\` TEXT NULL,
      \`publisher\` VARCHAR(100) NOT NULL DEFAULT 'Cebu DigiBox',
      \`receipt_printer_name\` VARCHAR(255) NOT NULL DEFAULT 'XPrinter 58IIH',
      \`created_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
      \`updated_at\` DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
      PRIMARY KEY (\`id\`)
    ) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_unicode_ci`
  );

  await ensureColumn('company_settings', 'receipt_printer_name', "VARCHAR(255) NOT NULL DEFAULT 'XPrinter 58IIH'");

  const [[row]] = await pool.query('SELECT COUNT(*) AS c FROM `company_settings`');
  if (Number(row?.c ?? 0) === 0) {
    await pool.query(`INSERT INTO \`company_settings\` (id, company_name, publisher) VALUES (1, 'My Business', 'Cebu DigiBox')`);
  }
}

// Ensure the database default collation matches what the schema expects.
// MariaDB 10.6+ defaults to utf8mb4_uca1400_ai_ci; tables created with
// utf8mb4_unicode_ci cause "Illegal mix of collations" on any string WHERE
// comparison if the connection collation doesn't also match.
async function ensureDbCollation() {
  try {
    const dbName = process.env.DB_NAME || 'gcash_pos';
    const [[info]] = await pool.query(
      `SELECT DEFAULT_COLLATION_NAME FROM information_schema.SCHEMATA WHERE SCHEMA_NAME = ?`,
      [dbName]
    );
    if (info && info.DEFAULT_COLLATION_NAME !== 'utf8mb4_unicode_ci') {
      await pool.query(
        `ALTER DATABASE \`${dbName}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`
      );
    }
  } catch (err) {
    // Non-fatal — connection-level SET NAMES in db.js is the primary guard
    console.warn('[schemaCompat] ensureDbCollation skipped:', err.message);
  }
}

export { ensureFinanceMonitoringSchema, ensurePosMultiPricingSchema, ensurePayrollTables, ensureCompanySettings, ensureDbCollation };
