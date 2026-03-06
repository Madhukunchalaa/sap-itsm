import React, { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { StatusBadge } from '../components/ui/Badges';
import { Plus, Search, Pencil, Building2, Eye } from 'lucide-react';

export default function CustomersPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const isCompanyAdmin = user?.role === 'COMPANY_ADMIN';
  const [search, setSearch] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['customers', search],
    queryFn: () => customersApi.list({ search: search || undefined, limit: 100 }).then(r => r.data),
  });
  const customers: any[] = data?.data || [];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-blue-600 flex items-center justify-center">
            <Building2 className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Customers</h1>
            <p className="text-xs text-gray-400">{customers.length} total</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => navigate('/customers/new')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Customer
          </button>
        )}
      </div>

      {/* Search */}
      <div className="relative max-w-sm">
        <Search className="absolute left-3 top-1/2 -translate-y-1/2 w-4 h-4 text-gray-400" />
        <input
          value={search} onChange={e => setSearch(e.target.value)}
          placeholder="Search customers..."
          className="w-full pl-9 pr-4 py-2.5 text-sm border border-gray-200 rounded-xl focus:outline-none focus:ring-2 focus:ring-blue-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white text-xs">
              {['Company', 'Industry', 'Country', 'Company Admin', 'Project Manager', 'Contract', 'Tickets', 'Status', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : customers.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-14 text-gray-400">No customers found.</td></tr>
            ) : customers.map((c: any) => (
              <tr key={c.id} className="hover:bg-gray-50 transition-colors">
                <td className="px-4 py-3">
                  <p className="font-semibold text-gray-900">{c.companyName}</p>
                  {c.contactEmail && <p className="text-xs text-gray-400">{c.contactEmail}</p>}
                </td>
                <td className="px-4 py-3 text-gray-500">{c.industry || '—'}</td>
                <td className="px-4 py-3 text-gray-500">{c.country || '—'}</td>
                <td className="px-4 py-3">
                  {c.adminUser
                    ? <span className="text-xs font-medium text-blue-700">{c.adminUser.firstName} {c.adminUser.lastName}</span>
                    : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.projectManager
                    ? <span className="text-xs font-medium text-violet-700">{c.projectManager.user?.firstName} {c.projectManager.user?.lastName}</span>
                    : <span className="text-xs text-gray-300">—</span>}
                </td>
                <td className="px-4 py-3">
                  {c.contracts?.[0]
                    ? <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                        c.contracts[0].contractType === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
                        c.contracts[0].contractType === 'SILVER' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'
                      }`}>{c.contracts[0].contractType}</span>
                    : <span className="text-xs text-gray-300">None</span>}
                </td>
                <td className="px-4 py-3 font-semibold text-blue-600">{c._count?.records || 0}</td>
                <td className="px-4 py-3"><StatusBadge status={c.status} /></td>
                <td className="px-4 py-3">
                  {isSuperAdmin ? (
                    <button
                      onClick={() => navigate(`/customers/${c.id}/edit`)}
                      className="text-blue-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50 transition-colors"
                      title="Edit"
                    >
                      <Pencil className="w-4 h-4" />
                    </button>
                  ) : (isCompanyAdmin || user?.role === 'PROJECT_MANAGER') ? (
                    <button
                      onClick={() => navigate(`/customers/${c.id}`)}
                      className="flex items-center gap-1 text-xs text-gray-500 hover:text-gray-700 px-2 py-1 rounded hover:bg-gray-100 transition-colors"
                      title="View"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
