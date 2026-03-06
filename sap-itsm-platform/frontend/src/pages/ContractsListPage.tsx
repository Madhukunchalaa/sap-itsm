import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { contractsApi, shiftsApi, holidaysApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { format } from 'date-fns';
import { Plus, FileText, Eye } from 'lucide-react';

export default function ContractsListPage() {
  const { user } = useAuthStore();
  const navigate = useNavigate();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data: contracts, isLoading } = useQuery({
    queryKey: ['contracts'],
    queryFn: () => contractsApi.list().then(r => r.data.contracts || []),
  });
  const { data: shiftsData } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.list().then(r => r.data.data || []),
  });
  const shifts: any[] = shiftsData || [];

  const rows: any[] = contracts || [];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-green-600 flex items-center justify-center">
            <FileText className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contracts</h1>
            <p className="text-xs text-gray-400">SLA contracts and agreements</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => navigate('/contracts/new')}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Contract
          </button>
        )}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white text-xs">
              {['Contract #', 'Customer', 'Type', 'Expires', 'Value', 'Shifts', 'SLA P1', 'Tickets', 'Auto-Renew', ''].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={10} className="text-center py-12 text-gray-400">Loading...</td></tr>
            ) : rows.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-14 text-gray-400">No contracts found.</td></tr>
            ) : rows.map((r: any) => {
              const expired = new Date(r.endDate) < new Date();
              const contractShiftIds: string[] = (r.shifts || []).map((s: any) => s.shiftId || s.id);
              const shiftNames = shifts.filter(s => contractShiftIds.includes(s.id)).map(s => s.name);
              const p1 = r.slaConfig?.priorities?.P1 || r.slaConfig?.P1;
              return (
                <tr key={r.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3 font-mono text-sm font-semibold text-gray-900">{r.contractNumber}</td>
                  <td className="px-4 py-3 font-medium text-gray-800">{r.customer?.companyName}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
                      r.contractType === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
                      r.contractType === 'SILVER' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'
                    }`}>{r.contractType}</span>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-sm ${expired ? 'text-red-600 font-semibold' : 'text-gray-600'}`}>
                      {format(new Date(r.endDate), 'MMM d, yyyy')}
                    </span>
                    {expired && <span className="ml-1 text-xs text-red-400">(Expired)</span>}
                  </td>
                  <td className="px-4 py-3 text-sm font-medium text-gray-700">
                    {r.currency} {Number(r.billingAmount || 0).toLocaleString()}
                  </td>
                  <td className="px-4 py-3">
                    {shiftNames.length > 0
                      ? <div className="space-y-0.5">{shiftNames.map(n => <div key={n} className="text-xs text-gray-500">{n}</div>)}</div>
                      : <span className="text-xs text-gray-300">—</span>}
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-600">{p1?.response || '—'} min</td>
                  <td className="px-4 py-3 font-semibold text-blue-600">{r._count?.records || 0}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium ${r.autoRenewal ? 'text-green-600' : 'text-gray-400'}`}>
                      {r.autoRenewal ? 'Yes' : 'No'}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    <button
                      onClick={() => navigate(`/contracts/${r.id}`)}
                      className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 px-2 py-1 rounded hover:bg-blue-50 transition-colors font-medium"
                    >
                      <Eye className="w-3.5 h-3.5" /> View
                    </button>
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}
