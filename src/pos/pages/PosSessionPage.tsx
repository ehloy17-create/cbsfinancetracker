import { useState, useEffect, useCallback, useRef } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { Monitor, User, MapPin, Calendar,
  LogOut, Banknote, ArrowLeft, XCircle, Pause, List,
  Trash2, Receipt, Ban, RotateCcw, BarChart2, Keyboard, ArrowDownCircle, ArrowUpCircle, Clock, Users,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { CustomerPriceLevel, PosShift, InvProduct, PosPermission, PosPermissionRow, PosCustomer } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../lib/posUtils';
import { useCart } from '../hooks/useCart';
import { useRecentItems } from '../hooks/useRecentItems';
import { fetchUserPermissions, writeAuditLog } from '../lib/posCheckout';
import CartPanel, { CartPanelHandle } from '../components/CartPanel';
import ProductSearch from '../components/ProductSearch';
import PosBalanceStack from '../components/PosBalanceStack';
import PosCashInModal from '../components/PosCashInModal';
import PosCashOutModal from '../components/PosCashOutModal';
import PosGcashOutModal from '../components/PosGcashOutModal';
import HeldSalesModal from '../components/HeldSalesModal';
import PaymentModal from '../components/PaymentModal';
import ReceiptModal from '../components/ReceiptModal';
import HoldSlipModal from '../components/HoldSlipModal';
import PosCustomerSearch from '../components/PosCustomerSearch';
import VoidTransactionModal from '../components/VoidTransactionModal';
import SalesReturnModal from '../components/SalesReturnModal';
import XReadingModal from '../components/XReadingModal';
import ZReadingModal from '../components/ZReadingModal';
import RecentSalesModal from '../components/RecentSalesModal';
import PosCustomerModal from '../components/PosCustomerModal';
import { getBooleanSystemState, POS_ALLOW_NEGATIVE_QTY_KEY } from '../../lib/systemState';
import { normalizeCustomerPriceLevel } from '../lib/pricing';
import { generateShortId } from '../../lib/utils';
import { fetchProductUnitBundles, ProductUnitBundle, resolveSellingUnitPricing } from '../../lib/productUnits';

// ─── Hold Modal ─────────────────────────────────────────────────────────────
function HoldModal({
  lineCount, customer, customerSnapshot, customerLocked, onCustomerChange, onClearCustomer, onConfirm, onClose,
}: { lineCount: number; customer: PosCustomer | null; customerSnapshot: string; customerLocked: boolean; onCustomerChange: (customer: PosCustomer | null) => void; onClearCustomer: () => void; onConfirm: (notes: string) => Promise<void>; onClose: () => void }) {
  const [notes, setNotes] = useState('');
  const [saving, setSaving] = useState(false);
  const customerInputRef = useRef<HTMLInputElement>(null);
  const displayCustomerName = formatCustomerName(customer, customerSnapshot);

  const handle = useCallback(async () => {
    if (saving) return;
    setSaving(true);
    await onConfirm(notes.trim());
    setSaving(false);
  }, [notes, onConfirm, saving]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.preventDefault();
        onClose();
        return;
      }
      if (e.key === 'Enter' && !saving) {
        e.preventDefault();
        void handle();
        return;
      }
      if (e.key === 'F2' && !customerLocked) {
        e.preventDefault();
        customerInputRef.current?.focus();
      }
    }

    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [customerLocked, onClose, saving, handle]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm">
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700">
          <div className="flex items-center gap-2">
            <Pause className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold text-white">Hold Transaction</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300"><XCircle className="w-5 h-5" /></button>
        </div>
        <div className="p-5 space-y-4">
          <p className="text-sm text-slate-300">Park <span className="font-semibold text-white">{lineCount}</span> item{lineCount !== 1 ? 's' : ''} to recall later. The cart will be cleared.</p>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Customer</label>
            {customer || customerSnapshot ? (
              <div className="flex items-center justify-between p-3 bg-slate-700 border border-slate-600 rounded-lg">
                <div className="min-w-0">
                  <p className="text-sm font-medium text-white truncate">{displayCustomerName}</p>
                  {customer?.phone && <p className="text-xs text-slate-400">{customer.phone}</p>}
                </div>
                {!customerLocked && (
                  <button onClick={onClearCustomer} className="text-slate-400 hover:text-slate-200 text-xs">Clear</button>
                )}
              </div>
            ) : (
              <PosCustomerSearch onSelect={onCustomerChange} inputRef={customerInputRef} autoFocus />
            )}
            {!customerLocked && (
              <p className="mt-1 text-[11px] text-slate-500">Press <span className="font-mono">F2</span> to focus customer search, or just type to search the customer table.</p>
            )}
          </div>
          <div>
            <label className="block text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1.5">Note (optional)</label>
            <input type="text" value={notes} onChange={e => setNotes(e.target.value)} placeholder="e.g. Customer will return..."
              className="w-full px-3 py-2.5 text-sm bg-slate-700 border border-slate-600 text-white rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 placeholder-slate-500" />
          </div>
        </div>
        <div className="flex items-center justify-end gap-3 px-5 py-4 border-t border-slate-700">
          <button onClick={onClose} className="px-4 py-2 text-sm text-slate-400 hover:text-slate-200 transition-colors">Cancel</button>
          <button onClick={handle} disabled={saving}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-amber-500 text-white rounded-lg hover:bg-amber-600 disabled:opacity-50 transition-colors">
            {saving && <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
            Hold Cart
          </button>
        </div>
      </div>
    </div>
  );
}

// ─── Clear Confirm ──────────────────────────────────────────────────────────
function ClearConfirmModal({ onConfirm, onClose }: { onConfirm: () => void; onClose: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <p className="text-white font-semibold mb-1">Clear the cart?</p>
        <p className="text-slate-400 text-sm mb-5">All items will be removed. This cannot be undone.</p>
        <div className="flex gap-3">
          <button onClick={onClose} className="flex-1 py-2.5 text-sm text-slate-400 hover:text-slate-200 border border-slate-600 rounded-lg transition-colors">Cancel</button>
          <button onClick={onConfirm} className="flex-1 py-2.5 text-sm font-semibold bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors">Clear Cart</button>
        </div>
      </div>
    </div>
  );
}

function PrintPromptModal({
  title,
  referenceNo,
  skipLabel,
  onPrint,
  onSkip,
}: {
  title: string;
  referenceNo: string;
  skipLabel: string;
  onPrint: () => void;
  onSkip: () => void;
}) {
  const confirmButtonRef = useRef<HTMLButtonElement>(null);

  useEffect(() => {
    window.setTimeout(() => confirmButtonRef.current?.focus(), 0);

    function handleKeyDown(e: KeyboardEvent) {
      if (e.key === 'Enter') {
        e.preventDefault();
        onPrint();
        return;
      }
      if (e.key === 'Escape') {
        e.preventDefault();
        onSkip();
      }
    }

    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [onPrint, onSkip]);

  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <p className="text-white font-semibold text-lg">{title}</p>
        <p className="text-slate-400 text-sm mt-2">
          Saved as <span className="font-mono text-slate-200">{referenceNo}</span>. Print preview will open in 58mm thermal-paper size.
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onSkip}
            className="flex-1 py-3 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
          >
            {skipLabel}
          </button>
          <button
            ref={confirmButtonRef}
            onClick={onPrint}
            className="flex-1 py-3 rounded-xl bg-blue-600 hover:bg-blue-500 text-white font-semibold transition-colors"
          >
            Yes, Preview
          </button>
        </div>
      </div>
    </div>
  );
}

function ZReadingPromptModal({ onProceed, onLater }: { onProceed: () => void; onLater: () => void }) {
  return (
    <div className="fixed inset-0 bg-black/60 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 border border-slate-700 rounded-2xl shadow-2xl w-full max-w-sm p-6">
        <p className="text-white font-semibold text-lg">Proceed to Z Reading?</p>
        <p className="text-slate-400 text-sm mt-2">
          Shift closed successfully. Do you want to proceed to Z Reading for day closing?
        </p>
        <div className="mt-6 flex gap-3">
          <button
            onClick={onLater}
            className="flex-1 py-3 rounded-xl border border-slate-600 text-slate-300 hover:text-white hover:border-slate-500 transition-colors"
          >
            Later
          </button>
          <button
            onClick={onProceed}
            className="flex-1 py-3 rounded-xl bg-red-600 hover:bg-red-500 text-white font-semibold transition-colors"
          >
            Proceed to Z Read
          </button>
        </div>
      </div>
    </div>
  );
}

function createHoldReference() {
  return generateShortId('HLD-');
}

function formatCustomerName(customer: PosCustomer | null, fallbackName = '') {
  if (!customer) return fallbackName.trim() || 'Walk-in';
  return `${customer.first_name ?? ''} ${customer.last_name ?? ''}`.trim() || 'Walk-in';
}

function buildRecalledCustomer(
  customerId?: string | null,
  customerNameSnapshot?: string,
  priceLevel?: string | null,
): PosCustomer | null {
  if (!customerId) return null;
  const rawName = (customerNameSnapshot ?? '').trim();
  const parts = rawName ? rawName.split(/\s+/) : [];
  const firstName = parts.shift() ?? 'Customer';
  const lastName = parts.join(' ');
  return {
    customer_id: customerId,
    first_name: firstName,
    last_name: lastName,
    phone: '',
    email: '',
    price_level: normalizeCustomerPriceLevel(priceLevel),
    messenger_psid: '',
    messenger_linked: false,
    last_messenger_interaction_at: null,
    loyalty_points: 0,
    is_active: true,
    created_at: '',
    updated_at: '',
  };
}

// ─── Main Page ──────────────────────────────────────────────────────────────
function PosSessionPage() {
  const { shiftId } = useParams<{ shiftId: string }>();
  const navigate = useNavigate();
  const { user, profile } = useAuth();
  const { showToast } = useToast();

  const cartRef = useRef<CartPanelHandle>(null);
  const searchInputRef = useRef<HTMLInputElement>(null);
  const pendingQtyTargetProductIdRef = useRef<string | null>(null);

  const [shift, setShift]             = useState<PosShift | null>(null);
  const [loading, setLoading]         = useState(true);
  const [now, setNow]                 = useState(new Date());
  const [selectedCategoryId] = useState<string | null>(null);
  const [permissions, setPermissions] = useState<Map<PosPermission, PosPermissionRow>>(new Map());
  const [selectedLineIdx, setSelectedLineIdx] = useState<number>(-1);
  const [qtyTargetIdx, setQtyTargetIdx] = useState<number>(-1);

  const [showZReading, setShowZReading]         = useState(false);
  const [showXReading, setShowXReading]         = useState(false);
  const [showHoldModal, setShowHoldModal]       = useState(false);
  const [showHeldSales, setShowHeldSales]       = useState(false);
  const [showClearConfirm, setShowClearConfirm] = useState(false);
  const [showCashIn, setShowCashIn]             = useState(false);
  const [showCashOut, setShowCashOut]           = useState(false);
  const [showGcashOut, setShowGcashOut]         = useState(false);
  const [showPayment, setShowPayment]           = useState(false);
  const [showVoidTxn, setShowVoidTxn]           = useState(false);
  const [showReturn, setShowReturn]             = useState(false);
  const [showReceipt, setShowReceipt]           = useState(false);
  const [showPrintPrompt, setShowPrintPrompt]   = useState(false);
  const [showHoldPrintPrompt, setShowHoldPrintPrompt] = useState(false);
  const [showHoldSlip, setShowHoldSlip]         = useState(false);
  const [showRecentSales, setShowRecentSales]   = useState(false);
  const [showCustomers, setShowCustomers]       = useState(false);
  const [showZPrompt, setShowZPrompt]           = useState(false);
  const [pendingVoidReceiptNo, setPendingVoidReceiptNo]     = useState<string | undefined>(undefined);
  const [pendingReturnReceiptNo, setPendingReturnReceiptNo] = useState<string | undefined>(undefined);
  const [currentCustomer, setCurrentCustomer]   = useState<PosCustomer | null>(null);
  const [recalledCustomerName, setRecalledCustomerName] = useState('');
  const [manualPriceMode, setManualPriceMode] = useState<CustomerPriceLevel>('Retail');
  const [activeRecalledHold, setActiveRecalledHold] = useState<{
    heldSaleId: string;
    holdReference: string;
    customerId?: string | null;
    customerNameSnapshot?: string;
    customerPriceLevelSnapshot?: CustomerPriceLevel;
  } | null>(null);
  const [lastSale, setLastSale]                 = useState<{ saleId: string; receiptNo: string; deviceTimestamp: string } | null>(null);
  const [lastHeldSale, setLastHeldSale]         = useState<{
    heldSaleId: string;
    holdReference: string;
    customerName: string;
    cashierName: string;
    createdAt: string;
    notes: string;
    lines: typeof lines;
    totalDue: number;
  } | null>(null);
  const [balanceRefreshKey, setBalanceRefreshKey] = useState(0);
  const [allowNegativeQty, setAllowNegativeQty] = useState(false);
  const [productUnitBundles, setProductUnitBundles] = useState<Record<string, ProductUnitBundle>>({});

  const {
    lines, totals,
    addProduct, updateLineUnit, removeLineByIdx, updateQty, clearCart, loadFromHeld,
    voidLine, applyDiscount, overridePrice,
  } = useCart();

  const terminalId = shift?.terminal_id ?? '';
  const locationId = shift?.location_id ?? '';
  const dayClosed = Boolean(shift?.z_reading_posted_at);
  const shiftClosed = Boolean(shift && shift.status !== 'open');
  const shiftLocked = shiftClosed || dayClosed;
  const shiftLockedMessage = dayClosed
    ? 'Z Reading already posted. Transactions are locked for this register/day.'
    : 'Shift already closed by X Reading. Start a new shift or proceed to Z Reading for day closing.';
  const { recents, recordUsage } = useRecentItems(terminalId, locationId);
  const effectivePriceMode = manualPriceMode;
  const priceModeTileClass = effectivePriceMode === 'Retail'
    ? 'border-emerald-500 bg-emerald-500 text-white'
    : effectivePriceMode === 'Wholesale'
      ? 'border-red-500/70 bg-red-500/45 text-white'
      : 'border-yellow-400/70 bg-yellow-300/55 text-slate-950';
  const cycleActivePriceMode = useCallback(() => {
    const order: CustomerPriceLevel[] = ['Retail', 'Wholesale', 'Special'];
    const currentIdx = order.indexOf(effectivePriceMode);
    const nextMode = order[(currentIdx + 1) % order.length];
    setManualPriceMode(nextMode);
    showToast(`Price mode set to ${nextMode}`, 'success');
  }, [effectivePriceMode, showToast]);
  const unitOptionsByProduct = Object.fromEntries(
    Object.entries(productUnitBundles).map(([productId, bundle]) => [
      productId,
      bundle.sellingUnits.map(unit => ({
        id: unit.id,
        label: `${unit.inv_units?.abbreviation ?? unit.inv_units?.short_name ?? unit.inv_units?.code ?? unit.inv_units?.name ?? 'Unit'} - ${unit.qty_in_base_unit.toLocaleString('en-PH', { maximumFractionDigits: 6 })} ${bundle.baseUnitCode || bundle.baseUnitName}`,
      })),
    ]),
  );

  const ensureProductBundles = useCallback(async (productIds: string[]) => {
    const uniqueIds = Array.from(new Set(productIds.filter(Boolean)));
    const missingIds = uniqueIds.filter(id => !productUnitBundles[id]);
    if (missingIds.length === 0) {
      return uniqueIds.reduce<Record<string, ProductUnitBundle>>((acc, id) => {
        const bundle = productUnitBundles[id];
        if (bundle) acc[id] = bundle;
        return acc;
      }, {});
    }

    const fetched = await fetchProductUnitBundles(missingIds);
    const nextEntries = Object.fromEntries(fetched.entries());
    const merged = { ...productUnitBundles, ...nextEntries };
    setProductUnitBundles(merged);
    return uniqueIds.reduce<Record<string, ProductUnitBundle>>((acc, id) => {
      const bundle = merged[id];
      if (bundle) acc[id] = bundle;
      return acc;
    }, {});
  }, [productUnitBundles]);

  useEffect(() => {
    if (currentCustomer) setRecalledCustomerName('');
  }, [currentCustomer]);

  useEffect(() => {
    if (lines.length === 0 && activeRecalledHold) {
      setActiveRecalledHold(null);
      setCurrentCustomer(null);
      setRecalledCustomerName('');
    }
  }, [activeRecalledHold, lines.length]);

  useEffect(() => {
    void ensureProductBundles(lines.map(line => line.productId));
  }, [ensureProductBundles, lines]);

  function setActiveLine(idx: number) {
    setSelectedLineIdx(idx);
    setQtyTargetIdx(idx);
  }

  const getLastActiveLineIdx = useCallback(() => {
    for (let i = lines.length - 1; i >= 0; i -= 1) {
      if (!lines[i]?.voided) return i;
    }
    return -1;
  }, [lines]);

  const getQtyEditTargetIdx = useCallback(() => {
    const candidates = [qtyTargetIdx, selectedLineIdx];
    for (const idx of candidates) {
      if (idx >= 0 && lines[idx] && !lines[idx].voided) return idx;
    }
    return getLastActiveLineIdx();
  }, [getLastActiveLineIdx, lines, qtyTargetIdx, selectedLineIdx]);

  function applySelectedCustomer(nextCustomer: PosCustomer | null) {
    setCurrentCustomer(nextCustomer);
    if (nextCustomer) setRecalledCustomerName('');
    setActiveRecalledHold(prev => prev ? {
      ...prev,
      customerId: nextCustomer?.customer_id ?? prev.customerId ?? null,
      customerNameSnapshot: nextCustomer ? formatCustomerName(nextCustomer) : prev.customerNameSnapshot,
    } : prev);
  }

  function handleCustomerSelection(nextCustomer: PosCustomer | null) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    if (activeRecalledHold && !nextCustomer) return;
    applySelectedCustomer(nextCustomer);
  }

  async function handleAddProduct(product: InvProduct) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return false;
    }
    pendingQtyTargetProductIdRef.current = product.id;
    const bundles = await ensureProductBundles([product.id]);
    const bundle = bundles[product.id];

    const pricing = resolveSellingUnitPricing(
      product,
      bundle,
      undefined,
      1,
      manualPriceMode,
      { lockSelectedPriceLevel: true, strictSelectedPriceLevel: true },
    );
    if (pricing.validationError) {
      showToast(pricing.validationError, 'error');
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return false;
    }
    const initialQty = manualPriceMode === 'Wholesale'
      ? Math.max(
          pricing.qtyInBaseUnitPerUnit > 0
            ? pricing.wholesaleBreakQtyInBaseUnit / pricing.qtyInBaseUnitPerUnit
            : 0,
          0,
        )
      : 1;
    if (manualPriceMode === 'Wholesale' && initialQty <= 0) {
      showToast('No wholesale minimum quantity set', 'error');
      window.setTimeout(() => searchInputRef.current?.focus(), 0);
      return false;
    }
    addProduct(product, bundle, null, manualPriceMode, undefined, true, initialQty);
    window.setTimeout(() => searchInputRef.current?.focus(), 0);
    recordUsage([product]);
    return true;
  }

  async function handleChangeLineUnit(lineIdx: number, selectedUnitId: string) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    const line = lines[lineIdx];
    if (!line?.productId) return;

    const [{ data, error }, bundles] = await Promise.all([
      supabase
        .from('inv_products')
        .select('id, sku_code, barcode, barcode2, name, retail_price, wholesale_price, special_price, selling_price, base_unit_name')
        .eq('id', line.productId)
        .single(),
      ensureProductBundles([line.productId]),
    ]);

    if (error || !data) {
      showToast('Failed to load unit pricing', 'error');
      return;
    }

    updateLineUnit(
      lineIdx,
      data as InvProduct,
      bundles[line.productId],
      currentCustomer,
      effectivePriceMode,
      selectedUnitId,
    );
  }

  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  const load = useCallback(async () => {
    if (!shiftId) return;
    const { data } = await supabase
      .from('pos_shifts')
      .select('*')
      .eq('shift_id', shiftId)
      .maybeSingle();

    if (!data) { navigate('/inventory/pos'); return; }

    // DB columns differ from type field names — map them here
    const raw = data as Record<string, unknown>;
    const s: PosShift = {
      ...(raw as unknown as PosShift),
      business_date: (raw.shift_date ?? raw.business_date ?? '') as string,
      shift_open_time: (raw.opened_at ?? raw.shift_open_time ?? '') as string,
      shift_close_time: (raw.closed_at ?? raw.shift_close_time ?? null) as string | null,
      opening_cash: Number(raw.opening_cash ?? 0),
      expected_cash_count: Number(raw.expected_cash ?? raw.expected_cash_count ?? 0),
      actual_cash_count: raw.actual_cash != null ? Number(raw.actual_cash) : null,
      cash_over_short: raw.over_short != null ? Number(raw.over_short) : null,
    };

    // Cashier ownership check using flat cashier_id (joins are stripped by the server)
    if (s.cashier_id !== user?.id && profile?.role !== 'admin') {
      showToast('Access denied', 'error');
      navigate('/inventory/pos');
      return;
    }
    // Fetch related data separately (server strips join syntax)
    const [terminalRes, locationRes, cashierRes] = await Promise.all([
      supabase.from('pos_terminals').select('*').eq('terminal_id', s.terminal_id).maybeSingle(),
      supabase.from('inv_locations').select('*').eq('id', s.location_id).maybeSingle(),
      supabase.from('profiles').select('*').eq('id', s.cashier_id).maybeSingle(),
    ]);

    s.pos_terminals = terminalRes.data as PosShift['pos_terminals'] ?? undefined;
    s.inv_locations = locationRes.data as PosShift['inv_locations'] ?? undefined;
    s.cashier = cashierRes.data as PosShift['cashier'] ?? undefined;

    setShift(s);
    if (raw.z_reading_posted_at) {
      showToast('Z Reading already posted. Transactions are locked for this register/day.', 'info');
    }
    setLoading(false);
  }, [shiftId, navigate, user?.id, profile?.role, showToast]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    if (!user?.id || !profile?.role) return;
    fetchUserPermissions(user.id, profile.role).then(setPermissions);
  }, [user?.id, profile?.role]);

  useEffect(() => {
    getBooleanSystemState(POS_ALLOW_NEGATIVE_QTY_KEY, false)
      .then(setAllowNegativeQty)
      .catch(() => setAllowNegativeQty(false));
  }, []);

  const canVoidTxn = profile?.role === 'admin' || permissions.has('void_transaction');
  const canRefund  = profile?.role === 'admin' || permissions.has('refund');

  // Keep selection and edit-qty target aligned with the most recently affected line.
  useEffect(() => {
    if (lines.length === 0) {
      if (selectedLineIdx !== -1) setSelectedLineIdx(-1);
      if (qtyTargetIdx !== -1) setQtyTargetIdx(-1);
      pendingQtyTargetProductIdRef.current = null;
      return;
    }

    const pendingProductId = pendingQtyTargetProductIdRef.current;
    if (pendingProductId) {
      for (let i = lines.length - 1; i >= 0; i -= 1) {
        if (!lines[i].voided && lines[i].productId === pendingProductId) {
          pendingQtyTargetProductIdRef.current = null;
          if (selectedLineIdx !== i) setSelectedLineIdx(i);
          if (qtyTargetIdx !== i) setQtyTargetIdx(i);
          return;
        }
      }
    }

    const lastActiveIdx = getLastActiveLineIdx();
    if (lastActiveIdx < 0) return;

    if (selectedLineIdx < 0 || !lines[selectedLineIdx] || lines[selectedLineIdx].voided) {
      setSelectedLineIdx(lastActiveIdx);
    }
    if (qtyTargetIdx < 0 || !lines[qtyTargetIdx] || lines[qtyTargetIdx].voided) {
      setQtyTargetIdx(selectedLineIdx >= 0 && lines[selectedLineIdx] && !lines[selectedLineIdx].voided
        ? selectedLineIdx
        : lastActiveIdx);
    }
  }, [getLastActiveLineIdx, lines, qtyTargetIdx, selectedLineIdx]);

  // F-key keyboard shortcuts
  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (showHoldModal) return;
      const tag = (e.target as HTMLElement).tagName;
      const isTypingField = tag === 'INPUT' || tag === 'TEXTAREA';
      const isFunctionKey = /^F\d{1,2}$/i.test(e.key);
      if (isTypingField && !isFunctionKey) return;

      const hasCart = totals.activeLineCount > 0;

      if (e.key === 'F11') {
        e.preventDefault();
        cycleActivePriceMode();
        return;
      }

      if (shiftLocked) {
        switch (e.key) {
          case 'F8':
            e.preventDefault();
            if (lastSale) setShowReceipt(true);
            return;
          case 'F9':
            e.preventDefault();
            setShowRecentSales(true);
            return;
          case 'F1':
          case 'F2':
          case 'F3':
          case 'F4':
          case 'F5':
          case 'F6':
          case 'F7':
          case 'F10':
            e.preventDefault();
            showToast(shiftLockedMessage, 'warning');
            return;
        }
      }

      switch (e.key) {
        case 'F1':
          e.preventDefault();
          if (hasCart) setShowHoldModal(true);
          break;
        case 'F2':
          e.preventDefault();
          if (hasCart) setShowPayment(true);
          break;
        case 'F3':
          e.preventDefault();
          setShowHeldSales(true);
          break;
        case 'F4':
          e.preventDefault();
          if (totals.lineCount > 0) setShowClearConfirm(true);
          break;
        case 'F5':
          e.preventDefault();
          if (canVoidTxn) setShowVoidTxn(true);
          break;
        case 'F6':
          e.preventDefault();
          if (hasCart) cartRef.current?.openQtyKeypad(getQtyEditTargetIdx());
          break;
        case 'F7':
          e.preventDefault();
          if (canRefund) setShowReturn(true);
          break;
        case 'F8':
          e.preventDefault();
          if (lastSale) setShowReceipt(true);
          break;
        case 'F9':
          e.preventDefault();
          setShowRecentSales(true);
          break;
        case 'F10':
          e.preventDefault();
          setShowCustomers(true);
          break;
        case 'F12':
          e.preventDefault();
          if (!shiftLocked) setShowCashOut(true);
          break;
      }
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [totals, getQtyEditTargetIdx, lastSale, canVoidTxn, canRefund, showHoldModal, shiftLocked, showToast, shiftLockedMessage, cycleActivePriceMode]);

  async function handleHold(notes: string) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    if (!shift || lines.length === 0) return;
    try {
      const holdReference = activeRecalledHold?.holdReference ?? createHoldReference();
      const customerName = formatCustomerName(currentCustomer, recalledCustomerName);
      const heldSalePayload = {
        shift_id: shift.shift_id,
        terminal_id: shift.terminal_id,
        cashier_id: user?.id,
        hold_reference: holdReference,
        customer_id: currentCustomer?.customer_id ?? activeRecalledHold?.customerId ?? null,
        customer_name_snapshot: customerName,
        customer_price_level_snapshot: effectivePriceMode,
        subtotal: totals.grandTotal,
        status: 'held',
        notes,
      };
      const heldSaleId = activeRecalledHold?.heldSaleId;

      const heldResult = heldSaleId
        ? await supabase
            .from('held_sales')
            .update(heldSalePayload)
            .eq('held_sale_id', heldSaleId)
            .select('held_sale_id, hold_reference, created_at')
            .single()
        : await supabase
            .from('held_sales')
            .insert(heldSalePayload)
            .select('held_sale_id, hold_reference, created_at')
            .single();

      const { data: held, error } = heldResult;

      if (error || !held) throw error;

      if (heldSaleId) {
        const { error: deleteOldItemsError } = await supabase
          .from('held_sale_items')
          .delete()
          .eq('held_sale_id', heldSaleId);
        if (deleteOldItemsError) throw deleteOldItemsError;
      }

      const { error: itemsError } = await supabase.from('held_sale_items').insert(
        lines.map((line, idx) => ({
          held_sale_id: held.held_sale_id,
          product_id: line.productId || null,
          selected_unit_id: line.selectedUnitId,
          selected_unit_name: line.selectedUnitName,
          qty_in_base_unit_per_unit: line.qtyInBaseUnitPerUnit,
          total_base_qty_deducted: line.totalBaseQtyDeducted,
          base_unit_name: line.baseUnitName,
          barcode: line.barcode,
          sku_code: line.sku,
          product_name_snapshot: line.productName,
          qty: line.qty,
          retail_unit_price: line.retailUnitPrice,
          unit_price: line.unitPrice,
          wholesale_enabled: line.wholesaleEnabled,
          wholesale_break_qty_in_base_unit: line.wholesaleBreakQtyInBaseUnit,
          wholesale_block_price: line.wholesaleBlockPrice,
          wholesale_blocks_applied: line.wholesaleBlocksApplied,
          wholesale_base_qty_applied: line.wholesaleBaseQtyApplied,
          retail_remainder_base_qty: line.retailRemainderBaseQty,
          pricing_breakdown: line.pricingBreakdown,
          selected_price_level: line.selectedPriceLevel,
          applied_price_level: line.appliedPriceLevel,
          price_source: line.priceSource,
          discount_amount: line.discountAmount,
          subtotal: line.subtotal,
          sort_order: idx,
        }))
      );
      if (itemsError) {
        if (!heldSaleId) {
          await supabase.from('held_sales').delete().eq('held_sale_id', held.held_sale_id);
        }
        throw itemsError;
      }

      const heldLines = lines.map(line => ({ ...line }));
      clearCart();
      setCurrentCustomer(null);
      setActiveRecalledHold(null);
      setRecalledCustomerName('');
      setShowHoldModal(false);
      setLastHeldSale({
        heldSaleId: String(held.held_sale_id),
        holdReference: String(held.hold_reference ?? holdReference),
        customerName,
        cashierName: String(profile?.name ?? cashierInfo?.name ?? '—'),
        createdAt: String(held.created_at ?? new Date().toISOString()),
        notes,
        lines: heldLines,
        totalDue: totals.grandTotal,
      });
      setShowHoldPrintPrompt(true);
      showToast(`Transaction held — ${held.hold_reference ?? holdReference}`, 'success');
    } catch {
      showToast('Failed to hold transaction', 'error');
    }
  }

  function handleResumeHeld(
    cartLines: Parameters<typeof loadFromHeld>[0],
    meta?: {
      heldSaleId: string;
      holdReference: string;
      customerId?: string | null;
      customerNameSnapshot?: string;
      customerPriceLevelSnapshot?: CustomerPriceLevel;
    }
  ) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    loadFromHeld(cartLines);
    setCurrentCustomer(buildRecalledCustomer(meta?.customerId, meta?.customerNameSnapshot, meta?.customerPriceLevelSnapshot));
    setManualPriceMode(meta?.customerPriceLevelSnapshot ?? 'Retail');
    setActiveRecalledHold(meta ? {
      heldSaleId: meta.heldSaleId,
      holdReference: meta.holdReference,
      customerId: meta.customerId ?? null,
      customerNameSnapshot: meta.customerNameSnapshot,
      customerPriceLevelSnapshot: meta.customerPriceLevelSnapshot ?? 'Retail',
    } : null);
    setRecalledCustomerName((meta?.customerNameSnapshot ?? '').trim());
    setLastHeldSale(null);
    setShowHeldSales(false);
    showToast('Transaction resumed', 'success');
  }

  function handleSaleSuccess(saleId: string, receiptNo: string) {
    const recalledHoldToRelease = activeRecalledHold;
    const deviceTimestamp = new Date().toISOString();
    setShowPayment(false);
    clearCart();
    setCurrentCustomer(null);
    setActiveRecalledHold(null);
    setRecalledCustomerName('');
    setLastSale({ saleId, receiptNo, deviceTimestamp });
    setBalanceRefreshKey(key => key + 1);
    setShowPrintPrompt(true);
    showToast(`Sale posted — ${receiptNo}`, 'success');
    if (recalledHoldToRelease) {
      void supabase
        .from('held_sales')
        .delete()
        .eq('held_sale_id', recalledHoldToRelease.heldSaleId)
        .then(({ error: releaseError }) => {
          if (releaseError) {
            showToast('Sale posted, but the original held entry could not be cleared.', 'warning');
          }
        });
    }
    writeAuditLog({
      shiftId: shift?.shift_id,
      terminalId: shift?.terminal_id,
      saleId,
      action: 'sale',
      actorId: user?.id,
      details: { receipt_no: receiptNo },
    });
  }

  function handleVoidLine(idx: number, reason: string) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    voidLine(idx);
    writeAuditLog({
      shiftId: shift?.shift_id,
      terminalId: shift?.terminal_id,
      action: 'void_line',
      actorId: user?.id,
      details: { line_idx: idx, reason },
    });
  }

  function handleApplyDiscount(idx: number, pct: number, fixed: number) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    applyDiscount(idx, pct, fixed);
    writeAuditLog({
      shiftId: shift?.shift_id,
      terminalId: shift?.terminal_id,
      action: 'discount',
      actorId: user?.id,
      details: { line_idx: idx, pct, fixed },
    });
  }

  function handleOverridePrice(idx: number, newPrice: number) {
    if (shiftLocked) {
      showToast(shiftLockedMessage, 'warning');
      return;
    }
    overridePrice(idx, newPrice);
    writeAuditLog({
      shiftId: shift?.shift_id,
      terminalId: shift?.terminal_id,
      action: 'price_override',
      actorId: user?.id,
      details: { line_idx: idx, new_price: newPrice },
    });
  }

  if (loading) {
    return (
      <div className="min-h-screen bg-slate-900 flex items-center justify-center">
        <div className="w-8 h-8 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!shift) return null;

  const terminal    = shift.pos_terminals as unknown as { terminal_name: string } | undefined;
  const loc         = shift.inv_locations  as unknown as { name: string; code: string } | undefined;
  const cashierInfo = shift.cashier        as unknown as { name: string } | undefined;
  const activeCustomerName = formatCustomerName(currentCustomer, recalledCustomerName);

  return (
    <div className="h-screen bg-slate-900 flex flex-col overflow-hidden select-none">
      {/* Top Bar */}
      <div className="bg-slate-800 border-b border-slate-700 px-4 py-2.5 flex items-center gap-3 flex-shrink-0">
        <Link to="/inventory/pos" className="text-slate-400 hover:text-white transition-colors flex-shrink-0">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex items-center gap-2 text-sm text-white font-semibold flex-shrink-0">
          <Monitor className="w-4 h-4 text-blue-400" />
          {terminal?.terminal_name ?? 'Terminal'}
        </div>
        <span className="text-slate-600 text-xs">|</span>
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
          <MapPin className="w-3.5 h-3.5" />
          {loc ? `[${loc.code}] ${loc.name}` : '—'}
        </div>
        <span className="text-slate-600 text-xs">|</span>
        <div className="flex items-center gap-1 text-xs text-slate-400 flex-shrink-0">
          <Calendar className="w-3.5 h-3.5" />
          {formatDate(shift.business_date)}
        </div>
        <button
          onClick={() => !shiftLocked && !activeRecalledHold && setShowCustomers(true)}
          disabled={shiftLocked || Boolean(activeRecalledHold)}
          className={`flex items-center gap-2 rounded-full border px-3 py-1 text-xs transition-colors ${
            shiftLocked || activeRecalledHold
              ? 'cursor-not-allowed border-slate-700 text-slate-500'
              : 'border-slate-700 text-slate-200 hover:border-blue-700 hover:bg-blue-950/40'
          }`}
        >
          <Users className="w-3.5 h-3.5" />
          <span className="max-w-[140px] truncate">{activeCustomerName}</span>
          <span className="rounded-full bg-slate-700 px-2 py-0.5 text-[10px] font-semibold text-blue-300">{effectivePriceMode}</span>
        </button>
        <div className="flex-1" />
        <p className="text-white font-mono text-sm font-semibold tabular-nums flex-shrink-0">
          {now.toLocaleTimeString('en-PH', { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: true })}
        </p>
        <div className={`flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold border flex-shrink-0 ${
          shiftLocked
            ? 'bg-red-950 text-red-300 border-red-900'
            : 'bg-emerald-950 text-emerald-400 border-emerald-800'
        }`}>
          <span className={`w-1.5 h-1.5 rounded-full ${shiftLocked ? 'bg-red-400' : 'bg-emerald-400 animate-pulse'}`} />
          {dayClosed ? 'Day Closed' : shiftClosed ? 'Shift Closed' : 'Open'}
        </div>
        <div className="flex items-center gap-1 text-xs text-slate-400 border-l border-slate-700 pl-3 flex-shrink-0">
          <User className="w-3.5 h-3.5" />
          {cashierInfo?.name ?? profile?.name}
        </div>
        <button
          onClick={() => !shiftLocked && setShowXReading(true)}
          disabled={shiftLocked}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-blue-400 border border-blue-800 rounded-lg hover:bg-blue-950 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <BarChart2 className="w-3.5 h-3.5" />
          X Reading
        </button>
        <button
          onClick={() => !dayClosed && setShowZReading(true)}
          disabled={dayClosed}
          className="flex items-center gap-1.5 px-3 py-1.5 text-xs font-medium text-red-400 border border-red-800 rounded-lg hover:bg-red-950 transition-colors flex-shrink-0 disabled:opacity-40 disabled:cursor-not-allowed"
        >
          <LogOut className="w-3.5 h-3.5" />
          Z Reading
        </button>
      </div>

      {/* Body: top content 80% + bottom menu 20% */}
      <div className="flex-1 flex flex-col overflow-hidden min-h-0">
        {shiftLocked && (
          <div className="border-b border-red-900 bg-red-950/60 px-4 py-2 text-sm text-red-100">
            {shiftLockedMessage}
          </div>
        )}

        <div className="flex min-h-0 overflow-hidden" style={{ flex: '0 0 75%' }}>
          {/* CASH TOOLS — 10% */}
          <div className="flex flex-col min-w-0 min-h-0 border-r border-slate-700 bg-slate-800/70 p-2 gap-2" style={{ flex: '0 0 10%' }}>
            <p className="px-1 pt-1 text-[10px] font-semibold uppercase tracking-widest text-slate-500">Cash</p>
            <button
              type="button"
              disabled={shiftLocked}
              onClick={() => !shiftLocked && setShowCashIn(true)}
              className="flex-1 min-h-0 rounded-xl border border-emerald-800/60 bg-emerald-950/40 text-emerald-300 hover:bg-emerald-900/40 transition-colors flex flex-col items-center justify-center gap-2 text-center px-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowDownCircle className="w-8 h-8" />
              <span className="text-sm font-bold leading-tight">GCash In</span>
            </button>
            <button
              type="button"
              disabled={shiftLocked}
              onClick={() => !shiftLocked && setShowGcashOut(true)}
              className="flex-1 min-h-0 rounded-xl border border-red-800/60 bg-red-950/40 text-red-300 hover:bg-red-900/40 transition-colors flex flex-col items-center justify-center gap-2 text-center px-2 disabled:opacity-40 disabled:cursor-not-allowed"
            >
              <ArrowUpCircle className="w-8 h-8" />
              <span className="text-sm font-bold leading-tight">GCash Out</span>
            </button>
          </div>

          {/* SEARCH + SHORTCUTS — 30% of remaining 90% */}
          <div className="flex flex-col min-w-0 min-h-0 border-r border-slate-700 bg-slate-900 overflow-hidden" style={{ flex: '0 0 27%' }}>
            <div className="relative flex-1 min-h-0 overflow-hidden">
              <div className={shiftLocked ? 'pointer-events-none h-full opacity-60' : 'h-full'}>
                <ProductSearch
                  locationId={shift.location_id}
                  selectedCategoryId={selectedCategoryId}
                  recents={recents}
                  onAddProduct={handleAddProduct}
                  inputRef={searchInputRef}
                />
              </div>
              {shiftLocked && (
                <div className="absolute inset-0 flex items-center justify-center p-4 text-center text-sm text-slate-200">
                  <div className="rounded-xl border border-red-900 bg-slate-950/90 px-4 py-3">
                    {dayClosed ? 'Register locked after Z Reading' : 'Shift closed after X Reading'}
                  </div>
                </div>
              )}
            </div>
            <div className="min-h-0 border-t border-slate-700 bg-slate-800/40 px-3 py-3 overflow-y-auto" style={{ flex: '0 0 34%' }}>
              <PosBalanceStack refreshKey={balanceRefreshKey} shiftId={shift.shift_id} />
            </div>
          </div>

          {/* CART — 70% of remaining 90%, right aligned */}
          <div className="flex min-w-0 min-h-0 overflow-hidden justify-end" style={{ flex: '0 0 63%' }}>
            <div className="w-full max-w-[96%] min-w-0 min-h-0">
              <div className={shiftLocked ? 'pointer-events-none h-full opacity-60' : 'h-full'}>
                <CartPanel
                  ref={cartRef}
                  lines={lines}
                  totals={totals}
                  customerName={activeCustomerName === 'Walk-in' ? '' : activeCustomerName}
                  permissions={permissions}
                  unitOptionsByProduct={unitOptionsByProduct}
                  selectedLineIdx={selectedLineIdx}
                  onSelectLine={setActiveLine}
                  onUpdateQty={updateQty}
                  onUpdateUnit={(idx, unitId) => void handleChangeLineUnit(idx, unitId)}
                  onRemoveLine={removeLineByIdx}
                  onVoidLine={handleVoidLine}
                  onApplyDiscount={handleApplyDiscount}
                  onOverridePrice={handleOverridePrice}
                  onQtyEditorClose={() => searchInputRef.current?.focus()}
                />
              </div>
            </div>
          </div>
        </div>

        {/* MENU — 2-row × 6-column grid dock */}
        <div
          className="grid min-h-0 border-t border-slate-700 bg-slate-800 overflow-hidden"
          style={{ flex: '0 0 25%', gridTemplateColumns: 'repeat(6, minmax(0, 1fr))', gridTemplateRows: 'repeat(2, minmax(0, 1fr))' }}
        >
          <button
            disabled={shiftLocked || totals.activeLineCount === 0}
            onClick={() => !shiftLocked && setShowPayment(true)}
            className="col-start-6 row-start-1 flex flex-col items-center justify-center gap-2 bg-blue-600 border-b border-blue-700 px-3 text-white transition-colors hover:bg-blue-500 active:bg-blue-700 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <Banknote className="h-8 w-8" />
            <span className="text-center text-sm font-bold leading-tight">Tender Payment</span>
            <span className="rounded bg-blue-700/60 px-2 py-0.5 font-mono text-xs">F2</span>
          </button>

          <button
            disabled={shiftLocked}
            onClick={() => !shiftLocked && setShowCashOut(true)}
            className="col-start-6 row-start-2 flex flex-col items-center justify-center gap-2 bg-red-700/80 px-3 text-white transition-colors hover:bg-red-600 active:bg-red-800 disabled:cursor-not-allowed disabled:opacity-40"
          >
            <ArrowUpCircle className="h-8 w-8" />
            <span className="text-center text-sm font-bold leading-tight">Cash Pickup</span>
            <span className="rounded bg-red-900/60 px-2 py-0.5 font-mono text-xs">F12</span>
          </button>

          {/* ── Row 1 ── */}
          <button
            className="col-start-1 row-start-1 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-orange-950/40 active:bg-orange-950/70 text-orange-400 border-r border-b border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2"
            disabled={shiftLocked || !canRefund}
            onClick={() => !shiftLocked && canRefund && setShowReturn(true)}
          >
            <RotateCcw className="w-7 h-7" />
            <span className="text-sm font-semibold">Return</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F7</span>
          </button>

          <button
            className="col-start-2 row-start-1 flex flex-col items-center justify-center gap-1.5 bg-amber-500/10 hover:bg-amber-500/20 active:bg-amber-500/30 text-amber-400 border-r border-b border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2"
            disabled={shiftLocked || totals.activeLineCount === 0}
            onClick={() => !shiftLocked && setShowHoldModal(true)}
          >
            <Pause className="w-7 h-7" />
            <span className="text-sm font-semibold">Hold</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F1</span>
          </button>

          <button
            className="col-start-3 row-start-1 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-r border-b border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2"
            disabled={shiftLocked}
            onClick={() => !shiftLocked && setShowHeldSales(true)}
          >
            <List className="w-7 h-7" />
            <span className="text-sm font-semibold">Recall</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F3</span>
          </button>

          <button
            className="col-start-4 row-start-1 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-red-950/40 active:bg-red-950/60 text-slate-400 hover:text-red-400 border-r border-b border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2"
            disabled={shiftLocked || totals.lineCount === 0}
            onClick={() => !shiftLocked && setShowClearConfirm(true)}
          >
            <Trash2 className="w-7 h-7" />
            <span className="text-sm font-semibold">Clear</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F4</span>
          </button>

          <button
            className="col-start-5 row-start-1 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-r border-b border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2"
            disabled={shiftLocked || totals.activeLineCount === 0}
            onClick={() => !shiftLocked && cartRef.current?.openQtyKeypad(getQtyEditTargetIdx())}
          >
            <Keyboard className="w-7 h-7" />
            <span className="text-sm font-semibold">Edit Qty</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F6</span>
          </button>

          {/* ── Row 2 ── */}
          <button
            className="col-start-1 row-start-2 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-red-950/40 active:bg-red-950/70 text-red-400 border-r border-slate-700 disabled:opacity-40 disabled:cursor-not-allowed transition-colors px-2"
            disabled={shiftLocked || !canVoidTxn}
            onClick={() => !shiftLocked && canVoidTxn && setShowVoidTxn(true)}
          >
            <Ban className="w-7 h-7" />
            <span className="text-sm font-semibold">Void Txn</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F5</span>
          </button>

          <button
            className="col-start-2 row-start-2 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-slate-700 active:bg-slate-600 text-slate-300 disabled:opacity-40 disabled:cursor-not-allowed border-r border-slate-700 transition-colors px-2"
            disabled={!lastSale}
            onClick={() => lastSale && setShowReceipt(true)}
          >
            <Receipt className="w-7 h-7" />
            <span className="text-sm font-semibold">Reprint</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F8</span>
          </button>

          <button
            className="col-start-3 row-start-2 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-r border-slate-700 transition-colors px-2"
            onClick={() => setShowRecentSales(true)}
          >
            <Clock className="w-7 h-7" />
            <span className="text-sm font-semibold">Transactions</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F9</span>
          </button>

          <button
            className="col-start-4 row-start-2 flex flex-col items-center justify-center gap-1.5 bg-slate-700/50 hover:bg-slate-700 active:bg-slate-600 text-slate-300 border-r border-slate-700 transition-colors disabled:opacity-40 disabled:cursor-not-allowed px-2"
            disabled={shiftLocked}
            onClick={() => !shiftLocked && setShowCustomers(true)}
          >
            <Users className="w-7 h-7" />
            <span className="text-sm font-semibold">Customers</span>
            <span className="text-[10px] text-slate-400">Profile & Ledger</span>
            <span className="text-xs bg-slate-700 px-1.5 py-0.5 rounded font-mono text-slate-300">F10</span>
          </button>

          <div className="col-start-5 row-start-2 border-r border-slate-700 px-2 py-2">
            <button
              type="button"
              onClick={cycleActivePriceMode}
              className={`flex h-full w-full flex-col items-center justify-center rounded-xl border p-2 text-center transition-colors hover:brightness-105 active:scale-[0.99] focus:outline-none focus:ring-2 focus:ring-white/40 ${priceModeTileClass}`}
            >
              <span className="rounded bg-black/20 px-1.5 py-0.5 font-mono text-[10px] text-white/90">F11</span>
              <p className="mt-2 text-[11px] font-semibold uppercase tracking-widest text-white/80">Price Mode</p>
              <p className="mt-1 text-sm font-bold text-white">{effectivePriceMode}</p>
            </button>
          </div>
        </div>
      </div>

      {/* Modals */}
      {showXReading && (
        <XReadingModal
          shiftId={shift.shift_id}
          terminalName={terminal?.terminal_name}
          cashierName={cashierInfo?.name ?? profile?.name}
          locationName={loc ? `[${loc.code}] ${loc.name}` : undefined}
          onDone={() => {
            setShowXReading(false);
            setShift(current => current ? { ...current, status: 'closed', shift_close_time: new Date().toISOString() } : current);
            setBalanceRefreshKey(key => key + 1);
            void load();
            setShowZPrompt(true);
          }}
          onClose={() => setShowXReading(false)}
        />
      )}

      {showZReading && (
        <ZReadingModal
          shift={shift}
          onClose={() => setShowZReading(false)}
          onClosed={() => { setShowZReading(false); navigate('/inventory/pos'); }}
        />
      )}

      {showHoldModal && (
        <HoldModal
          lineCount={totals.lineCount}
          customer={currentCustomer}
          customerSnapshot={recalledCustomerName}
          customerLocked={Boolean(activeRecalledHold)}
          onCustomerChange={handleCustomerSelection}
          onClearCustomer={() => {
            setCurrentCustomer(null);
            setRecalledCustomerName('');
          }}
          onConfirm={handleHold}
          onClose={() => setShowHoldModal(false)}
        />
      )}

      {showHeldSales && (
        <HeldSalesModal
          shiftId={shift.shift_id}
          activeHeldSaleId={activeRecalledHold?.heldSaleId ?? null}
          onClose={() => setShowHeldSales(false)}
          onResume={handleResumeHeld}
        />
      )}

      {showCashIn && (
        <PosCashInModal
          onClose={() => setShowCashIn(false)}
          onSaved={() => setBalanceRefreshKey(key => key + 1)}
        />
      )}

      {showCashOut && (
        <PosCashOutModal
          shift={shift}
          onClose={() => setShowCashOut(false)}
          onSaved={() => setBalanceRefreshKey(key => key + 1)}
        />
      )}

      {showGcashOut && (
        <PosGcashOutModal
          onClose={() => setShowGcashOut(false)}
          onSaved={() => setBalanceRefreshKey(key => key + 1)}
        />
      )}

      {showClearConfirm && (
        <ClearConfirmModal onConfirm={() => {
          clearCart();
          setActiveRecalledHold(null);
          setCurrentCustomer(null);
          setRecalledCustomerName('');
          setShowClearConfirm(false);
        }} onClose={() => setShowClearConfirm(false)} />
      )}

      {showPayment && (
        <PaymentModal
          lines={lines}
          totals={totals}
          shiftId={shift.shift_id}
          terminalId={shift.terminal_id}
          locationId={shift.location_id}
          cashierId={user?.id ?? ''}
          allowNegativeQty={allowNegativeQty}
          initialCustomer={currentCustomer}
          initialCustomerSnapshot={recalledCustomerName}
          customerLocked={Boolean(activeRecalledHold)}
          onCustomerChange={handleCustomerSelection}
          onSuccess={handleSaleSuccess}
          onClose={() => setShowPayment(false)}
        />
      )}

      {showPrintPrompt && lastSale && (
        <PrintPromptModal
          title="Print order slip?"
          referenceNo={lastSale.receiptNo}
          skipLabel="No, New Sale"
          onPrint={() => {
            setShowPrintPrompt(false);
            setShowReceipt(true);
          }}
          onSkip={() => {
            setShowPrintPrompt(false);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showHoldPrintPrompt && lastHeldSale && (
        <PrintPromptModal
          title="Print hold slip?"
          referenceNo={lastHeldSale.holdReference}
          skipLabel="No, Back to POS"
          onPrint={() => {
            setShowHoldPrintPrompt(false);
            setShowHoldSlip(true);
          }}
          onSkip={() => {
            setShowHoldPrintPrompt(false);
            setLastHeldSale(null);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showVoidTxn && (
        <VoidTransactionModal
          shiftId={shift.shift_id}
          terminalId={shift.terminal_id}
          actorId={user?.id ?? ''}
          initialReceiptNo={pendingVoidReceiptNo}
          onClose={() => { setShowVoidTxn(false); setPendingVoidReceiptNo(undefined); }}
          onVoided={() => {
            setShowVoidTxn(false);
            setPendingVoidReceiptNo(undefined);
            setBalanceRefreshKey(key => key + 1);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showReturn && (
        <SalesReturnModal
          shiftId={shift.shift_id}
          terminalId={shift.terminal_id}
          locationId={shift.location_id}
          cashierId={user?.id ?? ''}
          initialReceiptNo={pendingReturnReceiptNo}
          onClose={() => { setShowReturn(false); setPendingReturnReceiptNo(undefined); }}
          onReturned={() => {
            setShowReturn(false);
            setPendingReturnReceiptNo(undefined);
            setBalanceRefreshKey(key => key + 1);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showReceipt && lastSale && (
        <ReceiptModal
          saleId={lastSale.saleId}
          receiptNo={lastSale.receiptNo}
          deviceTimestamp={lastSale.deviceTimestamp}
          onClose={() => {
            setShowReceipt(false);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showHoldSlip && lastHeldSale && (
        <HoldSlipModal
          heldSaleId={lastHeldSale.heldSaleId}
          userId={user?.id ?? null}
          holdReference={lastHeldSale.holdReference}
          customerName={lastHeldSale.customerName}
          cashierName={lastHeldSale.cashierName}
          createdAt={lastHeldSale.createdAt}
          notes={lastHeldSale.notes}
          lines={lastHeldSale.lines}
          totalDue={lastHeldSale.totalDue}
          onClose={() => {
            setShowHoldSlip(false);
            setLastHeldSale(null);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}

      {showRecentSales && (
        <RecentSalesModal
          shiftId={shift.shift_id}
          onClose={() => setShowRecentSales(false)}
          onVoid={receiptNo => {
            setShowRecentSales(false);
            setPendingVoidReceiptNo(receiptNo);
            setShowVoidTxn(true);
          }}
          onReturn={receiptNo => {
            setShowRecentSales(false);
            setPendingReturnReceiptNo(receiptNo);
            setShowReturn(true);
          }}
        />
      )}

      {showCustomers && (
        <PosCustomerModal
          initialCustomer={currentCustomer}
          onClose={() => setShowCustomers(false)}
          onSelect={customer => {
            handleCustomerSelection(customer);
            setShowCustomers(false);
            window.setTimeout(() => searchInputRef.current?.focus(), 0);
          }}
        />
      )}
      {showZPrompt && (
        <ZReadingPromptModal
          onLater={() => {
            setShowZPrompt(false);
            navigate('/inventory/pos');
          }}
          onProceed={() => {
            setShowZPrompt(false);
            setShowZReading(true);
          }}
        />
      )}
    </div>
  );
}

export default PosSessionPage;
