import { useState, useEffect, useCallback, useMemo, useRef } from 'react';
import { Pencil, Trash2, Filter, ToggleLeft, ToggleRight, Download, Package } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvProduct, InvProductPricingHistory, InvProductSellingUnit } from '../../lib/types';
import { fetchProductUnitBundles } from '../../lib/productUnits';
import { downloadCSV, formatCurrency, formatDateTime, getTodayDateString, objectsToCSV } from '../../lib/utils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import InvPageHeader from '../components/InvPageHeader';
import InvTable from '../components/InvTable';
import InvModal from '../components/InvModal';
import StatusBadge from '../components/StatusBadge';
import { useInvRefs } from '../hooks/useInvData';

const PAGE_SIZE = 50;
const DEBOUNCE_MS = 300;

interface ProductRow extends InvProduct {
  category_name?: string;
  brand_name?: string;
  unit_code?: string;
  supplier_name?: string;
  qty_on_hand?: number;
  qty_available?: number;
}

interface ProductFormState {
  sku_code: string;
  barcode: string;
  barcode2: string;
  name: string;
  category_id: string;
  brand_id: string;
  supplier_id: string;
  unit_id: string;
  default_cost: string;
  retail_price: string;
  wholesale_price: string;
  wholesale_quantity: string;
  special_price: string;
  reorder_point: string;
  is_expiry_tracked: boolean;
  is_active: boolean;
  description: string;
}

const EMPTY_FORM: ProductFormState = {
  sku_code: '',
  barcode: '',
  barcode2: '',
  name: '',
  category_id: '',
  brand_id: '',
  supplier_id: '',
  unit_id: '',
  default_cost: '',
  retail_price: '',
  wholesale_price: '',
  wholesale_quantity: '',
  special_price: '',
  reorder_point: '0',
  is_expiry_tracked: false,
  is_active: true,
  description: '',
};

function unitLabel(unit?: { code?: string; name?: string } | null) {
  if (!unit) return '—';
  const code = String(unit.code ?? '').trim();
  const name = String(unit.name ?? '').trim();
  if (code && name) return `${code} - ${name}`;
  return code || name || '—';
}

function toFormNumber(value: number | null | undefined) {
  if (value == null || Number.isNaN(Number(value))) return '';
  return String(value);
}

function toNonNegativeNumber(value: string) {
  const parsed = Number(value || 0);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

function formatHistoryChange(oldValue: number | null, newValue: number | null) {
  const from = oldValue == null ? '—' : formatCurrency(oldValue);
  const to = newValue == null ? '—' : formatCurrency(newValue);
  return `${from} -> ${to}`;
}

export default function InvProductsPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const { categories, brands, units, suppliers, locations } = useInvRefs();

  const [products, setProducts] = useState<ProductRow[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [searchInput, setSearchInput] = useState('');
  const [search, setSearch] = useState('');
  const [filterActive, setFilterActive] = useState<'all' | 'active' | 'inactive'>('active');
  const [filterCategory, setFilterCategory] = useState('');
  const [loading, setLoading] = useState(true);
  const [showFilter, setShowFilter] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [stockBalanceTab, setStockBalanceTab] = useState<'all' | 'with-balance' | 'zero-negative'>('all');

  const [modalOpen, setModalOpen] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<ProductFormState>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);
  const [deleteId, setDeleteId] = useState<string | null>(null);
  const [togglingId, setTogglingId] = useState<string | null>(null);
  const [historyRows, setHistoryRows] = useState<InvProductPricingHistory[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);

  const [quickAdjustOpen, setQuickAdjustOpen] = useState(false);
  const [quickAdjustProduct, setQuickAdjustProduct] = useState<ProductRow | null>(null);
  const [quickAdjustLocationId, setQuickAdjustLocationId] = useState('');
  const [quickAdjustCurrentQty, setQuickAdjustCurrentQty] = useState(0);
  const [quickAdjustNewQty, setQuickAdjustNewQty] = useState('0');
  const [quickAdjustNotes, setQuickAdjustNotes] = useState('');
  const [quickAdjustLoading, setQuickAdjustLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  function handleSearchChange(value: string) {
    setSearchInput(value);
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => setSearch(value), DEBOUNCE_MS);
  }

  function getCost(product: Pick<ProductRow, 'default_cost' | 'cost_price'>) {
    return Number(product.default_cost ?? product.cost_price ?? 0);
  }

  function getRetailPrice(product: Pick<ProductRow, 'retail_price' | 'selling_price'>) {
    return Number(product.retail_price ?? product.selling_price ?? 0);
  }

  function hasInvalidRetailMargin(product: Pick<ProductRow, 'default_cost' | 'cost_price' | 'retail_price' | 'selling_price'>) {
    return getRetailPrice(product) <= getCost(product);
  }

  const fetchProducts = useCallback(async () => {
    setLoading(true);
    const { data, error } = await supabase.rpc('search_products', {
      search,
      filter_active: filterActive,
      filter_category: filterCategory,
      page,
      page_size: PAGE_SIZE,
    });

    if (error) {
      console.error('fetchProducts error:', error);
      showToast(`Failed to load products: ${error.message || 'Unknown error'}`, 'error');
      setLoading(false);
      return;
    }

    const payload = (data ?? {}) as { products?: ProductRow[]; total?: number };
    const baseProducts = payload.products ?? [];
    const productIds = baseProducts.map(product => product.id).filter(Boolean);

    let qtyMap = new Map<string, number>();
    if (productIds.length > 0) {
      const { data: balanceRows } = await supabase
        .from('inventory_balances')
        .select('product_id, qty_on_hand')
        .in('product_id', productIds);

      qtyMap = new Map<string, number>();
      for (const row of balanceRows ?? []) {
        const productId = String(row.product_id ?? '');
        qtyMap.set(productId, Number(qtyMap.get(productId) ?? 0) + Number(row.qty_on_hand ?? 0));
      }
    }

    setProducts(baseProducts.map(product => {
      const qtyOnHand = Number(qtyMap.get(product.id) ?? 0);
      return {
        ...product,
        qty_on_hand: qtyOnHand,
        qty_available: qtyOnHand,
      };
    }));
    setTotal(payload.total ?? 0);
    setLoading(false);
  }, [filterActive, filterCategory, page, search, showToast]);

  const handleExportProducts = useCallback(async () => {
    setExporting(true);
    try {
      const exportedProducts: ProductRow[] = [];
      let exportPage = 1;
      let expectedTotal = 0;

      while (true) {
        const { data, error } = await supabase.rpc('search_products', {
          search,
          filter_active: filterActive,
          filter_category: filterCategory,
          page: exportPage,
          page_size: 500,
        });

        if (error) throw error;

        const payload = (data ?? {}) as { products?: ProductRow[]; total?: number };
        const pageRows = payload.products ?? [];
        expectedTotal = Number(payload.total ?? expectedTotal ?? pageRows.length);
        exportedProducts.push(...pageRows);

        if (pageRows.length === 0 || exportedProducts.length >= expectedTotal) {
          break;
        }

        exportPage += 1;
      }

      const productIds = exportedProducts.map(product => product.id).filter(Boolean);
      let qtyMap = new Map<string, number>();
      if (productIds.length > 0) {
        const { data: balanceRows } = await supabase
          .from('inventory_balances')
          .select('product_id, qty_on_hand')
          .in('product_id', productIds);

        for (const row of balanceRows ?? []) {
          const productId = String(row.product_id ?? '');
          qtyMap.set(productId, Number(qtyMap.get(productId) ?? 0) + Number(row.qty_on_hand ?? 0));
        }
      }

      const exportRows = exportedProducts.map(product => ({
        SKU: product.sku_code,
        Name: product.name,
        Category: product.category_name ?? '',
        Brand: product.brand_name ?? '',
        Supplier: product.supplier_name ?? '',
        Unit: product.unit_code ?? '',
        QtyOnHand: Number(qtyMap.get(product.id) ?? 0),
        Cost: Number(product.default_cost ?? product.cost_price ?? 0),
        RetailPrice: Number(product.retail_price ?? product.selling_price ?? 0),
        WholesalePrice: Number(product.wholesale_price ?? 0),
        SpecialPrice: Number(product.special_price ?? 0),
        Status: product.is_active ? 'Active' : 'Inactive',
        UpdatedAt: formatDateTime(product.updated_at),
      }));

      downloadCSV(objectsToCSV(exportRows), `products_${getTodayDateString()}.csv`);
      showToast('Products exported for Excel', 'success');
    } catch (error) {
      const err = error as { message?: string };
      showToast(err.message ?? 'Failed to export products', 'error');
    } finally {
      setExporting(false);
    }
  }, [filterActive, filterCategory, search, showToast]);

  const loadHistory = useCallback(async (productId: string) => {
    setHistoryLoading(true);
    const { data, error } = await supabase
      .from('inv_product_pricing_history')
      .select('*')
      .eq('product_id', productId)
      .order('changed_at', { ascending: false })
      .limit(50);

    if (error) {
      setHistoryRows([]);
      setHistoryLoading(false);
      showToast('Failed to load product history', 'error');
      return;
    }

    setHistoryRows((data ?? []) as InvProductPricingHistory[]);
    setHistoryLoading(false);
  }, [showToast]);

  useEffect(() => { setPage(1); }, [search, filterActive, filterCategory, stockBalanceTab]);
  useEffect(() => { fetchProducts(); }, [fetchProducts]);

  useEffect(() => {
    if (!quickAdjustOpen || !quickAdjustProduct || !quickAdjustLocationId) return;

    let isMounted = true;
    (async () => {
      const { data } = await supabase
        .from('inventory_balances')
        .select('qty_on_hand')
        .eq('product_id', quickAdjustProduct.id)
        .eq('location_id', quickAdjustLocationId)
        .maybeSingle();

      if (!isMounted) return;
      const currentQty = Number(data?.qty_on_hand ?? 0);
      setQuickAdjustCurrentQty(currentQty);
      setQuickAdjustNewQty(String(currentQty));
    })();

    return () => { isMounted = false; };
  }, [quickAdjustLocationId, quickAdjustOpen, quickAdjustProduct]);

  function openAdd() {
    setEditId(null);
    setForm(EMPTY_FORM);
    setHistoryRows([]);
    setHistoryLoading(false);
    setModalOpen(true);
  }

  async function openEdit(product: ProductRow) {
    setEditId(product.id);
    const bundleMap = await fetchProductUnitBundles([product.id]);
    const bundle = bundleMap.get(product.id);
    const defaultSellingUnit =
      (bundle?.sellingUnits.find(unit => unit.is_default) ?? bundle?.sellingUnits[0] ?? null) as InvProductSellingUnit | null;

    setForm({
      sku_code: product.sku_code,
      barcode: product.barcode ?? '',
      barcode2: product.barcode2 ?? '',
      name: product.name,
      category_id: product.category_id ?? '',
      brand_id: product.brand_id ?? '',
      supplier_id: product.supplier_id ?? '',
      unit_id: product.base_unit_id ?? product.unit_id ?? '',
      default_cost: toFormNumber(product.default_cost ?? product.cost_price ?? 0),
      retail_price: toFormNumber(defaultSellingUnit?.retail_price ?? product.retail_price ?? product.selling_price ?? 0),
      wholesale_price: toFormNumber(defaultSellingUnit?.wholesale_price ?? product.wholesale_price ?? 0),
      wholesale_quantity: toFormNumber(defaultSellingUnit?.wholesale_break_qty_in_base_unit ?? 0),
      special_price: toFormNumber(defaultSellingUnit?.special_price ?? product.special_price ?? 0),
      reorder_point: toFormNumber(product.reorder_point ?? 0),
      is_expiry_tracked: !!product.is_expiry_tracked,
      is_active: !!product.is_active,
      description: product.description ?? '',
    });
    setModalOpen(true);
    void loadHistory(product.id);
  }

  async function handleSave() {
    if (!form.sku_code.trim() || !form.name.trim()) {
      showToast('SKU and product name are required', 'error');
      return;
    }
    if (!form.unit_id) {
      showToast('Unit is required', 'error');
      return;
    }

    const defaultCost = toNonNegativeNumber(form.default_cost);
    const retailPrice = toNonNegativeNumber(form.retail_price);
    const wholesalePrice = toNonNegativeNumber(form.wholesale_price);
    const wholesaleQuantity = toNonNegativeNumber(form.wholesale_quantity);
    const specialPrice = toNonNegativeNumber(form.special_price);

    if (retailPrice <= defaultCost) {
      showToast('Retail price must be greater than cost', 'error');
      return;
    }
    if ((wholesalePrice > 0 && wholesaleQuantity <= 0) || (wholesaleQuantity > 0 && wholesalePrice <= 0)) {
      showToast('Wholesale price and wholesale quantity must both be set', 'error');
      return;
    }

    setSaving(true);
    try {
      const { error } = await supabase.rpc('save_inventory_product', {
        product_id: editId,
        product: {
          sku_code: form.sku_code.trim(),
          barcode: form.barcode.trim(),
          barcode2: form.barcode2.trim(),
          name: form.name.trim(),
          category_id: form.category_id || null,
          brand_id: form.brand_id || null,
          supplier_id: form.supplier_id || null,
          unit_id: form.unit_id,
          default_cost: defaultCost,
          retail_price: retailPrice,
          wholesale_price: wholesalePrice,
          wholesale_quantity: wholesaleQuantity,
          special_price: specialPrice,
          reorder_point: toNonNegativeNumber(form.reorder_point),
          is_expiry_tracked: form.is_expiry_tracked,
          is_active: form.is_active,
          description: form.description.trim(),
          changed_by: user?.id ?? null,
          changed_by_name: profile?.name ?? user?.email ?? '',
        },
      });

      if (error) throw error;

      showToast(editId ? 'Product updated' : 'Product created', 'success');
      setModalOpen(false);
      setHistoryRows([]);
      await fetchProducts();
    } catch (error) {
      const err = error as { message?: string };
      showToast(err.message ?? 'Failed to save product', 'error');
    } finally {
      setSaving(false);
    }
  }

  function openQuickAdjust(product: ProductRow) {
    const firstLocationId = locations[0]?.id ?? '';
    setQuickAdjustProduct(product);
    setQuickAdjustLocationId(firstLocationId);
    setQuickAdjustCurrentQty(0);
    setQuickAdjustNewQty('0');
    setQuickAdjustNotes('');
    setQuickAdjustOpen(true);
  }

  function closeQuickAdjust() {
    setQuickAdjustOpen(false);
    setQuickAdjustProduct(null);
    setQuickAdjustLocationId('');
    setQuickAdjustCurrentQty(0);
    setQuickAdjustNewQty('0');
    setQuickAdjustNotes('');
  }

  async function handleQuickAdjustSave() {
    if (!quickAdjustProduct) return;
    if (!quickAdjustLocationId) {
      showToast('Please select a location', 'error');
      return;
    }

    const nextQty = Number(quickAdjustNewQty);
    if (!Number.isFinite(nextQty) || nextQty < 0) {
      showToast('New balance must be a valid non-negative number', 'error');
      return;
    }

    setQuickAdjustLoading(true);
    try {
      const { data, error } = await supabase.rpc('quick_adjust_inventory_balance', {
        product_id: quickAdjustProduct.id,
        location_id: quickAdjustLocationId,
        new_qty: nextQty,
        notes: quickAdjustNotes.trim(),
      });

      if (error) throw error;

      const payload = (data ?? {}) as { no_change?: boolean; adjustment_number?: string };
      if (payload.no_change) {
        showToast('No stock change detected', 'success');
      } else {
        showToast(payload.adjustment_number
          ? `Inventory updated and logged as ${payload.adjustment_number}`
          : 'Inventory balance updated', 'success');
      }

      closeQuickAdjust();
      await fetchProducts();
    } catch (error) {
      const err = error as { message?: string };
      showToast(err.message ?? 'Failed to update inventory balance', 'error');
    } finally {
      setQuickAdjustLoading(false);
    }
  }

  async function handleDelete() {
    if (!deleteId) return;
    const { error } = await supabase.from('inv_products').delete().eq('id', deleteId);
    setDeleteId(null);
    if (error) {
      showToast('Failed to delete product', 'error');
      return;
    }
    showToast('Product deleted', 'success');
    fetchProducts();
  }

  async function handleToggleStatus(product: ProductRow) {
    setTogglingId(product.id);
    const nextActive = !product.is_active;
    const { error } = await supabase
      .from('inv_products')
      .update({ is_active: nextActive ? 1 : 0, updated_at: new Date().toISOString() })
      .eq('id', product.id);

    if (error) {
      setTogglingId(null);
      showToast('Failed to update product status', 'error');
      return;
    }

    setProducts(current => current.map(item => (
      item.id === product.id
        ? { ...item, is_active: nextActive }
        : item
    )));
    setTogglingId(null);
    showToast(`Product marked as ${nextActive ? 'active' : 'inactive'}`, 'success');
  }

  const topCategories = categories.filter(c => !c.parent_id);
  const costValue = toNonNegativeNumber(form.default_cost);
  const retailValue = toNonNegativeNumber(form.retail_price);

  const filteredProducts = useMemo(() => {
    if (stockBalanceTab === 'with-balance') {
      return products.filter(product => Number(product.qty_on_hand ?? 0) > 0);
    }
    if (stockBalanceTab === 'zero-negative') {
      return products.filter(product => Number(product.qty_on_hand ?? 0) <= 0);
    }
    return products;
  }, [products, stockBalanceTab]);

  const withBalanceCount = products.filter(product => Number(product.qty_on_hand ?? 0) > 0).length;
  const zeroNegativeCount = products.filter(product => Number(product.qty_on_hand ?? 0) <= 0).length;

  const columns = [
    {
      key: 'sku_code',
      label: 'SKU',
      className: 'font-mono text-xs w-28',
      render: (p: ProductRow) => <span className="font-mono text-xs text-slate-600 bg-slate-100 px-1.5 py-0.5 rounded">{p.sku_code}</span>,
    },
    {
      key: 'name',
      label: 'Product Name',
      render: (p: ProductRow) => <p className="font-medium text-slate-800">{p.name}</p>,
    },
    {
      key: 'qty_on_hand',
      label: 'Current Balance',
      className: 'text-right min-w-44',
      render: (p: ProductRow) => {
        const qty = Number(p.qty_on_hand ?? 0);
        const isLow = Number(p.reorder_point ?? 0) > 0 && qty <= Number(p.reorder_point ?? 0);
        return (
          <div className="flex flex-col items-end gap-1">
            <div className="flex items-center gap-1.5">
              <Package className={`w-3.5 h-3.5 ${qty <= 0 ? 'text-red-500' : isLow ? 'text-amber-500' : 'text-emerald-500'}`} />
              <span className={`font-mono tabular-nums font-semibold ${qty <= 0 ? 'text-red-600' : isLow ? 'text-amber-700' : 'text-slate-800'}`}>
                {qty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </span>
              {p.unit_code && <span className="text-[11px] text-slate-400">{p.unit_code}</span>}
            </div>
            <button
              type="button"
              onClick={() => openQuickAdjust(p)}
              className="text-[11px] font-medium text-blue-600 hover:text-blue-700 hover:underline"
            >
              Quick edit stock
            </button>
          </div>
        );
      },
    },
    {
      key: 'cost',
      label: 'Cost',
      className: 'text-right',
      render: (p: ProductRow) => (
        <span className={`font-mono tabular-nums ${hasInvalidRetailMargin(p) ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
          {formatCurrency(getCost(p))}
        </span>
      ),
    },
    {
      key: 'retail_price',
      label: 'Retail',
      className: 'text-right',
      render: (p: ProductRow) => (
        <span className={`font-mono tabular-nums ${hasInvalidRetailMargin(p) ? 'font-semibold text-red-700' : 'text-slate-700'}`}>
          {formatCurrency(getRetailPrice(p))}
        </span>
      ),
    },
    {
      key: 'wholesale_price',
      label: 'Wholesale',
      className: 'text-right',
      render: (p: ProductRow) => <span className="font-mono tabular-nums text-slate-700">{formatCurrency(Number(p.wholesale_price ?? 0))}</span>,
    },
    {
      key: 'special_price',
      label: 'Special',
      className: 'text-right',
      render: (p: ProductRow) => <span className="font-mono tabular-nums text-slate-700">{formatCurrency(Number(p.special_price ?? 0))}</span>,
    },
    {
      key: 'is_active',
      label: 'Status',
      render: (p: ProductRow) => (
        <button
          type="button"
          disabled={togglingId === p.id}
          onClick={() => void handleToggleStatus(p)}
          className="rounded-full disabled:cursor-not-allowed disabled:opacity-60"
        >
          <StatusBadge active={p.is_active} activeLabel="Active" inactiveLabel="Inactive" />
        </button>
      ),
    },
    {
      key: 'actions',
      label: '',
      className: 'w-20',
      render: (p: ProductRow) => (
        <div className="flex items-center gap-1">
          <button onClick={() => { void openEdit(p); }} className="p-1.5 rounded-lg text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors">
            <Pencil className="w-3.5 h-3.5" />
          </button>
          <button onClick={() => setDeleteId(p.id)} className="p-1.5 rounded-lg text-slate-400 hover:text-red-500 hover:bg-red-50 transition-colors">
            <Trash2 className="w-3.5 h-3.5" />
          </button>
        </div>
      ),
    },
  ];

  return (
    <div className="p-6">
      <InvPageHeader
        title="Products"
        subtitle={`${total} product${total !== 1 ? 's' : ''} in catalog`}
        search={searchInput}
        onSearch={handleSearchChange}
        onAdd={openAdd}
        addLabel="Add Product"
        extra={(
          <div className="flex items-center gap-2">
            <button
              onClick={() => void handleExportProducts()}
              disabled={exporting || loading}
              className="flex items-center gap-2 px-3 py-2 text-sm border border-emerald-200 rounded-lg text-emerald-700 hover:bg-emerald-50 transition-colors disabled:opacity-60"
            >
              <Download className="w-4 h-4" />
              {exporting ? 'Exporting...' : 'Export Excel'}
            </button>
            <button
              onClick={() => setShowFilter(v => !v)}
              className={`flex items-center gap-2 px-3 py-2 text-sm border rounded-lg transition-colors ${showFilter ? 'bg-blue-50 border-blue-300 text-blue-700' : 'border-slate-200 text-slate-600 hover:bg-slate-50'}`}
            >
              <Filter className="w-4 h-4" />
              Filter
            </button>
          </div>
        )}
      />

      {showFilter && (
        <div className="flex flex-wrap gap-3 mb-4 p-4 bg-slate-50 rounded-lg border border-slate-200">
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Status</label>
            <select
              value={filterActive}
              onChange={e => setFilterActive(e.target.value as typeof filterActive)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="all">All</option>
              <option value="active">Active</option>
              <option value="inactive">Inactive</option>
            </select>
          </div>
          <div>
            <label className="block text-xs font-medium text-slate-500 mb-1">Category</label>
            <select
              value={filterCategory}
              onChange={e => setFilterCategory(e.target.value)}
              className="px-3 py-1.5 text-sm border border-slate-200 rounded-lg bg-white text-slate-700 focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">All Categories</option>
              {topCategories.map(c => (
                <option key={c.id} value={c.id}>{c.name}</option>
              ))}
            </select>
          </div>
        </div>
      )}

      <div className="mb-4 flex flex-wrap gap-2">
        <button
          onClick={() => setStockBalanceTab('all')}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${stockBalanceTab === 'all' ? 'bg-slate-800 text-white' : 'bg-slate-100 text-slate-700 hover:bg-slate-200'}`}
        >
          All Products ({products.length})
        </button>
        <button
          onClick={() => setStockBalanceTab('with-balance')}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${stockBalanceTab === 'with-balance' ? 'bg-emerald-600 text-white' : 'bg-emerald-50 text-emerald-700 hover:bg-emerald-100'}`}
        >
          With Balance ({withBalanceCount})
        </button>
        <button
          onClick={() => setStockBalanceTab('zero-negative')}
          className={`rounded-full px-4 py-2 text-sm font-semibold ${stockBalanceTab === 'zero-negative' ? 'bg-amber-500 text-white' : 'bg-amber-50 text-amber-700 hover:bg-amber-100'}`}
        >
          Zero / Negative ({zeroNegativeCount})
        </button>
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <InvTable
          columns={columns}
          data={filteredProducts}
          keyField="id"
          page={page}
          pageSize={PAGE_SIZE}
          total={stockBalanceTab === 'all' ? total : filteredProducts.length}
          onPageChange={setPage}
          loading={loading}
          emptyMessage={stockBalanceTab === 'zero-negative' ? 'No zero or negative stock products found.' : stockBalanceTab === 'with-balance' ? 'No products with available stock found.' : 'No products found. Add your first product to get started.'}
          rowClassName={product => hasInvalidRetailMargin(product)
            ? 'bg-red-50 hover:bg-red-100'
            : 'hover:bg-slate-50'}
        />
      </div>

      <InvModal open={modalOpen} onClose={() => setModalOpen(false)} title={editId ? 'Edit Product' : 'Add Product'} size="xl">
        <div className="p-6 space-y-6">
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">SKU / Item Code <span className="text-red-500">*</span></label>
              <input
                value={form.sku_code}
                onChange={e => setForm(f => ({ ...f, sku_code: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Barcode</label>
              <input
                value={form.barcode}
                onChange={e => setForm(f => ({ ...f, barcode: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Alternate Barcode</label>
              <input
                value={form.barcode2}
                onChange={e => setForm(f => ({ ...f, barcode2: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 font-mono"
              />
            </div>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Product Name <span className="text-red-500">*</span></label>
            <input
              value={form.name}
              onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Category</label>
              <select
                value={form.category_id}
                onChange={e => setForm(f => ({ ...f, category_id: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select Category —</option>
                {categories.map(c => (
                  <option key={c.id} value={c.id}>{c.parent_id ? `  ↳ ${c.name}` : c.name}</option>
                ))}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Brand</label>
              <select
                value={form.brand_id}
                onChange={e => setForm(f => ({ ...f, brand_id: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select Brand —</option>
                {brands.map(b => <option key={b.id} value={b.id}>{b.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Supplier</label>
              <select
                value={form.supplier_id}
                onChange={e => setForm(f => ({ ...f, supplier_id: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select Supplier —</option>
                {suppliers.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Unit / Selling Unit <span className="text-red-500">*</span></label>
              <select
                value={form.unit_id}
                onChange={e => setForm(f => ({ ...f, unit_id: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
              >
                <option value="">— Select Unit —</option>
                {units.map(u => <option key={u.id} value={u.id}>{unitLabel(u)}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Reorder Level</label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={form.reorder_point}
                onChange={e => setForm(f => ({ ...f, reorder_point: e.target.value }))}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
          </div>

          <div className="rounded-xl border border-slate-200">
            <div className="border-b border-slate-200 px-4 py-3">
              <h3 className="text-sm font-semibold text-slate-700">Cost & Price Setup</h3>
              <p className="text-xs text-slate-500">Only the three POS price modes are shown here. Saving will rebuild the default product pricing setup automatically.</p>
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 xl:grid-cols-5 gap-4 p-4">
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Cost</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.default_cost}
                  onChange={e => setForm(f => ({ ...f, default_cost: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Retail Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.retail_price}
                  onChange={e => setForm(f => ({ ...f, retail_price: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Wholesale Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.wholesale_price}
                  onChange={e => setForm(f => ({ ...f, wholesale_price: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Wholesale Qty</label>
                <input
                  type="number"
                  min="0"
                  step="0.001"
                  value={form.wholesale_quantity}
                  onChange={e => setForm(f => ({ ...f, wholesale_quantity: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
                <p className="mt-1 text-[11px] text-slate-500">Equivalent quantity for 1 wholesale pack in POS.</p>
              </div>
              <div>
                <label className="block text-xs font-semibold text-slate-600 mb-1">Special Price</label>
                <input
                  type="number"
                  min="0"
                  step="0.01"
                  value={form.special_price}
                  onChange={e => setForm(f => ({ ...f, special_price: e.target.value }))}
                  className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                />
              </div>
            </div>
          </div>

          {costValue > 0 && retailValue > 0 && retailValue > costValue && (
            <div className="flex items-center gap-4 px-4 py-2.5 bg-slate-50 rounded-lg text-sm">
              <span className="text-slate-500">Retail markup:</span>
              <span className="font-semibold text-emerald-600">
                {(((retailValue - costValue) / costValue) * 100).toFixed(1)}%
              </span>
              <span className="text-slate-400">|</span>
              <span className="text-slate-500">Gross profit:</span>
              <span className="font-semibold text-emerald-600">{formatCurrency(retailValue - costValue)}</span>
            </div>
          )}

          {retailValue <= costValue && (
            <div className="rounded-lg border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
              Retail price must be greater than cost before this product can be saved.
            </div>
          )}

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Description / Notes</label>
            <textarea
              value={form.description}
              onChange={e => setForm(f => ({ ...f, description: e.target.value }))}
              rows={2}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex items-center gap-6">
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button type="button" onClick={() => setForm(f => ({ ...f, is_expiry_tracked: !f.is_expiry_tracked }))}>
                {form.is_expiry_tracked ? <ToggleRight className="w-8 h-8 text-amber-500" /> : <ToggleLeft className="w-8 h-8 text-slate-300" />}
              </button>
              <span className="text-sm text-slate-700">Track Expiry Dates</span>
            </label>
            <label className="flex items-center gap-2 cursor-pointer select-none">
              <button type="button" onClick={() => setForm(f => ({ ...f, is_active: !f.is_active }))}>
                {form.is_active ? <ToggleRight className="w-8 h-8 text-emerald-500" /> : <ToggleLeft className="w-8 h-8 text-slate-300" />}
              </button>
              <span className="text-sm text-slate-700">Active</span>
            </label>
          </div>

          {editId && (
            <div className="rounded-xl border border-slate-200">
              <div className="border-b border-slate-200 px-4 py-3">
                <h3 className="text-sm font-semibold text-slate-700">Cost & Price History</h3>
                <p className="text-xs text-slate-500">Each cost or price update is recorded automatically.</p>
              </div>
              <div className="overflow-x-auto">
                {historyLoading ? (
                  <p className="px-4 py-4 text-sm text-slate-500">Loading history…</p>
                ) : historyRows.length === 0 ? (
                  <p className="px-4 py-4 text-sm text-slate-500">No cost or price changes recorded yet.</p>
                ) : (
                  <table className="min-w-full text-sm">
                    <thead className="bg-slate-50 text-slate-600">
                      <tr>
                        <th className="px-4 py-2 text-left font-semibold">Date</th>
                        <th className="px-4 py-2 text-left font-semibold">Changed By</th>
                        <th className="px-4 py-2 text-left font-semibold">Cost</th>
                        <th className="px-4 py-2 text-left font-semibold">Retail</th>
                        <th className="px-4 py-2 text-left font-semibold">Wholesale</th>
                        <th className="px-4 py-2 text-left font-semibold">Special</th>
                      </tr>
                    </thead>
                    <tbody>
                      {historyRows.map(row => (
                        <tr key={row.id} className="border-t border-slate-100">
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatDateTime(row.changed_at)}</td>
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{row.changed_by_name || row.changed_by || 'System'}</td>
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatHistoryChange(row.old_cost, row.new_cost)}</td>
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatHistoryChange(row.old_retail_price, row.new_retail_price)}</td>
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatHistoryChange(row.old_wholesale_price, row.new_wholesale_price)}</td>
                          <td className="px-4 py-2 text-slate-700 whitespace-nowrap">{formatHistoryChange(row.old_special_price, row.new_special_price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )}
              </div>
            </div>
          )}
        </div>

        <div className="flex justify-end gap-3 px-6 py-4 border-t border-slate-200 bg-slate-50">
          <button onClick={() => setModalOpen(false)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-white transition-colors">
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60 transition-colors"
          >
            {saving ? 'Saving...' : editId ? 'Update Product' : 'Add Product'}
          </button>
        </div>
      </InvModal>

      <InvModal open={quickAdjustOpen} onClose={closeQuickAdjust} title="Quick Edit Inventory Balance" size="md">
        <div className="p-6 space-y-5">
          <div>
            <p className="text-sm font-semibold text-slate-800">{quickAdjustProduct?.name ?? 'Product'}</p>
            <p className="text-xs text-slate-500 mt-1">
              Total balance across all locations: <span className="font-semibold text-slate-700">{Number(quickAdjustProduct?.qty_on_hand ?? 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</span>
            </p>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Location</label>
            <select
              value={quickAdjustLocationId}
              onChange={e => setQuickAdjustLocationId(e.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
            >
              <option value="">— Select Location —</option>
              {locations.map(location => (
                <option key={location.id} value={location.id}>{location.name}</option>
              ))}
            </select>
          </div>

          <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">Current Location Balance</label>
              <div className="px-3 py-2 rounded-lg border border-slate-200 bg-slate-50 text-sm font-mono text-slate-700">
                {quickAdjustCurrentQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
              </div>
            </div>
            <div>
              <label className="block text-xs font-semibold text-slate-600 mb-1">New Balance</label>
              <input
                type="number"
                min="0"
                step="0.001"
                value={quickAdjustNewQty}
                onChange={e => setQuickAdjustNewQty(e.target.value)}
                className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right font-mono"
              />
            </div>
          </div>

          <div className="rounded-lg border border-blue-100 bg-blue-50 px-4 py-3 text-sm text-blue-800">
            Change to post: <span className="font-semibold">{((Number(quickAdjustNewQty || 0) - quickAdjustCurrentQty) || 0).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}</span>
            <span className="text-blue-600"> &nbsp;This will create a posted inventory adjustment log automatically.</span>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-600 mb-1">Reason / Notes</label>
            <textarea
              rows={3}
              value={quickAdjustNotes}
              onChange={e => setQuickAdjustNotes(e.target.value)}
              placeholder="Optional note for this stock correction"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            />
          </div>

          <div className="flex justify-end gap-3">
            <button onClick={closeQuickAdjust} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button
              onClick={() => void handleQuickAdjustSave()}
              disabled={quickAdjustLoading}
              className="px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {quickAdjustLoading ? 'Saving...' : 'Update Balance'}
            </button>
          </div>
        </div>
      </InvModal>

      <InvModal open={!!deleteId} onClose={() => setDeleteId(null)} title="Delete Product" size="sm">
        <div className="p-6">
          <p className="text-sm text-slate-600 mb-6">Are you sure you want to delete this product? This action cannot be undone.</p>
          <div className="flex justify-end gap-3">
            <button onClick={() => setDeleteId(null)} className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50">
              Cancel
            </button>
            <button onClick={handleDelete} className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700">
              Delete
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
