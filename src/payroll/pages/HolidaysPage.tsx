import { useState, useEffect, useCallback } from 'react';
import { CalendarDays, Plus, Edit2, Sun, Trash2, AlertTriangle } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatDate } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface Holiday {
  holiday_id: number;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  is_recurring: number | boolean;
  year: number;
  is_active: number | boolean;
}

interface HolidayForm {
  holiday_id: number | null;
  holiday_name: string;
  holiday_date: string;
  holiday_type: string;
  is_recurring: boolean;
  year: string;
  is_active: boolean;
}

const EMPTY_FORM: HolidayForm = {
  holiday_id: null,
  holiday_name: '',
  holiday_date: '',
  holiday_type: 'Legal',
  is_recurring: false,
  year: '',
  is_active: true,
};

const PH_2025_HOLIDAYS = [
  { holiday_name: "New Year's Day", holiday_date: '2025-01-01', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Araw ng Kagitingan', holiday_date: '2025-04-09', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Maundy Thursday', holiday_date: '2025-04-17', holiday_type: 'Legal', is_recurring: false },
  { holiday_name: 'Good Friday', holiday_date: '2025-04-18', holiday_type: 'Legal', is_recurring: false },
  { holiday_name: 'Labor Day', holiday_date: '2025-05-01', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Independence Day', holiday_date: '2025-06-12', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Bonifacio Day', holiday_date: '2025-11-30', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Christmas Day', holiday_date: '2025-12-25', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: 'Rizal Day', holiday_date: '2025-12-30', holiday_type: 'Legal', is_recurring: true },
  { holiday_name: "New Year's Eve", holiday_date: '2025-12-31', holiday_type: 'Special', is_recurring: true },
];

export default function HolidaysPage() {
  const { showToast } = useToast();

  const [holidays, setHolidays] = useState<Holiday[]>([]);
  const [total, setTotal] = useState(0);
  const [loading, setLoading] = useState(false);
  const [seeding, setSeeding] = useState(false);

  const currentYear = new Date().getFullYear();
  const [yearFilter, setYearFilter] = useState(String(currentYear));
  const [searchName, setSearchName] = useState('');

  const [modalOpen, setModalOpen] = useState(false);
  const [form, setForm] = useState<HolidayForm>(EMPTY_FORM);
  const [saving, setSaving] = useState(false);

  const [deleteTarget, setDeleteTarget] = useState<Holiday | null>(null);
  const [deleting, setDeleting] = useState(false);

  const fetchHolidays = useCallback(async () => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_holidays', {
        search: searchName || null,
        year: yearFilter ? parseInt(yearFilter) : null,
      });
      if (error) throw error;
      const result = data as { holidays: Holiday[]; total: number } | null;
      setHolidays(result?.holidays ?? []);
      setTotal(result?.total ?? 0);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load holidays', 'error');
    } finally {
      setLoading(false);
    }
  }, [searchName, yearFilter, showToast]);

  useEffect(() => {
    fetchHolidays();
  }, [fetchHolidays]);

  const openAdd = () => {
    setForm({ ...EMPTY_FORM, year: yearFilter });
    setModalOpen(true);
  };

  const openEdit = (h: Holiday) => {
    setForm({
      holiday_id: h.holiday_id,
      holiday_name: h.holiday_name,
      holiday_date: String(h.holiday_date).slice(0, 10),
      holiday_type: h.holiday_type,
      is_recurring: !!h.is_recurring,
      year: String(h.year),
      is_active: !!h.is_active,
    });
    setModalOpen(true);
  };

  const set = (field: keyof HolidayForm, value: unknown) =>
    setForm(prev => ({ ...prev, [field]: value }));

  const handleDateChange = (val: string) => {
    set('holiday_date', val);
    if (val) {
      const y = val.split('-')[0];
      set('year', y);
    }
  };

  const handleSave = async () => {
    if (!form.holiday_name.trim()) {
      showToast('Holiday name is required', 'error');
      return;
    }
    if (!form.holiday_date) {
      showToast('Holiday date is required', 'error');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        holiday_id: form.holiday_id ?? null,
        holiday_name: form.holiday_name.trim(),
        holiday_date: form.holiday_date,
        holiday_type: form.holiday_type,
        is_recurring: form.is_recurring ? 1 : 0,
        year: form.year ? parseInt(form.year) : null,
        is_active: form.is_active ? 1 : 0,
      };
      const { error } = await supabase.rpc('save_holiday', { holiday: payload });
      if (error) throw error;
      showToast(`Holiday ${form.holiday_id ? 'updated' : 'created'} successfully`, 'success');
      setModalOpen(false);
      fetchHolidays();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to save holiday', 'error');
    } finally {
      setSaving(false);
    }
  };

  const handleToggleActive = async (h: Holiday) => {
    try {
      const newVal = h.is_active ? 0 : 1;
      const { error } = await supabase.rpc('save_holiday', {
        holiday: {
          holiday_id: h.holiday_id,
          holiday_name: h.holiday_name,
          holiday_date: String(h.holiday_date).slice(0, 10),
          holiday_type: h.holiday_type,
          is_recurring: h.is_recurring ? 1 : 0,
          year: h.year,
          is_active: newVal,
        },
      });
      if (error) throw error;
      showToast(`Holiday ${newVal ? 'activated' : 'deactivated'}`, 'success');
      fetchHolidays();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to update holiday', 'error');
    }
  };

  const handleSeedPH2025 = async () => {
    if (holidays.length > 0) {
      showToast('Holidays already exist for this year. Clear them first or change year filter.', 'warning');
      return;
    }
    setSeeding(true);
    try {
      for (const h of PH_2025_HOLIDAYS) {
        const { error } = await supabase.rpc('save_holiday', {
          holiday: {
            holiday_id: null,
            holiday_name: h.holiday_name,
            holiday_date: h.holiday_date,
            holiday_type: h.holiday_type,
            is_recurring: h.is_recurring ? 1 : 0,
            year: 2025,
            is_active: 1,
          },
        });
        if (error) throw error;
      }
      showToast(`Seeded ${PH_2025_HOLIDAYS.length} Philippine holidays for 2025`, 'success');
      fetchHolidays();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Seeding failed', 'error');
    } finally {
      setSeeding(false);
    }
  };

  const handleDelete = async () => {
    if (!deleteTarget) return;
    setDeleting(true);
    try {
      const { error } = await supabase.rpc('delete_holiday', { holiday_id: deleteTarget.holiday_id });
      if (error) throw error;
      showToast('Holiday deleted', 'success');
      setDeleteTarget(null);
      fetchHolidays();
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Delete failed', 'error');
    } finally {
      setDeleting(false);
    }
  };

  const yearOptions = Array.from({ length: 5 }, (_, i) => currentYear - 1 + i);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Holidays</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} holiday{total !== 1 ? 's' : ''} for {yearFilter}</p>
        </div>
        <div className="flex items-center gap-2">
          {yearFilter === '2025' && (
            <button
              onClick={handleSeedPH2025}
              disabled={seeding}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-60"
            >
              <Sun className="w-4 h-4" />
              {seeding ? 'Seeding…' : 'Seed PH 2025 Holidays'}
            </button>
          )}
          <button
            onClick={openAdd}
            className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
          >
            <Plus className="w-4 h-4" />
            Add Holiday
          </button>
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
          <input
            type="text"
            placeholder="Search by name…"
            value={searchName}
            onChange={e => setSearchName(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          />
          <select
            value={yearFilter}
            onChange={e => setYearFilter(e.target.value)}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            {yearOptions.map(y => (
              <option key={y} value={y}>{y}</option>
            ))}
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : holidays.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <CalendarDays className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No holidays found</p>
            {yearFilter === '2025' && (
              <p className="text-xs mt-1">Use the "Seed PH 2025 Holidays" button to populate.</p>
            )}
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Date</th>
                  <th className="px-4 py-3 text-left">Holiday Name</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-center">Recurring</th>
                  <th className="px-4 py-3 text-center">Year</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {holidays.map(h => (
                  <tr key={h.holiday_id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-medium text-slate-800">{formatDate(h.holiday_date)}</td>
                    <td className="px-4 py-3 text-slate-800">{h.holiday_name}</td>
                    <td className="px-4 py-3">
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${h.holiday_type === 'Legal' ? 'bg-blue-100 text-blue-700' : 'bg-amber-100 text-amber-700'}`}>
                        {h.holiday_type}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-center">
                      {h.is_recurring ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Yes</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-500">No</span>
                      )}
                    </td>
                    <td className="px-4 py-3 text-center text-slate-600">{h.year}</td>
                    <td className="px-4 py-3 text-center">
                      <button onClick={() => handleToggleActive(h)}>
                        {h.is_active ? (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700 cursor-pointer hover:bg-green-200">Active</span>
                        ) : (
                          <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600 cursor-pointer hover:bg-slate-200">Inactive</span>
                        )}
                      </button>
                    </td>
                    <td className="px-4 py-3 text-center">
                      <div className="flex items-center justify-center gap-1">
                        <button
                          onClick={() => openEdit(h)}
                          title="Edit"
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        >
                          <Edit2 className="w-4 h-4" />
                        </button>
                        <button onClick={() => setDeleteTarget(h)} title="Delete" className="p-1.5 rounded hover:bg-red-50 text-red-500">
                          <Trash2 className="w-4 h-4" />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </div>

      {/* Add/Edit Modal */}
      <InvModal
        open={modalOpen}
        onClose={() => setModalOpen(false)}
        title={form.holiday_id ? 'Edit Holiday' : 'Add Holiday'}
        size="md"
      >
        <div className="space-y-4 px-6 py-5">
          <div>
            <label className="block text-sm font-medium text-slate-700 mb-1">
              Holiday Name<span className="text-red-500">*</span>
            </label>
            <input
              type="text"
              value={form.holiday_name}
              onChange={e => set('holiday_name', e.target.value)}
              className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              placeholder="e.g. Christmas Day"
            />
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">
                Date <span className="text-red-500">*</span>
              </label>
              <input
                type="date"
                value={form.holiday_date}
                onChange={e => handleDateChange(e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Type</label>
              <select
                value={form.holiday_type}
                onChange={e => set('holiday_type', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
              >
                <option>Legal</option>
                <option>Special</option>
              </select>
            </div>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1">Year</label>
              <input
                type="number"
                value={form.year}
                onChange={e => set('year', e.target.value)}
                className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                placeholder="e.g. 2025"
              />
              <p className="text-xs text-slate-400 mt-1">Auto-filled from date</p>
            </div>
          </div>

          <div className="flex items-center gap-6">
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="is_recurring"
                checked={form.is_recurring}
                onChange={e => set('is_recurring', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="is_recurring" className="text-sm font-medium text-slate-700">Recurring Annually</label>
            </div>
            <div className="flex items-center gap-2">
              <input
                type="checkbox"
                id="h_is_active"
                checked={form.is_active}
                onChange={e => set('is_active', e.target.checked)}
                className="w-4 h-4 rounded border-slate-300 text-blue-600 focus:ring-blue-500"
              />
              <label htmlFor="h_is_active" className="text-sm font-medium text-slate-700">Active</label>
            </div>
          </div>

          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setModalOpen(false)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleSave}
              disabled={saving}
              className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700 disabled:opacity-60"
            >
              {saving ? 'Saving…' : 'Save Holiday'}
            </button>
          </div>
        </div>
      </InvModal>

      {/* Delete Confirmation Modal */}
      <InvModal open={!!deleteTarget} onClose={() => setDeleteTarget(null)} title="Delete Holiday" size="sm">
        <div className="space-y-4 px-6 py-5">
          <div className="flex items-start gap-3">
            <AlertTriangle className="w-6 h-6 text-red-500 flex-shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-medium text-slate-800">Delete this holiday?</p>
              <p className="text-sm text-slate-600 mt-1">{deleteTarget?.holiday_name} — {deleteTarget?.holiday_date}</p>
              <p className="text-xs text-red-600 mt-2">This action cannot be undone.</p>
            </div>
          </div>
          <div className="flex justify-end gap-2 pt-2">
            <button onClick={() => setDeleteTarget(null)} className="px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50">Cancel</button>
            <button onClick={handleDelete} disabled={deleting} className="px-4 py-2 bg-red-600 text-white text-sm font-medium rounded-lg hover:bg-red-700 disabled:opacity-60">
              {deleting ? 'Deleting…' : 'Delete'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
