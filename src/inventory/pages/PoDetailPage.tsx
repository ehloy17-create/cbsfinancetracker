import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Printer, Pencil, CheckCircle, XCircle,
  Package, AlertTriangle, Truck,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { PurchaseOrder, PurchaseOrderItem, PoStatus } from '../../lib/types';
import { PO_STATUS_LABELS, PO_STATUS_COLORS, formatCurrency, formatDate } from '../lib/poUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../../components/ConfirmDialog';

type PoFull = Omit<PurchaseOrder, 'inv_suppliers' | 'inv_locations' | 'creator' | 'approver'> & {
  inv_suppliers: { id: string; name: string; code: string; contact_person: string; phone: string; address: string; city: string };
  inv_locations: { id: string; name: string; code: string; address: string };
  creator: { name: string } | null;
  approver: { name: string } | null;
};

type ItemFull = Omit<PurchaseOrderItem, 'inv_products'> & {
  inv_products: {
    id: string; sku_code: string; name: string;
    inv_units?: { code: string } | null;
    inv_categories?: { name: string } | null;
  };
};

function formatQtyWithBase(displayQty: number, baseQty?: number | null, baseUnitCode?: string) {
  const display = displayQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  if (!baseQty || !baseUnitCode) return display;
  return `${display} (${Number(baseQty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${baseUnitCode})`;
}

function PoStatusBadge({ status }: { status: PoStatus }) {
  const c = PO_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {PO_STATUS_LABELS[status]}
    </span>
  );
}

export default function PoDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [po, setPo] = useState<PoFull | null>(null);
  const [items, setItems] = useState<ItemFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'cancel' | null>(null);

  const loadPo = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [poRes, itemsRes] = await Promise.all([
      supabase.from('purchase_orders').select('*').eq('id', id).maybeSingle(),
      supabase.from('purchase_order_items').select('*').eq('po_id', id).order('sort_order'),
    ]);

    if (poRes.error || !poRes.data) {
      showToast('Purchase order not found', 'error');
      navigate('/inventory/purchase-orders');
      return;
    }

    const purchaseOrder = poRes.data as PurchaseOrder & { approved_at?: string | null };
    const rawItems = (itemsRes.data ?? []) as Array<PurchaseOrderItem & { subtotal?: number }>;
    const productIds = [...new Set(rawItems.map((item) => item.product_id).filter(Boolean))];
    const profileIds = [...new Set([purchaseOrder.created_by, purchaseOrder.approved_by].filter(Boolean))] as string[];

    const [supplierRes, locationRes, productsRes, unitsRes, categoriesRes, profilesRes] = await Promise.all([
      supabase.from('inv_suppliers').select('id, name, code, contact_person, phone, address, city').eq('id', purchaseOrder.supplier_id).maybeSingle(),
      supabase.from('inv_locations').select('id, name, code, address').eq('id', purchaseOrder.location_id).maybeSingle(),
      productIds.length > 0
        ? supabase.from('inv_products').select('id, sku_code, name, unit_id, category_id').in('id', productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase.from('inv_units').select('id, code').order('code')
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase.from('inv_categories').select('id, name').order('name')
        : Promise.resolve({ data: [], error: null }),
      profileIds.length > 0
        ? supabase.from('profiles').select('id, name').in('id', profileIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const unitMap = new Map(((unitsRes.data ?? []) as Array<{ id: string; code: string }>).map((unit) => [unit.id, unit]));
    const categoryMap = new Map(((categoriesRes.data ?? []) as Array<{ id: string; name: string }>).map((category) => [category.id, category]));
    const productMap = new Map(
      ((productsRes.data ?? []) as Array<{ id: string; sku_code: string; name: string; unit_id?: string | null; category_id?: string | null }>)
        .map((product) => [
          product.id,
          {
            id: product.id,
            sku_code: product.sku_code,
            name: product.name,
            inv_units: product.unit_id ? { code: unitMap.get(product.unit_id)?.code ?? '' } : null,
            inv_categories: product.category_id ? { name: categoryMap.get(product.category_id)?.name ?? '' } : null,
          },
        ])
    );
    const profileMap = new Map(((profilesRes.data ?? []) as Array<{ id: string; name: string }>).map((profile) => [profile.id, profile]));

    setPo({
      ...purchaseOrder,
      approved_date: purchaseOrder.approved_at
        ? String(purchaseOrder.approved_at).slice(0, 10)
        : purchaseOrder.approved_date ?? '',
      subtotal: purchaseOrder.total_amount,
      discount_amount: 0,
      tax_amount: 0,
      other_charges: 0,
      terms: '',
      inv_suppliers: supplierRes.data ?? {
        id: purchaseOrder.supplier_id,
        name: 'Unknown supplier',
        code: '',
        contact_person: '',
        phone: '',
        address: '',
        city: '',
      },
      inv_locations: locationRes.data ?? {
        id: purchaseOrder.location_id,
        name: 'Unknown location',
        code: '',
        address: '',
      },
      creator: purchaseOrder.created_by ? { name: profileMap.get(purchaseOrder.created_by)?.name ?? '—' } : null,
      approver: purchaseOrder.approved_by ? { name: profileMap.get(purchaseOrder.approved_by)?.name ?? '—' } : null,
    } as unknown as PoFull);

    setItems(rawItems.map((item) => ({
      ...item,
      line_total: Number(item.subtotal ?? 0),
      inv_products: productMap.get(item.product_id) ?? {
        id: item.product_id,
        sku_code: '',
        name: 'Unknown product',
        inv_units: null,
        inv_categories: null,
      },
    })) as ItemFull[]);
    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => { void loadPo(); }, [loadPo]);

  async function handleStatusChange(newStatus: PoStatus) {
    if (!po) return;
    setActionLoading(true);

    const update: Record<string, string | null> = {
      status: newStatus,
    };

    if (newStatus === 'approved') {
      update.approved_at = new Date().toISOString();
      update.approved_by = user?.id ?? null;
    }

    const { error } = await supabase
      .from('purchase_orders')
      .update(update)
      .eq('id', po.id);

    if (error) {
      showToast('Failed to update status', 'error');
    } else {
      showToast(`PO ${PO_STATUS_LABELS[newStatus]}`, 'success');
      await loadPo();
    }
    setActionLoading(false);
    setConfirmAction(null);
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="flex flex-col items-center gap-3">
          <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
          <p className="text-sm text-slate-400">Loading...</p>
        </div>
      </div>
    );
  }

  if (!po) return null;

  const canEdit = po.status === 'draft';
  const canApprove = po.status === 'draft';
  const canCancel = ['draft', 'approved'].includes(po.status);

  const totalOrdered = items.reduce((s, i) => s + Number(i.qty_ordered), 0);
  const totalReceived = items.reduce((s, i) => s + Number(i.qty_received), 0);
  const totalRemaining = totalOrdered - totalReceived;

  return (
    <>
      {/* Screen layout */}
      <div className="p-6 print:hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/inventory/purchase-orders" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Purchase Orders
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono font-semibold text-slate-700">{po.po_number}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            {canEdit && (
              <Link
                to={`/inventory/purchase-orders/${po.id}/edit`}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Pencil className="w-4 h-4" />
                Edit
              </Link>
            )}
            {['approved', 'partially_received'].includes(po.status) && (
              <Link
                to={`/inventory/receivings/new?po=${po.id}`}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Truck className="w-4 h-4" />
                Receive Goods
              </Link>
            )}
            {canApprove && (
              <button
                onClick={() => setConfirmAction('approve')}
                disabled={actionLoading || items.length === 0}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
            )}
            {canCancel && (
              <button
                onClick={() => setConfirmAction('cancel')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <XCircle className="w-4 h-4" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* PO Header Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Purchase Order</p>
              <h1 className="text-2xl font-bold text-slate-800 font-mono">{po.po_number}</h1>
            </div>
            <PoStatusBadge status={po.status} />
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-slate-100">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Supplier</p>
              <p className="text-sm font-semibold text-slate-800">{po.inv_suppliers.name}</p>
              <p className="text-xs text-slate-400 font-mono">{po.inv_suppliers.code}</p>
              {po.inv_suppliers.contact_person && <p className="text-xs text-slate-500 mt-0.5">{po.inv_suppliers.contact_person}</p>}
              {po.inv_suppliers.phone && <p className="text-xs text-slate-500">{po.inv_suppliers.phone}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Deliver To</p>
              <p className="text-sm font-semibold text-slate-800">{po.inv_locations.name}</p>
              <p className="text-xs text-slate-400 font-mono">{po.inv_locations.code}</p>
              {po.inv_locations.address && <p className="text-xs text-slate-500 mt-0.5">{po.inv_locations.address}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Dates</p>
              <p className="text-xs text-slate-600"><span className="font-medium">Order:</span> {formatDate(po.order_date)}</p>
              {po.expected_date && <p className="text-xs text-slate-600"><span className="font-medium">Expected:</span> {formatDate(po.expected_date)}</p>}
              {po.approved_date && <p className="text-xs text-slate-600"><span className="font-medium">Approved:</span> {formatDate(po.approved_date)}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Created By</p>
              <p className="text-sm text-slate-600">{po.creator?.name ?? '—'}</p>
              {po.approver && <p className="text-xs text-slate-500 mt-0.5">Approved by: {po.approver.name}</p>}
            </div>
          </div>

          {po.notes && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
              <p className="text-sm text-slate-600">{po.notes}</p>
            </div>
          )}
        </div>

        {/* Receiving summary */}
        {['approved', 'partially_received', 'fully_received'].includes(po.status) && (
          <div className="grid grid-cols-3 gap-4 mb-4">
            {[
              { label: 'Total Ordered', value: totalOrdered, color: 'text-slate-800' },
              { label: 'Total Received', value: totalReceived, color: 'text-emerald-700' },
              { label: 'Remaining', value: totalRemaining, color: totalRemaining > 0 ? 'text-amber-700' : 'text-slate-400' },
            ].map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-2xl font-bold tabular-nums ${color}`}>{value.toLocaleString()}</p>
              </div>
            ))}
          </div>
        )}

        {/* Items Table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-slate-100">
            <h2 className="text-sm font-semibold text-slate-700 flex items-center gap-2">
              <Package className="w-4 h-4 text-slate-400" />
              Line Items ({items.length})
            </h2>
          </div>

          {items.length === 0 ? (
            <div className="py-12 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No items on this purchase order.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Ordered</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Received</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Remaining</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Unit Cost</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Line Total</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => {
                    const remaining = Number(item.qty_ordered) - Number(item.qty_received);
                    const fullyReceived = remaining <= 0;
                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{item.inv_products.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="text-xs font-mono text-slate-400">{item.inv_products.sku_code}</span>
                            <span className="text-xs text-slate-400">{item.purchase_unit_name ?? item.inv_products.inv_units?.code ?? 'unit'}</span>
                            {item.inv_products.inv_categories && <span className="text-xs text-slate-400">{item.inv_products.inv_categories.name}</span>}
                          </div>
                          {(item.qty_in_base_unit_per_purchase ?? 1) !== 1 && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              1 {item.purchase_unit_name ?? item.inv_products.inv_units?.code ?? 'unit'} = {Number(item.qty_in_base_unit_per_purchase ?? 1).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {item.inv_products.inv_units?.code ?? 'base'}
                            </p>
                          )}
                          {item.notes && <p className="text-xs text-slate-400 italic mt-0.5">{item.notes}</p>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-700 font-medium">
                          {formatQtyWithBase(Number(item.qty_ordered), item.qty_ordered_in_base_unit, item.inv_products.inv_units?.code)}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-medium ${Number(item.qty_received) > 0 ? 'text-emerald-700' : 'text-slate-400'}`}>
                            {formatQtyWithBase(Number(item.qty_received), item.qty_received_in_base_unit, item.inv_products.inv_units?.code)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={`font-medium ${fullyReceived ? 'text-slate-300 line-through' : 'text-amber-700'}`}>
                            {formatQtyWithBase(remaining, Number(item.qty_ordered_in_base_unit ?? 0) - Number(item.qty_received_in_base_unit ?? 0), item.inv_products.inv_units?.code)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          <div>{formatCurrency(Number(item.unit_cost))}</div>
                          {item.cost_per_base_unit ? (
                            <div className="text-[11px] text-slate-400">{formatCurrency(Number(item.cost_per_base_unit))} / {item.inv_products.inv_units?.code ?? 'base'}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-slate-800">
                          {formatCurrency(Number(item.line_total))}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        {/* Totals */}
        <div className="flex justify-end">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5 w-72">
            <div className="space-y-2 text-sm">
              <div className="flex justify-between text-slate-600">
                <span>Subtotal</span>
                <span className="tabular-nums">{formatCurrency(po.total_amount)}</span>
              </div>
              <div className="flex justify-between font-bold text-base text-slate-800 pt-2 border-t border-slate-200">
                <span>Total Amount</span>
                <span className="tabular-nums">{formatCurrency(po.total_amount)}</span>
              </div>
            </div>
          </div>
        </div>
      </div>

      {/* ===================== PRINT LAYOUT ===================== */}
      <div className="hidden print:block p-8 text-sm text-gray-900" ref={printRef}>
        {/* Header */}
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-300">
          <div>
            <h1 className="text-2xl font-bold text-gray-900 mb-1">PURCHASE ORDER</h1>
            <p className="font-mono text-lg font-semibold text-gray-700">{po.po_number}</p>
            <p className="text-sm text-gray-500 mt-1">Status: {PO_STATUS_LABELS[po.status]}</p>
          </div>
          <div className="text-right">
            <p className="text-sm"><span className="font-semibold">Order Date:</span> {formatDate(po.order_date)}</p>
            {po.expected_date && <p className="text-sm"><span className="font-semibold">Expected:</span> {formatDate(po.expected_date)}</p>}
            {po.approved_date && <p className="text-sm"><span className="font-semibold">Approved:</span> {formatDate(po.approved_date)}</p>}
          </div>
        </div>

        {/* Supplier + Location */}
        <div className="grid grid-cols-2 gap-8 mb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Supplier</p>
            <p className="font-bold">{po.inv_suppliers.name}</p>
            <p className="text-gray-600">{po.inv_suppliers.contact_person}</p>
            <p className="text-gray-600">{po.inv_suppliers.phone}</p>
            <p className="text-gray-600">{po.inv_suppliers.address}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Deliver To</p>
            <p className="font-bold">{po.inv_locations.name}</p>
            <p className="text-gray-600 font-mono text-xs">{po.inv_locations.code}</p>
            {po.inv_locations.address && <p className="text-gray-600">{po.inv_locations.address}</p>}
          </div>
        </div>

        {/* Items */}
        <table className="w-full border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="py-2 text-left text-xs font-bold uppercase tracking-wider text-gray-500 w-8">#</th>
              <th className="py-2 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Product</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-24">Qty</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-28">Unit Cost</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-32">Total</th>
            </tr>
          </thead>
          <tbody>
            {items.map((item, idx) => (
              <tr key={item.id} className="border-b border-gray-200">
                <td className="py-2 text-gray-500 text-xs">{idx + 1}</td>
                <td className="py-2">
                  <p className="font-medium">{item.inv_products.name}</p>
                  <p className="text-xs text-gray-500 font-mono">{item.inv_products.sku_code}</p>
                  <p className="text-xs text-gray-500">{item.purchase_unit_name ?? item.inv_products.inv_units?.code ?? 'unit'}</p>
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatQtyWithBase(Number(item.qty_ordered), item.qty_ordered_in_base_unit, item.inv_products.inv_units?.code)}
                </td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(Number(item.unit_cost))}
                  {item.cost_per_base_unit ? ` / ${formatCurrency(Number(item.cost_per_base_unit))} ${item.inv_products.inv_units?.code ?? 'base'}` : ''}
                </td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatCurrency(Number(item.line_total))}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {/* Totals */}
        <div className="flex justify-end mb-8">
          <div className="w-64">
            <div className="flex justify-between py-1 text-gray-600"><span>Subtotal</span><span>{formatCurrency(po.total_amount)}</span></div>
            <div className="flex justify-between py-2 border-t-2 border-gray-300 font-bold text-base mt-1">
              <span>TOTAL</span>
              <span>{formatCurrency(po.total_amount)}</span>
            </div>
          </div>
        </div>

        {/* Notes & Signatures */}
        {po.notes && (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Notes</p>
            <p className="text-gray-700">{po.notes}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-8 mt-12">
          {['Prepared By', 'Approved By', 'Received By'].map(label => (
            <div key={label} className="text-center">
              <div className="border-b border-gray-400 mb-1 h-8" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm Dialogs */}
      <ConfirmDialog
        open={confirmAction === 'approve'}
        title="Approve Purchase Order"
        message={`Approve ${po.po_number}? This will allow goods receiving against this PO.`}
        confirmLabel="Approve"
        onConfirm={() => handleStatusChange('approved')}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="Cancel Purchase Order"
        message={`Cancel ${po.po_number}? This action cannot be undone.`}
        confirmLabel="Cancel PO"
        onConfirm={() => handleStatusChange('cancelled')}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}

