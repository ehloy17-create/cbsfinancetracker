import { useEffect, useMemo, useState, type RefObject } from 'react';
import { Barcode, PackageSearch, Search, X } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvProduct } from '../../lib/types';
import { RecentProduct } from '../hooks/useRecentItems';

interface SearchProductsResponse {
  products?: InvProduct[];
}

interface Props {
  locationId: string;
  selectedCategoryId: string | null;
  recents: RecentProduct[];
  onAddProduct: (product: InvProduct) => boolean | Promise<boolean>;
  inputRef?: RefObject<HTMLInputElement>;
}

type ScanStatus =
  | { type: 'success'; message: string }
  | { type: 'error'; message: string }
  | null;

function formatMoney(value: number | undefined) {
  return `P${(value ?? 0).toLocaleString('en-PH', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function ProductRow({
  product,
  subtitle,
  meta,
  onSelect,
}: {
  product: InvProduct;
  subtitle: string;
  meta: string;
  onSelect: (product: InvProduct) => void | Promise<unknown>;
}) {
  return (
    <button
      type="button"
      onClick={() => void onSelect(product)}
      className="flex w-full items-start gap-3 border-b border-slate-800/80 px-3 py-3 text-left transition-colors hover:bg-slate-800/80"
    >
      <div className="mt-0.5 rounded-lg bg-slate-800 p-2 text-slate-400">
        <PackageSearch className="h-4 w-4" />
      </div>
      <div className="min-w-0 flex-1">
        <p className="truncate text-sm font-semibold text-slate-100">{product.name}</p>
        <p className="mt-0.5 truncate text-xs text-slate-400">{subtitle}</p>
        <p className="mt-1 text-[11px] text-slate-500">{meta}</p>
      </div>
      <div className="text-right">
        <p className="text-sm font-bold text-emerald-400">{formatMoney(product.selling_price)}</p>
      </div>
    </button>
  );
}

export default function ProductSearch({
  locationId,
  selectedCategoryId,
  recents,
  onAddProduct,
  inputRef,
}: Props) {
  const [query, setQuery] = useState('');
  const [scanBusy, setScanBusy] = useState(false);
  const [scanStatus, setScanStatus] = useState<ScanStatus>(null);
  const [results, setResults] = useState<InvProduct[]>([]);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    inputRef?.current?.focus();
  }, [inputRef]);

  useEffect(() => {
    if (!scanStatus) return;
    const timer = window.setTimeout(() => setScanStatus(null), 2200);
    return () => window.clearTimeout(timer);
  }, [scanStatus]);

  useEffect(() => {
    let cancelled = false;

    const runSearch = window.setTimeout(async () => {
      const term = query.trim();
      if (!term) {
        setResults([]);
        setLoading(false);
        return;
      }

      setLoading(true);
      const { data, error } = await supabase.rpc('search_products', {
        search: term,
        filter_active: 'active',
        filter_category: selectedCategoryId ?? '',
        page: 1,
        page_size: 30,
      });

      if (cancelled) return;

      if (error) {
        setResults([]);
        setLoading(false);
        return;
      }

      const next = ((data ?? {}) as SearchProductsResponse).products ?? [];
      setResults(next);
      setLoading(false);
    }, 250);

    return () => {
      cancelled = true;
      window.clearTimeout(runSearch);
    };
  }, [query, selectedCategoryId]);

  const visibleRecents = useMemo(() => recents.slice(0, 12), [recents]);
  const trimmedQuery = query.trim();

  const handleSelect = async (product: InvProduct) => {
    const added = await Promise.resolve(onAddProduct(product));
    if (!added) return false;
    setQuery('');
    inputRef?.current?.focus();
    return true;
  };

  const lookupExactProduct = async (rawValue: string): Promise<InvProduct | null> => {
    const value = rawValue.trim();
    if (!value) return null;

    const exactFields: Array<'barcode' | 'barcode2' | 'sku_code'> = ['barcode', 'barcode2', 'sku_code'];
    for (const field of exactFields) {
      const { data, error } = await supabase
        .from('inv_products')
        .select('*')
        .eq(field, value)
        .eq('is_active', true)
        .limit(1)
        .maybeSingle();

      if (error) return null;
      if (data) return data as InvProduct;
    }

    return null;
  };

  const handleUnifiedSubmit = async () => {
    const value = query.trim();
    if (!value || scanBusy) return;

    setScanBusy(true);
    const product = await lookupExactProduct(value);
    if (!product) {
      setScanStatus({ type: 'error', message: 'Barcode not found' });
      inputRef?.current?.focus();
      setScanBusy(false);
      return;
    }

    const added = await handleSelect(product);
    if (added) {
      setScanStatus({ type: 'success', message: `${product.name} added to cart` });
    }
    inputRef?.current?.focus();
    setScanBusy(false);
  };

  return (
    <div className="flex h-full min-h-0 flex-col bg-slate-900">
      <div className="space-y-2 border-b border-slate-700 px-3 py-3">
        <div>
          <label className="mb-2 block text-[11px] font-semibold uppercase tracking-widest text-slate-500">
            Scan or Search
          </label>
          <div className="relative">
            <div className="pointer-events-none absolute left-3 top-1/2 flex -translate-y-1/2 items-center gap-1 text-slate-500">
              <Barcode className="h-4 w-4" />
              <Search className="h-4 w-4" />
            </div>
            <input
              ref={inputRef}
              type="text"
              value={query}
              onChange={e => {
                setQuery(e.target.value);
                if (scanStatus) setScanStatus(null);
              }}
              onKeyDown={e => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void handleUnifiedSubmit();
                }
              }}
              placeholder="Scan barcode or type name, SKU, or barcode"
              className="h-11 w-full rounded-xl border border-slate-700 bg-slate-800 pl-14 pr-10 text-sm text-slate-100 outline-none transition-colors placeholder:text-slate-500 focus:border-blue-500"
              autoComplete="off"
              spellCheck={false}
            />
            {query && (
              <button
                type="button"
                onClick={() => {
                  setQuery('');
                  setScanStatus(null);
                  inputRef?.current?.focus();
                }}
                className="absolute right-2 top-1/2 flex h-7 w-7 -translate-y-1/2 items-center justify-center rounded-full text-slate-500 transition-colors hover:bg-slate-700 hover:text-slate-200"
              >
                <X className="h-4 w-4" />
              </button>
            )}
          </div>
        </div>

        {scanStatus && (
          <div
            className={`rounded-xl border px-3 py-2 text-sm ${
              scanStatus.type === 'success'
                ? 'border-emerald-800/60 bg-emerald-950/40 text-emerald-300'
                : 'border-red-800/60 bg-red-950/40 text-red-300'
            }`}
          >
            {scanStatus.message}
          </div>
        )}

      </div>

      <div className="min-h-0 flex-1 overflow-y-auto">
        {trimmedQuery ? (
          loading ? (
            <div className="px-3 py-6 text-center text-sm text-slate-400">Searching products...</div>
          ) : results.length > 0 ? (
            results.map(product => (
              <ProductRow
                key={product.id}
                product={product}
                subtitle={[product.sku_code, product.barcode || product.barcode2].filter(Boolean).join(' • ')}
                meta={product.description || 'Tap to add this item to the cart'}
                onSelect={handleSelect}
              />
            ))
          ) : (
            <div className="px-3 py-6 text-center text-sm text-slate-400">No matching products found.</div>
          )
        ) : (
          <>
            <div className="border-b border-slate-800 px-3 py-2 text-[11px] font-semibold uppercase tracking-widest text-slate-500">
              Recent Items
            </div>
            {visibleRecents.length > 0 ? (
              visibleRecents.map(product => (
                <ProductRow
                  key={product.id}
                  product={product}
                  subtitle={[product.sku_code, product.barcode || product.barcode2].filter(Boolean).join(' • ')}
                  meta={`Used ${product.use_count} time${product.use_count === 1 ? '' : 's'}`}
                  onSelect={handleSelect}
                />
              ))
            ) : (
              <div className="px-3 py-6 text-center text-sm text-slate-500">Recent items will appear here.</div>
            )}
          </>
        )}
      </div>

      <div className="border-t border-slate-800 px-3 py-2 text-[11px] text-slate-500">
        {locationId ? 'Showing products for this terminal location.' : 'Select a location to start searching.'}
      </div>
    </div>
  );
}
