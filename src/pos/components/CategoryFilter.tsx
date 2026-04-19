import { useEffect, useState } from 'react';
import { Tag, LayoutGrid } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvCategory } from '../../lib/types';

interface Props {
  selectedId: string | null;
  onChange: (id: string | null) => void;
  layout?: 'vertical' | 'horizontal';
}

export default function CategoryFilter({ selectedId, onChange, layout = 'vertical' }: Props) {
  const [categories, setCategories] = useState<InvCategory[]>([]);

  useEffect(() => {
    supabase
      .from('inv_categories')
      .select('id, name, code')
      .eq('is_active', true)
      .order('sort_order', { ascending: true })
      .order('name', { ascending: true })
      .then(({ data }) => setCategories((data ?? []) as unknown as InvCategory[]));
  }, []);

  if (categories.length === 0) return null;

  if (layout === 'horizontal') {
    return (
      <div className="flex items-center gap-1.5 overflow-x-auto flex-nowrap pb-1 scrollbar-none">
        <button
          onClick={() => onChange(null)}
          className={`flex items-center gap-1.5 flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
            selectedId === null
              ? 'bg-blue-600 text-white'
              : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
          }`}
        >
          <LayoutGrid className="w-3 h-3" />
          All
        </button>
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onChange(selectedId === cat.id ? null : cat.id)}
            className={`flex-shrink-0 px-3 py-1.5 rounded-full text-xs font-semibold transition-colors ${
              selectedId === cat.id
                ? 'bg-blue-600 text-white'
                : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            {cat.name}
          </button>
        ))}
      </div>
    );
  }

  return (
    <div className="flex flex-col gap-1.5">
      <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider flex items-center gap-1.5 px-0.5">
        <Tag className="w-3 h-3" />
        Categories
      </p>

      <button
        onClick={() => onChange(null)}
        className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-left ${
          selectedId === null
            ? 'bg-blue-600 text-white shadow-sm'
            : 'bg-slate-700 text-slate-300 hover:bg-slate-600 hover:text-white'
        }`}
      >
        <LayoutGrid className="w-3.5 h-3.5 flex-shrink-0" />
        All Products
      </button>

      <div className="flex flex-col gap-1">
        {categories.map(cat => (
          <button
            key={cat.id}
            onClick={() => onChange(selectedId === cat.id ? null : cat.id)}
            className={`flex items-center gap-2 w-full px-3 py-2 rounded-lg text-xs font-semibold transition-colors text-left ${
              selectedId === cat.id
                ? 'bg-blue-600 text-white shadow-sm'
                : 'bg-slate-700/60 text-slate-400 hover:bg-slate-700 hover:text-white'
            }`}
          >
            <span className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${selectedId === cat.id ? 'bg-white' : 'bg-slate-600'}`} />
            <span className="truncate">{cat.name}</span>
            {cat.code && (
              <span className={`ml-auto font-mono text-[10px] flex-shrink-0 ${selectedId === cat.id ? 'text-blue-200' : 'text-slate-600'}`}>
                {cat.code}
              </span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}
