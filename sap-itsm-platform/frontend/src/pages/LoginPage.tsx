import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Ticket, Eye, EyeOff, AlertCircle } from 'lucide-react';
import { authApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';

export default function LoginPage() {
  const navigate = useNavigate();
  const { setUser, setTokens } = useAuthStore();

  const [email, setEmail]       = useState('');
  const [password, setPassword] = useState('');
  const [showPw, setShowPw]     = useState(false);
  const [loading, setLoading]   = useState(false);
  const [error, setError]       = useState('');

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError('');
    setLoading(true);
    try {
      const res = await authApi.login(email.toLowerCase().trim(), password);
      const { tokens, user } = res.data;
      setTokens(tokens.accessToken, tokens.refreshToken);
      setUser(user);
      navigate('/dashboard', { replace: true });
    } catch (err) {
      setError(getErrorMessage(err));
    } finally {
      setLoading(false);
    }
  };

  return (
    <div className="min-h-screen flex bg-gradient-to-br from-slate-900 via-blue-950 to-slate-900">
      {/* Left branding panel */}
      <div className="hidden lg:flex flex-col justify-between w-1/2 p-12 text-white">
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 bg-blue-500 rounded-xl flex items-center justify-center">
            <Ticket className="w-6 h-6" />
          </div>
          <span className="text-xl font-bold">SAP ITSM Platform</span>
        </div>

        <div>
          <h1 className="text-4xl font-bold leading-tight mb-4">
            Enterprise Service Desk<br />
            <span className="text-blue-400">Built for SAP</span>
          </h1>
          <p className="text-slate-300 text-lg leading-relaxed max-w-md">
            Multi-tenant ITSM with real-time SLA tracking, automated escalations, 
            and full audit compliance.
          </p>

          <div className="mt-10 grid grid-cols-2 gap-4">
            {[
              { label: 'SLA Engine',        desc: 'Shift-aware, real-time' },
              { label: 'Multi-Tenant',       desc: 'Full data isolation' },
              { label: 'Role-Based Access',  desc: '5 granular roles' },
              { label: 'Audit Trail',        desc: 'Every change logged' },
            ].map((f) => (
              <div key={f.label} className="bg-white/5 rounded-xl p-4 border border-white/10">
                <p className="font-semibold text-sm">{f.label}</p>
                <p className="text-xs text-slate-400 mt-0.5">{f.desc}</p>
              </div>
            ))}
          </div>
        </div>

        <p className="text-slate-500 text-sm">© 2024 SAP ITSM Platform. Production Grade.</p>
      </div>

      {/* Right login panel */}
      <div className="flex-1 flex items-center justify-center p-6">
        <div className="w-full max-w-md">
          <div className="bg-white rounded-2xl shadow-2xl p-8">
            {/* Mobile logo */}
            <div className="flex items-center gap-2 mb-8 lg:hidden">
              <div className="w-8 h-8 bg-blue-500 rounded-lg flex items-center justify-center">
                <Ticket className="w-4 h-4 text-white" />
              </div>
              <span className="font-bold text-gray-900">SAP ITSM</span>
            </div>

            <h2 className="text-2xl font-bold text-gray-900 mb-1">Welcome back</h2>
            <p className="text-gray-500 text-sm mb-8">Sign in to your service desk</p>

            {error && (
              <div className="flex items-start gap-2 p-3 bg-red-50 border border-red-200 rounded-xl mb-6 text-sm text-red-700">
                <AlertCircle className="w-4 h-4 flex-shrink-0 mt-0.5" />
                {error}
              </div>
            )}

            <form onSubmit={handleSubmit} className="space-y-5">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Email Address</label>
                <input
                  type="email"
                  value={email}
                  onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@company.com"
                  required
                  autoFocus
                  className="w-full border border-gray-300 rounded-xl px-4 py-3 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                />
              </div>

              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1.5">Password</label>
                <div className="relative">
                  <input
                    type={showPw ? 'text' : 'password'}
                    value={password}
                    onChange={(e) => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    className="w-full border border-gray-300 rounded-xl px-4 py-3 pr-11 text-sm focus:outline-none focus:ring-2 focus:ring-blue-500 focus:border-transparent"
                  />
                  <button
                    type="button"
                    onClick={() => setShowPw(!showPw)}
                    className="absolute right-3 top-1/2 -translate-y-1/2 text-gray-400 hover:text-gray-600"
                  >
                    {showPw ? <EyeOff className="w-4 h-4" /> : <Eye className="w-4 h-4" />}
                  </button>
                </div>
              </div>

              <button
                type="submit"
                disabled={loading}
                className="w-full bg-blue-600 hover:bg-blue-700 text-white font-semibold py-3 rounded-xl text-sm transition-colors disabled:opacity-60 flex items-center justify-center gap-2"
              >
                {loading && <span className="w-4 h-4 border-2 border-white border-t-transparent rounded-full animate-spin" />}
                {loading ? 'Signing in…' : 'Sign In'}
              </button>
            </form>

            {/* Dev hint */}
            {import.meta.env.DEV && (
              <div className="mt-6 p-3 bg-gray-50 rounded-xl border border-gray-200">
                <p className="text-xs font-semibold text-gray-500 mb-2">Dev Quick Login</p>
                <div className="space-y-1">
                  {[
                    ['superadmin@itsm.local', 'Super Admin'],
                    ['admin@acme.com',         'Company Admin'],
                    ['agent1@acme.com',         'Agent L2'],
                    ['user@acme.com',           'End User'],
                  ].map(([e, role]) => (
                    <button
                      key={e}
                      onClick={() => { setEmail(e); setPassword('Admin@123456'); }}
                      className="w-full text-left px-2 py-1 text-xs text-blue-600 hover:bg-blue-50 rounded flex justify-between"
                    >
                      <span>{e}</span>
                      <span className="text-gray-400">{role}</span>
                    </button>
                  ))}
                </div>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  );
}
