import { useState, useEffect, useCallback } from 'react';
import { useParams, useNavigate, Link } from 'react-router-dom';
import { ArrowLeft, CreditCard as Edit2, CheckCircle, XCircle, Send, FileCheck, AlertCircle, User, Calendar, MapPin, MessageSquare, Ban } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Adjustment, AdjustmentItem, AdjustmentStatus } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import {
  ADJUSTMENT_STATUS_LABELS,
  ADJUSTMENT_STATUS_COLORS,
  ADJUSTMENT_REASON_LABELS,
  DIRECTION_LABELS,
  canSubmitForApproval,
  canApprove,
  canReject,
  canPost,
  canCancel,
  canEdit,
  formatDate,
  formatQty,
  formatCurrency,
} from '../lib/adjustmentUtils';

function StatusBadge({ status }: { status: AdjustmentStatus }) {
  const c = ADJUSTMENT_STATUS_COLORS[status];
  return (
    <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-sm font-semibold border ${c.bg} ${c.text} ${c.border}`}>
      <span className={`w-2 h-2 rounded-full ${c.dot}`} />
      {ADJUSTMENT_STATUS_LABELS[status]}
    </span>
  );
}

function InfoRow({ icon: Icon, label, value }: { icon: React.ElementType; label: string; value: React.ReactNode }) {
  return (
    <div className="flex items-start gap-3">
      <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0 mt-0.5">
        <Icon className="w-4 h-4 text-slate-500" />
      </div>
      <div>
        <p className="text-xs text-slate-400 font-medium">{label}</p>
        <div className="text-sm font-medium text-slate-800 mt-0.5">{value}</div>
      </div>
    </div>
  );
}

export default function AdjustmentDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuth();
  const { showToast } = useToast();

  const [adjustment, setAdjustment] = useState<Adjustment | null>(null);
  const [items, setItems] = useState<AdjustmentItem[]>([]);
  const [movementMap, setMovementMap] = useState<Record<string, { qty_before: number; qty_change: number; qty_after: number }>>({});
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);

  const [showRejectModal, setShowRejectModal] = useState(false);
  const [rejectionReason, setRejectionReason] = useState('');

  const load = useCallback(async () => {
    if (!id) return;
    setLoading(true);
    const { data } = await supabase
      .from('adjustments')
      .select(`
        *,
        inv_locations(id, name, code),
        creator:created_by(name),
        approver:approved_by(name),
        rejector:rejected_by(name),
        poster:posted_by(name),
        adjustment_items(*, inv_products(id, name, sku_code, inv_units(code)))
      `)
      .eq('id', id)
      .maybeSingle();

    if (!data) { navigate('/inventory/adjustments'); return; }
    const adj = data as unknown as Adjustment & { adjustment_items: AdjustmentItem[] };
    const sortedItems = (adj.adjustment_items ?? []).sort((a: AdjustmentItem, b: AdjustmentItem) => a.sort_order - b.sort_order);

    setAdjustment(adj);
    setItems(sortedItems);

    const movementIds = sortedItems.map(item => item.movement_id).filter(Boolean) as string[];
    if (movementIds.length > 0) {
      const { data: movementRows } = await supabase
        .from('inventory_movements')
        .select('id, qty_before, qty_change, qty_after')
        .in('id', movementIds);

      const snapshots = Object.fromEntries((movementRows ?? []).map((row: { id: string; qty_before: number; qty_change: number; qty_after: number }) => [
        row.id,
        {
          qty_before: Number(row.qty_before ?? 0),
          qty_change: Number(row.qty_change ?? 0),
          qty_after: Number(row.qty_after ?? 0),
        },
      ]));
      setMovementMap(snapshots);
    } else {
      setMovementMap({});
    }

    setLoading(false);
  }, [id, navigate]);

  useEffect(() => { load(); }, [load]);

  async function handleSubmitForApproval() {
    if (!adjustment) return;
    setActionLoading(true);
    const { error } = await supabase
      .from('adjustments')
      .update({ status: 'pending_approval', updated_by: user?.id })
      .eq('id', adjustment.id);
    if (error) { showToast(error.message, 'error'); } else { showToast('Submitted for approval', 'success'); await load(); }
    setActionLoading(false);
  }

  async function handleApprove() {
    if (!adjustment) return;
    setActionLoading(true);
    const { error } = await supabase
      .from('adjustments')
      .update({
        status: 'approved',
        approved_by: user?.id,
        approved_at: new Date().toISOString(),
        updated_by: user?.id,
      })
      .eq('id', adjustment.id);
    if (error) { showToast(error.message, 'error'); } else { showToast('Adjustment approved', 'success'); await load(); }
    setActionLoading(false);
  }

  async function handleReject() {
    if (!adjustment || !rejectionReason.trim()) {
      showToast('Rejection reason is required', 'error');
      return;
    }
    setActionLoading(true);
    const { error } = await supabase
      .from('adjustments')
      .update({
        status: 'rejected',
        rejected_by: user?.id,
        rejected_at: new Date().toISOString(),
        rejection_reason: rejectionReason.trim(),
        updated_by: user?.id,
      })
      .eq('id', adjustment.id);
    if (error) { showToast(error.message, 'error'); } else {
      showToast('Adjustment rejected', 'success');
      setShowRejectModal(false);
      setRejectionReason('');
      await load();
    }
    setActionLoading(false);
  }

  async function handlePost() {
    if (!adjustment) return;
    setActionLoading(true);
    try {
      const movType = adjustment.direction === 'add' ? 'adjustment_add' : 'adjustment_deduct';
      const sign = adjustment.direction === 'add' ? 1 : -1;

      for (const item of items) {
        const { data: bal } = await supabase
          .from('inventory_balances')
          .select('qty_on_hand, qty_available')
          .eq('product_id', item.product_id)
          .eq('location_id', adjustment.location_id)
          .maybeSingle();

        const qtyBefore = bal?.qty_on_hand ?? 0;
        const qtyChange = item.qty * sign;
        const qtyAfter = qtyBefore + qtyChange;

        const { data: mov, error: movErr } = await supabase
          .from('inventory_movements')
          .insert({
            product_id: item.product_id,
            location_id: adjustment.location_id,
            movement_type: movType,
            qty_change: qtyChange,
            qty_before: qtyBefore,
            qty_after: qtyAfter,
            unit_cost: item.unit_cost,
            ref_number: adjustment.adjustment_number,
            notes: `${ADJUSTMENT_REASON_LABELS[adjustment.reason]} — ${adjustment.remarks}${item.notes ? ' | ' + item.notes : ''}`,
            created_by: user?.id ?? null,
          })
          .select('id')
          .single();

        if (movErr) throw movErr;

        if (bal) {
          await supabase
            .from('inventory_balances')
            .update({
              qty_on_hand: qtyAfter,
              qty_available: (bal.qty_available ?? qtyBefore) + qtyChange,
              last_movement_at: new Date().toISOString(),
              updated_at: new Date().toISOString(),
            })
            .eq('product_id', item.product_id)
            .eq('location_id', adjustment.location_id);
        } else {
          await supabase.from('inventory_balances').insert({
            product_id: item.product_id,
            location_id: adjustment.location_id,
            qty_on_hand: qtyAfter,
            qty_available: qtyAfter,
            last_movement_at: new Date().toISOString(),
          });
        }

        await supabase
          .from('adjustment_items')
          .update({ movement_id: mov.id })
          .eq('id', item.id);
      }

      await supabase.from('adjustments').update({
        status: 'posted',
        posted_by: user?.id,
        posted_at: new Date().toISOString(),
        updated_by: user?.id,
      }).eq('id', adjustment.id);

      showToast('Adjustment posted — inventory updated', 'success');
      await load();
    } catch (e: unknown) {
      const msg = e instanceof Error ? e.message : 'Failed to post';
      showToast(msg, 'error');
    } finally {
      setActionLoading(false);
    }
  }

  async function handleCancel() {
    if (!adjustment) return;
    if (!confirm('Cancel this adjustment? This cannot be undone.')) return;
    setActionLoading(true);
    const { error } = await supabase
      .from('adjustments')
      .update({ status: 'cancelled', updated_by: user?.id })
      .eq('id', adjustment.id);
    if (error) { showToast(error.message, 'error'); } else { showToast('Adjustment cancelled', 'success'); await load(); }
    setActionLoading(false);
  }

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center">
        <div className="w-7 h-7 border-2 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  if (!adjustment) return null;

  const loc = adjustment.inv_locations as unknown as { name: string; code: string } | undefined;
  const creator = adjustment.creator as unknown as { name: string } | undefined;
  const approver = adjustment.approver as unknown as { name: string } | undefined;
  const rejector = adjustment.rejector as unknown as { name: string } | undefined;
  const poster = adjustment.poster as unknown as { name: string } | undefined;

  return (
    <div className="p-6 max-w-5xl">
      {/* Header */}
      <div className="flex items-center gap-4 mb-6">
        <Link to="/inventory/adjustments" className="text-slate-400 hover:text-slate-600 transition-colors">
          <ArrowLeft className="w-5 h-5" />
        </Link>
        <div className="flex-1">
          <div className="flex items-center gap-3 flex-wrap">
            <h1 className="text-xl font-bold text-slate-800 font-mono">{adjustment.adjustment_number}</h1>
            <StatusBadge status={adjustment.status} />
            <span className={`inline-flex items-center gap-1 px-2.5 py-1 rounded-full text-xs font-semibold border ${
              adjustment.direction === 'add'
                ? 'bg-emerald-50 text-emerald-700 border-emerald-200'
                : 'bg-red-50 text-red-700 border-red-200'
            }`}>
              {DIRECTION_LABELS[adjustment.direction]}
            </span>
          </div>
          <p className="text-sm text-slate-500 mt-0.5">
            {ADJUSTMENT_REASON_LABELS[adjustment.reason]} &middot; {formatDate(adjustment.adjustment_date)}
          </p>
        </div>

        <div className="flex items-center gap-2 flex-wrap justify-end">
          {canEdit(adjustment.status) && (
            <Link
              to={`/inventory/adjustments/${adjustment.id}/edit`}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-slate-300 text-slate-700 rounded-lg hover:bg-slate-50 transition-colors"
            >
              <Edit2 className="w-4 h-4" />
              Edit
            </Link>
          )}
          {canSubmitForApproval(adjustment.status) && (
            <button
              onClick={handleSubmitForApproval}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 transition-colors disabled:opacity-50"
            >
              <Send className="w-4 h-4" />
              Submit for Approval
            </button>
          )}
          {canApprove(adjustment.status) && (
            <button
              onClick={handleApprove}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-emerald-600 text-white rounded-lg hover:bg-emerald-700 transition-colors disabled:opacity-50"
            >
              <CheckCircle className="w-4 h-4" />
              Approve
            </button>
          )}
          {canReject(adjustment.status) && (
            <button
              onClick={() => setShowRejectModal(true)}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 transition-colors disabled:opacity-50"
            >
              <XCircle className="w-4 h-4" />
              Reject
            </button>
          )}
          {canPost(adjustment.status) && (
            <button
              onClick={handlePost}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium bg-slate-800 text-white rounded-lg hover:bg-slate-900 transition-colors disabled:opacity-50"
            >
              {actionLoading ? (
                <div className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />
              ) : (
                <FileCheck className="w-4 h-4" />
              )}
              Post Adjustment
            </button>
          )}
          {canCancel(adjustment.status) && (
            <button
              onClick={handleCancel}
              disabled={actionLoading}
              className="flex items-center gap-1.5 px-3 py-2 text-sm font-medium border border-red-200 text-red-600 rounded-lg hover:bg-red-50 transition-colors disabled:opacity-50"
            >
              <Ban className="w-4 h-4" />
              Cancel
            </button>
          )}
        </div>
      </div>

      {/* Rejection notice */}
      {adjustment.status === 'rejected' && adjustment.rejection_reason && (
        <div className="mb-5 flex items-start gap-3 p-4 bg-red-50 border border-red-200 rounded-xl">
          <AlertCircle className="w-5 h-5 text-red-500 flex-shrink-0 mt-0.5" />
          <div>
            <p className="text-sm font-semibold text-red-700">Rejected</p>
            <p className="text-sm text-red-600 mt-0.5">{adjustment.rejection_reason}</p>
            {rejector && (
              <p className="text-xs text-red-400 mt-1">by {rejector.name} on {formatDate(adjustment.rejected_at)}</p>
            )}
          </div>
        </div>
      )}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-5">
        {/* Left: items table */}
        <div className="lg:col-span-2 space-y-5">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
            <div className="px-5 py-4 border-b border-slate-100">
              <h2 className="text-sm font-semibold text-slate-700">Products ({items.length})</h2>
            </div>
            {items.length === 0 ? (
              <div className="py-8 text-center text-sm text-slate-400">No items</div>
            ) : (
              <div className="overflow-x-auto">
                <table className="w-full text-sm">
                  <thead>
                    <tr className="bg-slate-50 border-b border-slate-100">
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">#</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Product</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Before</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Change</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">After</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Unit Cost</th>
                      <th className="px-4 py-3 text-right text-xs font-semibold text-slate-400 uppercase tracking-wider">Total</th>
                      <th className="px-4 py-3 text-left text-xs font-semibold text-slate-400 uppercase tracking-wider">Notes</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-100">
                    {items.map((item, i) => {
                      const product = item.inv_products as unknown as { name: string; sku_code: string; inv_units?: { code: string } } | undefined;
                      const total = item.unit_cost != null ? item.qty * item.unit_cost : null;
                      const snapshot = item.movement_id ? movementMap[item.movement_id] : undefined;
                      const qtyBefore = Number(snapshot?.qty_before ?? 0);
                      const qtyChange = Number(snapshot?.qty_change ?? (adjustment.direction === 'add' ? item.qty : -item.qty));
                      const qtyAfter = Number(snapshot?.qty_after ?? (qtyBefore + qtyChange));
                      return (
                        <tr key={item.id} className="hover:bg-slate-50">
                          <td className="px-4 py-3 text-xs text-slate-400">{i + 1}</td>
                          <td className="px-4 py-3">
                            <p className="font-medium text-slate-800">{product?.name}</p>
                            <p className="text-xs text-slate-400 font-mono">{product?.sku_code}</p>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-600 font-mono">{formatQty(qtyBefore)}</td>
                          <td className="px-4 py-3 text-right font-mono">
                            <span className={`font-semibold ${qtyChange >= 0 ? 'text-emerald-700' : 'text-red-700'}`}>
                              {qtyChange >= 0 ? '+' : ''}{formatQty(qtyChange)}
                            </span>
                            <span className="text-xs text-slate-400 ml-1">{product?.inv_units?.code}</span>
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 font-mono font-semibold">{formatQty(qtyAfter)}</td>
                          <td className="px-4 py-3 text-right text-slate-600 font-mono">
                            {item.unit_cost != null ? formatCurrency(item.unit_cost) : '—'}
                          </td>
                          <td className="px-4 py-3 text-right text-slate-700 font-mono font-medium">
                            {total != null ? formatCurrency(total) : '—'}
                          </td>
                          <td className="px-4 py-3 text-slate-500 text-xs">{item.notes || '—'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                  {items.some(i => i.unit_cost != null) && (
                    <tfoot>
                      <tr className="bg-slate-50 border-t border-slate-200">
                        <td colSpan={6} className="px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wider text-right">Total Value</td>
                        <td className="px-4 py-3 text-right font-mono font-bold text-slate-800">
                          {formatCurrency(items.reduce((s, i) => s + (i.unit_cost != null ? i.qty * i.unit_cost : 0), 0))}
                        </td>
                        <td />
                      </tr>
                    </tfoot>
                  )}
                </table>
              </div>
            )}
          </div>
        </div>

        {/* Right: details */}
        <div className="space-y-4">
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Details</h2>
            <div className="space-y-4">
              <InfoRow icon={MapPin} label="Location" value={loc ? `[${(loc as unknown as { code: string }).code}] ${loc.name}` : '—'} />
              <InfoRow icon={Calendar} label="Adjustment Date" value={formatDate(adjustment.adjustment_date)} />
              <InfoRow icon={AlertCircle} label="Reason" value={ADJUSTMENT_REASON_LABELS[adjustment.reason]} />
              <InfoRow icon={MessageSquare} label="Remarks" value={<span className="text-slate-600 font-normal">{adjustment.remarks || '—'}</span>} />
              <InfoRow icon={User} label="Created By" value={creator?.name ?? '—'} />
            </div>
          </div>

          {/* Workflow timeline */}
          <div className="bg-white rounded-xl border border-slate-200 shadow-sm p-5">
            <h2 className="text-xs font-semibold text-slate-400 uppercase tracking-wider mb-4">Workflow</h2>
            <div className="space-y-3">
              <WorkflowStep
                label="Created"
                done
                name={creator?.name}
                date={adjustment.created_at}
              />
              <WorkflowStep
                label="Submitted"
                done={['pending_approval', 'approved', 'posted', 'rejected'].includes(adjustment.status)}
                name={creator?.name}
                date={null}
              />
              <WorkflowStep
                label="Approved"
                done={['approved', 'posted'].includes(adjustment.status)}
                rejected={adjustment.status === 'rejected'}
                name={adjustment.status === 'rejected' ? rejector?.name : approver?.name}
                date={adjustment.status === 'rejected' ? adjustment.rejected_at : adjustment.approved_at}
              />
              <WorkflowStep
                label="Posted"
                done={adjustment.status === 'posted'}
                name={poster?.name}
                date={adjustment.posted_at}
              />
            </div>
          </div>
        </div>
      </div>

      {/* Reject Modal */}
      {showRejectModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-center justify-center p-4">
          <div className="bg-white rounded-2xl shadow-2xl w-full max-w-md p-6">
            <h3 className="text-base font-bold text-slate-800 mb-1">Reject Adjustment</h3>
            <p className="text-sm text-slate-500 mb-4">Provide a reason for rejecting this adjustment.</p>
            <textarea
              value={rejectionReason}
              onChange={e => setRejectionReason(e.target.value)}
              rows={3}
              placeholder="Reason for rejection..."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-red-500 resize-none mb-4"
              autoFocus
            />
            <div className="flex justify-end gap-3">
              <button
                onClick={() => { setShowRejectModal(false); setRejectionReason(''); }}
                className="px-4 py-2 text-sm text-slate-600 border border-slate-200 rounded-lg hover:bg-slate-50"
              >
                Cancel
              </button>
              <button
                onClick={handleReject}
                disabled={actionLoading || !rejectionReason.trim()}
                className="px-4 py-2 text-sm font-medium bg-red-600 text-white rounded-lg hover:bg-red-700 disabled:opacity-50"
              >
                {actionLoading ? 'Rejecting...' : 'Confirm Reject'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}

function WorkflowStep({
  label, done, rejected, name, date,
}: {
  label: string;
  done: boolean;
  rejected?: boolean;
  name?: string;
  date?: string | null;
}) {
  return (
    <div className="flex items-start gap-3">
      <div className={`w-6 h-6 rounded-full flex items-center justify-center flex-shrink-0 mt-0.5 ${
        rejected ? 'bg-red-100' : done ? 'bg-emerald-100' : 'bg-slate-100'
      }`}>
        {rejected ? (
          <XCircle className="w-3.5 h-3.5 text-red-500" />
        ) : done ? (
          <CheckCircle className="w-3.5 h-3.5 text-emerald-500" />
        ) : (
          <div className="w-2 h-2 rounded-full bg-slate-300" />
        )}
      </div>
      <div>
        <p className={`text-sm font-medium ${done || rejected ? 'text-slate-800' : 'text-slate-400'}`}>{label}</p>
        {(name || date) && (
          <p className="text-xs text-slate-400 mt-0.5">
            {name}{name && date ? ' · ' : ''}{date ? new Date(date).toLocaleDateString('en-PH', { month: 'short', day: 'numeric', year: 'numeric' }) : ''}
          </p>
        )}
      </div>
    </div>
  );
}
