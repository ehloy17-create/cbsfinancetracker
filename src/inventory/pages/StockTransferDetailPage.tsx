import { useState, useEffect, useRef } from 'react';
import { useParams, Link, useNavigate } from 'react-router-dom';
import { ArrowLeft, CreditCard as Edit2, CheckCircle, ArrowRightLeft, Package, Printer, AlertTriangle, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { StockTransfer, StockTransferItem } from '../../lib/types';
import {
  TRANSFER_STATUS_LABELS, TRANSFER_STATUS_COLORS,
  formatDate, formatQty, canApprove, canIssue, canReceive, canCancel, canEdit,
} from '../lib/transferUtils';
import ConfirmDialog from '../../components/ConfirmDialog';
import { useToast } from '../../contexts/ToastContext';
import { useAuth } from '../../contexts/AuthContext';

type TransferFull = StockTransfer & {
  source_location: { id: string; name: string; code: string };
  destination_location: { id: string; name: string; code: string };
  approver: { name: string } | null;
  issuer: { name: string } | null;
  creator: { name: string } | null;
};

type ItemFull = StockTransferItem & {
  inv_products: { id: string; sku_code: string; name: string; inv_units?: { code: string } | null };
};

type ReceiveState = Record<string, string>;

function StatusBadge({ status }: { status: StockTransfer['status'] }) {
  const c = TRANSFER_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1 rounded-full text-sm font-medium border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {TRANSFER_STATUS_LABELS[status]}
    </span>
  );
}

function VarianceBadge({ variance }: { variance: number }) {
  if (variance === 0) return <span className="text-xs text-slate-400">—</span>;
  if (variance > 0) return <span className="text-xs text-emerald-600 font-medium">+{formatQty(variance)}</span>;
  return <span className="text-xs text-red-600 font-medium">{formatQty(variance)}</span>;
}

export default function StockTransferDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { showToast } = useToast();
  const { user } = useAuth();
  const printRef = useRef<HTMLDivElement>(null);

  const [transfer, setTransfer] = useState<TransferFull | null>(null);
  const [items, setItems] = useState<ItemFull[]>([]);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [confirmAction, setConfirmAction] = useState<'approve' | 'issue' | 'cancel' | null>(null);
  const [receiveMode, setReceiveMode] = useState(false);
  const [receiveQtys, setReceiveQtys] = useState<ReceiveState>({});

  async function loadData() {
    if (!id) return;
    setLoading(true);

    const [txRes, itemsRes] = await Promise.all([
      supabase
        .from('stock_transfers')
        .select(`
          *,
          source_location:source_location_id(id, name, code),
          destination_location:destination_location_id(id, name, code),
          approver:approved_by(name),
          issuer:issued_by(name),
          creator:created_by(name)
        `)
        .eq('id', id)
        .maybeSingle(),
      supabase
        .from('stock_transfer_items')
        .select('*, inv_products(id, sku_code, name, inv_units(code))')
        .eq('transfer_id', id)
        .order('sort_order'),
    ]);

    if (!txRes.data) {
      showToast('Transfer not found', 'error');
      navigate('/inventory/transfers');
      return;
    }

    setTransfer(txRes.data as unknown as TransferFull);
    const itemData = (itemsRes.data ?? []) as unknown as ItemFull[];
    setItems(itemData);

    const defaultQtys: ReceiveState = {};
    itemData.forEach(item => {
      defaultQtys[item.id] = String(Number(item.qty_in_transit));
    });
    setReceiveQtys(defaultQtys);
    setLoading(false);
  }

  useEffect(() => { loadData(); }, [id]);

  async function handleApprove() {
    if (!transfer) return;
    setActionLoading(true);
    const { error } = await supabase.from('stock_transfers').update({
      status: 'approved',
      approved_by: user?.id,
      approved_at: new Date().toISOString(),
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq('id', transfer.id);
    setActionLoading(false);
    setConfirmAction(null);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Transfer approved', 'success');
    loadData();
  }

  async function handleIssue() {
    if (!transfer) return;
    setActionLoading(true);
    const { error } = await supabase.rpc('issue_stock_transfer', {
      p_transfer_id: transfer.id,
      p_issued_by: user?.id,
    });
    setActionLoading(false);
    setConfirmAction(null);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Stock issued. Transfer is now in transit.', 'success');
    loadData();
  }

  async function handleCancel() {
    if (!transfer) return;
    setActionLoading(true);
    const { error } = await supabase.from('stock_transfers').update({
      status: 'cancelled',
      updated_by: user?.id,
      updated_at: new Date().toISOString(),
    }).eq('id', transfer.id);
    setActionLoading(false);
    setConfirmAction(null);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Transfer cancelled', 'success');
    loadData();
  }

  async function handleReceive() {
    if (!transfer) return;
    const receiveItems = items
      .filter(item => Number(item.qty_in_transit) > 0)
      .map(item => ({
        transfer_item_id: item.id,
        qty_received: parseFloat(receiveQtys[item.id] ?? '0') || 0,
      }))
      .filter(r => r.qty_received > 0);

    if (receiveItems.length === 0) {
      showToast('Enter received quantities for at least one item', 'error');
      return;
    }

    setActionLoading(true);
    const { error } = await supabase.rpc('receive_stock_transfer', {
      p_transfer_id: transfer.id,
      p_receive_items: JSON.stringify(receiveItems),
      p_received_by: user?.id,
    });
    setActionLoading(false);
    if (error) { showToast(error.message, 'error'); return; }
    showToast('Stock received. Inventory updated.', 'success');
    setReceiveMode(false);
    loadData();
  }

  function handlePrint() {
    window.print();
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }
  if (!transfer) return null;

  const totalRequested = items.reduce((s, i) => s + Number(i.qty_requested), 0);
  const totalIssued = items.reduce((s, i) => s + Number(i.qty_issued), 0);
  const totalReceived = items.reduce((s, i) => s + Number(i.qty_received), 0);
  const totalInTransit = items.reduce((s, i) => s + Math.max(0, Number(i.qty_in_transit)), 0);

  return (
    <>
      {/* Print styles */}
      <style>{`
        @media print {
          body * { visibility: hidden; }
          #transfer-print-area, #transfer-print-area * { visibility: visible; }
          #transfer-print-area { position: fixed; top: 0; left: 0; width: 100%; }
          .no-print { display: none !important; }
        }
      `}</style>

      <div className="p-6 max-w-5xl">
        {/* Top bar */}
        <div className="flex items-center justify-between mb-6 no-print">
          <div className="flex items-center gap-3">
            <Link to="/inventory/transfers" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors">
              <ArrowLeft className="w-4 h-4" />
              Stock Transfers
            </Link>
            <span className="text-slate-300">/</span>
            <span className="font-mono font-semibold text-slate-700">{transfer.transfer_number}</span>
          </div>
          <div className="flex items-center gap-2">
            <button
              onClick={handlePrint}
              className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Printer className="w-4 h-4" />
              Print
            </button>

            {canEdit(transfer.status) && (
              <Link
                to={`/inventory/transfers/${transfer.id}/edit`}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
              >
                <Edit2 className="w-4 h-4" />
                Edit
              </Link>
            )}

            {canApprove(transfer.status) && (
              <button
                onClick={() => setConfirmAction('approve')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors"
              >
                <CheckCircle className="w-4 h-4" />
                Approve
              </button>
            )}

            {canIssue(transfer.status) && (
              <button
                onClick={() => setConfirmAction('issue')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-amber-600 text-white rounded-lg hover:bg-amber-700 transition-colors"
              >
                <ArrowRightLeft className="w-4 h-4" />
                Issue Stock
              </button>
            )}

            {canReceive(transfer.status) && !receiveMode && (
              <button
                onClick={() => setReceiveMode(true)}
                className="flex items-center gap-2 px-4 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors"
              >
                <Package className="w-4 h-4" />
                Receive Stock
              </button>
            )}

            {canCancel(transfer.status) && (
              <button
                onClick={() => setConfirmAction('cancel')}
                disabled={actionLoading}
                className="flex items-center gap-2 px-3 py-2 text-sm font-medium text-red-600 border border-red-200 rounded-lg hover:bg-red-50 transition-colors"
              >
                <X className="w-4 h-4" />
                Cancel
              </button>
            )}
          </div>
        </div>

        {/* Printable content */}
        <div id="transfer-print-area" ref={printRef}>
          {/* Header card */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-6 mb-4">
            <div className="flex items-start justify-between mb-4">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Stock Transfer</p>
                <h1 className="text-2xl font-bold text-slate-800 font-mono">{transfer.transfer_number}</h1>
              </div>
              <StatusBadge status={transfer.status} />
            </div>

            <div className="grid grid-cols-2 md:grid-cols-3 gap-6 pt-4 border-t border-slate-100">
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">From</p>
                <p className="text-sm font-semibold text-slate-800">{transfer.source_location.name}</p>
                <p className="text-xs text-slate-400 font-mono">{transfer.source_location.code}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">To</p>
                <p className="text-sm font-semibold text-slate-800">{transfer.destination_location.name}</p>
                <p className="text-xs text-slate-400 font-mono">{transfer.destination_location.code}</p>
              </div>
              <div>
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Transfer Date</p>
                <p className="text-sm font-medium text-slate-800">{formatDate(transfer.transfer_date)}</p>
                {transfer.expected_date && (
                  <p className="text-xs text-slate-500 mt-0.5">Expected: {formatDate(transfer.expected_date)}</p>
                )}
              </div>
              {transfer.creator && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Created By</p>
                  <p className="text-sm text-slate-700">{transfer.creator.name}</p>
                  <p className="text-xs text-slate-400">{formatDate(transfer.created_at)}</p>
                </div>
              )}
              {transfer.approver && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Approved By</p>
                  <p className="text-sm text-slate-700">{transfer.approver.name}</p>
                  <p className="text-xs text-slate-400">{formatDate(transfer.approved_at ?? '')}</p>
                </div>
              )}
              {transfer.issuer && (
                <div>
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Issued By</p>
                  <p className="text-sm text-slate-700">{transfer.issuer.name}</p>
                  <p className="text-xs text-slate-400">{formatDate(transfer.issued_at ?? '')}</p>
                </div>
              )}
              {transfer.notes && (
                <div className="col-span-full">
                  <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">Notes</p>
                  <p className="text-sm text-slate-600">{transfer.notes}</p>
                </div>
              )}
            </div>
          </div>

          {/* Summary cards */}
          <div className="grid grid-cols-4 gap-3 mb-4 no-print">
            {[
              { label: 'Items', value: items.length, color: 'text-slate-800' },
              { label: 'Total Requested', value: formatQty(totalRequested), color: 'text-slate-800' },
              { label: 'Total Issued', value: formatQty(totalIssued), color: totalIssued > 0 ? 'text-amber-700' : 'text-slate-300' },
              { label: 'In Transit', value: formatQty(totalInTransit), color: totalInTransit > 0 ? 'text-blue-700' : 'text-slate-300' },
              { label: 'Total Received', value: formatQty(totalReceived), color: totalReceived > 0 ? 'text-emerald-700' : 'text-slate-300' },
            ].slice(0, 4).map(({ label, value, color }) => (
              <div key={label} className="bg-white rounded-xl border border-slate-200 shadow-sm p-3 text-center">
                <p className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-1">{label}</p>
                <p className={`text-lg font-bold tabular-nums ${color}`}>{value}</p>
              </div>
            ))}
          </div>

          {/* Receive mode banner */}
          {receiveMode && (
            <div className="bg-emerald-50 border border-emerald-200 rounded-xl p-4 mb-4 flex items-center justify-between no-print">
              <div className="flex items-center gap-2">
                <Package className="w-4 h-4 text-emerald-600" />
                <p className="text-sm font-semibold text-emerald-800">Enter received quantities for each item below</p>
              </div>
              <div className="flex items-center gap-2">
                <button
                  onClick={() => {
                    const all: ReceiveState = {};
                    items.forEach(i => { all[i.id] = String(Number(i.qty_in_transit)); });
                    setReceiveQtys(all);
                  }}
                  className="text-xs font-medium text-emerald-700 hover:text-emerald-900 border border-emerald-300 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Fill All In-Transit
                </button>
                <button
                  onClick={() => setReceiveMode(false)}
                  className="text-xs font-medium text-slate-600 hover:text-slate-800 border border-slate-200 px-3 py-1.5 rounded-lg transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleReceive}
                  disabled={actionLoading}
                  className="flex items-center gap-1.5 text-xs font-medium bg-emerald-600 text-white px-4 py-1.5 rounded-lg hover:bg-emerald-700 disabled:opacity-50 transition-colors"
                >
                  <Package className="w-3.5 h-3.5" />
                  {actionLoading ? 'Processing...' : 'Confirm Receipt'}
                </button>
              </div>
            </div>
          )}

          {/* Items table */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-6 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Transfer Items ({items.length})</h2>
            </div>

            {items.length === 0 ? (
              <div className="py-12 text-center">
                <AlertTriangle className="w-8 h-8 text-slate-200 mx-auto mb-2" />
                <p className="text-sm text-slate-400">No items on this transfer</p>
              </div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-200">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Product</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">Requested</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Issued</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">In Transit</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-28">
                        {receiveMode ? 'Receive Qty' : 'Received'}
                      </th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-500 uppercase tracking-wider w-24">Variance</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map(item => {
                      const inTransit = Math.max(0, Number(item.qty_in_transit));
                      return (
                        <tr key={item.id} className="hover:bg-slate-50 transition-colors">
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800">{item.inv_products.name}</p>
                            <div className="flex items-center gap-2 mt-0.5">
                              <span className="font-mono text-xs text-slate-400">{item.inv_products.sku_code}</span>
                              {item.inv_products.inv_units?.code && (
                                <span className="text-xs text-slate-400">{item.inv_products.inv_units.code}</span>
                              )}
                            </div>
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums font-medium text-slate-700">
                            {formatQty(Number(item.qty_requested))}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums text-amber-700">
                            {Number(item.qty_issued) > 0 ? formatQty(Number(item.qty_issued)) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right tabular-nums">
                            {inTransit > 0 ? (
                              <span className="font-semibold text-blue-700">{formatQty(inTransit)}</span>
                            ) : (
                              <span className="text-slate-300">—</span>
                            )}
                          </td>
                          <td className="px-3 py-2 text-right">
                            {receiveMode && inTransit > 0 ? (
                              <input
                                type="number"
                                min="0"
                                max={inTransit}
                                step="0.001"
                                value={receiveQtys[item.id] ?? ''}
                                onChange={e => setReceiveQtys(prev => ({ ...prev, [item.id]: e.target.value }))}
                                className="w-24 px-2 py-1.5 text-sm border border-emerald-300 rounded-lg focus:outline-none focus:ring-2 focus:ring-emerald-500 text-right tabular-nums bg-emerald-50"
                              />
                            ) : (
                              <span className={`tabular-nums ${Number(item.qty_received) > 0 ? 'text-emerald-700 font-medium' : 'text-slate-300'}`}>
                                {Number(item.qty_received) > 0 ? formatQty(Number(item.qty_received)) : '—'}
                              </span>
                            )}
                          </td>
                          <td className="px-4 py-3 text-right">
                            <VarianceBadge variance={Number(item.qty_variance)} />
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{item.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  <tfoot>
                    <tr className="bg-slate-50 border-t-2 border-slate-200">
                      <td className="px-4 py-3 text-sm font-semibold text-slate-700">Totals</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-slate-800">{formatQty(totalRequested)}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-amber-700">{totalIssued > 0 ? formatQty(totalIssued) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-blue-700">{totalInTransit > 0 ? formatQty(totalInTransit) : '—'}</td>
                      <td className="px-4 py-3 text-right tabular-nums font-bold text-emerald-700">{totalReceived > 0 ? formatQty(totalReceived) : '—'}</td>
                      <td className="px-4 py-3 text-right">
                        <VarianceBadge variance={items.reduce((s, i) => s + Number(i.qty_variance), 0)} />
                      </td>
                      <td />
                    </tr>
                  </tfoot>
                </table>
              </div>
            )}
          </div>

          {/* Print footer */}
          <div className="hidden print:block mt-8 pt-8 border-t border-slate-200">
            <div className="grid grid-cols-3 gap-8">
              {['Prepared By', 'Approved By', 'Received By'].map(label => (
                <div key={label} className="text-center">
                  <div className="h-12 border-b border-slate-400 mb-1" />
                  <p className="text-xs text-slate-500">{label}</p>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

      <ConfirmDialog
        open={confirmAction === 'approve'}
        title="Approve Transfer"
        message={`Approve transfer ${transfer.transfer_number}? This allows stock to be issued from ${transfer.source_location.name}.`}
        confirmLabel="Approve"
        onConfirm={handleApprove}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'issue'}
        title="Issue Stock"
        message={`Issue stock for transfer ${transfer.transfer_number}? This will deduct quantities from ${transfer.source_location.name} and mark items as in-transit.`}
        confirmLabel="Issue Stock"
        onConfirm={handleIssue}
        onCancel={() => setConfirmAction(null)}
      />

      <ConfirmDialog
        open={confirmAction === 'cancel'}
        title="Cancel Transfer"
        message={`Cancel transfer ${transfer.transfer_number}? This cannot be undone.`}
        confirmLabel="Cancel Transfer"
        onConfirm={handleCancel}
        onCancel={() => setConfirmAction(null)}
      />
    </>
  );
}
