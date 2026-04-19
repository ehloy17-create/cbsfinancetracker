import { useEffect, useMemo, useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { AlertTriangle, Loader2, Printer } from 'lucide-react';
import HoldSlipPaper, { HoldSlipPaperLine } from '../components/HoldSlipPaper';
import { getHoldSlipData, PublicHoldSlipData } from '../lib/holdSlip';

type LoadState =
  | { status: 'loading' }
  | { status: 'ready'; data: PublicHoldSlipData; expiresAt: string | null }
  | { status: 'error'; message: string; expired?: boolean };

export default function PublicHoldSlipPage() {
  const { heldSaleId } = useParams<{ heldSaleId: string }>();
  const [searchParams] = useSearchParams();
  const [state, setState] = useState<LoadState>({ status: 'loading' });

  useEffect(() => {
    const token = searchParams.get('token')?.trim() ?? '';
    if (!heldSaleId || !token) {
      setState({ status: 'error', message: 'Invalid hold slip link' });
      return;
    }

    let active = true;
    getHoldSlipData(heldSaleId, token)
      .then(result => {
        if (!active) return;
        setState({
          status: 'ready',
          data: result.data,
          expiresAt: result.expiresAt,
        });
      })
      .catch((error: { message?: string; code?: string }) => {
        if (!active) return;
        setState({
          status: 'error',
          message: error.message || 'Unable to load this hold slip',
          expired: error.code === 'HOLD_SLIP_EXPIRED',
        });
      });

    return () => {
      active = false;
    };
  }, [heldSaleId, searchParams]);

  const lines = useMemo<HoldSlipPaperLine[]>(() => {
    if (state.status !== 'ready') return [];
    return state.data.items.map(item => ({
      id: item.item_id,
      productName: item.product_name_snapshot,
      qty: Number(item.qty ?? 0),
      unitPrice: Number(item.unit_price ?? 0),
      subtotal: Number(item.subtotal ?? 0),
      selectedUnitName: item.selected_unit_name,
      baseUnitName: item.base_unit_name,
      pricingBreakdown: item.pricing_breakdown,
    }));
  }, [state]);

  if (state.status === 'loading') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center">
        <div className="flex items-center gap-3 text-sm text-slate-300">
          <Loader2 className="h-5 w-5 animate-spin" />
          Loading hold slip...
        </div>
      </div>
    );
  }

  if (state.status === 'error') {
    return (
      <div className="min-h-screen bg-slate-950 text-white flex items-center justify-center p-6">
        <div className="w-full max-w-md rounded-3xl border border-slate-800 bg-slate-900 p-8 text-center shadow-2xl">
          <AlertTriangle className={`mx-auto h-10 w-10 ${state.expired ? 'text-amber-400' : 'text-red-400'}`} />
          <h1 className="mt-4 text-xl font-semibold text-white">
            {state.expired ? 'This hold slip has expired' : 'Unable to open hold slip'}
          </h1>
          <p className="mt-2 text-sm text-slate-400">{state.message}</p>
        </div>
      </div>
    );
  }

  const expiresLabel = state.expiresAt
    ? new Date(state.expiresAt).toLocaleString('en-PH', {
        month: 'short',
        day: 'numeric',
        hour: 'numeric',
        minute: '2-digit',
        hour12: true,
      })
    : null;

  return (
    <div className="min-h-screen bg-slate-950 px-4 py-8 text-slate-100">
      <div className="mx-auto flex max-w-6xl flex-col gap-6">
        <div className="flex flex-wrap items-center justify-between gap-3 rounded-3xl border border-slate-800 bg-slate-900/90 px-5 py-4 shadow-xl">
          <div>
            <p className="text-xs font-semibold uppercase tracking-[0.24em] text-blue-300">Temporary Hold Slip</p>
            <h1 className="mt-1 text-lg font-semibold text-white">{state.data.hold_reference}</h1>
            {expiresLabel && (
              <p className="mt-1 text-sm text-slate-400">Valid until {expiresLabel}</p>
            )}
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <button
              type="button"
              onClick={() => window.print()}
              className="inline-flex items-center gap-2 rounded-xl bg-blue-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-blue-500 transition-colors"
            >
              <Printer className="h-4 w-4" />
              Print
            </button>
            <Link
              to="/login"
              className="rounded-xl border border-slate-700 px-4 py-2.5 text-sm text-slate-300 hover:border-slate-500 hover:text-white transition-colors"
            >
              Back to App
            </Link>
          </div>
        </div>

        <div className="overflow-auto rounded-3xl border border-slate-800 bg-slate-900/60 p-10 shadow-2xl">
          <div className="mx-auto min-w-[360px] rounded-2xl bg-white p-8 shadow-2xl">
            <HoldSlipPaper
              holdReference={state.data.hold_reference}
              customerName={state.data.customer_name_snapshot}
              cashierName={state.data.cashier_name}
              createdAt={state.data.created_at}
              notes={state.data.notes}
              lines={lines}
              totalDue={state.data.subtotal}
            />
          </div>
        </div>
      </div>
    </div>
  );
}
