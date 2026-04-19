import { useEffect, useMemo, useRef, useState } from 'react';
import { Maximize, Minimize, MonitorSmartphone, Package, RotateCcw, Search } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { formatCurrency } from '../lib/utils';

interface PriceCheckerProduct {
  id: string;
  sku_code: string;
  barcode?: string;
  barcode2?: string;
  name: string;
  retail_price?: number;
  selling_price?: number;
  wholesale_price?: number;
  special_price?: number;
  unit_code?: string;
  qty_on_hand?: number;
}

function toNumber(value: unknown) {
  const parsed = Number(value ?? 0);
  return Number.isFinite(parsed) ? parsed : 0;
}

export default function PriceCheckerPage({ kioskMode = false }: { kioskMode?: boolean }) {
  const [query, setQuery] = useState('');
  const [products, setProducts] = useState<PriceCheckerProduct[]>([]);
  const [selectedProduct, setSelectedProduct] = useState<PriceCheckerProduct | null>(null);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    const handleFullscreenChange = () => setIsFullscreen(Boolean(document.fullscreenElement));
    handleFullscreenChange();
    document.addEventListener('fullscreenchange', handleFullscreenChange);
    return () => document.removeEventListener('fullscreenchange', handleFullscreenChange);
  }, []);

  useEffect(() => {
    const term = query.trim();
    if (!term) {
      setProducts([]);
      setSelectedProduct(null);
      setError('');
      return;
    }

    const timer = window.setTimeout(async () => {
      setLoading(true);
      setError('');
      try {
        const { data, error: rpcError } = await supabase.rpc('price_check', { search: term });
        if (rpcError) throw rpcError;

        const rows = (((data as { products?: PriceCheckerProduct[] } | null)?.products ?? []) as PriceCheckerProduct[]).map(product => ({
          ...product,
          retail_price: toNumber(product.retail_price ?? product.selling_price),
          selling_price: toNumber(product.selling_price ?? product.retail_price),
          wholesale_price: toNumber(product.wholesale_price),
          special_price: toNumber(product.special_price),
          qty_on_hand: toNumber(product.qty_on_hand),
        }));

        setProducts(rows);
        setSelectedProduct(rows[0] ?? null);
        if (rows.length === 0) {
          setError('No matching product found');
        }
      } catch (err) {
        setProducts([]);
        setSelectedProduct(null);
        setError((err as Error)?.message || 'Unable to load product details');
      } finally {
        setLoading(false);
      }
    }, 180);

    return () => window.clearTimeout(timer);
  }, [query]);

  async function toggleFullscreen() {
    try {
      if (!document.fullscreenElement) {
        await document.documentElement.requestFullscreen();
      } else {
        await document.exitFullscreen();
      }
    } catch {
      // ignore fullscreen errors
    }
  }

  function clearSearch() {
    setQuery('');
    setProducts([]);
    setSelectedProduct(null);
    setError('');
    inputRef.current?.focus();
  }

  const retailPrice = useMemo(
    () => toNumber(selectedProduct?.retail_price ?? selectedProduct?.selling_price),
    [selectedProduct],
  );

  const stockBalance = useMemo(
    () => toNumber(selectedProduct?.qty_on_hand),
    [selectedProduct],
  );

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-slate-900 px-4 py-6 md:px-8 md:py-8">
      <div className="mx-auto w-full max-w-7xl">
        <div className="mb-6 flex flex-wrap items-center justify-between gap-3">
          <div>
            <h1 className="text-3xl md:text-5xl font-black tracking-tight text-white">Price Checker</h1>
            <p className="mt-2 text-base md:text-lg text-slate-300">Scan barcode or type a product name to view price and inventory balance.</p>
          </div>
          <div className="flex items-center gap-2">
            <span className="inline-flex items-center gap-2 rounded-full border border-sky-400/30 bg-sky-500/10 px-3 py-1.5 text-xs md:text-sm font-semibold text-sky-200">
              <MonitorSmartphone className="h-4 w-4" />
              Tablet Friendly
            </span>
            {!kioskMode && (
              <a
                href="/price-checker/kiosk"
                target="_blank"
                rel="noreferrer"
                className="inline-flex items-center gap-2 rounded-xl border border-emerald-400/30 bg-emerald-500/10 px-3 py-2 text-sm font-semibold text-emerald-100 hover:bg-emerald-500/20"
              >
                <MonitorSmartphone className="h-4 w-4" />
                Open Kiosk Mode
              </a>
            )}
            <button
              onClick={toggleFullscreen}
              className="inline-flex items-center gap-2 rounded-xl border border-white/20 bg-white/10 px-3 py-2 text-sm font-semibold text-white hover:bg-white/20"
            >
              {isFullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
              {isFullscreen ? 'Exit Fullscreen' : 'Fullscreen'}
            </button>
          </div>
        </div>

        <div className="grid gap-6 lg:grid-cols-[1.25fr_0.75fr]">
          <div className="rounded-[28px] border border-white/10 bg-white/95 p-4 shadow-2xl md:p-6">
            <div className="mb-4 flex flex-wrap gap-3">
              <div className="relative flex-1 min-w-[260px]">
                <Search className="pointer-events-none absolute left-4 top-1/2 h-6 w-6 -translate-y-1/2 text-slate-400" />
                <input
                  ref={inputRef}
                  value={query}
                  onChange={event => setQuery(event.target.value)}
                  placeholder="Scan barcode or search product"
                  className="w-full rounded-2xl border-2 border-slate-200 py-4 pl-14 pr-4 text-lg md:text-2xl font-semibold text-slate-900 outline-none focus:border-[#6b91ec]"
                  autoFocus
                />
              </div>
              <button
                onClick={clearSearch}
                className="inline-flex items-center justify-center gap-2 rounded-2xl bg-slate-200 px-4 py-4 text-sm md:text-base font-bold text-slate-700 hover:bg-slate-300"
              >
                <RotateCcw className="h-5 w-5" /> Clear
              </button>
            </div>

            {loading ? (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center text-lg font-semibold text-slate-500">
                Looking up product…
              </div>
            ) : error ? (
              <div className="rounded-2xl border border-rose-200 bg-rose-50 px-6 py-10 text-center">
                <p className="text-2xl font-bold text-rose-700">{error}</p>
                <p className="mt-2 text-sm text-rose-600">Try scanning the barcode again or search by product name.</p>
              </div>
            ) : selectedProduct ? (
              <div className="space-y-4">
                <div className="rounded-3xl bg-[#6b91ec] p-5 text-white shadow-lg md:p-6">
                  <div className="flex items-start justify-between gap-4">
                    <div>
                      <p className="text-sm md:text-base font-semibold text-white/85">Selected Product</p>
                      <h2 className="mt-1 text-2xl md:text-4xl font-black leading-tight">{selectedProduct.name}</h2>
                      <p className="mt-2 text-sm md:text-base text-white/85">
                        SKU: {selectedProduct.sku_code || '—'}
                        {selectedProduct.barcode ? ` • Barcode: ${selectedProduct.barcode}` : ''}
                      </p>
                    </div>
                    <div className="rounded-2xl bg-white/15 p-3">
                      <Package className="h-8 w-8 md:h-10 md:w-10" />
                    </div>
                  </div>
                </div>

                <div className="grid gap-4 md:grid-cols-2">
                  <div className="rounded-3xl border border-emerald-200 bg-emerald-50 p-5 md:p-6">
                    <p className="text-base md:text-lg font-semibold text-emerald-700">Retail Price</p>
                    <p className="mt-2 text-4xl md:text-6xl font-black text-emerald-800">{formatCurrency(retailPrice)}</p>
                    <p className="mt-2 text-sm md:text-base text-emerald-700">Main selling price</p>
                  </div>
                  <div className="rounded-3xl border border-amber-200 bg-amber-50 p-5 md:p-6">
                    <p className="text-base md:text-lg font-semibold text-amber-700">Inventory Balance</p>
                    <p className="mt-2 text-4xl md:text-6xl font-black text-amber-800">
                      {stockBalance.toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                    </p>
                    <p className="mt-2 text-sm md:text-base text-amber-700">{selectedProduct.unit_code || 'units'} on hand</p>
                  </div>
                </div>

                <div className="grid gap-3 md:grid-cols-3">
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Wholesale</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{formatCurrency(toNumber(selectedProduct.wholesale_price))}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Special</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{formatCurrency(toNumber(selectedProduct.special_price))}</p>
                  </div>
                  <div className="rounded-2xl bg-slate-100 p-4">
                    <p className="text-xs font-bold uppercase tracking-wide text-slate-500">Unit</p>
                    <p className="mt-1 text-2xl font-black text-slate-800">{selectedProduct.unit_code || '—'}</p>
                  </div>
                </div>
              </div>
            ) : (
              <div className="rounded-2xl border border-dashed border-slate-300 bg-slate-50 px-6 py-16 text-center">
                <p className="text-2xl md:text-3xl font-bold text-slate-700">Ready to check</p>
                <p className="mt-2 text-base text-slate-500">Use the search box above to display product price and stock balance.</p>
              </div>
            )}
          </div>

          <div className="rounded-[28px] border border-white/10 bg-slate-950/70 p-4 shadow-2xl md:p-5">
            <div className="mb-3">
              <h2 className="text-xl md:text-2xl font-bold text-white">Matching Products</h2>
              <p className="text-sm text-slate-300">Tap any result to display its price and available stock.</p>
            </div>
            <div className="space-y-3 max-h-[560px] overflow-y-auto pr-1">
              {products.length === 0 ? (
                <div className="rounded-2xl border border-dashed border-slate-700 px-4 py-10 text-center text-slate-400">
                  Search results will appear here.
                </div>
              ) : products.map(product => (
                <button
                  key={product.id}
                  onClick={() => setSelectedProduct(product)}
                  className={`w-full rounded-2xl border px-4 py-4 text-left transition ${selectedProduct?.id === product.id ? 'border-[#6b91ec] bg-[#6b91ec]/15' : 'border-slate-700 bg-slate-900/80 hover:border-slate-500'}`}
                >
                  <p className="text-base md:text-lg font-bold text-white">{product.name}</p>
                  <p className="mt-1 text-xs md:text-sm text-slate-300">{product.sku_code || '—'} {product.barcode ? `• ${product.barcode}` : ''}</p>
                  <div className="mt-3 flex items-center justify-between gap-3">
                    <span className="text-lg md:text-xl font-black text-emerald-300">{formatCurrency(toNumber(product.retail_price ?? product.selling_price))}</span>
                    <span className="rounded-full bg-white/10 px-3 py-1 text-xs md:text-sm font-semibold text-slate-200">
                      Bal: {toNumber(product.qty_on_hand).toLocaleString(undefined, { minimumFractionDigits: 0, maximumFractionDigits: 3 })}
                    </span>
                  </div>
                </button>
              ))}
            </div>
          </div>
        </div>

        <p className="mt-5 text-center text-sm md:text-base text-slate-400">
          {kioskMode
            ? 'Tablet mode is active — keep this page open for quick item price and stock checks.'
            : 'Optimized for tablets, touch screens, and barcode scanners.'}
        </p>
      </div>
    </div>
  );
}
