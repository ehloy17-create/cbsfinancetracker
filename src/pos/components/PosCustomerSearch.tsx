import { RefObject, useEffect, useRef, useState } from 'react';
import { Search, Star, UserPlus } from 'lucide-react';
import { CustomerPriceLevel, PosCustomer } from '../../lib/types';
import { createCustomer, searchCustomers } from '../lib/posCheckout';

interface Props {
  onSelect: (customer: PosCustomer | null) => void;
  inputRef?: RefObject<HTMLInputElement>;
  autoFocus?: boolean;
}

export default function PosCustomerSearch({ onSelect, inputRef, autoFocus = false }: Props) {
  const [q, setQ] = useState('');
  const [results, setResults] = useState<PosCustomer[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [showCreate, setShowCreate] = useState(false);
  const [firstName, setFirstName] = useState('');
  const [lastName, setLastName] = useState('');
  const [phone, setPhone] = useState('');
  const [priceLevel, setPriceLevel] = useState<CustomerPriceLevel>('Retail');
  const [saving, setSaving] = useState(false);
  const [saveErr, setSaveErr] = useState('');
  const localInputRef = useRef<HTMLInputElement>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout>>();

  useEffect(() => {
    if (!autoFocus) return;
    window.requestAnimationFrame(() => (inputRef?.current ?? localInputRef.current)?.focus());
  }, [autoFocus, inputRef]);

  useEffect(() => {
    clearTimeout(timerRef.current);
    if (q.trim().length < 2) {
      setResults([]);
      setOpen(false);
      return;
    }
    timerRef.current = setTimeout(async () => {
      setSearching(true);
      const res = await searchCustomers(q.trim());
      setResults(res);
      setOpen(true);
      setSearching(false);
    }, 300);
  }, [q]);

  async function handleCreate() {
    if (!firstName.trim()) {
      setSaveErr('First name is required');
      return;
    }
    setSaveErr('');
    setSaving(true);
    try {
      const newCustomer = await createCustomer(firstName.trim(), lastName.trim(), phone.trim() || undefined, priceLevel);
      onSelect(newCustomer);
      setQ(`${newCustomer.first_name} ${newCustomer.last_name}`.trim());
      setShowCreate(false);
      setOpen(false);
    } catch {
      setSaveErr('Failed to create customer');
    } finally {
      setSaving(false);
    }
  }

  if (showCreate) {
    return (
      <div className="border border-blue-200 rounded-xl p-3 space-y-2 bg-blue-50/40">
        <div className="flex items-center justify-between mb-1">
          <p className="text-xs font-semibold text-blue-700 flex items-center gap-1"><UserPlus className="w-3.5 h-3.5" /> New Customer</p>
          <button onClick={() => setShowCreate(false)} className="text-slate-400 hover:text-slate-600 text-xs">Cancel</button>
        </div>
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text"
            value={firstName}
            onChange={e => setFirstName(e.target.value)}
            placeholder="First name *"
            autoFocus
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <input
            type="text"
            value={lastName}
            onChange={e => setLastName(e.target.value)}
            placeholder="Last name"
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
        </div>
        <input
          type="tel"
          value={phone}
          onChange={e => setPhone(e.target.value)}
          placeholder="Phone (optional)"
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        <select
          value={priceLevel}
          onChange={e => setPriceLevel(e.target.value as CustomerPriceLevel)}
          className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 bg-white"
        >
          <option value="Retail">Retail</option>
          <option value="Wholesale">Wholesale</option>
          <option value="Special">Special</option>
        </select>
        {saveErr && <p className="text-xs text-red-600">{saveErr}</p>}
        <button
          onClick={handleCreate}
          disabled={saving || !firstName.trim()}
          className="w-full py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-40 transition-colors flex items-center justify-center gap-1"
        >
          {saving && <div className="w-3.5 h-3.5 border-2 border-white border-t-transparent rounded-full animate-spin" />}
          Save Customer
        </button>
      </div>
    );
  }

  return (
    <div className="relative">
      <div className="relative">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400 pointer-events-none" />
        <input
          ref={inputRef ?? localInputRef}
          type="text"
          value={q}
          onChange={e => setQ(e.target.value)}
          placeholder="Search customer by name or phone..."
          className="w-full pl-9 pr-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
        {searching && (
          <div className="absolute right-3 top-1/2 -translate-y-1/2 w-4 h-4 border-2 border-blue-400 border-t-transparent rounded-full animate-spin" />
        )}
      </div>
      {open && (
        <div className="absolute z-10 top-full mt-1 left-0 right-0 bg-white border border-slate-200 rounded-xl shadow-lg max-h-48 overflow-y-auto">
          {results.map(customer => (
            <button
              key={customer.customer_id}
              onClick={() => { onSelect(customer); setQ(`${customer.first_name} ${customer.last_name}`.trim()); setOpen(false); }}
              className="w-full flex items-center justify-between px-3 py-2.5 hover:bg-slate-50 text-left text-sm transition-colors"
            >
              <div>
                <p className="font-medium text-slate-800">{customer.first_name} {customer.last_name}</p>
                <p className="text-xs text-slate-500">
                  {customer.price_level}
                  {customer.phone ? ` • ${customer.phone}` : ''}
                </p>
              </div>
              <div className="flex items-center gap-1 text-amber-600 text-xs font-medium">
                <Star className="w-3 h-3" />
                {customer.loyalty_points.toLocaleString()} pts
              </div>
            </button>
          ))}
          {results.length === 0 && !searching && (
            <div className="px-3 py-2.5">
              <p className="text-sm text-slate-400 mb-2">No customers found for "{q}"</p>
            </div>
          )}
          <button
            onClick={() => { setOpen(false); setShowCreate(true); setFirstName(q.trim()); setPriceLevel('Retail'); }}
            className="w-full flex items-center gap-2 px-3 py-2.5 border-t border-slate-100 text-blue-600 hover:bg-blue-50 text-sm font-medium transition-colors"
          >
            <UserPlus className="w-4 h-4" />
            + Create new customer
          </button>
        </div>
      )}
      {!open && q.length === 0 && (
        <button
          onClick={() => setShowCreate(true)}
          className="mt-1.5 flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 transition-colors"
        >
          <UserPlus className="w-3.5 h-3.5" />
          Create new customer
        </button>
      )}
    </div>
  );
}
