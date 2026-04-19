import { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import { Users, Plus, Search, Edit, UserX, UserCheck } from 'lucide-react';
import { supabase } from '../../lib/supabase';
import { useToast } from '../../contexts/ToastContext';
import { formatCurrency } from '../../lib/utils';
import InvModal from '../../inventory/components/InvModal';

interface Employee {
  id: string;
  employee_code: string;
  first_name: string;
  middle_name: string;
  last_name: string;
  department_name: string;
  position_name: string;
  payroll_type: string;
  basic_monthly_rate: number;
  is_active: number;
}

interface Department {
  id: string;
  name: string;
}

const PAGE_SIZE = 25;

export default function EmployeesPage() {
  const navigate = useNavigate();
  const { showToast } = useToast();

  const [employees, setEmployees] = useState<Employee[]>([]);
  const [total, setTotal] = useState(0);
  const [page, setPage] = useState(1);
  const [loading, setLoading] = useState(false);

  const [search, setSearch] = useState('');
  const [statusFilter, setStatusFilter] = useState<'all' | 'active' | 'inactive'>('all');
  const [departmentId, setDepartmentId] = useState('');
  const [departments, setDepartments] = useState<Department[]>([]);

  const [confirmEmployee, setConfirmEmployee] = useState<Employee | null>(null);
  const [toggling, setToggling] = useState(false);

  const searchDebounce = useRef<ReturnType<typeof setTimeout> | null>(null);

  const fetchDepartments = useCallback(async () => {
    const { data } = await supabase.from('hr_departments').select('*').eq('is_active', 1).order('name');
    if (data) setDepartments(data as Department[]);
  }, []);

  const fetchEmployees = useCallback(async (currentPage: number, currentSearch: string) => {
    setLoading(true);
    try {
      const { data, error } = await supabase.rpc('search_employees', {
        search: currentSearch || '',
        department_id: departmentId || '',
        status: statusFilter === 'all' ? '' : statusFilter,
        page: currentPage,
        page_size: PAGE_SIZE,
      });
      if (error) throw error;
      const result = data as { employees: Employee[]; total: number } | null;
      setEmployees(result?.employees ?? []);
      setTotal(result?.total ?? 0);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to load employees', 'error');
    } finally {
      setLoading(false);
    }
  }, [departmentId, statusFilter, showToast]);

  useEffect(() => {
    fetchDepartments();
  }, [fetchDepartments]);

  useEffect(() => {
    if (searchDebounce.current) clearTimeout(searchDebounce.current);
    searchDebounce.current = setTimeout(() => {
      setPage(1);
      fetchEmployees(1, search);
    }, 300);
    return () => {
      if (searchDebounce.current) clearTimeout(searchDebounce.current);
    };
  }, [search, departmentId, statusFilter, fetchEmployees]);

  const handleToggleActive = async () => {
    if (!confirmEmployee) return;
    setToggling(true);
    try {
      const newVal = confirmEmployee.is_active ? 0 : 1;
      const { error } = await supabase
        .from('hr_employees')
        .update({ is_active: newVal })
        .eq('id', confirmEmployee.id);
      if (error) throw error;
      showToast(`Employee ${newVal ? 'activated' : 'deactivated'} successfully`, 'success');
      setConfirmEmployee(null);
      fetchEmployees(page, search);
    } catch (err: unknown) {
      showToast((err as Error).message ?? 'Failed to update status', 'error');
    } finally {
      setToggling(false);
    }
  };

  const totalPages = Math.ceil(total / PAGE_SIZE);

  return (
    <div className="p-6 space-y-4">
      <div className="flex items-center justify-between mb-6">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">Employees</h1>
          <p className="text-sm text-slate-500 mt-0.5">{total} employee{total !== 1 ? 's' : ''} found</p>
        </div>
        <button
          onClick={() => navigate('/payroll/employees/new')}
          className="inline-flex items-center gap-2 px-4 py-2 bg-blue-600 text-white text-sm font-medium rounded-lg hover:bg-blue-700"
        >
          <Plus className="w-4 h-4" />
          Add Employee
        </button>
      </div>

      {/* Filters */}
      <div className="bg-white border border-slate-200 rounded-xl p-4">
        <div className="grid grid-cols-1 md:grid-cols-3 gap-3">
          <div className="relative">
            <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-slate-400" />
            <input
              type="text"
              placeholder="Search by name or code…"
              value={search}
              onChange={e => setSearch(e.target.value)}
              className="w-full border border-slate-300 rounded-lg pl-9 pr-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
            />
          </div>
          <select
            value={departmentId}
            onChange={e => { setDepartmentId(e.target.value); setPage(1); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="">All Departments</option>
            {departments.map(d => (
              <option key={d.id} value={d.id}>{d.name}</option>
            ))}
          </select>
          <select
            value={statusFilter}
            onChange={e => { setStatusFilter(e.target.value as 'all' | 'active' | 'inactive'); setPage(1); }}
            className="w-full border border-slate-300 rounded-lg px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
          >
            <option value="all">All Status</option>
            <option value="active">Active</option>
            <option value="inactive">Inactive</option>
          </select>
        </div>
      </div>

      {/* Table */}
      <div className="bg-white border border-slate-200 rounded-xl">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-8 h-8 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : employees.length === 0 ? (
          <div className="text-center py-16 text-slate-400">
            <Users className="w-12 h-12 mx-auto mb-3 opacity-40" />
            <p className="font-medium">No employees found</p>
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 text-slate-600 text-xs uppercase">
                <tr>
                  <th className="px-4 py-3 text-left">Code</th>
                  <th className="px-4 py-3 text-left">Name</th>
                  <th className="px-4 py-3 text-left">Department</th>
                  <th className="px-4 py-3 text-left">Position</th>
                  <th className="px-4 py-3 text-left">Type</th>
                  <th className="px-4 py-3 text-right">Monthly Rate</th>
                  <th className="px-4 py-3 text-center">Status</th>
                  <th className="px-4 py-3 text-center">Actions</th>
                </tr>
              </thead>
              <tbody>
                {employees.map(emp => (
                  <tr key={emp.id} className="border-b border-slate-100 hover:bg-slate-50">
                    <td className="px-4 py-3 font-mono text-xs text-slate-600">{emp.employee_code}</td>
                    <td className="px-4 py-3 font-medium text-slate-800">
                      {emp.last_name}, {emp.first_name}{emp.middle_name ? ` ${emp.middle_name}` : ''}
                    </td>
                    <td className="px-4 py-3 text-slate-600">{emp.department_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{emp.position_name ?? '—'}</td>
                    <td className="px-4 py-3 text-slate-600">{emp.payroll_type}</td>
                    <td className="px-4 py-3 text-right font-medium text-slate-800">
                      {formatCurrency(parseFloat(String(emp.basic_monthly_rate)) || 0)}
                    </td>
                    <td className="px-4 py-3 text-center">
                      {emp.is_active ? (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-700">Active</span>
                      ) : (
                        <span className="px-2 py-0.5 rounded-full text-xs font-medium bg-slate-100 text-slate-600">Inactive</span>
                      )}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center justify-center gap-2">
                        <button
                          onClick={() => navigate(`/payroll/employees/${emp.id}/edit`)}
                          title="Edit"
                          className="p-1.5 rounded hover:bg-blue-50 text-blue-600"
                        >
                          <Edit className="w-4 h-4" />
                        </button>
                        <button
                          onClick={() => setConfirmEmployee(emp)}
                          title={emp.is_active ? 'Deactivate' : 'Activate'}
                          className={`p-1.5 rounded ${emp.is_active ? 'hover:bg-red-50 text-red-500' : 'hover:bg-green-50 text-green-600'}`}
                        >
                          {emp.is_active ? <UserX className="w-4 h-4" /> : <UserCheck className="w-4 h-4" />}
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}

        {totalPages > 1 && (
          <div className="flex items-center justify-between px-4 py-3 border-t border-slate-100">
            <span className="text-sm text-slate-500">
              Page {page} of {totalPages} ({total} total)
            </span>
            <div className="flex gap-2">
              <button
                disabled={page <= 1}
                onClick={() => { const p = page - 1; setPage(p); fetchEmployees(p, search); }}
                className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Previous
              </button>
              <button
                disabled={page >= totalPages}
                onClick={() => { const p = page + 1; setPage(p); fetchEmployees(p, search); }}
                className="inline-flex items-center gap-2 px-3 py-1.5 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50 disabled:opacity-40 disabled:cursor-not-allowed"
              >
                Next
              </button>
            </div>
          </div>
        )}
      </div>

      {/* Confirm Toggle Modal */}
      <InvModal
        open={!!confirmEmployee}
        onClose={() => setConfirmEmployee(null)}
        title={confirmEmployee?.is_active ? 'Deactivate Employee' : 'Activate Employee'}
        size="md"
      >
        <div className="p-6 space-y-4">
          <p className="text-sm text-slate-600">
            Are you sure you want to{' '}
            <span className="font-semibold">
              {confirmEmployee?.is_active ? 'deactivate' : 'activate'}
            </span>{' '}
            <span className="font-semibold text-slate-800">
              {confirmEmployee?.last_name}, {confirmEmployee?.first_name}
            </span>?
          </p>
          {confirmEmployee?.is_active ? (
            <p className="text-xs text-slate-500">
              Deactivated employees will not appear in payroll processing.
            </p>
          ) : (
            <p className="text-xs text-slate-500">
              Activated employees will be included in future payroll runs.
            </p>
          )}
          <div className="flex justify-end gap-2 pt-2">
            <button
              onClick={() => setConfirmEmployee(null)}
              className="inline-flex items-center gap-2 px-4 py-2 border border-slate-300 text-slate-700 text-sm font-medium rounded-lg hover:bg-slate-50"
            >
              Cancel
            </button>
            <button
              onClick={handleToggleActive}
              disabled={toggling}
              className={`inline-flex items-center gap-2 px-4 py-2 text-white text-sm font-medium rounded-lg disabled:opacity-60 ${confirmEmployee?.is_active ? 'bg-red-600 hover:bg-red-700' : 'bg-green-600 hover:bg-green-700'}`}
            >
              {toggling ? 'Saving…' : confirmEmployee?.is_active ? 'Deactivate' : 'Activate'}
            </button>
          </div>
        </div>
      </InvModal>
    </div>
  );
}
