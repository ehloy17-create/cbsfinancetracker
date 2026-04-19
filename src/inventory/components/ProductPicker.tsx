import { useState, useEffect } from 'react';
import { Search, X, PackageSearch } from 'lucide-react';
import { supabase } from '../../lib/supabase';

export interface PickedProduct {
  id: string;
  sku_code: string;
  name: string;
  cost_price: number;
  unit_code: string;
  base_unit_code?: string;
  default_purchase_unit_id?: string | null;
  default_purchase_unit_code?: string;
  default_purchase_unit_name?: string;
  default_cost?: number;
  category_name?: string;
}

interface Props {
  value: PickedProduct | null;
  onChange: (product: PickedProduct | null) => void;
  placeholder?: string;
  className?: string;
}

export default function ProductPicker({ value, onChange, placeholder = 'Search product...', className = '' }: Props) {
  const [query, setQuery]     = useState('');
  const [results, setResults] = useState<PickedProduct[]>([]);
  const [loading, setLoading] = useState(false);
  const [open, setOpen]       = useState(false);

  // Debounced RPC search
  useEffect(() => {
    if (!open || !query.trim()) { setResults([]); return; }
    const timer = setTimeout(async () => {
      setLoading(true);
      const { data } = await supabase.rpc('search_products', {
        search: query.trim(),
        filter_active: 'active',
        filter_category: '',
        page: 1,
        page_size: 20,
      });
      type RpcProduct = {
        id: string; sku_code: string; name: string;
        cost_price: number; default_cost?: number;
        unit_code: string; base_unit_code?: string;
        default_purchase_unit_id?: string | null;
        default_purchase_unit_code?: string;
        default_purchase_unit_name?: string;
        category_name?: string;
      };
      const products = ((data ?? {}) as { products: RpcProduct[] }).products ?? [];
      setResults(products.map(p => ({
        id: p.id, sku_code: p.sku_code, name: p.name,
        cost_price: p.cost_price ?? 0,
        default_cost: p.default_cost ?? p.cost_price ?? 0,
        unit_code: p.default_purchase_unit_code ?? p.unit_code ?? '',
        base_unit_code: p.base_unit_code ?? p.unit_code ?? '',
        default_purchase_unit_id: p.default_purchase_unit_id ?? null,
        default_purchase_unit_code: p.default_purchase_unit_code ?? p.unit_code ?? '',
        default_purchase_unit_name: p.default_purchase_unit_name ?? '',
        category_name: p.category_name,
      })));
      setLoading(false);
    }, 280);
    return () => clearTimeout(timer);
  }, [open, query]);

  useEffect(() => {
    if (!open) {
      setQuery('');
      setResults([]);
      setLoading(false);
    }
  }, [open]);

  if (value) {
    return (
      <div className={`flex min-h-[42px] items-center gap-2 rounded-lg border border-slate-200 bg-white px-3 py-2 ${className}`}>
        <div className="flex-1 min-w-0">
          <p className="text-sm font-medium text-slate-800 truncate leading-tight">{value.name}</p>
          <p className="text-xs text-slate-400 font-mono leading-tight">{value.sku_code}{value.unit_code ? ` · ${value.unit_code}` : ''}</p>
        </div>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="flex-shrink-0 rounded-md border border-slate-200 px-2 py-1 text-xs font-medium text-slate-600 transition-colors hover:border-blue-200 hover:bg-blue-50 hover:text-blue-700"
        >
          Change
        </button>
        <button type="button" onClick={() => onChange(null)} className="text-slate-400 hover:text-slate-600 flex-shrink-0 p-0.5">
          <X className="w-3.5 h-3.5" />
        </button>
        {open && <ProductPickerModal
          query={query}
          setQuery={setQuery}
          results={results}
          loading={loading}
          onClose={() => setOpen(false)}
          onSelect={product => {
            onChange(product);
            setOpen(false);
          }}
        />}
      </div>
    );
  }

  return (
    <div className={className}>
      <button
        type="button"
        onClick={() => setOpen(true)}
        className="flex min-h-[42px] w-full items-center gap-2 rounded-lg border border-dashed border-slate-300 bg-white px-3 py-2 text-left text-sm text-slate-500 transition-colors hover:border-blue-300 hover:bg-blue-50 hover:text-blue-700"
      >
        <Search className="h-4 w-4 flex-shrink-0" />
        <span>{placeholder}</span>
      </button>
      {open && <ProductPickerModal
        query={query}
        setQuery={setQuery}
        results={results}
        loading={loading}
        onClose={() => setOpen(false)}
        onSelect={product => {
          onChange(product);
          setOpen(false);
        }}
      />}
    </div>
  );
}

function ProductPickerModal({
  query,
  setQuery,
  results,
  loading,
  onClose,
  onSelect,
}: {
  query: string;
  setQuery: (value: string) => void;
  results: PickedProduct[];
  loading: boolean;
  onClose: () => void;
  onSelect: (product: PickedProduct) => void;
}) {
  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-slate-950/60 p-4 backdrop-blur-sm" onClick={onClose}>
      <div
        className="flex max-h-[80vh] w-full max-w-3xl flex-col overflow-hidden rounded-2xl border border-slate-200 bg-white shadow-2xl"
        onClick={e => e.stopPropagation()}
      >
        <div className="flex items-center justify-between border-b border-slate-200 px-5 py-4">
          <div>
            <h3 className="text-base font-semibold text-slate-900">Select Product</h3>
            <p className="text-sm text-slate-500">Search by name, SKU, or category.</p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg p-2 text-slate-400 transition-colors hover:bg-slate-100 hover:text-slate-700">
            <X className="h-5 w-5" />
          </button>
        </div>

        <div className="border-b border-slate-100 px-5 py-4">
          <div className="relative">
            <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-slate-400" />
            <input
              type="text"
              autoFocus
              value={query}
              onChange={e => setQuery(e.target.value)}
              placeholder="Search products..."
              className="w-full rounded-xl border border-slate-200 py-3 pl-10 pr-4 text-sm text-slate-900 outline-none transition-colors focus:border-blue-500 focus:ring-2 focus:ring-blue-200"
            />
          </div>
        </div>

        <div className="min-h-0 flex-1 overflow-y-auto">
          {!query.trim() ? (
            <div className="flex flex-col items-center justify-center px-6 py-12 text-center text-slate-400">
              <PackageSearch className="mb-3 h-8 w-8" />
              <p className="text-sm font-medium">Start typing to search products</p>
            </div>
          ) : loading ? (
            <p className="px-5 py-4 text-sm text-slate-500">Searching products...</p>
          ) : results.length === 0 ? (
            <p className="px-5 py-4 text-sm text-slate-500">No products found</p>
          ) : results.map(p => (
            <button
              key={p.id}
              type="button"
              onClick={() => onSelect(p)}
              className="w-full border-b border-slate-100 px-5 py-3 text-left transition-colors hover:bg-blue-50 last:border-b-0"
            >
              <p className="truncate text-sm font-medium text-slate-900">{p.name}</p>
              <p className="mt-1 text-xs text-slate-500">
                <span className="font-mono">{p.sku_code}</span>
                {p.unit_code && <span className="ml-2">{p.unit_code}</span>}
                {p.category_name && <span className="ml-2">{p.category_name}</span>}
              </p>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}
