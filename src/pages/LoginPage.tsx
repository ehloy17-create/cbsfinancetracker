import { useState, FormEvent, useEffect } from 'react';
import { Navigate } from 'react-router-dom';
import { Wallet, Eye, EyeOff, LogIn } from 'lucide-react';
import { useAuth } from '../contexts/AuthContext';
import { useToast } from '../contexts/ToastContext';
import { writeAuditLog } from '../lib/audit';
import { getDefaultRouteForRole } from '../lib/accessControl';
import { fetchPublicCompanySettings } from '../lib/companySettings';
import { resolveApiBase } from '../lib/apiBase';

export default function LoginPage() {
  const { user, profile, signIn, loading } = useAuth();
  const { showToast } = useToast();
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [showPassword, setShowPassword] = useState(false);
  const [submitting, setSubmitting] = useState(false);
  const [companyName, setCompanyName] = useState('My Business');
  const [logoUrl, setLogoUrl] = useState('');

  useEffect(() => {
    fetchPublicCompanySettings().then(s => {
      setCompanyName(s.app_title?.trim() || s.company_name || 'My Business');
      setLogoUrl(s.logo_url || '');
    });
  }, []);

  const displayLogoUrl = logoUrl
    ? (logoUrl.startsWith('http') ? logoUrl : `${resolveApiBase()}${logoUrl}`)
    : '/app-logo.png';

  if (!loading && user && profile) {
    return <Navigate to={getDefaultRouteForRole(profile.role)} replace />;
  }

  async function handleSubmit(e: FormEvent) {
    e.preventDefault();
    if (!email || !password) {
      showToast('Please enter email and password', 'warning');
      return;
    }
    setSubmitting(true);
    const { error } = await signIn(email, password);
    if (error) {
      showToast(error || 'Invalid credentials', 'error');
      setSubmitting(false);
    } else {
      await writeAuditLog(null, 'LOGIN', 'Auth', undefined, { email });
      showToast('Welcome back!', 'success');
    }
  }

  return (
    <div className="min-h-screen bg-gradient-to-br from-slate-900 via-slate-800 to-blue-900 flex items-center justify-center p-4">
      <div className="w-full max-w-md">
        <div className="text-center mb-8">
          <div className="inline-flex items-center justify-center w-16 h-16 bg-white rounded-2xl shadow-lg mb-4 overflow-hidden">
            {displayLogoUrl ? (
              <img src={displayLogoUrl} alt="Logo" className="w-12 h-12 object-contain rounded-lg" />
            ) : (
              <Wallet className="w-8 h-8 text-slate-700" />
            )}
          </div>
          <h1 className="text-3xl font-bold text-white">{companyName}</h1>
          <p className="text-slate-400 mt-2">Business Management System</p>
        </div>

        <div className="bg-white rounded-2xl shadow-2xl p-8">
          <h2 className="text-xl font-semibold text-slate-800 mb-6">Sign In</h2>
          <form onSubmit={handleSubmit} className="space-y-5">
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="you@example.com"
                className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition"
                required
              />
            </div>
            <div>
              <label className="block text-sm font-medium text-slate-700 mb-1.5">Password</label>
              <div className="relative">
                <input
                  type={showPassword ? 'text' : 'password'}
                  value={password}
                  onChange={e => setPassword(e.target.value)}
                  placeholder="••••••••"
                  className="w-full px-4 py-2.5 border border-slate-300 rounded-lg text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent transition pr-10"
                  required
                />
                <button
                  type="button"
                  onClick={() => setShowPassword(!showPassword)}
                  className="absolute right-3 top-1/2 -translate-y-1/2 text-slate-400 hover:text-slate-600"
                >
                  {showPassword ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                </button>
              </div>
            </div>
            <button
              type="submit"
              disabled={submitting}
              className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-2.5 rounded-lg transition-colors flex items-center justify-center gap-2 disabled:opacity-60"
            >
              {submitting ? (
                <div className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
              ) : (
                <LogIn className="w-4 h-4" />
              )}
              {submitting ? 'Signing in...' : 'Sign In'}
            </button>
          </form>

        </div>
      </div>
    </div>
  );
}
