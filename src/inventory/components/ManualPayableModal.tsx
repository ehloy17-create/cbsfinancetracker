import { useEffect, useState } from 'react';
import { Plus } from 'lucide-react';
import InvModal from './InvModal';
import { supabase } from '../../lib/supabase';
import { InvSupplier } from '../../lib/types';
import { useAuth } from '../../contexts/AuthContext';
import { useToast } from '../../contexts/ToastContext';

interface Props {
  open: boolean;
  onClose: () => void;
  onSaved: () => void;
}

function createEmptyForm() {
  return {
    supplier_id: '',
    payable_date: new Date().toISOString().split('T')[0],
    due_date: '',
    amount: '',
    reference_number: '',
    remarks: '',
  };
}

export default function ManualPayableModal({ open, onClose, onSaved }: Props) {
  const { user } = useAuth();
  const { showToast } = useToast();
  const [suppliers, setSuppliers] = useState<InvSupplier[]>([]);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(createEmptyForm);

  useEffect(() => {
    if (!open) return;
    supabase
      .from('inv_suppliers')
      .select('id, code, name, payment_terms')
      .eq('is_active', true)
      .order('name')
      .then(({ data }) => {
        setSuppliers((data ?? []) as InvSupplier[]);
      });
  }, [open]);

  function setField<K extends keyof typeof form>(key: K, value: typeof form[K]) {
    setForm((current) => ({ ...current, [key]: value }));
  }

  function handleClose() {
    if (saving) return;
    setForm(createEmptyForm());
    onClose();
  }

  async function handleSave() {
    const amount = Number(form.amount);
    if (!form.supplier_id) {
      showToast('Select a supplier', 'error');
      return;
    }
    if (!form.payable_date) {
      showToast('Enter the payable date', 'error');
      return;
    }
    if (!Number.isFinite(amount) || amount <= 0) {
      showToast('Enter a valid amount', 'error');
      return;
    }
    if (form.due_date && form.due_date < form.payable_date) {
      showToast('Due date cannot be earlier than payable date', 'error');
      return;
    }

    setSaving(true);
    const { error } = await supabase.from('payables').insert({
      supplier_id: form.supplier_id,
      receiving_id: null,
      invoice_number: form.reference_number.trim(),
      amount,
      balance: amount,
      due_date: form.due_date || null,
      status: 'open',
      notes: form.remarks.trim(),
      created_by: user?.id ?? null,
      created_at: `${form.payable_date}T00:00:00.000Z`,
      updated_at: `${form.payable_date}T00:00:00.000Z`,
    });

    if (error) {
      showToast(error.message || 'Failed to save payable', 'error');
      setSaving(false);
      return;
    }

    showToast('Manual payable created', 'success');
    setSaving(false);
    setForm(createEmptyForm());
    onSaved();
  }

  return (
    <InvModal open={open} onClose={handleClose} title="Create Manual Payable" size="md">
      <div className="p-6 space-y-5">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
          <div className="md:col-span-2">
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Supplier <span className="text-red-500">*</span>
            </label>
            <select
              value={form.supplier_id}
              onChange={(event) => setField('supplier_id', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            >
              <option value="">Select supplier...</option>
              {suppliers.map((supplier) => (
                <option key={supplier.id} value={supplier.id}>
                  {supplier.code ? `[${supplier.code}] ` : ''}{supplier.name}
                </option>
              ))}
            </select>
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Payable Date <span className="text-red-500">*</span>
            </label>
            <input
              type="date"
              value={form.payable_date}
              onChange={(event) => setField('payable_date', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Due Date</label>
            <input
              type="date"
              value={form.due_date}
              onChange={(event) => setField('due_date', event.target.value)}
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">
              Amount <span className="text-red-500">*</span>
            </label>
            <input
              type="number"
              min="0.01"
              step="0.01"
              value={form.amount}
              onChange={(event) => setField('amount', event.target.value)}
              placeholder="0.00"
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>

          <div>
            <label className="block text-xs font-semibold text-slate-500 mb-1">Reference No.</label>
            <input
              type="text"
              value={form.reference_number}
              onChange={(event) => setField('reference_number', event.target.value)}
              placeholder="Invoice / voucher / bill no."
              className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
        </div>

        <div>
          <label className="block text-xs font-semibold text-slate-500 mb-1">Remarks / Description</label>
          <textarea
            value={form.remarks}
            onChange={(event) => setField('remarks', event.target.value)}
            rows={3}
            className="w-full px-3 py-2 text-sm border border-slate-200 rounded-lg focus:outline-none focus:ring-2 focus:ring-blue-500 resize-none"
            placeholder="Describe this manual payable..."
          />
        </div>

        <div className="flex items-center justify-end gap-3 pt-2 border-t border-slate-100">
          <button
            onClick={handleClose}
            className="px-4 py-2 text-sm font-medium text-slate-700 border border-slate-200 rounded-lg hover:bg-slate-50 transition-colors"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={saving}
            className="inline-flex items-center gap-2 px-5 py-2 text-sm font-medium bg-blue-600 text-white rounded-lg hover:bg-blue-700 disabled:opacity-50 transition-colors"
          >
            <Plus className="w-4 h-4" />
            {saving ? 'Saving...' : 'Save Payable'}
          </button>
        </div>
      </div>
    </InvModal>
  );
}
