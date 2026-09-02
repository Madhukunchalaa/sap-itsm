import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { statusHistoryApi, customersApi, plantsApi, agentsApi, usersApi } from '../api/services';
import { PageHeader, Button } from '../components/ui/Forms';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { Download, ArrowRight, History } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const STATUS_COLORS: Record<string, string> = {
  NEW: 'bg-gray-100 text-gray-600', OPEN: 'bg-indigo-100 text-indigo-700', IN_PROGRESS: 'bg-indigo-100 text-indigo-700',
  AWAITING_CUSTOMER: 'bg-orange-100 text-orange-700', IN_UAT: 'bg-teal-100 text-teal-700',
  HOLD: 'bg-pink-100 text-pink-700', RESOLVED: 'bg-green-100 text-green-700', CLOSED: 'bg-green-100 text-green-700',
  MOVED_TO_QUALITY: 'bg-cyan-100 text-cyan-700', MOVED_TO_PRODUCTION: 'bg-emerald-100 text-emerald-700',
};
const statusChip = (s: string) => (
  <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[s] || 'bg-gray-100 text-gray-600'}`}>
    {s.replace(/_/g, ' ')}
  </span>
);

export default function StatusHistoryPage() {
  const { user } = useAuthStore();
  const showCustomerFilter = ['SUPER_ADMIN', 'PROJECT_MANAGER'].includes(user?.role || '');
  const showPlantFilter = ['SUPER_ADMIN', 'PROJECT_MANAGER', 'COMPANY_ADMIN'].includes(user?.role || '');
  // "Changed By" needs GET /users, which is gated to SUPER_ADMIN/COMPANY_ADMIN/PROJECT_MANAGER —
  // Plant Manager would just get a 403, so skip fetching it for that role.
  const showUserFilter = user?.role !== 'PLANT_MANAGER';

  const [page, setPage] = useState(1);
  const [customerId, setCustomerId] = useState('');
  const [plant, setPlant] = useState('');
  const [assignedAgentId, setAssignedAgentId] = useState('');
  const [changedById, setChangedById] = useState('');
  const [from, setFrom] = useState('');
  const [to, setTo] = useState('');
  const [exporting, setExporting] = useState(false);

  const { data: agentsData } = useQuery({
    queryKey: ['agents-list-sh'],
    queryFn: () => agentsApi.list({ limit: 200 }).then(r => r.data.data || []),
  });
  const agents: any[] = agentsData || [];

  const { data: usersData } = useQuery({
    queryKey: ['users-list-sh'],
    queryFn: () => usersApi.list({ limit: 500 }).then(r => r.data.data || []),
    enabled: showUserFilter,
  });
  const changedByUsers: any[] = usersData || [];

  const { data: customersData } = useQuery({
    queryKey: ['customers-list-sh'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
    enabled: showCustomerFilter,
  });
  const customers: any[] = customersData || [];

  const plantCustomerId = showCustomerFilter ? customerId : (user?.customer?.id || '');
  const { data: plantsData } = useQuery({
    queryKey: ['plants-by-customer-sh', plantCustomerId],
    queryFn: () => plantsApi.byCustomer(plantCustomerId).then(r => r.data.data || []),
    enabled: showPlantFilter && !!plantCustomerId,
  });
  const plants: any[] = plantsData || [];

  const filters: Record<string, string> = {
    ...(customerId && { customerId }),
    ...(plant && { plant }),
    ...(assignedAgentId && { assignedAgentId }),
    ...(changedById && { changedById }),
    ...(from && { from: new Date(`${from}T00:00:00`).toISOString() }),
    ...(to && { to: new Date(`${to}T23:59:59.999`).toISOString() }),
  };

  const { data, isLoading } = useQuery({
    queryKey: ['status-history', page, filters],
    queryFn: () => statusHistoryApi.list({ page, limit: 30, ...filters }).then(r => r.data),
  });

  const rows: any[] = data?.data || [];
  const total = data?.total || 0;
  const totalPages = Math.ceil(total / 30);

  const handleExport = async () => {
    setExporting(true);
    try {
      const res = await statusHistoryApi.export(filters);
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = `status-history-${format(new Date(), 'yyyy-MM-dd')}.xlsx`;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setExporting(false);
    }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader
        title="Status Change History"
        subtitle={`${total} status change${total !== 1 ? 's' : ''} — for review or audit purposes`}
        actions={<Button onClick={handleExport} loading={exporting}><Download className="w-4 h-4"/>Export to Excel</Button>}
      />

      <div className="flex items-center gap-3 flex-wrap bg-white border border-gray-200 rounded-xl p-3">
        {showCustomerFilter && (
          <select value={customerId} onChange={e => { setCustomerId(e.target.value); setPlant(''); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[180px]">
            <option value="">All Customers</option>
            {customers.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
          </select>
        )}
        {showPlantFilter && (
          <select value={plant} onChange={e => { setPlant(e.target.value); setPage(1); }} disabled={showCustomerFilter && !customerId}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[160px] disabled:bg-gray-50 disabled:text-gray-400">
            <option value="">All Plants</option>
            {plants.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
          </select>
        )}
        <select value={assignedAgentId} onChange={e => { setAssignedAgentId(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[160px]">
          <option value="">All Agents</option>
          {agents.map((a: any) => <option key={a.id} value={a.id}>{a.user?.firstName} {a.user?.lastName}</option>)}
        </select>
        {showUserFilter && (
          <select value={changedById} onChange={e => { setChangedById(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[160px]">
            <option value="">All Users (Changed By)</option>
            {changedByUsers.map((u: any) => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
          </select>
        )}
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">From</label>
          <input type="date" value={from} onChange={e => { setFrom(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"/>
        </div>
        <div className="flex items-center gap-2">
          <label className="text-xs text-gray-500">To</label>
          <input type="date" value={to} onChange={e => { setTo(e.target.value); setPage(1); }}
            className="border border-gray-200 rounded-xl px-3 py-2 text-sm bg-white"/>
        </div>
        {(from || to || plant || customerId || assignedAgentId || changedById) && (
          <button onClick={() => { setFrom(''); setTo(''); setPlant(''); setCustomerId(''); setAssignedAgentId(''); setChangedById(''); setPage(1); }}
            className="text-xs text-gray-400 hover:text-gray-600 underline">Clear filters</button>
        )}
        <span className="text-xs text-gray-400 ml-auto">Page {page} of {totalPages || 1}</span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : rows.length === 0 ? (
        <div className="text-center py-16">
          <History className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No status changes found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase whitespace-nowrap">Ticket</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">Title</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase whitespace-nowrap">Customer / Plant</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase whitespace-nowrap">Transition</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase whitespace-nowrap">Changed By</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase whitespace-nowrap">Changed At</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {rows.map((r: any) => (
                <tr key={r.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs font-mono text-gray-600 whitespace-nowrap">{r.recordNumber}</td>
                  <td className="px-4 py-3 text-sm text-gray-700 max-w-[280px] truncate">{r.title}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                    {r.customerName || '—'}{r.plant ? ` / ${r.plant}` : ''}
                  </td>
                  <td className="px-4 py-3 whitespace-nowrap">
                    <div className="flex items-center gap-1.5">
                      {r.fromStatus ? statusChip(r.fromStatus) : <span className="text-xs text-gray-400">(new)</span>}
                      <ArrowRight className="w-3 h-3 text-gray-300"/>
                      {statusChip(r.toStatus)}
                    </div>
                  </td>
                  <td className="px-4 py-3 text-sm text-gray-700 whitespace-nowrap">{r.changedByName}</td>
                  <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">{format(new Date(r.changedAt), 'dd MMM yyyy HH:mm:ss')}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        </div>
      )}
    </div>
  );
}
