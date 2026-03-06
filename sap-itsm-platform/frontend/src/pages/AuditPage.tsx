import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { auditApi } from '../api/services';
import { PageHeader } from '../components/ui/Forms';
import { Search, Filter, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';

const ACTION_COLORS: Record<string,string> = {
  CREATE: 'bg-green-100 text-green-700', UPDATE: 'bg-blue-100 text-blue-700',
  DELETE: 'bg-red-100 text-red-700', STATUS_CHANGE: 'bg-purple-100 text-purple-700',
  ASSIGN: 'bg-amber-100 text-amber-700', COMMENT: 'bg-cyan-100 text-cyan-700',
  LOGIN: 'bg-gray-100 text-gray-600', LOGIN_FAILED: 'bg-red-100 text-red-600',
  TOKEN_REFRESH: 'bg-gray-50 text-gray-400', PASSWORD_CHANGE: 'bg-orange-100 text-orange-700',
  SLA_BREACH: 'bg-red-100 text-red-700', SLA_WARNING: 'bg-amber-100 text-amber-700',
  TIME_ENTRY: 'bg-indigo-100 text-indigo-700',
};

const ENTITY_TYPES = ['User','Agent','Customer','Contract','ITSMRecord','ConfigurationItem','SupportTypeMaster','SLAPolicyMaster','Shift','NotificationRule','EmailTemplate'];
const ACTIONS = ['CREATE','UPDATE','DELETE','STATUS_CHANGE','ASSIGN','COMMENT','TIME_ENTRY','LOGIN','LOGIN_FAILED','PASSWORD_CHANGE','SLA_BREACH','SLA_WARNING'];

export default function AuditPage() {
  const [page, setPage] = useState(1);
  const [filterAction, setFilterAction] = useState('');
  const [filterEntity, setFilterEntity] = useState('');
  const [expandedRows, setExpandedRows] = useState<Set<string>>(new Set());

  const { data, isLoading } = useQuery({
    queryKey: ['audit-logs', page, filterAction, filterEntity],
    queryFn: () => auditApi.list({
      page, limit: 30,
      ...(filterAction && { action: filterAction }),
      ...(filterEntity && { entityType: filterEntity }),
    }).then(r => r.data),
  });

  const logs = data?.logs || [];
  const total = data?.pagination?.total || 0;
  const totalPages = Math.ceil(total / 30);

  const toggleRow = (id: string) => {
    setExpandedRows(prev => {
      const next = new Set(prev);
      next.has(id) ? next.delete(id) : next.add(id);
      return next;
    });
  };

  const renderValues = (label: string, values: any) => {
    if (!values || typeof values !== 'object') return null;
    const entries = Object.entries(values).filter(([_, v]) => v !== undefined && v !== null);
    if (entries.length === 0) return null;
    return (
      <div>
        <p className="text-xs font-semibold text-gray-400 uppercase mb-1">{label}</p>
        <div className="space-y-0.5">
          {entries.map(([k, v]) => (
            <div key={k} className="flex gap-2 text-xs">
              <span className="text-gray-500 font-medium min-w-[120px]">{k}:</span>
              <span className="text-gray-700 break-all">{typeof v === 'object' ? JSON.stringify(v) : String(v)}</span>
            </div>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader title="Audit Log" subtitle={`${total} entries`} />

      <div className="flex items-center gap-3 flex-wrap">
        <Filter className="w-4 h-4 text-gray-400"/>
        <select value={filterEntity} onChange={e => { setFilterEntity(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[180px]">
          <option value="">All Entity Types</option>
          {ENTITY_TYPES.map(t => <option key={t} value={t}>{t}</option>)}
        </select>
        <select value={filterAction} onChange={e => { setFilterAction(e.target.value); setPage(1); }}
          className="border border-gray-200 rounded-xl px-3 py-2.5 text-sm bg-white min-w-[160px]">
          <option value="">All Actions</option>
          {ACTIONS.map(a => <option key={a} value={a}>{a}</option>)}
        </select>
        <span className="text-xs text-gray-400 ml-auto">Showing page {page} of {totalPages || 1}</span>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : logs.length === 0 ? (
        <div className="text-center py-16 text-gray-400">No audit entries found</div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="w-8 px-3 py-3"></th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">Timestamp</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">User</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">Action</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">Entity</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">Entity ID</th>
                <th className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase">IP</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {logs.map((log: any) => {
                const isExpanded = expandedRows.has(log.id);
                const hasDetails = log.oldValues || log.newValues;
                return (
                  <React.Fragment key={log.id}>
                    <tr className={`hover:bg-gray-50 ${hasDetails ? 'cursor-pointer' : ''}`}
                      onClick={() => hasDetails && toggleRow(log.id)}>
                      <td className="px-3 py-3">
                        {hasDetails && (isExpanded
                          ? <ChevronDown className="w-3.5 h-3.5 text-gray-400"/>
                          : <ChevronRight className="w-3.5 h-3.5 text-gray-400"/>
                        )}
                      </td>
                      <td className="px-4 py-3 text-xs text-gray-500 whitespace-nowrap">
                        {format(new Date(log.createdAt), 'dd MMM yyyy HH:mm:ss')}
                      </td>
                      <td className="px-4 py-3 text-sm text-gray-700">
                        {log.user ? `${log.user.firstName} ${log.user.lastName}` : <span className="text-gray-400">System</span>}
                      </td>
                      <td className="px-4 py-3">
                        <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${ACTION_COLORS[log.action] || 'bg-gray-100 text-gray-600'}`}>
                          {log.action}
                        </span>
                      </td>
                      <td className="px-4 py-3">
                        <span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">{log.entityType}</span>
                      </td>
                      <td className="px-4 py-3 text-xs font-mono text-gray-400 max-w-[120px] truncate">{log.entityId?.slice(0, 8)}…</td>
                      <td className="px-4 py-3 text-xs text-gray-400">{log.ipAddress || '—'}</td>
                    </tr>
                    {isExpanded && hasDetails && (
                      <tr>
                        <td></td>
                        <td colSpan={6} className="px-4 py-4 bg-gray-50/50">
                          <div className="grid grid-cols-2 gap-4">
                            {renderValues('Old Values', log.oldValues)}
                            {renderValues('New Values', log.newValues)}
                          </div>
                        </td>
                      </tr>
                    )}
                  </React.Fragment>
                );
              })}
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
