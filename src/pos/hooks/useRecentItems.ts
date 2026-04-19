import { useState, useEffect, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { InvProduct } from '../../lib/types';

const RECENT_LIMIT = 20;

export interface RecentProduct extends InvProduct {
  last_used_at: string;
  use_count: number;
}

export function useRecentItems(terminalId: string, locationId: string) {
  const [recents, setRecents] = useState<RecentProduct[]>([]);

  const load = useCallback(async () => {
    if (!terminalId) {
      setRecents([]);
      return;
    }

    const { data: recentRows, error: recentError } = await supabase
      .from('pos_recent_items')
      .select('product_id, last_used_at, use_count')
      .eq('terminal_id', terminalId)
      .order('last_used_at', { ascending: false })
      .limit(RECENT_LIMIT);

    if (recentError) {
      setRecents([]);
      return;
    }

    const recentList = (recentRows ?? []) as Array<{
      product_id: string;
      last_used_at: string;
      use_count: number;
    }>;
    const productIds = Array.from(new Set(recentList.map(row => row.product_id).filter(Boolean)));

    if (productIds.length === 0) {
      setRecents([]);
      return;
    }

    const { data: productRows, error: productError } = await supabase
      .from('inv_products')
      .select('id, sku_code, barcode, barcode2, name, selling_price, retail_price, wholesale_price, special_price, category_id, is_active')
      .in('id', productIds);

    if (productError) {
      setRecents([]);
      return;
    }

    const productMap = new Map(
      ((productRows ?? []) as InvProduct[])
        .filter(product => product.is_active)
        .map(product => [product.id, product])
    );

    const items: RecentProduct[] = recentList
      .map(row => {
        const product = productMap.get(row.product_id);
        if (!product) return null;
        return {
          ...product,
          last_used_at: row.last_used_at,
          use_count: row.use_count,
        } as RecentProduct;
      })
      .filter((item): item is RecentProduct => Boolean(item));

    setRecents(items);
  }, [terminalId]);

  useEffect(() => { void load(); }, [load]);

  const recordUsage = useCallback(async (products: InvProduct[]) => {
    if (!terminalId || products.length === 0) return;
    const now = new Date().toISOString();

    try {
      await Promise.all(
        products.map(async (p) => {
          const { data: existing, error: lookupError } = await supabase
            .from('pos_recent_items')
            .select('id, use_count')
            .eq('terminal_id', terminalId)
            .eq('product_id', p.id)
            .maybeSingle();

          if (lookupError) return;

          if (existing) {
            await supabase
              .from('pos_recent_items')
              .update({ last_used_at: now, use_count: (existing.use_count as number) + 1 })
              .eq('id', existing.id);
          } else {
            await supabase.from('pos_recent_items').insert({
              terminal_id: terminalId,
              location_id: locationId,
              product_id: p.id,
              last_used_at: now,
              use_count: 1,
            });
          }
        })
      );
    } finally {
      void load();
    }
  }, [terminalId, locationId, load]);

  return { recents, recordUsage, reload: load };
}
