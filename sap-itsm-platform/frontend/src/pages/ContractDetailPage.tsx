import React, { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contractsApi, shiftsApi, holidaysApi } from '../api/services';
import { format } from 'date-fns';
import { ArrowLeft, FileText, Pencil, History } from 'lucide-react';
import { useAuthStore } from '../store/auth.store';

const SLA_LABELS = { P1:'P1 – Blocker / Critical', P2:'P2 – Major', P3:'P3 – Normal / Minor', P4:'P4 – Query' } as Record<string,string>;
const SLA_COLORS = { P1:'text-red-600', P2:'text-orange-500', P3:'text-blue-600', P4:'text-green-600' } as Record<string,string>;
const SLA_DESCS  = { P1:'Critical system down. Business completely blocked.', P2:'Major feature broken. Significant impact.', P3:'Minor issue. Workaround available.', P4:'General query or low-impact issue.' } as Record<string,string>;

function Row({ label, value }: { label: string; value?: string | React.ReactNode }) {
  return (
    <div className="flex items-start py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-400 w-52 flex-shrink-0">{label}</span>
      <span className="text-sm font-medium text-gray-800">{value || <span className="text-gray-300">—</span>}</span>
    </div>
  );
}
function Sec({ icon, title, color, children }: { icon: string; title: string; color: string; children: React.ReactNode }) {
  return (
    <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
      <div className="flex items-center gap-2 pb-3 border-b border-gray-100 mb-5">
        <span className="text-xl">{icon}</span>
        <h3 className={`font-semibold text-base ${color}`}>{title}</h3>
      </div>
      {children}
    </div>
  );
}

export default function ContractDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const [showChangelog, setShowChangelog] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['contract', id],
    queryFn: () => contractsApi.get(id!).then(r => r.data.contract),
  });

  const { data: changelogData } = useQuery({
    queryKey: ['contract-changelog', id],
    queryFn: () => contractsApi.changelog(id!).then(r => r.data.logs || []),
    enabled: showChangelog,
  });
  const { data: shiftsData }   = useQuery({ queryKey: ['shifts'],   queryFn: () => shiftsApi.list().then(r => r.data.data || []) });
  const { data: holidaysData } = useQuery({ queryKey: ['holidays'], queryFn: () => holidaysApi.list().then(r => r.data.data || []) });

  const shifts: any[]   = shiftsData  || [];
  const holidays: any[] = holidaysData || [];

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading contract...</div>;
  if (!data) return <div className="p-10 text-center text-red-400">Contract not found</div>;

  const c = data;
  const expired = new Date(c.endDate) < new Date();
  const contractShiftIds: string[] = (c.shifts || []).map((s: any) => s.shiftId || s.id);
  const assignedShifts = shifts.filter(s => contractShiftIds.includes(s.id));
  const cal = holidays.find((h: any) => h.id === c.holidayCalendarId);
  const slaP = c.slaConfig?.priorities || c.slaConfig || {};
  const slaCfg = c.slaConfig || {};
  const pauseConditions: string[] = slaCfg.pauseConditions || [];

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center gap-4">
        <button onClick={() => navigate('/contracts')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-2 rounded-lg">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <div className="flex items-center gap-3">
              <h1 className="text-xl font-bold text-gray-900 font-mono">{c.contractNumber}</h1>
              <span className={`text-xs font-bold px-2.5 py-1 rounded-full ${
                c.contractType === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
                c.contractType === 'SILVER' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'
              }`}>{c.contractType}</span>
              {expired && <span className="text-xs font-bold bg-red-100 text-red-600 px-2 py-0.5 rounded-full">EXPIRED</span>}
            </div>
            <p className="text-sm text-gray-400">{c.customer?.companyName}</p>
          </div>
        </div>
        <div className="ml-auto flex items-center gap-2">
          {user?.role === 'SUPER_ADMIN' && (
            <button onClick={() => navigate(`/contracts/${id}/edit`)}
              className="flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-xl text-sm font-medium">
              <Pencil className="w-4 h-4"/> Edit Contract
            </button>
          )}
        </div>
      </div>

      {/* Section 1 — Contract Details */}
      <Sec icon="📋" title="Contract Details" color="text-slate-700">
        <Row label="Contract Number" value={<span className="font-mono">{c.contractNumber}</span>} />
        <Row label="Customer" value={c.customer?.companyName} />
        <Row label="Contract Type" value={
          <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${
            c.contractType === 'GOLD' ? 'bg-yellow-100 text-yellow-700' :
            c.contractType === 'SILVER' ? 'bg-gray-100 text-gray-600' : 'bg-orange-100 text-orange-700'
          }`}>{c.contractType}</span>
        } />
        <Row label="Start Date" value={format(new Date(c.startDate), 'MMMM d, yyyy')} />
        <Row label="End Date" value={
          <span className={expired ? 'text-red-600 font-semibold' : ''}>
            {format(new Date(c.endDate), 'MMMM d, yyyy')}{expired ? ' (Expired)' : ''}
          </span>
        } />
        <Row label="Weekly Pattern" value={slaCfg.weeklyPattern} />
        <Row label="Customer Timezone" value={slaCfg.timezone || c.timezone} />
        <Row label="Holiday Calendar" value={cal?.name} />
        <Row label="Holiday Support" value={c.holidaySupport ? 'Yes' : 'No'} />
        <Row label="After-Hours Multiplier" value={c.afterHoursMultiplier ? `${c.afterHoursMultiplier}×` : undefined} />
        <Row label="Weekend Multiplier" value={c.weekendMultiplier ? `${c.weekendMultiplier}×` : undefined} />
        {assignedShifts.length > 0 && (
          <div className="flex items-start py-2.5 border-b border-gray-50">
            <span className="text-sm text-gray-400 w-52 flex-shrink-0">Support Shifts</span>
            <div className="flex flex-wrap gap-1.5">
              {assignedShifts.map(s => (
                <span key={s.id} className="text-xs font-medium bg-blue-50 text-blue-700 px-2 py-0.5 rounded-lg">
                  {s.name} ({s.startTime}–{s.endTime})
                </span>
              ))}
            </div>
          </div>
        )}
      </Sec>

      {/* Section 2 — SLA */}
      <Sec icon="📊" title="SLA Response & Resolution Times" color="text-blue-700">
        <div className="border border-gray-200 rounded-xl overflow-hidden mb-5">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                <th className="text-left px-5 py-3 font-semibold text-gray-700 w-1/2">Priority</th>
                <th className="text-center px-5 py-3 font-semibold text-gray-700">Response</th>
                <th className="text-center px-5 py-3 font-semibold text-gray-700">Resolution</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {['P1','P2','P3','P4'].map(p => {
                const sla = slaP[p];
                return (
                  <tr key={p}>
                    <td className="px-5 py-4">
                      <p className={`font-semibold ${SLA_COLORS[p]}`}>{SLA_LABELS[p]}</p>
                      <p className="text-xs text-gray-400 mt-0.5">{SLA_DESCS[p]}</p>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-block bg-blue-50 text-blue-700 font-semibold text-sm px-3 py-1.5 rounded-lg">
                        {sla?.response || '—'} min
                      </span>
                    </td>
                    <td className="px-5 py-4 text-center">
                      <span className="inline-block bg-purple-50 text-purple-700 font-semibold text-sm px-3 py-1.5 rounded-lg">
                        {sla?.resolution || '—'} min
                      </span>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
        {pauseConditions.length > 0 && (
          <div>
            <p className="text-sm font-medium text-gray-700 mb-2">SLA Pause Conditions</p>
            <div className="flex flex-wrap gap-2">
              {pauseConditions.map(p => (
                <span key={p} className="text-xs font-medium bg-purple-50 text-purple-700 border border-purple-200 px-3 py-1 rounded-lg">{p}</span>
              ))}
            </div>
          </div>
        )}
      </Sec>

      {/* Section 3 — Billing */}
      <Sec icon="💰" title="Billing & Renewal" color="text-green-700">
        <Row label="Billing Amount" value={c.billingAmount ? `${c.currency} ${Number(c.billingAmount).toLocaleString()}` : undefined} />
        <Row label="Currency" value={c.currency} />
        <Row label="Billing Frequency" value={slaCfg.billingFrequency} />
        <Row label="Payment Terms" value={slaCfg.paymentTerms} />
        <Row label="Auto Renewal" value={
          <span className={c.autoRenewal ? 'text-green-600 font-semibold' : 'text-gray-400'}>
            {c.autoRenewal ? '✓ Yes — Auto Renew' : 'No — Manual Renewal'}
          </span>
        } />
        <Row label="Renewal Notice" value={slaCfg.renewalNoticeDays ? `${slaCfg.renewalNoticeDays} days` : undefined} />
        {slaCfg.notes && <Row label="Notes" value={slaCfg.notes} />}
      </Sec>

      {/* Change Log */}
      <div className="bg-white rounded-2xl border border-gray-200 p-5">
        <button onClick={() => setShowChangelog(!showChangelog)}
          className="flex items-center gap-2 text-sm font-semibold text-gray-700 w-full text-left">
          <History className="w-4 h-4 text-gray-400"/>
          Change Log
          <span className="text-xs text-gray-400 ml-auto">{showChangelog ? '▾ Hide' : '▸ Show'}</span>
        </button>
        {showChangelog && (
          <div className="mt-4 space-y-3">
            {(!changelogData || changelogData.length === 0) ? (
              <p className="text-sm text-gray-400 text-center py-4">No changes recorded yet.</p>
            ) : (
              changelogData.map((log: any) => (
                <div key={log.id} className="flex gap-3 text-sm border-b border-gray-50 pb-3 last:border-0">
                  <div className="w-8 h-8 rounded-full bg-blue-50 flex items-center justify-center flex-shrink-0 text-xs font-bold text-blue-600">
                    {log.user ? `${log.user.firstName?.[0]}${log.user.lastName?.[0]}` : '⚙'}
                  </div>
                  <div className="flex-1">
                    <div className="flex items-center gap-2">
                      <span className="font-medium text-gray-800">{log.user ? `${log.user.firstName} ${log.user.lastName}` : 'System'}</span>
                      <span className="text-xs font-semibold bg-blue-100 text-blue-700 px-2 py-0.5 rounded-full">{log.action}</span>
                      <span className="text-xs text-gray-400 ml-auto">{format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}</span>
                    </div>
                    {log.newValues && (
                      <div className="mt-1 text-xs text-gray-500">
                        {Object.entries(log.newValues).filter(([_, v]) => v != null).map(([k, v]) => (
                          <span key={k} className="mr-3">
                            <span className="text-gray-400">{k}:</span>{' '}
                            {log.oldValues?.[k] != null && <><span className="text-red-400 line-through">{String(log.oldValues[k]).slice(0,30)}</span> → </>}
                            <span className="text-green-600">{String(v).slice(0,50)}</span>
                          </span>
                        ))}
                      </div>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        )}
      </div>
    </div>
  );
}
