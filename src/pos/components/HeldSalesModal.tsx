import { useState, useEffect, useCallback } from 'react';
import { X, Clock, RotateCcw, Loader2, ShoppingCart } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { HeldSale, HeldSaleItem } from '../../lib/types';
import { generateUUID } from '../../lib/utils';
import { CartLine } from '../hooks/useCart';
import HoldSlipShareButton from './HoldSlipShareButton';
import { useAuth } from '../../contexts/AuthContext';
import { HoldSlipPaperLine } from './HoldSlipPaper';

interface Props {
  shiftId: string;
  activeHeldSaleId?: string | null;
  onClose: () => void;
  onResume: (lines: CartLine[], meta?: {
    heldSaleId: string;
    holdReference: string;
    customerId?: string | null;
    customerNameSnapshot?: string;
    customerPriceLevelSnapshot?: HeldSale['customer_price_level_snapshot'];
  }) => void;
}

function fmt(n: number) {
  return n.toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function relativeTime(dt: string) {
  const diff = Date.now() - new Date(dt).getTime();
  const mins = Math.floor(diff / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins}m ago`;
  const hrs = Math.floor(mins / 60);
  return `${hrs}h ${mins % 60}m ago`;
}

export default function HeldSalesModal({ shiftId, activeHeldSaleId = null, onClose, onResume }: Props) {
  const { user, profile } = useAuth();
  const [heldSales, setHeldSales] = useState<HeldSale[]>([]);
  const [loading, setLoading] = useState(true);
  const [resuming, setResuming] = useState<string | null>(null);
  const [expanded, setExpanded] = useState<string | null>(null);
  const visibleHeldSales = heldSales.filter(held => held.held_sale_id !== activeHeldSaleId);

  const load = useCallback(async () => {
    setLoading(true);
    const { data } = await supabase
      .from('held_sales')
      .select('*')
      .eq('shift_id', shiftId)
      .eq('status', 'held')
      .order('created_at', { ascending: false });

    const heldRows = (data ?? []) as HeldSale[];
    const heldIds = heldRows.map(row => row.held_sale_id);

    let itemsByHeldId = new Map<string, HeldSaleItem[]>();
    if (heldIds.length > 0) {
      const { data: itemRows } = await supabase
        .from('held_sale_items')
        .select('*')
        .in('held_sale_id', heldIds)
        .order('sort_order', { ascending: true });

      itemsByHeldId = ((itemRows ?? []) as HeldSaleItem[]).reduce((map: Map<string, HeldSaleItem[]>, item: HeldSaleItem) => {
        const typed = item as HeldSaleItem;
        const group = map.get(typed.held_sale_id) ?? [];
        group.push(typed);
        map.set(typed.held_sale_id, group);
        return map;
      }, new Map<string, HeldSaleItem[]>());
    }

    setHeldSales(heldRows.map(held => ({
      ...held,
      held_sale_items: itemsByHeldId.get(held.held_sale_id) ?? [],
    })) as unknown as HeldSale[]);
    setLoading(false);
  }, [shiftId]);

  useEffect(() => { load(); }, [load]);

  useEffect(() => {
    function onKeyDown(e: KeyboardEvent) {
      if (e.key === 'Escape') { e.preventDefault(); onClose(); }
    }
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [onClose]);

  async function handleResume(held: HeldSale) {
    setResuming(held.held_sale_id);
    try {
      const items = (held.held_sale_items ?? []) as HeldSaleItem[];
      const cartLines: CartLine[] = items
        .sort((a, b) => a.sort_order - b.sort_order)
        .map((item, idx) => ({
          lineId: generateUUID(),
          productId: item.product_id ?? '',
          productName: item.product_name_snapshot,
          sku: item.sku_code,
          barcode: item.barcode,
          selectedUnitId: item.selected_unit_id ?? null,
          selectedUnitName: item.selected_unit_name ?? item.base_unit_name ?? 'Unit',
          baseUnitName: item.base_unit_name ?? 'Unit',
          qtyInBaseUnitPerUnit: Number(item.qty_in_base_unit_per_unit ?? 1),
          totalBaseQtyDeducted: Number(item.total_base_qty_deducted ?? Number(item.qty ?? 0) * Number(item.qty_in_base_unit_per_unit ?? 1)),
          retailUnitPrice: item.retail_unit_price ?? item.unit_price,
          legacyWholesaleUnitPrice: item.selected_price_level === 'Wholesale' ? item.unit_price : 0,
          specialUnitPrice: item.selected_price_level === 'Special' ? item.unit_price : 0,
          unitPrice: item.unit_price,
          originalUnitPrice: item.unit_price,
          lineBaseAmount: Number(item.subtotal ?? 0) + Number(item.discount_amount ?? 0),
          wholesaleEnabled: Boolean(item.wholesale_enabled),
          wholesaleBreakQtyInBaseUnit: Number(item.wholesale_break_qty_in_base_unit ?? 0),
          wholesaleBlockPrice: Number(item.wholesale_block_price ?? 0),
          wholesaleBlocksApplied: Number(item.wholesale_blocks_applied ?? 0),
          wholesaleBaseQtyApplied: Number(item.wholesale_base_qty_applied ?? 0),
          retailRemainderBaseQty: Number(item.retail_remainder_base_qty ?? item.total_base_qty_deducted ?? 0),
          pricingBreakdown: String(item.pricing_breakdown ?? ''),
          selectedPriceLevel: item.selected_price_level ?? 'Retail',
          appliedPriceLevel: item.applied_price_level ?? 'Retail',
          priceSource: item.price_source ?? 'Retail',
          priceOverridden: false,
          priceModeLocked: false,
          qty: item.qty,
          discountAmount: item.discount_amount,
          discountPct: 0,
          subtotal: item.subtotal,
            sortOrder: idx,
            voided: false,
          }));

      onResume(cartLines, {
        heldSaleId: held.held_sale_id,
        holdReference: held.hold_reference,
        customerId: held.customer_id ?? null,
        customerNameSnapshot: held.customer_name_snapshot ?? undefined,
        customerPriceLevelSnapshot: held.customer_price_level_snapshot ?? 'Retail',
      });
    } catch {
      setResuming(null);
    }
  }

  return (
    <div className="fixed inset-0 bg-black/70 backdrop-blur-sm z-50 flex items-center justify-center p-4">
      <div className="bg-slate-800 rounded-2xl shadow-2xl w-full max-w-lg border border-slate-700 flex flex-col max-h-[80vh]">
        {/* Header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-700 flex-shrink-0">
          <div className="flex items-center gap-2">
            <Clock className="w-5 h-5 text-amber-400" />
            <h2 className="font-semibold text-white">Held Transactions</h2>
          </div>
          <button onClick={onClose} className="text-slate-500 hover:text-slate-300 transition-colors">
            <X className="w-5 h-5" />
          </button>
        </div>

        {/* Body */}
        <div className="flex-1 overflow-y-auto p-4">
          {loading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="w-6 h-6 text-blue-400 animate-spin" />
            </div>
          ) : visibleHeldSales.length === 0 ? (
            <div className="flex flex-col items-center justify-center py-12 text-center">
              <ShoppingCart className="w-10 h-10 text-slate-600 mb-3" />
              <p className="text-slate-400 font-medium">No held transactions</p>
              <p className="text-slate-600 text-sm mt-1">Use Hold to park a cart and recall it here</p>
            </div>
          ) : (
            <div className="space-y-2">
              {visibleHeldSales.map(held => {
                const items = (held.held_sale_items ?? []) as HeldSaleItem[];
                const isExpanded = expanded === held.held_sale_id;
                const isResuming = resuming === held.held_sale_id;

                return (
                  <div key={held.held_sale_id} className="bg-slate-700/60 rounded-xl border border-slate-600 overflow-hidden">
                    <div className="flex items-center gap-3 p-4">
                      <div className="flex-1 min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-semibold text-amber-300 bg-amber-950 border border-amber-800 px-2 py-0.5 rounded truncate max-w-[180px]">
                            {held.customer_name_snapshot || 'Walk-in'}
                          </span>
                          <span className="text-xs text-slate-500">{relativeTime(held.created_at)}</span>
                        </div>
                        <div className="flex items-center gap-3 mt-1.5">
                          <span className="text-xs text-slate-400">{items.length} line{items.length !== 1 ? 's' : ''}</span>
                          <span className="text-sm font-bold text-white font-mono">₱{fmt(items.reduce((sum, item) => sum + Number(item.subtotal ?? 0), 0))}</span>
                        </div>
                        {held.notes && (
                          <p className="text-xs text-slate-500 mt-1 truncate">{held.notes}</p>
                        )}
                      </div>
                       <div className="flex items-center gap-2 flex-shrink-0">
                         <button
                           onClick={() => setExpanded(isExpanded ? null : held.held_sale_id)}
                           className="text-xs text-slate-400 hover:text-slate-200 transition-colors px-2 py-1 rounded"
                         >
                           {isExpanded ? 'Hide' : 'View'}
                         </button>
                          <HoldSlipShareButton
                            payload={{
                              heldSaleId: held.held_sale_id,
                              cacheKey: `${held.held_sale_id}:${held.updated_at}:${held.subtotal}`,
                              holdReference: held.hold_reference,
                              customerName: held.customer_name_snapshot,
                              cashierName: profile?.name ?? '',
                              createdAt: held.created_at,
                              notes: held.notes,
                              lines: items.map<HoldSlipPaperLine>(item => ({
                                id: item.item_id,
                                productName: item.product_name_snapshot,
                                qty: Number(item.qty ?? 0),
                                unitPrice: Number(item.unit_price ?? 0),
                                subtotal: Number(item.subtotal ?? 0),
                                selectedUnitName: item.selected_unit_name ?? undefined,
                                baseUnitName: item.base_unit_name ?? undefined,
                                pricingBreakdown: item.pricing_breakdown ?? undefined,
                              })),
                              totalDue: Number(held.subtotal ?? 0),
                            }}
                            userId={user?.id ?? null}
                            buttonLabel="Business Suite"
                            buttonClassName="flex items-center gap-1.5 px-3 py-2 bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold rounded-lg transition-colors"
                          />
                         <button
                           onClick={() => handleResume(held)}
                           disabled={isResuming}
                          className="flex items-center gap-1.5 px-3 py-2 bg-blue-600 hover:bg-blue-500 text-white text-xs font-semibold rounded-lg transition-colors disabled:opacity-60"
                        >
                          {isResuming ? (
                            <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          ) : (
                            <RotateCcw className="w-3.5 h-3.5" />
                          )}
                          Resume
                        </button>
                      </div>
                    </div>

                    {isExpanded && items.length > 0 && (
                      <div className="border-t border-slate-600 px-4 py-3 space-y-1.5">
                        {items
                          .sort((a, b) => a.sort_order - b.sort_order)
                          .map(item => (
                            <div key={item.item_id} className="flex items-center justify-between text-xs">
                              <div className="flex-1 min-w-0">
                                <span className="text-slate-300 truncate block">{item.product_name_snapshot}</span>
                                <span className="text-slate-500 font-mono">{item.sku_code}</span>
                                <span className="ml-2 text-slate-500">{item.selected_unit_name ?? item.base_unit_name ?? 'Unit'}</span>
                              </div>
                              <div className="text-right flex-shrink-0 ml-4">
                                <span className="text-slate-400">{item.qty} × ₱{fmt(item.unit_price)}</span>
                                <span className="text-white font-mono ml-2">₱{fmt(item.subtotal)}</span>
                              </div>
                            </div>
                          ))}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}
        </div>

        <div className="px-5 py-3 border-t border-slate-700 flex-shrink-0">
          <button onClick={onClose} className="w-full py-2.5 text-sm text-slate-400 hover:text-slate-200 transition-colors">
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
