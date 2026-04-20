import { useState, useEffect, FormEvent } from 'react';
import { UserPlus, CreditCard as Edit2, AlertTriangle, Check, X, Trash2, ShieldCheck } from 'lucide-react';
import { supabase } from '../lib/supabase';
import { Profile } from '../lib/types';
import { formatDateTime } from '../lib/utils';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { ALL_USER_ROLES, getUserRoleLabel } from '../lib/accessControl';
import ConfirmDialog from '../components/ConfirmDialog';
import UserPermissionsModal from '../components/UserPermissionsModal';
import { buildApiUrl } from '../lib/apiBase';

export default function UsersPage() {
  const { user, profile } = useAuth();
  const { showToast } = useToast();
  const [users, setUsers] = useState<Profile[]>([]);
  const [loading, setLoading] = useState(true);
  const [showAdd, setShowAdd] = useState(false);
  const [editUser, setEditUser] = useState<Profile | null>(null);
  const [newEmail, setNewEmail] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [newName, setNewName] = useState('');
  const [newRole, setNewRole] = useState<Profile['role']>('staff');
  const [submitting, setSubmitting] = useState(false);
  const [deleteTarget, setDeleteTarget] = useState<Profile | null>(null);
  const [permissionsTarget, setPermissionsTarget] = useState<Profile | null>(null);

  async function load() {
    setLoading(true);
    const { data } = await supabase.from('profiles').select('*').order('created_at');
    if (data) setUsers(data);
    setLoading(false);
  }

  useEffect(() => { load(); }, []);

  async function handleAddUser(e: FormEvent) {
    e.preventDefault();
    if (!newEmail || !newPassword || !newName) {
      showToast('All fields are required', 'warning');
      return;
    }
    setSubmitting(true);
    try {
      // Fallback: use signUp
      const { data: signUpData, error: signUpError } = await supabase.auth.signUp({
        email: newEmail,
        password: newPassword,
        options: {
          data: { name: newName, role: newRole }
        }
      });

      if (signUpError) throw signUpError;

      if (signUpData.user) {
        await supabase.from('profiles').upsert({
          id: signUpData.user.id,
          name: newName,
          email: newEmail,
          role: newRole,
          status: 'active',
        });

        await writeAuditLog(user?.id ?? null, 'CREATE_USER', 'Users', signUpData.user.id, {
          email: newEmail,
          role: newRole,
        });
      }

      showToast('User created successfully', 'success');
      setShowAdd(false);
      setNewEmail(''); setNewPassword(''); setNewName(''); setNewRole('staff');
      load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to create user', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleUpdateUser() {
    if (!editUser) return;
    setSubmitting(true);
    try {
      await supabase
        .from('profiles')
        .update({ role: editUser.role, status: editUser.status, name: editUser.name })
        .eq('id', editUser.id);

      await writeAuditLog(user?.id ?? null, 'UPDATE_USER', 'Users', editUser.id, {
        role: editUser.role,
        status: editUser.status,
      });

      showToast('User updated', 'success');
      setEditUser(null);
      load();
    } catch {
      showToast('Failed to update user', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleDeleteUser() {
    if (!deleteTarget) return;
    setSubmitting(true);
    try {
      const { error } = await supabase.from('profiles').delete().eq('id', deleteTarget.id);
      if (error) throw new Error(error.message);
      await writeAuditLog(user?.id ?? null, 'DELETE_USER', 'Users', deleteTarget.id, {
        email: deleteTarget.email,
        role: deleteTarget.role,
      });
      showToast('User deleted', 'success');
      setDeleteTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to delete user', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  async function handleSavePermissions(moduleAccess: string | null) {
    if (!permissionsTarget) return;
    setSubmitting(true);
    try {
      const token = localStorage.getItem('access_token');
      const res = await fetch(
        buildApiUrl(`/profiles?id=eq.${permissionsTarget.id}`),
        {
          method: 'PATCH',
          headers: {
            'Content-Type': 'application/json',
            ...(token ? { Authorization: `Bearer ${token}` } : {}),
          },
          body: JSON.stringify({ module_access: moduleAccess }),
        }
      );
      if (!res.ok) {
        const body = await res.json().catch(() => ({}));
        throw new Error(body?.error || `Server error ${res.status}`);
      }
      await writeAuditLog(user?.id ?? null, 'UPDATE_USER', 'Users', permissionsTarget.id, {
        module_access: moduleAccess,
      });
      showToast('Permissions saved', 'success');
      setPermissionsTarget(null);
      load();
    } catch (err) {
      showToast((err as Error).message || 'Failed to save permissions', 'error');
    } finally {
      setSubmitting(false);
    }
  }

  if (profile?.role !== 'admin') {
    return (
      <div className="flex items-center justify-center h-64">
        <div className="text-center text-slate-400">
          <AlertTriangle className="w-8 h-8 mx-auto mb-2" />
          <p>Admin access required</p>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div className="flex items-center justify-between flex-wrap gap-3">
        <div>
          <h1 className="text-2xl font-bold text-slate-800">User Management</h1>
          <p className="text-slate-500 text-sm mt-1">{users.length} users</p>
        </div>
        <button
          onClick={() => setShowAdd(true)}
          className="flex items-center gap-2 px-4 py-2 bg-blue-600 hover:bg-blue-700 text-white rounded-lg text-sm font-medium transition-colors shadow-sm"
        >
          <UserPlus className="w-4 h-4" />
          Add User
        </button>
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-slate-100 overflow-hidden">
        {loading ? (
          <div className="flex items-center justify-center h-40">
            <div className="w-6 h-6 border-4 border-blue-600 border-t-transparent rounded-full animate-spin" />
          </div>
        ) : (
          <div className="overflow-x-auto">
            <table className="w-full text-sm">
              <thead className="bg-slate-50 border-b border-slate-100">
                <tr>
                  {['Name', 'Email', 'Role', 'Status', 'Last Login', 'Actions'].map(h => (
                    <th key={h} className="text-left px-4 py-3 text-xs font-semibold text-slate-500 uppercase tracking-wide">
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody className="divide-y divide-slate-50">
                {users.map(u => (
                  <tr key={u.id} className="hover:bg-slate-50 transition-colors">
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-3">
                        <div className="w-8 h-8 rounded-full bg-blue-600 flex items-center justify-center flex-shrink-0">
                          <span className="text-white text-xs font-bold">
                            {u.name?.charAt(0)?.toUpperCase()}
                          </span>
                        </div>
                        <span className="font-medium text-slate-700">{u.name}</span>
                      </div>
                    </td>
                    <td className="px-4 py-3 text-slate-500">{u.email}</td>
                    <td className="px-4 py-3">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${
                          roleBadgeClass(u.role)
                        }`}>
                          {getUserRoleLabel(u.role)}
                        </span>
                    </td>
                    <td className="px-4 py-3">
                      <span className={`inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-medium ${
                        u.status === 'active'
                          ? 'bg-emerald-100 text-emerald-700'
                          : 'bg-red-100 text-red-700'
                      }`}>
                        {u.status === 'active' ? <Check className="w-3 h-3" /> : <X className="w-3 h-3" />}
                        {u.status}
                      </span>
                    </td>
                    <td className="px-4 py-3 text-slate-400 text-xs">
                      {u.last_login ? formatDateTime(u.last_login) : 'Never'}
                    </td>
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button
                          onClick={() => setEditUser({ ...u })}
                          className="p-1.5 rounded text-slate-400 hover:text-blue-600 hover:bg-blue-50 transition-colors"
                          title="Edit user"
                        >
                          <Edit2 className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setPermissionsTarget({ ...u })}
                          className="p-1.5 rounded text-slate-400 hover:text-violet-600 hover:bg-violet-50 transition-colors"
                          title="Module permissions"
                        >
                          <ShieldCheck className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => setDeleteTarget({ ...u })}
                          disabled={u.id === user?.id || (u.role === 'admin' && users.filter(x => x.role === 'admin').length === 1)}
                          className="p-1.5 rounded text-slate-400 hover:text-red-600 hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed"
                          title={u.id === user?.id ? "Can't delete yourself" : u.role === 'admin' && users.filter(x => x.role === 'admin').length === 1 ? 'Last admin — cannot delete' : 'Delete user'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
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

      {/* Add User Modal */}
      {showAdd && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setShowAdd(false)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Add New User</h3>
              <button onClick={() => setShowAdd(false)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <form onSubmit={handleAddUser} className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Full Name</label>
                <input type="text" value={newName} onChange={e => setNewName(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required placeholder="John Doe" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
                <input type="email" value={newEmail} onChange={e => setNewEmail(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required placeholder="user@example.com" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
                <input type="password" value={newPassword} onChange={e => setNewPassword(e.target.value)}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500"
                  required placeholder="Min 6 characters" minLength={6} />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
                <select value={newRole} onChange={e => setNewRole(e.target.value as Profile['role'])}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ALL_USER_ROLES.map(role => (
                    <option key={role} value={role}>{getUserRoleLabel(role)}</option>
                  ))}
                </select>
              </div>
              <div className="flex gap-3 pt-2">
                <button type="button" onClick={() => setShowAdd(false)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button type="submit" disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60 flex items-center justify-center gap-2">
                  {submitting ? <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" /> : <UserPlus className="w-4 h-4" />}
                  Create User
                </button>
              </div>
            </form>
          </div>
        </div>
      )}

      {/* Edit User Modal */}
      {editUser && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="absolute inset-0 bg-black/50" onClick={() => setEditUser(null)} />
          <div className="relative bg-white rounded-xl shadow-2xl max-w-md w-full p-6">
            <div className="flex items-center justify-between mb-5">
              <h3 className="text-lg font-semibold text-slate-800">Edit User</h3>
              <button onClick={() => setEditUser(null)} className="text-slate-400 hover:text-slate-600">
                <X className="w-5 h-5" />
              </button>
            </div>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Name</label>
                <input type="text" value={editUser.name} onChange={e => setEditUser({ ...editUser, name: e.target.value })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Role</label>
                <select value={editUser.role} onChange={e => setEditUser({ ...editUser, role: e.target.value as Profile['role'] })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  {ALL_USER_ROLES.map(role => (
                    <option key={role} value={role}>{getUserRoleLabel(role)}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-slate-700 mb-1.5">Status</label>
                <select value={editUser.status} onChange={e => setEditUser({ ...editUser, status: e.target.value as 'active' | 'inactive' })}
                  className="w-full px-3 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500">
                  <option value="active">Active</option>
                  <option value="inactive">Inactive</option>
                </select>
              </div>

              <div className="flex gap-3 pt-2">
                <button onClick={() => setEditUser(null)}
                  className="flex-1 py-2.5 border border-slate-300 text-slate-600 rounded-lg text-sm font-medium hover:bg-slate-50">
                  Cancel
                </button>
                <button onClick={handleUpdateUser} disabled={submitting}
                  className="flex-1 py-2.5 bg-blue-600 text-white rounded-lg text-sm font-medium hover:bg-blue-700 disabled:opacity-60">
                  Save Changes
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
      <ConfirmDialog
        open={!!deleteTarget}
        title="Delete User"
        message={`Permanently delete "${deleteTarget?.name}" (${deleteTarget?.email})? This cannot be undone.`}
        confirmLabel={submitting ? 'Deleting…' : 'Delete'}
        danger
        onConfirm={handleDeleteUser}
        onCancel={() => setDeleteTarget(null)}
      />
      {permissionsTarget && (
        <UserPermissionsModal
          user={permissionsTarget}
          onSave={handleSavePermissions}
          onClose={() => setPermissionsTarget(null)}
        />
      )}
    </div>
  );
}
  function roleBadgeClass(role: Profile['role']) {
    if (role === 'admin')      return 'bg-blue-100 text-blue-700';
    if (role === 'accounting') return 'bg-purple-100 text-purple-700';
    if (role === 'cashier')    return 'bg-amber-100 text-amber-700';
    return 'bg-slate-100 text-slate-600';
  }
