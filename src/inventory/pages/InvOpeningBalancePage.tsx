import { useState, useEffect, useCallback } from 'react';
import { Link } from 'react-router-dom';
import { ArrowLeft, Plus, Trash2, Save, AlertTriangle, CheckCircle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { InvLocation } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';
import { generateUUID } from '../../lib/utils';
import ProductPicker, { PickedProduct } from '../components/ProductPicker';

interface LineItem {
  id: string;
  product_id: string;
  product?: PickedProduct | null;
  location_id: string;
  qty: string;
  unit_cost: string;
  notes: string;
}

function newLine(): LineItem {
  return {
    id: generateUUID(),
    product_id: '',
    location_id: '',
    qty: '',
    unit_cost: '',
    notes: '',
  };
}

export default function InvOpeningBalancePage() {
  const { user } = useAuth();
  const { showToast } = useToast();

  const [locations, setLocations] = useState<InvLocation[]>([]);
  const [lines, setLines] = useState<LineItem[]>([newLine()]);
  const [saving, setSaving] = useState(false);
  const [savedCount, setSavedCount] = useState(0);
  const [defaultLocation, setDefaultLocation] = useState('');

  useEffect(() => {
    supabase.from('inv_locations').select('*').eq('is_active', true).order('name').then(({ data }) => {
      setLocations(data ?? []);
      if (data && data.length === 1) setDefaultLocation(data[0].id);
    });
  }, []);

  const updateLine = useCallback((id: string, field: keyof LineItem, value: string) => {
    setLines(prev => prev.map(l => l.id !== id ? l : { ...l, [field]: value }));
  }, []);

  function setProductOnLine(lineId: string, product: PickedProduct | null) {
    setLines(prev => prev.map(l => l.id !== lineId ? l : {
      ...l,
      product_id: product?.id ?? '',
      product,
      unit_cost: product ? String(product.cost_price) : l.unit_cost,
    }));
  }

  function addLine() {
    setLines(prev => [...prev, { ...newLine(), location_id: defaultLocation }]);
  }

  function removeLine(id: string) {
    if (lines.length === 1) return;
    setLines(prev => prev.filter(l => l.id !== id));
  }

  function applyLocationToAll(locationId: string) {
    setLines(prev => prev.map(l => ({ ...l, location_id: locationId })));
  }

  async function handleSave() {
    const validLines = lines.filter(l => l.product_id && l.location_id && l.qty !== '' && parseFloat(l.qty) > 0);
    if (validLines.length === 0) {
      showToast('Add at least one product with quantity and location', 'error');
      return;
    }

    setSaving(true);
    let successCount = 0;
    const errors: string[] = [];

    for (const line of validLines) {
      const prod = line.product;

      const { error } = await supabase.from('inventory_movements').insert({
        product_id: line.product_id,
        location_id: line.location_id,
        movement_type: 'opening_balance',
        qty_change: parseFloat(line.qty),
        unit_cost: line.unit_cost ? parseFloat(line.unit_cost) : null,
        notes: line.notes || `Opening balance for ${prod?.name ?? 'product'}`,
        created_by: user?.id,
      });

      if (error) {
        errors.push(`${prod?.sku_code ?? 'Unknown'}: ${error.message}`);
      } else {
        successCount++;
      }
    }

    setSaving(false);
    if (errors.length > 0) {
      showToast(`${successCount} saved, ${errors.length} failed`, 'error');
    } else {
      setSavedCount(prev => prev + successCount);
      showToast(`${successCount} opening balance${successCount > 1 ? 's' : ''} saved`, 'success');
      setLines([{ ...newLine(), location_id: defaultLocation }]);
    }
  }

  const validCount = lines.filter(l => l.product_id && l.location_id && l.qty !== '' && parseFloat(l.qty) > 0).length;

  return (
    <div className="p-6 max-w-6xl">
      {/* Header */}
      <div className="mb-6">
        <Link to="/inventory/stock" className="flex items-center gap-1.5 text-sm text-slate-500 hover:text-slate-700 transition-colors mb-2">
          <ArrowLeft className="w-3.5 h-3.5" />
          Back to Stock List
        </Link>
        <div className="flex items-start justify-between">
          <div>
            <h1 className="text-xl font-bold text-slate-800">Opening Balance Entry</h1>
            <p className="text-sm text-slate-500 mt-0.5">Enter initial stock quantities per product per location</p>
          </div>
          {savedCount > 0 && (
            <div className="flex items-center gap-2 px-3 py-2 bg-emerald-50 border border-emerald-200 rounded-lg text-sm text-emerald-700">
              <CheckCircle className="w-4 h-4" />
              {savedCount} balance{savedCount > 1 ? 's' : ''} saved this session
            </div>
          )}
        </div>
      </div>

      {/* Quick location apply */}
      {locations.length > 1 && (
        <div className="flex items-center gap-3 mb-4 p-4 bg-slate-50 rounded-xl border border-slate-200">
          <span className="text-sm text-slate-600 font-medium whitespace-nowrap">Apply location to all rows:</span>
          <div className="flex flex-wrap gap-2">
            {locations.map(l => (
              <button
                key={l.id}
                onClick={() => { setDefaultLocation(l.id); applyLocationToAll(l.id); }}
                className={`px-3 py-1 text-xs font-medium rounded-lg border transition-colors ${
                  defaultLocation === l.id
                    ? 'bg-blue-600 text-white border-blue-600'
                    : 'bg-white text-slate-600 border-slate-200 hover:border-blue-300'
                }`}
              >
                {l.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Lines table */}
      <div className="bg-white rounded-xl border border-slate-200 shadow-sm overflow-hidden mb-4">
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-slate-50 border-b border-slate-200">
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-8">#</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-64">Product</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider min-w-44">Location</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-32">Qty</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider w-36">Unit Cost (₱)</th>
                <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 uppercase tracking-wider">Notes</th>
                <th className="px-4 py-3 w-10"></th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-100">
              {lines.map((line, idx) => {
                const isValid = line.product_id && line.location_id && line.qty !== '' && parseFloat(line.qty) > 0;
                return (
                  <tr key={line.id} className={`${isValid ? 'bg-white' : 'bg-slate-50/50'}`}>
                    <td className="px-4 py-2 text-xs text-slate-400">{idx + 1}</td>
                    <td className="px-3 py-2">
                      <ProductPicker
                        value={line.product ?? null}
                        onChange={p => setProductOnLine(line.id, p)}
                      />
                    </td>
                    <td className="px-3 py-2">
                      <select
                        value={line.location_id}
                        onChange={e => updateLine(line.id, 'location_id', e.target.value)}
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
                      >
                        <option value="">— Select Location —</option>
                        {locations.map(l => (
                          <option key={l.id} value={l.id}>{l.name}</option>
                        ))}
                      </select>
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.001"
                        value={line.qty}
                        onChange={e => updateLine(line.id, 'qty', e.target.value)}
                        placeholder="0"
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="number"
                        min="0"
                        step="0.01"
                        value={line.unit_cost}
                        onChange={e => updateLine(line.id, 'unit_cost', e.target.value)}
                        placeholder="0.00"
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 text-right tabular-nums"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <input
                        type="text"
                        value={line.notes}
                        onChange={e => updateLine(line.id, 'notes', e.target.value)}
                        placeholder="Optional notes..."
                        className="w-full px-2 py-1.5 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
                      />
                    </td>
                    <td className="px-3 py-2">
                      <button
                        onClick={() => removeLine(line.id)}
                        disabled={lines.length === 1}
                        className="p-1.5 rounded-lg text-slate-300 hover:text-red-500 hover:bg-red-50 disabled:opacity-30 disabled:cursor-not-allowed transition-colors"
                      >
                        <Trash2 className="w-3.5 h-3.5" />
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>

        {/* Add row */}
        <div className="px-4 py-3 border-t border-slate-100 bg-slate-50">
          <button
            onClick={addLine}
            className="flex items-center gap-2 text-sm text-blue-600 font-medium hover:text-blue-700 transition-colors"
          >
            <Plus className="w-4 h-4" />
            Add Row
          </button>
        </div>
      </div>

      {/* Footer */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2">
          {validCount > 0 ? (
            <div className="flex items-center gap-1.5 text-sm text-emerald-600">
              <CheckCircle className="w-4 h-4" />
              {validCount} row{validCount > 1 ? 's' : ''} ready to save
            </div>
          ) : (
            <div className="flex items-center gap-1.5 text-sm text-slate-400">
              <AlertTriangle className="w-4 h-4" />
              Fill in product, location, and quantity to save
            </div>
          )}
        </div>
        <div className="flex items-center gap-3">
          <Link to="/inventory/stock" className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors">
            Cancel
          </Link>
          <button
            onClick={handleSave}
            disabled={saving || validCount === 0}
            className="flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 disabled:cursor-not-allowed transition-colors"
          >
            <Save className="w-4 h-4" />
            {saving ? 'Saving...' : `Save ${validCount > 0 ? validCount + ' ' : ''}Balance${validCount !== 1 ? 's' : ''}`}
          </button>
        </div>
      </div>
    </div>
  );
}
