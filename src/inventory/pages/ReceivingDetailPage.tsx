import { useState, useEffect, useRef, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import {
  ArrowLeft, Printer, CheckCircle, XCircle, Trash2,
  Package, AlertTriangle, Calendar, Clock,
} from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Receiving, ReceivingItem } from '../../lib/types';
import {
  RECV_STATUS_LABELS, RECV_STATUS_COLORS,
  formatDate, formatCurrency, daysUntilExpiry, expiryWarningLevel,
} from '../lib/receivingUtils';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import ConfirmDialog from '../../components/ConfirmDialog';
import { writeAuditLog } from '../../lib/audit';

type RecvFull = Omit<Receiving, 'inv_suppliers' | 'inv_locations' | 'purchase_orders' | 'creator' | 'poster'> & {
  inv_suppliers: { id: string; name: string; code: string; contact_person: string; phone: string };
  inv_locations: { id: string; name: string; code: string };
  purchase_orders: { id: string; po_number: string; order_date: string };
  creator: { name: string } | null;
  poster: { name: string } | null;
};

type ItemFull = Omit<ReceivingItem, 'inv_products'> & {
  inv_products: {
    id: string; sku_code: string; name: string;
    is_expiry_tracked: boolean;
    near_expiry_days: number;
    inv_units?: { code: string } | null;
  };
};

function formatQtyWithBase(displayQty: number, baseQty?: number | null, baseUnitCode?: string) {
  const display = displayQty.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 });
  if (!baseQty || !baseUnitCode) return display;
  return `${display} (${Number(baseQty).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })} ${baseUnitCode})`;
}

type ReceivingStatus = 'draft' | 'posted' | 'cancelled';

function RecvStatusBadge({ status }: { status: ReceivingStatus }) {
  const c = RECV_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {RECV_STATUS_LABELS[status]}
    </span>
  );
}

export default function ReceivingDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();
  const printRef = useRef<HTMLDivElement>(null);

  const [recv, setRecv] = useState<RecvFull | null>(null);
  const [items, setItems] = useState<ItemFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'post' | 'cancel' | 'delete' | null>(null);

  const loadData = useCallback(async () => {
    if (!id) return;
    setLoading(true);

    const [recvRes, itemsRes] = await Promise.all([
      supabase.from('receivings').select('*').eq('id', id).maybeSingle(),
      supabase.from('receiving_items').select('*').eq('receiving_id', id).order('sort_order'),
    ]);

    if (recvRes.error || !recvRes.data) {
      showToast('Receiving not found', 'error');
      navigate('/inventory/receivings');
      return;
    }

    const receiving = recvRes.data as Receiving;
    const receivingItems = (itemsRes.data ?? []) as ReceivingItem[];
    const productIds = [...new Set(receivingItems.map((item) => item.product_id).filter(Boolean))];
    const profileIds = [...new Set([receiving.created_by, receiving.posted_by].filter(Boolean))] as string[];

    const [supplierRes, locationRes, poRes, productsRes, unitsRes, profilesRes] = await Promise.all([
      supabase.from('inv_suppliers').select('id, name, code, contact_person, phone').eq('id', receiving.supplier_id).maybeSingle(),
      supabase.from('inv_locations').select('id, name, code').eq('id', receiving.location_id).maybeSingle(),
      supabase.from('purchase_orders').select('id, po_number, order_date').eq('id', receiving.po_id).maybeSingle(),
      productIds.length > 0
        ? supabase.from('inv_products').select('id, sku_code, name, is_expiry_tracked, near_expiry_days, unit_id').in('id', productIds)
        : Promise.resolve({ data: [], error: null }),
      productIds.length > 0
        ? supabase.from('inv_units').select('id, code')
        : Promise.resolve({ data: [], error: null }),
      profileIds.length > 0
        ? supabase.from('profiles').select('id, name').in('id', profileIds)
        : Promise.resolve({ data: [], error: null }),
    ]);

    const unitMap = new Map(((unitsRes.data ?? []) as Array<{ id: string; code: string }>).map((unit) => [unit.id, unit]));
    const profileMap = new Map(((profilesRes.data ?? []) as Array<{ id: string; name: string }>).map((profile) => [profile.id, profile]));
    const productMap = new Map(
      ((productsRes.data ?? []) as Array<{ id: string; sku_code: string; name: string; is_expiry_tracked: boolean; near_expiry_days: number; unit_id?: string | null }>)
        .map((product) => [
          product.id,
          {
            id: product.id,
            sku_code: product.sku_code,
            name: product.name,
            is_expiry_tracked: product.is_expiry_tracked,
            near_expiry_days: product.near_expiry_days,
            inv_units: product.unit_id ? { code: unitMap.get(product.unit_id)?.code ?? '' } : null,
          },
        ])
    );

    setRecv({
      ...receiving,
      admin_override: false,
      updated_by: null,
      inv_suppliers: supplierRes.data ?? { id: receiving.supplier_id, name: 'Unknown supplier', code: '', contact_person: '', phone: '' },
      inv_locations: locationRes.data ?? { id: receiving.location_id, name: 'Unknown location', code: '' },
      purchase_orders: poRes.data ?? { id: receiving.po_id, po_number: '—', order_date: '' },
      creator: receiving.created_by ? { name: profileMap.get(receiving.created_by)?.name ?? '—' } : null,
      poster: receiving.posted_by ? { name: profileMap.get(receiving.posted_by)?.name ?? '—' } : null,
    } as unknown as RecvFull);
    setItems(receivingItems.map((item) => ({
      ...item,
      qty_in_base_unit_per_purchase: Number(item.qty_in_base_unit_per_purchase ?? 1),
      qty_ordered: Number(item.qty_ordered ?? 0),
      qty_prev_received: Number(item.qty_prev_received ?? 0),
      qty_remaining: Number(item.qty_remaining ?? Math.max(Number(item.qty_ordered ?? 0) - Number(item.qty_prev_received ?? 0), 0)),
      qty_received: Number(item.qty_received ?? 0),
      qty_rejected: Number(item.qty_rejected ?? 0),
      qty_accepted: Number(item.qty_accepted ?? Math.max(Number(item.qty_received ?? 0) - Number(item.qty_rejected ?? 0), 0)),
      qty_received_in_base_unit: Number(item.qty_received_in_base_unit ?? 0),
      qty_accepted_in_base_unit: Number(item.qty_accepted_in_base_unit ?? ((Number(item.qty_accepted ?? Math.max(Number(item.qty_received ?? 0) - Number(item.qty_rejected ?? 0), 0))) * Number(item.qty_in_base_unit_per_purchase ?? 1))),
      qty_rejected_in_base_unit: Number(item.qty_rejected_in_base_unit ?? (Number(item.qty_rejected ?? 0) * Number(item.qty_in_base_unit_per_purchase ?? 1))),
      unit_cost_per_base: Number(item.unit_cost_per_base ?? 0),
      notes: item.notes ?? '',
      inv_products: productMap.get(item.product_id) ?? {
        id: item.product_id,
        sku_code: '',
        name: 'Unknown product',
        is_expiry_tracked: false,
        near_expiry_days: 90,
        inv_units: null,
      },
    })) as ItemFull[]);
    setLoading(false);
  }, [id, navigate, showToast]);

  useEffect(() => { void loadData(); }, [loadData]);

  async function handlePost() {
    if (!recv) return;
    if (actionLoading) return;
    setActionLoading(true);
    const { error } = await supabase.rpc('post_receiving', {
      p_receiving_id: recv.id,
      p_posted_by: user?.id,
    });
    if (error) {
      showToast(error.message, 'error');
    } else {
      await supabase.rpc('create_payable_from_receiving', {
        p_receiving_id: recv.id,
        p_created_by: user?.id,
      });
      showToast('Receiving posted. Inventory updated. Payable created.', 'success');
      await loadData();
    }
    setActionLoading(false);
    setConfirmAction(null);
  }

  async function handleCancel() {
    if (!recv) return;
    if (actionLoading) return;
    setActionLoading(true);
    const { error } = await supabase
      .from('receivings')
      .update({ status: 'cancelled', updated_at: new Date().toISOString() })
      .eq('id', recv.id);
    if (error) {
      showToast('Failed to cancel', 'error');
    } else {
      showToast('Receiving cancelled', 'success');
      await loadData();
    }
    setActionLoading(false);
    setConfirmAction(null);
  }

  async function handleDelete() {
    if (!recv) return;
    if (actionLoading) return;

    setActionLoading(true);
    const { error } = await supabase.rpc('delete_receiving', {
      p_receiving_id: recv.id,
    });

    if (error) {
      showToast(error.message || 'Failed to delete receiving', 'error');
      setActionLoading(false);
      return;
    }

    await writeAuditLog(user?.id ?? null, 'DELETE', 'Receivings', recv.id, {
      receiving_number: recv.receiving_number,
      status: recv.status,
    });

    showToast('Receiving deleted', 'success');
    setActionLoading(false);
    setConfirmAction(null);
    navigate('/inventory/receivings');
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

  if (!recv) return null;

  const canPost = recv.status === 'draft' && items.length > 0;
  const canCancel = recv.status === 'draft';
  const deleteMessage = recv.status === 'posted'
    ? `Delete ${recv.receiving_number}? This will remove the receiving, roll back stock and PO received quantities, and delete its unpaid payable. Deletion is blocked if stock has already been consumed or payments already exist.`
    : `Delete ${recv.receiving_number}? This will permanently remove the receiving entry.`;

  const totalAccepted = items.reduce((s, i) => s + Number(i.qty_accepted), 0);
  const totalRejected = items.reduce((s, i) => s + Number(i.qty_rejected), 0);

  const nearExpiryItems = items.filter(item => {
    if (!item.expiry_date) return false;
    const days = daysUntilExpiry(item.expiry_date);
    return expiryWarningLevel(days, item.inv_products.near_expiry_days ?? 90) !== 'ok';
  });

  return (
    <>
      <div className="p-6 print:hidden">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6">
          <div className="flex items-center gap-3">
            <Link to="/inventory/receivings" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Goods Receiving
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono font-semibold text-slate-700">{recv.receiving_number}</span>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={() => window.print()}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>
            {canPost && (
              <button
                onClick={() => setConfirmAction('post')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Post Receiving
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
            <button
              onClick={() => setConfirmAction('delete')}
              disabled={actionLoading}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 disabled:opacity-50 transition-colors"
            >
              <Trash2 className="w-4 h-4" />
              Delete
            </button>
          </div>
        </div>

        {/* Header Card */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
          <div className="flex items-start justify-between mb-4">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Goods Receiving</p>
              <h1 className="text-2xl font-bold text-slate-800 font-mono">{recv.receiving_number}</h1>
              <Link to={`/inventory/purchase-orders/${recv.purchase_orders.id}`} className="text-sm text-blue-600 hover:underline font-mono mt-0.5 block">
                PO: {recv.purchase_orders.po_number}
              </Link>
            </div>
            <div className="flex flex-col items-end gap-2">
              <RecvStatusBadge status={recv.status} />
            </div>
          </div>

          <div className="grid grid-cols-2 md:grid-cols-4 gap-6 pt-4 border-t border-slate-100">
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Supplier</p>
              <p className="text-sm font-semibold text-slate-800">{recv.inv_suppliers.name}</p>
              <p className="text-xs text-slate-400 font-mono">{recv.inv_suppliers.code}</p>
              {recv.inv_suppliers.contact_person && <p className="text-xs text-slate-500 mt-0.5">{recv.inv_suppliers.contact_person}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Received At</p>
              <p className="text-sm font-semibold text-slate-800">{recv.inv_locations.name}</p>
              <p className="text-xs text-slate-400 font-mono">{recv.inv_locations.code}</p>
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Dates</p>
              <p className="text-xs text-slate-600"><span className="font-medium">Received:</span> {formatDate(recv.receiving_date)}</p>
              {recv.posted_at && <p className="text-xs text-slate-600"><span className="font-medium">Posted:</span> {formatDate(recv.posted_at)}</p>}
            </div>
            <div>
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Reference</p>
              {recv.invoice_number && <p className="text-xs text-slate-600"><span className="font-medium">Invoice:</span> {recv.invoice_number}</p>}
              {recv.dr_number && <p className="text-xs text-slate-600"><span className="font-medium">DR:</span> {recv.dr_number}</p>}
              <p className="text-xs text-slate-500 mt-1">By: {recv.creator?.name ?? '—'}</p>
              {recv.poster && <p className="text-xs text-slate-500">Posted by: {recv.poster.name}</p>}
            </div>
          </div>

          {recv.remarks && (
            <div className="mt-4 pt-4 border-t border-slate-100">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Remarks</p>
              <p className="text-sm text-slate-600">{recv.remarks}</p>
            </div>
          )}
        </div>

        {/* Summary stats */}
        <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-4">
          {[
            { label: 'Items', value: items.length, color: 'text-slate-800' },
            { label: 'Total Accepted', value: totalAccepted.toLocaleString(), color: 'text-emerald-700' },
            { label: 'Total Rejected', value: totalRejected.toLocaleString(), color: totalRejected > 0 ? 'text-red-600' : 'text-slate-300' },
            { label: 'Near Expiry', value: nearExpiryItems.length, color: nearExpiryItems.length > 0 ? 'text-amber-700' : 'text-slate-300' },
          ].map(({ label, value, color }) => (
            <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-4 text-center">
              <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
              <p className={`text-2xl font-bold tabular-nums ${color}`}>{value}</p>
            </div>
          ))}
        </div>

        {/* Near-expiry warning */}
        {nearExpiryItems.length > 0 && (
          <div className="bg-amber-50 border border-amber-200 rounded-xl p-4 mb-4">
            <div className="flex items-start gap-3">
              <Clock className="w-4 h-4 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-semibold text-amber-800 mb-1">Near Expiry Warning</p>
                <div className="space-y-1">
                  {nearExpiryItems.map(item => {
                    const days = daysUntilExpiry(item.expiry_date!);
                    const level = expiryWarningLevel(days, item.inv_products.near_expiry_days ?? 90);
                    return (
                      <p key={item.id} className="text-xs text-amber-700">
                        <span className="font-medium">{item.inv_products.name}</span>
                        {level === 'expired'
                          ? <span className="text-red-600 font-semibold"> — EXPIRED ({formatDate(item.expiry_date)})</span>
                          : <span> — expires {formatDate(item.expiry_date)} ({days} day{days !== 1 ? 's' : ''} remaining)</span>
                        }
                      </p>
                    );
                  })}
                </div>
              </div>
            </div>
          </div>
        )}

        {/* Items table */}
        <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
          <div className="px-6 py-4 border-b border-slate-100 flex items-center gap-2">
            <Package className="w-4 h-4 text-slate-400" />
            <h2 className="text-sm font-semibold text-slate-700">Received Items ({items.length})</h2>
          </div>
          {items.length === 0 ? (
            <div className="py-12 text-center">
              <AlertTriangle className="w-8 h-8 text-amber-400 mx-auto mb-2" />
              <p className="text-sm text-slate-400">No items recorded.</p>
            </div>
          ) : (
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-slate-50 border-b border-slate-200">
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Ordered</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Prev Rcvd</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Remaining</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28 text-emerald-700">Accepted</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24 text-red-600">Rejected</th>
                    <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Unit Cost</th>
                    <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Expiry / Batch</th>
                  </tr>
                </thead>
                <tbody className="divide-y divide-slate-100">
                  {items.map((item, idx) => {
                    const expiryDays = item.expiry_date ? daysUntilExpiry(item.expiry_date) : null;
                    const expiryLevel = expiryDays !== null
                      ? expiryWarningLevel(expiryDays, item.inv_products.near_expiry_days ?? 90)
                      : null;

                    return (
                      <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                        <td className="px-4 py-3 text-xs text-slate-400">{idx + 1}</td>
                        <td className="px-4 py-3">
                          <p className="font-medium text-slate-800">{item.inv_products.name}</p>
                          <div className="flex items-center gap-2 mt-0.5">
                            <span className="font-mono text-xs text-slate-400">{item.inv_products.sku_code}</span>
                            <span className="text-xs text-slate-400">{item.purchase_unit_name ?? item.inv_products.inv_units?.code ?? 'unit'}</span>
                            {item.inv_products.is_expiry_tracked && (
                              <span className="text-xs text-amber-600 bg-amber-50 border border-amber-200 px-1.5 py-0.5 rounded">Expiry</span>
                            )}
                          </div>
                          {(item.qty_in_base_unit_per_purchase ?? 1) !== 1 && (
                            <p className="text-xs text-slate-500 mt-0.5">
                              1 {item.purchase_unit_name ?? item.inv_products.inv_units?.code ?? 'unit'} = {Number(item.qty_in_base_unit_per_purchase ?? 1).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 6 })} {item.inv_products.inv_units?.code ?? 'base'}
                            </p>
                          )}
                          {item.notes && <p className="text-xs text-slate-400 italic mt-0.5">{item.notes}</p>}
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatQtyWithBase(Number(item.qty_ordered), item.qty_ordered * Number(item.qty_in_base_unit_per_purchase ?? 1), item.inv_products.inv_units?.code)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-500">{formatQtyWithBase(Number(item.qty_prev_received), Number(item.qty_prev_received) * Number(item.qty_in_base_unit_per_purchase ?? 1), item.inv_products.inv_units?.code)}</td>
                        <td className="px-4 py-3 text-right tabular-nums text-amber-700">{formatQtyWithBase(Number(item.qty_remaining), Number(item.qty_remaining) * Number(item.qty_in_base_unit_per_purchase ?? 1), item.inv_products.inv_units?.code)}</td>
                        <td className="px-4 py-3 text-right tabular-nums font-semibold text-emerald-700">{formatQtyWithBase(Number(item.qty_accepted), item.qty_accepted_in_base_unit, item.inv_products.inv_units?.code)}</td>
                        <td className="px-4 py-3 text-right tabular-nums">
                          <span className={Number(item.qty_rejected) > 0 ? 'font-semibold text-red-600' : 'text-slate-300'}>
                            {formatQtyWithBase(Number(item.qty_rejected), item.qty_rejected_in_base_unit, item.inv_products.inv_units?.code)}
                          </span>
                        </td>
                        <td className="px-4 py-3 text-right tabular-nums text-slate-600">
                          <div>{formatCurrency(Number(item.unit_cost))}</div>
                          {item.unit_cost_per_base ? (
                            <div className="text-[11px] text-slate-400">{formatCurrency(Number(item.unit_cost_per_base))} / {item.inv_products.inv_units?.code ?? 'base'}</div>
                          ) : null}
                        </td>
                        <td className="px-4 py-3">
                          {item.expiry_date ? (
                            <div>
                              <div className={`flex items-center gap-1 text-xs ${
                                expiryLevel === 'expired' ? 'text-red-600 font-semibold' :
                                expiryLevel === 'near' ? 'text-amber-700 font-medium' :
                                'text-slate-600'
                              }`}>
                                <Calendar className="w-3 h-3" />
                                {formatDate(item.expiry_date)}
                              </div>
                              {expiryLevel === 'near' && expiryDays !== null && (
                                <p className="text-xs text-amber-600 mt-0.5">{expiryDays}d left</p>
                              )}
                              {expiryLevel === 'expired' && (
                                <p className="text-xs text-red-600 mt-0.5">Expired!</p>
                              )}
                              {item.batch_number && (
                                <p className="text-xs text-slate-400 mt-0.5 font-mono">{item.batch_number}</p>
                              )}
                            </div>
                          ) : (
                            <span className="text-xs text-slate-300">—</span>
                          )}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>
      </div>

      {/* ==================== PRINT LAYOUT ==================== */}
      <div className="hidden print:block p-8 text-sm text-gray-900" ref={printRef}>
        <div className="flex items-start justify-between mb-6 pb-4 border-b-2 border-gray-300">
          <div>
            <h1 className="text-2xl font-bold mb-1">GOODS RECEIVING REPORT</h1>
            <p className="font-mono text-lg font-semibold text-gray-700">{recv.receiving_number}</p>
            <p className="text-sm text-gray-500 mt-1">Status: {RECV_STATUS_LABELS[recv.status]}</p>
          </div>
          <div className="text-right">
            <p className="text-sm"><span className="font-semibold">Date:</span> {formatDate(recv.receiving_date)}</p>
            <p className="text-sm"><span className="font-semibold">PO:</span> {recv.purchase_orders.po_number}</p>
            {recv.invoice_number && <p className="text-sm"><span className="font-semibold">Invoice:</span> {recv.invoice_number}</p>}
            {recv.dr_number && <p className="text-sm"><span className="font-semibold">DR:</span> {recv.dr_number}</p>}
          </div>
        </div>

        <div className="grid grid-cols-2 gap-8 mb-6">
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Supplier</p>
            <p className="font-bold">{recv.inv_suppliers.name}</p>
            <p className="text-gray-600">{recv.inv_suppliers.contact_person}</p>
            <p className="text-gray-600">{recv.inv_suppliers.phone}</p>
          </div>
          <div>
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-2">Received At</p>
            <p className="font-bold">{recv.inv_locations.name}</p>
            <p className="text-gray-600 font-mono text-xs">{recv.inv_locations.code}</p>
          </div>
        </div>

        <table className="w-full border-collapse mb-6">
          <thead>
            <tr className="border-b-2 border-gray-300">
              <th className="py-2 text-left text-xs font-bold uppercase tracking-wider text-gray-500 w-8">#</th>
              <th className="py-2 text-left text-xs font-bold uppercase tracking-wider text-gray-500">Product</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-20">Ordered</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-22">Accepted</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-22">Rejected</th>
              <th className="py-2 text-right text-xs font-bold uppercase tracking-wider text-gray-500 w-28">Unit Cost</th>
              <th className="py-2 text-left text-xs font-bold uppercase tracking-wider text-gray-500 w-28">Expiry</th>
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
                <td className="py-2 text-right tabular-nums">{formatQtyWithBase(Number(item.qty_ordered), Number(item.qty_ordered) * Number(item.qty_in_base_unit_per_purchase ?? 1), item.inv_products.inv_units?.code)}</td>
                <td className="py-2 text-right tabular-nums font-semibold">{formatQtyWithBase(Number(item.qty_accepted), item.qty_accepted_in_base_unit, item.inv_products.inv_units?.code)}</td>
                <td className="py-2 text-right tabular-nums">{formatQtyWithBase(Number(item.qty_rejected), item.qty_rejected_in_base_unit, item.inv_products.inv_units?.code)}</td>
                <td className="py-2 text-right tabular-nums">
                  {formatCurrency(Number(item.unit_cost))}
                  {item.unit_cost_per_base ? ` / ${formatCurrency(Number(item.unit_cost_per_base))} ${item.inv_products.inv_units?.code ?? 'base'}` : ''}
                </td>
                <td className="py-2 text-xs">{item.expiry_date ? formatDate(item.expiry_date) : '—'}</td>
              </tr>
            ))}
          </tbody>
        </table>

        {recv.remarks && (
          <div className="mb-6">
            <p className="text-xs font-bold uppercase tracking-wider text-gray-500 mb-1">Remarks</p>
            <p className="text-gray-700">{recv.remarks}</p>
          </div>
        )}

        <div className="grid grid-cols-3 gap-8 mt-12">
          {['Received By', 'Inspected By', 'Approved By'].map(label => (
            <div key={label} className="text-center">
              <div className="border-b border-gray-400 mb-1 h-8" />
              <p className="text-xs font-semibold text-gray-500 uppercase tracking-wider">{label}</p>
            </div>
          ))}
        </div>
      </div>

      {/* Confirm dialogs */}
      <ConfirmDialog
        open={confirmAction === 'post'}
        title="Post Receiving"
        message={`Post ${recv.receiving_number}? This will update inventory balances and PO received quantities. This cannot be undone.`}
        confirmLabel="Post Receiving"
        onConfirm={handlePost}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="Cancel Receiving"
        message={`Cancel ${recv.receiving_number}? This will discard all entered data.`}
        confirmLabel="Cancel Receiving"
        onConfirm={handleCancel}
        onCancel={() => setConfirmAction(null)}
      />
      <ConfirmDialog
        open={confirmAction === 'delete'}
        title="Delete Receiving"
        message={deleteMessage}
        confirmLabel={actionLoading ? 'Deleting...' : 'Delete Receiving'}
        danger
        onConfirm={handleDelete}
        onCancel={() => {
          if (!actionLoading) setConfirmAction(null);
        }}
      />
    </>
  );
}

