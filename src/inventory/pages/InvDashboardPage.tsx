import { useEffect, useState, useCallback } from 'react';
import { Package, Tag, Truck, MapPin, Layers, Ruler, TrendingUp, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { Link } from 'react-router-dom';

interface Stats {
  products: number;
  active_products: number;
  categories: number;
  brands: number;
  suppliers: number;
  locations: number;
  units: number;
  low_reorder: number;
  is_expiry_tracked: number;
}

interface StatCardProps {
  title: string;
  value: number | string;
  sub?: string;
  icon: React.ElementType;
  color: string;
  to?: string;
}

function StatCard({ title, value, sub, icon: Icon, color, to }: StatCardProps) {
  const content = (
    <div className={`bg-white rounded-xl border border-slate-200 shadow-sm p-5 hover:shadow-md transition-shadow ${to ? 'cursor-pointer' : ''}`}>
      <div className="flex items-start justify-between">
        <div>
          <p className="text-xs font-semibold text-slate-500 uppercase tracking-wider mb-1">{title}</p>
          <p className="text-2xl font-bold text-slate-800">{value}</p>
          {sub && <p className="text-xs text-slate-400 mt-1">{sub}</p>}
        </div>
        <div className={`w-10 h-10 rounded-xl flex items-center justify-center ${color}`}>
          <Icon className="w-5 h-5" />
        </div>
      </div>
    </div>
  );
  if (to) return <Link to={to}>{content}</Link>;
  return content;
}

export default function InvDashboardPage() {
  const [stats, setStats] = useState<Stats>({
    products: 0, active_products: 0, categories: 0, brands: 0,
    suppliers: 0, locations: 0, units: 0, low_reorder: 0, is_expiry_tracked: 0,
  });
  const [loading, setLoading] = useState(true);
  const [recentProducts, setRecentProducts] = useState<{ id: string; name: string; sku_code: string; selling_price: number; is_active: boolean }[]>([]);

  const load = useCallback(async () => {
    setLoading(true);
    const [prods, cats, brands, sups, locs, units, recent] = await Promise.all([
      supabase.from('inv_products').select('id, is_active, is_expiry_tracked, reorder_point'),
      supabase.from('inv_categories').select('id'),
      supabase.from('inv_brands').select('id'),
      supabase.from('suppliers').select('id'),
      supabase.from('inv_locations').select('id'),
      supabase.from('inv_units').select('id'),
      supabase.from('inv_products').select('id, name, sku_code, selling_price, is_active').order('created_at', { ascending: false }).limit(8),
    ]);

    const products = prods.data ?? [];
    setStats({
      products: products.length,
      active_products: products.filter((p: { is_active?: boolean }) => p.is_active).length,
      categories: (cats.data ?? []).length,
      brands: (brands.data ?? []).length,
      suppliers: (sups.data ?? []).length,
      locations: (locs.data ?? []).length,
      units: (units.data ?? []).length,
      low_reorder: products.filter((p: { reorder_point?: number }) => Number(p.reorder_point ?? 0) > 0).length,
      is_expiry_tracked: products.filter((p: { is_expiry_tracked?: boolean }) => p.is_expiry_tracked).length,
    });
    setRecentProducts(recent.data ?? []);
    setLoading(false);
  }, []);

  useEffect(() => {
    load();
  }, [load]);

  if (loading) {
    return (
      <div className="p-6 flex items-center justify-center min-h-64">
        <div className="w-8 h-8 border-3 border-blue-500 border-t-transparent rounded-full animate-spin" />
      </div>
    );
  }

  return (
    <div className="p-6 space-y-6">
      <div>
        <h1 className="text-xl font-bold text-slate-800">Inventory Overview</h1>
        <p className="text-sm text-slate-500 mt-0.5">Product catalog summary and quick links</p>
      </div>

      <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
        <StatCard title="Total Products" value={stats.products} sub={`${stats.active_products} active`} icon={Package} color="bg-blue-50 text-blue-600" to="/inventory/products" />
        <StatCard title="Categories" value={stats.categories} icon={Layers} color="bg-teal-50 text-teal-600" to="/inventory/categories" />
        <StatCard title="Brands" value={stats.brands} icon={Tag} color="bg-orange-50 text-orange-600" to="/inventory/brands" />
        <StatCard title="Suppliers" value={stats.suppliers} icon={Truck} color="bg-slate-100 text-slate-600" to="/inventory/suppliers" />
        <StatCard title="Locations" value={stats.locations} icon={MapPin} color="bg-emerald-50 text-emerald-600" to="/inventory/locations" />
        <StatCard title="Units" value={stats.units} icon={Ruler} color="bg-sky-50 text-sky-600" to="/inventory/units" />
        <StatCard title="Expiry Tracked" value={stats.is_expiry_tracked} sub="products with expiry" icon={AlertTriangle} color="bg-amber-50 text-amber-600" />
        <StatCard title="Reorder Points" value={stats.low_reorder} sub="products with reorder set" icon={TrendingUp} color="bg-rose-50 text-rose-600" />
      </div>

      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden">
        <div className="px-5 py-4 border-b border-slate-100 flex items-center justify-between">
          <h2 className="font-semibold text-slate-800 text-sm">Recently Added Products</h2>
          <Link to="/inventory/products" className="text-xs font-medium text-blue-600 hover:text-blue-700">View all</Link>
        </div>
        <div className="divide-y divide-slate-50">
          {recentProducts.length === 0 ? (
            <p className="px-5 py-8 text-center text-sm text-slate-400">No products yet. Start by adding products to the catalog.</p>
          ) : recentProducts.map(p => (
            <div key={p.id} className="flex items-center justify-between px-5 py-3 hover:bg-slate-50 transition-colors">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 bg-slate-100 rounded-lg flex items-center justify-center flex-shrink-0">
                  <Package className="w-4 h-4 text-slate-400" />
                </div>
                <div>
                  <p className="text-sm font-medium text-slate-700">{p.name}</p>
                  <p className="text-xs text-slate-400 font-mono">{p.sku_code}</p>
                </div>
              </div>
              <div className="flex items-center gap-3">
                <span className="text-sm font-semibold text-slate-800">₱{Number(p.selling_price || 0).toFixed(2)}</span>
                <span className={`text-xs px-1.5 py-0.5 rounded-full border ${p.is_active ? 'bg-emerald-50 text-emerald-700 border-emerald-200' : 'bg-slate-100 text-slate-400 border-slate-200'}`}>
                  {p.is_active ? 'Active' : 'Inactive'}
                </span>
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

