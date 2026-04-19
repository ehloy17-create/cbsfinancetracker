import { useEffect, useState, useCallback } from 'react';
import { supabase } from '../../lib/supabase';
import { InvCategory, InvBrand, InvUnit, InvSupplier, InvLocation } from '../../lib/types';

export function useInvRefs() {
  const [categories, setCategories] = useState<InvCategory[]>([]);
  const [brands, setBrands] = useState<InvBrand[]>([]);
  const [units, setUnits] = useState<InvUnit[]>([]);
  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    setLoading(true);
    const [cats, brs, uns, sups, locs] = await Promise.all([
      supabase.from('inv_categories').select('*').order('name'),
      supabase.from('inv_brands').select('*').order('name'),
      supabase.from('inv_units').select('*').order('name'),
      supabase.from('suppliers').select('*').order('name'),
      supabase.from('inv_locations').select('*').order('name'),
    ]);
    setCategories(cats.data ?? []);
    setBrands(brs.data ?? []);
    setUnits(uns.data ?? []);
    setSuppliers(sups.data ?? []);
    setLocations(locs.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => { load(); }, [load]);

  return { categories, brands, units, suppliers, locations, loading, reload: load };
}

