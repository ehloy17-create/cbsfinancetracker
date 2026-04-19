import { useEffect, useState, useCallback } from 'react';
import { Star, Plus, X, Settings2 } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvProduct } from '../../lib/types';

interface FavoriteRow {
  id: string;
  sort_order: number;
  inv_products: InvProduct;
}

interface Props {
  locationId: string;
  onAddProduct: (product: InvProduct) => void;
  layout?: 'panel' | 'strip';
}

export default function FavoritesPanel({ locationId, onAddProduct, layout = 'panel' }: Props) {
  const [favorites, setFavorites] = useState<FavoriteRow[]>([]);
  const [loading, setLoading]     = useState(true);
  const [editMode, setEditMode]   = useState(false);
  const [removing, setRemoving]   = useState<Set<string>>(new Set());

  const load = useCallback(async () => {
    if (!locationId) return;
    const { data } = await supabase
      .from('pos_favorites')
      .select('id, sort_order, inv_products(id, sku_code, name, selling_price, retail_price, wholesale_price, special_price, is_active)')
      .eq('location_id', locationId)
      .order('sort_order', { ascending: true })
      .limit(30);

    const rows = ((data ?? []) as unknown as FavoriteRow[]).filter(
      r => r.inv_products && (r.inv_products as unknown as { is_active: boolean }).is_active
    );
    setFavorites(rows);
    setLoading(false);
  }, [locationId]);

  useEffect(() => { load(); }, [load]);

  async function handleRemove(favId: string) {
    setRemoving(prev => new Set(prev).add(favId));
    await supabase.from('pos_favorites').delete().eq('id', favId);
    setFavorites(prev => prev.filter(f => f.id !== favId));
    setRemoving(prev => { const s = new Set(prev); s.delete(favId); return s; });
  }

  if (loading) return null;

  // ── Strip layout: compact horizontal scrolling row ──────────────────────
  if (layout === 'strip') {
    if (favorites.length === 0) return null;
    return (
      <div className="flex items-center gap-0.5 overflow-x-auto flex-nowrap scrollbar-none border-b border-slate-700/60 px-2 py-1.5">
        <span className="flex-shrink-0 flex items-center gap-1 text-[10px] text-slate-500 font-semibold uppercase tracking-wide pr-2 border-r border-slate-700 mr-1">
          <Star className="w-3 h-3" />
          Quick
        </span>
        {favorites.map(row => {
          const product = row.inv_products;
          return (
            <button
              key={row.id}
              onClick={() => onAddProduct(product)}
              className="flex-shrink-0 flex flex-col items-start px-2.5 py-1.5 rounded-lg bg-slate-700/70 hover:bg-slate-600 active:bg-slate-500 border border-slate-600/60 hover:border-slate-500 transition-all text-left group min-w-[90px] max-w-[140px]"
            >
              <p className="text-[11px] text-white font-medium leading-snug truncate w-full group-hover:text-blue-300 transition-colors">
                {product.name}
              </p>
              <p className="text-[11px] text-emerald-400 font-mono font-semibold">
                ₱{product.selling_price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
              </p>
            </button>
          );
        })}
      </div>
    );
  }

  // ── Panel layout (default) ──────────────────────────────────────────────
  return (
    <div className="flex flex-col gap-1.5">
      <div className="flex items-center justify-between px-0.5">
        <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5">
          <Star className="w-3 h-3" />
          Favorites
        </p>
        {favorites.length > 0 && (
          <button
            onClick={() => setEditMode(e => !e)}
            className={`flex items-center gap-1 px-2 py-1 rounded text-[10px] font-semibold transition-colors ${
              editMode
                ? 'bg-amber-600/20 text-amber-400 border border-amber-700/50'
                : 'text-slate-500 hover:text-slate-300'
            }`}
          >
            <Settings2 className="w-3 h-3" />
            {editMode ? 'Done' : 'Edit'}
          </button>
        )}
      </div>

      {favorites.length === 0 ? (
        <p className="text-[11px] text-slate-600 px-1 leading-relaxed">
          No favorites for this branch. Assign via Product Management.
        </p>
      ) : (
        <div className="grid grid-cols-2 gap-1.5">
          {favorites.map(row => {
            const product = row.inv_products;
            return (
              <button
                key={row.id}
                onClick={() => !editMode && onAddProduct(product)}
                className={`relative flex flex-col items-start p-2.5 rounded-xl transition-all text-left group ${
                  editMode
                    ? 'bg-slate-700/60 border border-amber-700/40 cursor-default'
                    : 'bg-slate-700 hover:bg-slate-600 active:bg-slate-500 border border-transparent hover:border-slate-500'
                }`}
              >
                {editMode && (
                  <button
                    onClick={e => { e.stopPropagation(); handleRemove(row.id); }}
                    disabled={removing.has(row.id)}
                    className="absolute -top-1.5 -right-1.5 w-5 h-5 bg-red-600 hover:bg-red-500 text-white rounded-full flex items-center justify-center transition-colors disabled:opacity-50 z-10"
                  >
                    <X className="w-3 h-3" />
                  </button>
                )}
                <div className="flex items-start justify-between w-full gap-1">
                  <p className="text-xs text-white font-medium leading-snug line-clamp-2 flex-1">
                    {product.name}
                  </p>
                  {!editMode && (
                    <Plus className="w-3.5 h-3.5 text-slate-500 group-hover:text-blue-400 flex-shrink-0 mt-0.5 transition-colors" />
                  )}
                </div>
                <p className="text-xs text-emerald-400 font-mono font-semibold mt-1">
                  ₱{product.selling_price.toLocaleString('en-PH', { minimumFractionDigits: 2 })}
                </p>
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
