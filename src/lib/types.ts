export type UserRole = 'admin' | 'staff' | 'cashier';
export type TransactionCategory = 'regular' | 'disbursement' | 'transfer';
export type BankTxType =
  | 'deposit'
  | 'withdrawal'
  | 'interest_income'
  | 'bank_fee'
  | 'check_payment'
  | 'disbursement'
  | 'adjustment'
  | 'transfer_in'
  | 'transfer_out'
  | 'owner_funding'
  | 'owner_withdrawal';
export type BankTxDirection = 'credit' | 'debit';
export type UserStatus = 'active' | 'inactive';
export type TransactionType = 'cash_in' | 'cash_out';
export type CashInMode = 'regular' | 'payment';
export type FeeType = 'cash' | 'gcash';
export type CashSource = 'pos_register' | 'cash_fund';
export type CashOutType = 'disbursement' | 'add_to_cash_fund' | 'pos_remittance' | 'move_to_bank' | 'void_reversal';
export type CashTransactionType =
  | 'beginning_balance'
  | 'bank_deposit'
  | 'cash_fund_disbursement'
  | 'pos_remittance'
  | 'cash_in'
  | 'cash_out';
export type CheckStatus = 'draft' | 'pdc' | 'outstanding' | 'cleared' | 'cancelled' | 'bounced';
export type PaymentMethod = 'cash' | 'check' | 'gcash' | 'creditcard' | 'advances_to_owner';
export type OwnerLedgerTransactionType =
  | 'owner_paid_expense'
  | 'owner_paid_purchase'
  | 'owner_paid_supplier_bill'
  | 'owner_paid_shopee_purchase'
  | 'owner_funding_to_bank'
  | 'owner_funding_to_gcash'
  | 'owner_funding_to_cash_fund'
  | 'owner_advance_adjustment'
  | 'payment_to_owner_from_bank'
  | 'payment_to_owner_from_gcash'
  | 'payment_to_owner_from_cash_fund'
  | 'owner_settlement'
  | 'owner_balance_adjustment';
export type OwnerLedgerSourceAccountType = 'bank' | 'gcash' | 'cash_fund' | 'owner_personal' | 'adjustment';

export interface Profile {
  id: string;
  name: string;
  email: string;
  role: UserRole;
  status: UserStatus;
  created_at: string;
  last_login: string | null;
}

export interface Account {
  id: string;
  name: string;
  is_active: boolean;
  current_beginning_balance: number;
  current_running_balance: number;
  last_closed_date: string | null;
  created_at: string;
  updated_at: string;
}

export interface Transaction {
  id: string;
  date: string;
  account_id: string;
  transaction_type: TransactionType;
  cash_in_mode: CashInMode | null;
  amount: number;
  transaction_fee: number;
  amount_received: number | null;
  delivery_fee: number | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  fee_type: FeeType;
  cash_source: CashSource | null;
  cash_out_type: CashOutType | null;
  bank_account_id: string | null;
  source_sale_id?: string | null;
  reversal_of_transaction_id?: string | null;
  source_module?: string | null;
  source_reference_id?: string | null;
  transaction_category?: TransactionCategory;
  disbursement_id?: string | null;
  is_deleted: boolean;
  is_closed?: boolean;
  cleared_at?: string | null;
  accounts?: Account;
  profiles?: Profile;
}

export interface CashTransaction {
  id: string;
  date: string;
  transaction_type: CashTransactionType;
  amount: number;
  notes: string;
  description?: string;
  reference_number?: string;
  source_module?: string | null;
  source_reference_id?: string | null;
  transaction_category?: TransactionCategory;
  disbursement_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  is_closed?: boolean;
  cleared_at?: string | null;
  profiles?: Profile;
}

export interface DailyHistory {
  id: string;
  date: string;
  account_id: string;
  beginning_balance: number;
  total_cash_in: number;
  total_cash_out: number;
  total_transaction_fee: number;
  total_delivery_fee: number;
  transaction_count?: number;
  ending_balance: number;
  posted_at: string;
  posted_by: string | null;
  accounts?: Account;
  profiles?: Profile;
}

export interface SystemState {
  id: string;
  key: string;
  value: string;
  updated_at: string;
}

export interface AuditLog {
  id: string;
  timestamp: string;
  created_at?: string;
  user_id: string | null;
  action: string;
  module: string;
  table_name?: string;
  record_id: string | null;
  details: Record<string, unknown>;
  profiles?: Profile;
}

export interface DailySummary {
  account: Account;
  beginning_balance: number;
  total_cash_in: number;
  total_cash_out: number;
  total_transaction_fee: number;
  total_delivery_fee: number;
  total_cash_fees: number;
  total_product_payment: number;
  total_cash_fund_given: number;
  total_pos_register: number;
  total_cash_out_to_fund: number;
  total_bank_fees: number;
  running_balance: number;
}

export interface CashBalance {
  beginning: number;
  cash_fees_collected: number;
  cash_given_out: number;
  cash_out_to_fund: number;
  bank_deposits: number;
  cash_fund_disbursements: number;
  running: number;
  date: string;
}

export interface BankAccount {
  id: string;
  name: string;
  account_number: string;
  bank_name: string;
  beginning_balance: number;
  current_balance: number;
  actual_balance?: number;
  due_today?: number;
  due_tomorrow?: number;
  overdue_amount?: number;
  pdc_amount?: number;
  projected_available_balance?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface BankDeposit {
  id: string;
  bank_account_id: string;
  date: string;
  amount: number;
  source_type: string;
  source_description: string;
  notes: string;
  source_transaction_id: string | null;
  status?: 'pending' | 'deposited' | 'verified' | 'cancelled';
  deposited_at?: string | null;
  verified_at?: string | null;
  verified_by?: string | null;
  cancelled_at?: string | null;
  cashier_remittance_id?: string | null;
  source_module?: string | null;
  attachment_reference?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  bank_accounts?: BankAccount;
  profiles?: Profile;
}

export interface Supplier {
  id: string;
  code: string;
  name: string;
  contact_person: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  terms: string;
  notes: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface CheckIssued {
  id: string;
  check_number: string;
  bank_account_id: string | null;
  supplier_id: string | null;
  payable_id?: string | null;
  issued_date: string;
  check_date: string;
  cleared_date?: string | null;
  amount: number;
  payee?: string;
  description?: string;
  notes: string;
  status: CheckStatus;
  manually_set_status: boolean;
  approval_required?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  rejected_reason?: string | null;
  disbursement_id: string | null;
  attachment_reference?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  bank_accounts?: BankAccount;
  suppliers?: Supplier;
  profiles?: Profile;
}

export interface Disbursement {
  id: string;
  date: string;
  payee: string;
  purpose: string;
  amount: number;
  affects_cashflow: boolean;
  payment_method: PaymentMethod;
  check_id: string | null;
  owner_id?: string | null;
  owner_ledger_id?: string | null;
  check_number: string;
  supplier_id: string | null;
  description: string;
  reference_number: string;
  disbursement_type: string;
  source_module?: string | null;
  source_reference_id?: string | null;
  source_account_type?: string | null;
  source_account_id?: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  isSynthetic?: boolean;
  checks_issued?: CheckIssued;
  suppliers?: Supplier;
  owners?: FinanceOwner;
  profiles?: Profile;
}

export interface BankTransaction {
  id: string;
  bank_account_id: string;
  date: string;
  tx_type: BankTxType;
  description: string;
  ref_number: string;
  amount: number;
  direction: BankTxDirection;
  disbursement_id: string | null;
  check_id: string | null;
  payable_id?: string | null;
  balance_after?: number | null;
  module_source?: string | null;
  attachment_reference?: string | null;
  approval_required?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  source_transaction_id: string | null;
  notes: string;
  created_by: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
  bank_accounts?: BankAccount;
  profiles?: Profile;
  source_tx?: {
    id: string;
    account_id: string;
    amount: number;
    transaction_fee: number;
    accounts?: { name: string };
  } | null;
}

export interface CashDailyHistory {
  id: string;
  date: string;
  beginning_balance: number;
  total_cash_in?: number;
  total_cash_out?: number;
  transaction_count?: number;
  cash_fees_collected: number;
  cash_given_out: number;
  cash_out_to_fund?: number;
  bank_deposits: number;
  cash_fund_disbursements: number;
  ending_balance: number;
  posted_at: string;
  posted_by: string | null;
  profiles?: Profile;
}

export interface DailySales {
  id: string;
  date: string;
  description: string;
  notes?: string;
  sales: number;
  cost_of_sales: number;
  gross_profit: number;
  // POS auto-sync fields
  total_pos_sales: number;
  cash_pos_sales: number;
  gcash_pos_sales: number;
  card_pos_sales?: number;
  pos_synced_at: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  is_deleted: boolean;
  profiles?: Profile;
}

// -----------------------------------------------
// Inventory Module Types
// -----------------------------------------------

export interface InvRole {
  id: string;
  name: string;
  display_name: string;
  description: string;
  permissions: Record<string, Record<string, boolean>>;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface InvLocation {
  id: string;
  code: string;
  name: string;
  address: string;
  city: string;
  phone: string;
  manager_name: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvCategory {
  id: string;
  code: string;
  name: string;
  parent_id: string | null;
  description: string;
  is_active: boolean;
  sort_order: number;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  parent?: InvCategory;
}

export interface InvBrand {
  id: string;
  name: string;
  description: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface InvUnit {
  id: string;
  code: string;
  name: string;
  abbreviation?: string;
  short_name?: string;
  description?: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export type InvSupplier = Supplier;

export interface InvProduct {
  id: string;
  sku_code: string;
  barcode: string;
  barcode2: string;
  name: string;
  description: string;
  category_id: string | null;
  brand_id: string | null;
  unit_id: string | null;
  base_unit_id?: string | null;
  default_purchase_unit_id?: string | null;
  default_selling_unit_id?: string | null;
  supplier_id: string | null;
  cost_price: number;
  default_cost?: number;
  retail_price?: number;
  wholesale_price?: number;
  special_price?: number;
  selling_price: number;
  reorder_point: number;
  is_expiry_tracked: boolean;
  near_expiry_days: number;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  base_unit_code?: string;
  base_unit_name?: string;
  default_purchase_unit_code?: string;
  default_purchase_unit_name?: string;
  default_selling_unit_code?: string;
  default_selling_unit_name?: string;
  inv_categories?: InvCategory;
  inv_brands?: InvBrand;
  inv_units?: InvUnit;
  suppliers?: Supplier;
  inv_base_unit?: InvUnit;
  inv_default_purchase_unit?: InvUnit;
  inv_product_unit_conversions?: InvProductUnitConversion[];
  inv_product_selling_units?: InvProductSellingUnit[];
}

export interface InvProductUnitConversion {
  id: string;
  product_id: string;
  unit_id: string;
  equivalent_qty_in_base_unit: number;
  allow_purchase: boolean;
  allow_sale: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  inv_units?: InvUnit;
}

export interface InvProductSellingUnit {
  id: string;
  product_id: string;
  unit_id: string;
  qty_in_base_unit: number;
  selling_price: number;
  retail_price: number;
  wholesale_price: number;
  special_price: number;
  wholesale_enabled?: boolean;
  wholesale_break_qty_in_base_unit?: number;
  wholesale_block_price?: number;
  is_default: boolean;
  sort_order: number;
  created_at: string;
  updated_at: string;
  inv_units?: InvUnit;
}

export interface InvProductPricingHistory {
  id: string;
  product_id: string;
  old_cost: number | null;
  new_cost: number | null;
  old_retail_price: number | null;
  new_retail_price: number | null;
  old_wholesale_price: number | null;
  new_wholesale_price: number | null;
  old_special_price: number | null;
  new_special_price: number | null;
  changed_by: string | null;
  changed_by_name: string;
  changed_at: string;
}

export type InvMovementType =
  | 'opening_balance'
  | 'receiving'
  | 'sale'
  | 'transfer_out'
  | 'transfer_in'
  | 'adjustment_add'
  | 'adjustment_deduct'
  | 'physical_count'
  | 'expired'
  | 'damaged'
  | 'loss';

export interface InvBalance {
  id: string;
  product_id: string;
  location_id: string;
  qty_on_hand: number;
  qty_available: number;
  last_movement_at: string | null;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
  inv_locations?: InvLocation;
}

export interface InvMovement {
  id: string;
  product_id: string;
  location_id: string;
  movement_type: InvMovementType;
  qty_change: number;
  display_qty?: number;
  qty_in_base_unit_per_display?: number;
  qty_before: number;
  qty_after: number;
  unit_cost: number | null;
  ref_number: string;
  notes: string;
  related_location_id: string | null;
  display_unit_id?: string | null;
  display_unit_name?: string;
  base_unit_id?: string | null;
  base_unit_name?: string;
  created_by: string | null;
  created_at: string;
  inv_products?: InvProduct;
  inv_locations?: InvLocation;
  related_location?: InvLocation;
  profiles?: Profile;
}

export type PoStatus =
  | 'draft'
  | 'approved'
  | 'partially_received'
  | 'fully_received'
  | 'closed'
  | 'cancelled';

export interface PurchaseOrder {
  id: string;
  po_number: string;
  supplier_id: string;
  location_id: string;
  status: PoStatus;
  order_date: string;
  expected_date: string | null;
  approved_date: string | null;
  approved_by: string | null;
  notes: string;
  terms: string;
  subtotal: number;
  tax_amount: number;
  discount_amount: number;
  other_charges: number;
  total_amount: number;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: Supplier;
  inv_locations?: InvLocation;
  approver?: Profile;
  creator?: Profile;
}

export interface PurchaseOrderItem {
  id: string;
  po_id: string;
  product_id: string;
  purchase_unit_id?: string | null;
  purchase_unit_name?: string;
  qty_in_base_unit_per_purchase?: number;
  qty_ordered: number;
  qty_received: number;
  qty_ordered_in_base_unit?: number;
  qty_received_in_base_unit?: number;
  unit_cost: number;
  cost_per_base_unit?: number;
  line_total: number;
  notes: string;
  sort_order: number;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
}

export type ReceivingStatus = 'draft' | 'posted' | 'cancelled';

export interface Receiving {
  id: string;
  receiving_number: string;
  po_id: string;
  supplier_id: string;
  location_id: string;
  status: ReceivingStatus;
  receiving_date: string;
  invoice_number: string;
  dr_number: string;
  remarks: string;
  admin_override: boolean;
  posted_at: string | null;
  posted_by: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  purchase_orders?: PurchaseOrder;
  suppliers?: Supplier;
  inv_locations?: InvLocation;
  poster?: Profile;
  creator?: Profile;
}

export interface ReceivingItem {
  id: string;
  receiving_id: string;
  po_item_id: string | null;
  product_id: string;
  purchase_unit_id?: string | null;
  purchase_unit_name?: string;
  qty_in_base_unit_per_purchase?: number;
  qty_ordered: number;
  qty_prev_received: number;
  qty_remaining: number;
  qty_received: number;
  qty_accepted: number;
  qty_rejected: number;
  qty_received_in_base_unit?: number;
  qty_accepted_in_base_unit?: number;
  qty_rejected_in_base_unit?: number;
  unit_cost: number;
  unit_cost_per_base?: number;
  expiry_date: string | null;
  batch_number: string;
  notes: string;
  sort_order: number;
  movement_id: string | null;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
}

// -----------------------------------------------
// Stock Transfer Types
// -----------------------------------------------

export type TransferStatus =
  | 'draft'
  | 'approved'
  | 'issued'
  | 'partially_received'
  | 'fully_received'
  | 'cancelled';

export interface StockTransfer {
  id: string;
  transfer_number: string;
  source_location_id: string;
  destination_location_id: string;
  status: TransferStatus;
  transfer_date: string;
  expected_date: string | null;
  notes: string;
  approved_by: string | null;
  approved_at: string | null;
  issued_by: string | null;
  issued_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  source_location?: InvLocation;
  destination_location?: InvLocation;
  approver?: Profile;
  issuer?: Profile;
  creator?: Profile;
}

export interface StockTransferItem {
  id: string;
  transfer_id: string;
  product_id: string;
  qty_requested: number;
  qty_issued: number;
  qty_received: number;
  qty_in_transit: number;
  qty_variance: number;
  unit_cost: number | null;
  notes: string;
  sort_order: number;
  source_movement_id: string | null;
  dest_movement_id: string | null;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
}

// -----------------------------------------------
// Accounts Payable Types
// -----------------------------------------------

export type PayablePaymentStatus = 'unpaid' | 'partial' | 'paid' | 'voided';
export type PayablePaymentMethod = 'cash' | 'check' | 'bank_transfer' | 'gcash' | 'owner_personal_fund' | 'other';

export interface Payable {
  id: string;
  payable_number: string;
  supplier_id: string;
  po_id: string | null;
  receiving_id: string | null;
  invoice_number: string;
  invoice_date: string;
  due_date: string;
  total_amount: number;
  amount_paid: number;
  balance_due: number;
  payment_status: PayablePaymentStatus;
  remarks: string;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  suppliers?: Supplier;
  purchase_orders?: { id: string; po_number: string };
  receivings?: { id: string; receiving_number: string };
  creator?: Profile;
}

export interface PayablePayment {
  id: string;
  payable_id: string;
  payment_date: string;
  amount: number;
  payment_method: PayablePaymentMethod;
  reference_number: string;
  remarks: string;
  owner_id?: string | null;
  bank_account_id?: string | null;
  check_id?: string | null;
  bank_transaction_id?: string | null;
  owner_ledger_id?: string | null;
  attachment_reference?: string | null;
  approval_required?: boolean;
  approval_status?: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  created_by: string | null;
  created_at: string;
  payables?: Payable;
  bank_accounts?: BankAccount;
  checks_issued?: CheckIssued;
  profiles?: Profile;
}

export interface RecurringObligation {
  id: string;
  name: string;
  category: string;
  default_amount: number;
  frequency: 'weekly' | 'monthly' | 'custom';
  due_date_rule: string;
  next_due_date: string;
  is_active: boolean;
  remarks: string;
  paid_transaction_id?: string | null;
  paid_disbursement_id?: string | null;
  last_paid_date?: string | null;
  last_paid_amount?: number | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface BankReconciliation {
  id: string;
  bank_account_id: string;
  statement_date: string;
  statement_ending_balance: number;
  system_book_balance: number;
  uncleared_checks_total: number;
  deposits_in_transit_total: number;
  adjusted_balance: number;
  variance: number;
  remarks: string;
  status: 'draft' | 'reviewed' | 'finalized';
  created_by: string | null;
  reviewed_by?: string | null;
  reviewed_at?: string | null;
  finalized_by?: string | null;
  finalized_at?: string | null;
  created_at: string;
  updated_at: string;
  bank_accounts?: BankAccount;
}

export interface FinanceOwnerMovement {
  id: string;
  date: string;
  movement_type: 'funding' | 'withdrawal';
  target_module: 'bank' | 'gcash' | 'cash_fund';
  owner_id?: string | null;
  bank_account_id?: string | null;
  account_id?: string | null;
  amount: number;
  reference_number: string;
  remarks: string;
  attachment_reference?: string | null;
  approval_required: boolean;
  approval_status: 'pending' | 'approved' | 'rejected';
  approved_by?: string | null;
  approved_at?: string | null;
  posted_bank_transaction_id?: string | null;
  posted_transaction_id?: string | null;
  posted_cash_transaction_id?: string | null;
  owner_ledger_id?: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  bank_accounts?: BankAccount;
  accounts?: Account;
  profiles?: Profile;
}

export interface FinanceOwner {
  id: string;
  name: string;
  remarks: string;
  is_active: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface OwnerLedgerEntry {
  id: string;
  owner_id: string;
  transaction_date: string;
  transaction_type: OwnerLedgerTransactionType;
  reference_type: string;
  reference_id: string | null;
  source_module: string;
  description: string;
  increase_amount: number;
  decrease_amount: number;
  running_balance: number;
  source_account_type: OwnerLedgerSourceAccountType | null;
  source_account_id: string | null;
  reference_number: string;
  remarks: string;
  is_deleted: boolean;
  created_by: string | null;
  created_at: string;
  updated_at: string;
  owners?: FinanceOwner;
}

// -----------------------------------------------
// Inventory Adjustment Types
// -----------------------------------------------

export type AdjustmentReason =
  | 'damaged'
  | 'expired'
  | 'loss'
  | 'spoilage'
  | 'found_stock'
  | 'system_correction';

export type AdjustmentDirection = 'add' | 'deduct';

export type AdjustmentStatus =
  | 'draft'
  | 'pending_approval'
  | 'approved'
  | 'posted'
  | 'rejected'
  | 'cancelled';

export interface Adjustment {
  id: string;
  adjustment_number: string;
  location_id: string;
  adjustment_date: string;
  reason: AdjustmentReason;
  direction: AdjustmentDirection;
  remarks: string;
  status: AdjustmentStatus;
  approved_by: string | null;
  approved_at: string | null;
  rejected_by: string | null;
  rejected_at: string | null;
  rejection_reason: string | null;
  posted_by: string | null;
  posted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  inv_locations?: InvLocation;
  approver?: Profile;
  rejector?: Profile;
  poster?: Profile;
  creator?: Profile;
  adjustment_items?: AdjustmentItem[];
}

export interface AdjustmentItem {
  id: string;
  adjustment_id: string;
  product_id: string;
  qty: number;
  unit_cost: number | null;
  notes: string;
  sort_order: number;
  movement_id: string | null;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
}

// -----------------------------------------------
// Physical Count Types
// -----------------------------------------------

export type PhysicalCountStatus = 'draft' | 'counted' | 'posted' | 'cancelled';
export type PhysicalCountFilterType = 'all' | 'category' | 'brand';

export interface PhysicalCount {
  id: string;
  count_number: string;
  location_id: string;
  count_date: string;
  filter_type: PhysicalCountFilterType;
  filter_id: string | null;
  remarks: string;
  status: PhysicalCountStatus;
  posted_by: string | null;
  posted_at: string | null;
  created_by: string | null;
  updated_by: string | null;
  created_at: string;
  updated_at: string;
  inv_locations?: InvLocation;
  creator?: Profile;
  poster?: Profile;
  physical_count_items?: PhysicalCountItem[];
}

export interface PhysicalCountItem {
  id: string;
  count_id: string;
  product_id: string;
  system_qty: number;
  counted_qty: number | null;
  unit_cost: number | null;
  notes: string;
  sort_order: number;
  movement_id: string | null;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
}

export interface ProductLot {
  id: string;
  product_id: string;
  location_id: string;
  receiving_item_id: string | null;
  movement_id: string | null;
  batch_number: string;
  expiry_date: string;
  qty_received: number;
  qty_on_hand: number;
  unit_cost: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  inv_products?: InvProduct;
  inv_locations?: InvLocation;
}

// -----------------------------------------------
// POS Types
// -----------------------------------------------

export type PosShiftStatus = 'open' | 'closed';
export type SaleStatus = 'completed' | 'held' | 'cancelled' | 'voided';
export type HeldSaleStatus = 'held' | 'recalled' | 'expired' | 'cancelled';
export type CustomerPriceLevel = 'Retail' | 'Wholesale' | 'Special';
export type PriceSource =
  | 'Retail'
  | 'Wholesale'
  | 'Wholesale qty'
  | 'Special'
  | 'Wholesale break'
  | 'Wholesale break + Retail'
  | 'Retail (Wholesale fallback)'
  | 'Retail (Special fallback)';
export type SalePaymentMethod = 'cash' | 'gcash' | 'charge';

export interface PosTerminal {
  terminal_id: string;
  terminal_code: string;
  terminal_name: string;
  location_id: string;
  is_active: boolean;
  created_at: string;
  updated_at: string;
  inv_locations?: InvLocation;
}

export interface PosShift {
  shift_id: string;
  terminal_id: string;
  cashier_id: string;
  location_id: string;
  business_date: string;
  shift_open_time: string;
  shift_close_time: string | null;
  opening_cash: number;
  actual_cash_count: number | null;
  expected_cash_count: number | null;
  cash_over_short: number | null;
  status: PosShiftStatus;
  notes: string;
  closed_by: string | null;
  z_reading_posted_at?: string | null;
  z_reading_posted_by?: string | null;
  z_reading_reset_at?: string | null;
  z_reading_reset_by?: string | null;
  z_reading_reset_reason?: string | null;
  created_at: string;
  updated_at: string;
  pos_terminals?: PosTerminal;
  cashier?: Profile;
  inv_locations?: InvLocation;
}

export interface PosZReadingReset {
  id: string;
  shift_id: string;
  terminal_id: string;
  location_id: string;
  business_date: string;
  reset_by: string;
  reason: string;
  reset_at: string;
  created_at: string;
}

export interface PosCashPickup {
  id: string;
  shift_id: string;
  terminal_id: string;
  location_id: string;
  business_date: string;
  pickup_kind: string;
  pickup_at: string;
  amount: number;
  reason: string;
  category: string;
  related_reference: string;
  notes: string;
  created_by: string | null;
  is_deleted: boolean;
  created_at: string;
  updated_at: string;
}

export interface PosCashPickupLink {
  id: string;
  pickup_id: string;
  source_transaction_id: string;
  source_sale_id: string | null;
  linked_amount: number;
  created_at: string;
}

export interface Sale {
  sale_id: string;
  receipt_no: string;
  shift_id: string;
  terminal_id: string;
  location_id: string;
  cashier_id: string;
  sale_datetime: string;
  sale_status: SaleStatus;
  subtotal: number;
  discount_amount: number;
  tax_amount: number;
  total_amount: number;
  amount_tendered: number;
  change_amount: number;
  customer_id: string | null;
  notes: string;
  loyalty_points_earned: number;
  loyalty_points_redeemed: number;
  voided_by: string | null;
  voided_at: string | null;
  void_reason: string;
  created_at: string;
  updated_at: string;
  sale_items?: SaleItem[];
  sale_payments?: SalePayment[];
  cashier?: Profile;
  pos_terminals?: PosTerminal;
}

export interface SaleItem {
  sale_item_id?: string;
  item_id?: string;
  sale_id: string;
  product_id: string | null;
  selected_unit_id?: string | null;
  selected_unit_name?: string;
  qty_in_base_unit_per_unit?: number;
  total_base_qty_deducted?: number;
  base_unit_name?: string;
  barcode: string;
  sku_code: string;
  product_name_snapshot: string;
  qty: number;
  retail_unit_price: number;
  unit_price: number;
  wholesale_enabled?: boolean;
  wholesale_break_qty_in_base_unit?: number;
  wholesale_block_price?: number;
  wholesale_blocks_applied?: number;
  wholesale_base_qty_applied?: number;
  retail_remainder_base_qty?: number;
  pricing_breakdown?: string;
  selected_price_level: CustomerPriceLevel;
  applied_price_level: CustomerPriceLevel;
  price_source: PriceSource;
  discount_amount: number;
  subtotal: number;
  cost_at_sale: number | null;
  cost_per_base_unit?: number;
  sort_order: number;
  created_at: string;
}

export interface SalePayment {
  sale_payment_id: string;
  sale_id: string;
  payment_method: SalePaymentMethod;
  amount: number;
  reference_no: string;
  created_at: string;
}

export interface HeldSale {
  held_sale_id: string;
  shift_id: string;
  terminal_id: string;
  cashier_id: string;
  hold_reference: string;
  customer_id: string | null;
  customer_name_snapshot: string;
  customer_price_level_snapshot: CustomerPriceLevel;
  subtotal: number;
  status: HeldSaleStatus;
  notes: string;
  created_at: string;
  updated_at: string;
  held_sale_items?: HeldSaleItem[];
}

export interface HeldSaleItem {
  item_id: string;
  held_sale_id: string;
  product_id: string | null;
  selected_unit_id?: string | null;
  selected_unit_name?: string;
  qty_in_base_unit_per_unit?: number;
  total_base_qty_deducted?: number;
  base_unit_name?: string;
  barcode: string;
  sku_code: string;
  product_name_snapshot: string;
  qty: number;
  retail_unit_price: number;
  unit_price: number;
  wholesale_enabled?: boolean;
  wholesale_break_qty_in_base_unit?: number;
  wholesale_block_price?: number;
  wholesale_blocks_applied?: number;
  wholesale_base_qty_applied?: number;
  retail_remainder_base_qty?: number;
  pricing_breakdown?: string;
  selected_price_level: CustomerPriceLevel;
  applied_price_level: CustomerPriceLevel;
  price_source: PriceSource;
  discount_amount: number;
  subtotal: number;
  sort_order: number;
  created_at: string;
}

// ─── POS Advanced ─────────────────────────────────────────────────────────

export type PosPermission =
  | 'discount'
  | 'price_override'
  | 'void_line'
  | 'void_transaction'
  | 'reprint'
  | 'refund'
  | 'supervisor';

export type LoyaltyTxnType = 'earn' | 'redeem' | 'adjustment' | 'expire';
export type RefundMethod = 'cash' | 'store_credit' | 'original_method';

export interface PosCustomer {
  customer_id: string;
  first_name: string;
  last_name: string;
  phone: string;
  email: string;
  address?: string;
  price_level: CustomerPriceLevel;
  messenger_psid: string;
  messenger_linked: boolean;
  last_messenger_interaction_at?: string | null;
  loyalty_points: number;
  credit_balance?: number;
  is_active: boolean;
  created_at: string;
  updated_at: string;
}

export interface CustomerCreditLedgerEntry {
  id: string;
  customer_id: string;
  entry_type: 'charge' | 'payment' | 'adjustment';
  amount: number;
  balance_before: number;
  balance_after: number;
  payment_method: SalePaymentMethod;
  payment_number?: string;
  reference_number: string;
  target_account_type?: string;
  target_account_id?: string | null;
  target_account_name?: string;
  accounting_entry_id?: string | null;
  sale_id: string | null;
  notes: string;
  created_by: string | null;
  created_at: string;
  updated_at: string;
}

export interface PosPermissionRow {
  id: string;
  role: string | null;
  user_id: string | null;
  permission: PosPermission;
  max_discount_pct: number | null;
  requires_pin: boolean;
  pin_hash: string | null;
}

export interface PosAuditEntry {
  id: string;
  shift_id: string | null;
  terminal_id: string | null;
  sale_id: string | null;
  action: string;
  actor_id: string | null;
  supervisor_id: string | null;
  details: Record<string, unknown>;
  created_at: string;
}

export interface PaymentSplit {
  method: SalePaymentMethod;
  amount: number;
  referenceNo: string;
}

export interface SaleReturn {
  return_id: string;
  return_no: string;
  original_sale_id: string;
  shift_id: string | null;
  terminal_id: string | null;
  location_id: string | null;
  cashier_id: string | null;
  supervisor_id: string | null;
  reason: string;
  refund_method: RefundMethod;
  total_return_amt: number;
  notes: string;
  created_at: string;
  sale_return_items?: SaleReturnItem[];
}

export interface SaleReturnItem {
  return_item_id: string;
  return_id: string;
  original_sale_item_id: string | null;
  product_id: string | null;
  product_name_snapshot: string;
  sku_code: string;
  qty_returned: number;
  unit_price: number;
  subtotal: number;
  created_at: string;
}
