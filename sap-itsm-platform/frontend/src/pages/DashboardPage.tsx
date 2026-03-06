import React from 'react';
import { useNavigate } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import {
  BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer,
  PieChart, Pie, Cell, LineChart, Line, CartesianGrid, Legend
} from 'recharts';
import { Ticket, AlertTriangle, Clock, Users, RefreshCw, TrendingUp } from 'lucide-react';
import { useDashboard } from '../hooks/useApi';
import { dashboardApi } from '../api/services';
import { LoadingSpinner } from '../components/ui/LoadingSpinner';
import { StatCard, Card, PageHeader } from '../components/ui/Forms';
import { PriorityBadge, StatusBadge, TypeBadge, SLABadge } from '../components/ui/Badges';
import { formatDistanceToNow, format } from 'date-fns';
import { useAuthStore } from '../store/auth.store';

const PIE_COLORS = ['#3b82f6','#f59e0b','#8b5cf6','#10b981','#ef4444','#6b7280'];

export default function DashboardPage() {
  const { user } = useAuthStore();
  const role = user?.role;

  if (role === 'PROJECT_MANAGER') return <PMDashboard />;
  if (role === 'COMPANY_ADMIN') return <CustomerDashboard />;
  if (role === 'AGENT') return <AgentDashboard />;
  if (role === 'USER') return <UserDashboard />;
  return <AdminDashboard />;
}

function AdminDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: dashboard, isLoading, refetch, dataUpdatedAt } = useDashboard();

  if (isLoading) return <LoadingSpinner fullscreen label="Loading dashboard…" />;
  if (!dashboard) return (
    <div className="flex flex-col items-center justify-center h-96 gap-4">
      <p className="text-gray-500 text-sm">Unable to load dashboard. Please refresh or log in again.</p>
      <button onClick={() => refetch()} className="px-4 py-2 bg-indigo-600 text-white rounded-lg text-sm">Retry</button>
    </div>
  );

  const d = dashboard;
  const lastUpdated = dataUpdatedAt ? formatDistanceToNow(new Date(dataUpdatedAt), { addSuffix: true }) : '';

  // Recharts data
  const statusData = d?.byStatus?.map((s: any) => ({ name: s.status.replace('_', ' '), value: s.count })) || [];
  const priorityData = d?.byPriority?.map((p: any) => ({ name: p.priority, count: p.count })) || [];
  const typeData = d?.byType?.map((t: any) => ({ name: t.type, value: t.count })) || [];
  const trendData = d?.monthlyTrend?.map((t: any) => ({
    day: new Date(t.day).toLocaleDateString('en', { month: 'short', day: 'numeric' }),
    total: Number(t.total),
    resolved: Number(t.resolved),
  })) || [];

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader
        title={`Good ${getGreeting()}, ${user?.firstName} 👋`}
        subtitle="Here's what's happening in your service desk"
        actions={
          <button
            onClick={() => refetch()}
            className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-700 border border-gray-200 rounded-lg px-3 py-1.5 hover:bg-gray-50"
          >
            <RefreshCw className="w-4 h-4" />
            Refresh {lastUpdated && <span className="text-xs text-gray-400">({lastUpdated})</span>}
          </button>
        }
      />

      {/* ── KPI Cards ─────────────────────────────────────── */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard
          label="Open Tickets"
          value={d?.summary?.totalOpen ?? 0}
          sub="Across all types"
          icon={<Ticket className="w-6 h-6" />}
          color="blue"
        />
        <StatCard
          label="New Today"
          value={d?.summary?.newToday ?? 0}
          sub="Created since midnight"
          icon={<TrendingUp className="w-6 h-6" />}
          color="green"
        />
        <StatCard
          label="Critical (P1)"
          value={d?.summary?.p1Open ?? 0}
          sub="Require immediate action"
          icon={<AlertTriangle className="w-6 h-6" />}
          color="red"
        />
        <StatCard
          label="SLA Breaches"
          value={d?.summary?.slaBreaches ?? 0}
          sub="Active breaches"
          icon={<Clock className="w-6 h-6" />}
          color="orange"
        />
      </div>

      {/* ── Charts Row 1 ──────────────────────────────────── */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        {/* Priority distribution */}
        <Card title="Open by Priority">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <BarChart data={priorityData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="name" tick={{ fontSize: 12 }} />
                <YAxis tick={{ fontSize: 12 }} />
                <Tooltip />
                <Bar dataKey="count" radius={[4, 4, 0, 0]}>
                  {priorityData.map((_: any, i: number) => (
                    <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i] || '#6b7280'} />
                  ))}
                </Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Status distribution */}
        <Card title="Status Breakdown">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent * 100).toFixed(0)}%`} labelLine={false}>
                  {statusData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>

        {/* Record type */}
        <Card title="By Record Type">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={200}>
              <PieChart>
                <Pie data={typeData} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                  {typeData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
                </Pie>
                <Tooltip />
                <Legend />
              </PieChart>
            </ResponsiveContainer>
          </div>
        </Card>
      </div>

      {/* ── Monthly Trend ──────────────────────────────────── */}
      {trendData.length > 0 && (
        <Card title="Monthly Ticket Trend">
          <div className="p-4">
            <ResponsiveContainer width="100%" height={220}>
              <LineChart data={trendData}>
                <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
                <XAxis dataKey="day" tick={{ fontSize: 11 }} />
                <YAxis tick={{ fontSize: 11 }} />
                <Tooltip />
                <Legend />
                <Line type="monotone" dataKey="total"    stroke="#3b82f6" strokeWidth={2} dot={false} name="Created" />
                <Line type="monotone" dataKey="resolved" stroke="#10b981" strokeWidth={2} dot={false} name="Resolved" />
              </LineChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}

      {/* ── Recent Records ─────────────────────────────────── */}
      <Card title="Recent Tickets" actions={
        <button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>
      }>
        <div className="divide-y divide-gray-100">
          {(d?.recentRecords || []).length === 0 && (
            <p className="px-5 py-8 text-sm text-center text-gray-400">No tickets yet.</p>
          )}
          {(d?.recentRecords || []).map((rec: any) => (
            <div
              key={rec.id}
              onClick={() => navigate(`/records/${rec.id}`)}
              className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer transition-colors"
            >
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{rec.recordNumber}</span>
                  <TypeBadge type={rec.recordType} />
                  <PriorityBadge priority={rec.priority} short />
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{rec.title}</p>
                <div className="flex items-center gap-2">
                  {rec.customer && <p className="text-xs text-gray-400">{rec.customer.companyName}</p>}
                  {rec.assignedAgent && (
                    <span className="text-xs text-blue-500">→ {rec.assignedAgent.user?.firstName} {rec.assignedAgent.user?.lastName}</span>
                  )}
                </div>
              </div>
              <div className="flex flex-col items-end gap-1">
                <StatusBadge status={rec.status} />
                <span className="text-xs text-gray-400">
                  {formatDistanceToNow(new Date(rec.createdAt), { addSuffix: true })}
                </span>
              </div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

function getGreeting() {
  const h = new Date().getHours();
  if (h < 12) return 'morning';
  if (h < 18) return 'afternoon';
  return 'evening';
}

// ══════════════════════════════════════════════════════════════
// PM OPERATIONAL HEALTH DASHBOARD
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// PM OPERATIONAL HEALTH DASHBOARD
// ══════════════════════════════════════════════════════════════

// ══════════════════════════════════════════════════════════════
// PM OPERATIONAL HEALTH DASHBOARD
// Pattern: 4 KPI → 3 Charts → Tables
// ══════════════════════════════════════════════════════════════
function PMDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard-pm'], queryFn: () => dashboardApi.pm().then(r => r.data) });
  if (isLoading) return <LoadingSpinner fullscreen label="Loading operational dashboard…" />;

  const customers = d?.customers || [];
  const totalOpen = customers.reduce((s: number, c: any) => s + c.openTickets, 0);
  const totalBreaches = customers.reduce((s: number, c: any) => s + c.breaches, 0);
  const avgSla = customers.length > 0 ? Math.round(customers.reduce((s: number, c: any) => s + c.slaCompliance, 0) / customers.length) : 100;
  const customerChartData = customers.map((c: any) => ({ name: c.companyName?.slice(0, 12), open: c.openTickets, breaches: c.breaches }));
  const moduleData = (d?.moduleHeat || []).slice(0, 8).map((m: any) => ({ name: m.moduleCode, value: m.count }));
  const workloadData = (d?.agentWorkload || []).slice(0, 8).map((a: any) => ({ name: `${a.user?.firstName?.slice(0,8)}`, tickets: a.openTickets, max: a.maxConcurrent || 5 }));

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader title={`Good ${getGreeting()}, ${user?.firstName} 👋`} subtitle="Operational health across managed customers" />
      {/* Row 1: 4 KPIs */}
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Total Open" value={totalOpen} sub="Across all customers" icon={<Ticket className="w-6 h-6"/>} color="blue" />
        <StatCard label="SLA Compliance" value={`${avgSla}%`} sub="Avg across customers" icon={<AlertTriangle className="w-6 h-6"/>} color={avgSla >= 95 ? 'green' : avgSla >= 85 ? 'orange' : 'red'} />
        <StatCard label="SLA Breaches" value={totalBreaches} sub="Last 30 days" icon={<Clock className="w-6 h-6"/>} color="red" />
        <StatCard label="At Risk" value={(d?.slaRisk || []).length} sub="Warning threshold hit" icon={<AlertTriangle className="w-6 h-6"/>} color="orange" />
      </div>
      {/* Row 2: 3 Charts */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Tickets by Customer">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <BarChart data={customerChartData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip /><Legend />
              <Bar dataKey="open" fill="#3b82f6" name="Open" radius={[4,4,0,0]} />
              <Bar dataKey="breaches" fill="#ef4444" name="Breaches" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Module Heat Map (30d)">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={moduleData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {moduleData.map((_: any, i: number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip />
            </PieChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Agent Workload">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <BarChart data={workloadData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" />
              <XAxis dataKey="name" tick={{ fontSize: 10 }} /><YAxis tick={{ fontSize: 11 }} /><Tooltip />
              <Bar dataKey="tickets" fill="#6366f1" name="Open" radius={[4,4,0,0]} />
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
      </div>
      {/* Row 3: Tables */}
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <Card title={`⚠ SLA Risk (${(d?.slaRisk || []).length})`} actions={<button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>}>
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {(d?.slaRisk || []).slice(0,8).map((s: any) => (
              <div key={s.id} onClick={() => navigate(`/records/${s.record?.id}`)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-red-50 cursor-pointer">
                <span className="font-mono text-xs text-gray-400">{s.record?.recordNumber}</span>
                <PriorityBadge priority={s.record?.priority} short />
                <span className="text-sm text-gray-800 truncate flex-1">{s.record?.title}</span>
                <span className="text-xs text-gray-400">{s.record?.customer?.companyName}</span>
              </div>
            ))}
            {(d?.slaRisk || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">No SLA risks</p>}
          </div>
        </Card>
        <Card title={`Aging > 5 days (${(d?.aging || []).length})`}>
          <div className="divide-y divide-gray-100 max-h-64 overflow-y-auto">
            {(d?.aging || []).slice(0,8).map((t: any) => {
              const age = Math.floor((Date.now() - new Date(t.createdAt).getTime()) / 86400000);
              return (
                <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-3 px-4 py-2.5 hover:bg-orange-50 cursor-pointer">
                  <span className="font-mono text-xs">{t.recordNumber}</span>
                  <span className="text-xs font-bold text-orange-600 bg-orange-100 px-1.5 py-0.5 rounded">{age}d</span>
                  <span className="text-sm text-gray-700 truncate flex-1">{t.title}</span>
                  <span className="text-xs text-gray-400">{t.customer?.companyName}</span>
                </div>
              );
            })}
            {(d?.aging || []).length === 0 && <p className="text-xs text-gray-400 text-center py-6">No aging tickets</p>}
          </div>
        </Card>
      </div>
      <Card title="Recent Tickets" actions={<button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>}>
        <div className="divide-y divide-gray-100">
          {(d?.recent || []).map((r: any) => (
            <div key={r.id} onClick={() => navigate(`/records/${r.id}`)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1">
                  <span className="text-xs font-mono text-gray-400">{r.recordNumber}</span><TypeBadge type={r.recordType} /><PriorityBadge priority={r.priority} short />
                </div>
                <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                <span className="text-xs text-gray-400">{r.customer?.companyName}</span>
              </div>
              <div className="flex flex-col items-end gap-1"><StatusBadge status={r.status} /><span className="text-xs text-gray-400">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span></div>
            </div>
          ))}
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// COMPANY ADMIN (CUSTOMER) DASHBOARD
// ══════════════════════════════════════════════════════════════
function CustomerDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard-customer'], queryFn: () => dashboardApi.customer().then(r => r.data) });
  if (isLoading) return <LoadingSpinner fullscreen label="Loading dashboard…" />;

  const s = d?.summary || {};
  const priorityData = ['P1','P2','P3','P4'].map(p => ({ name: p, count: (d?.openByPriority || []).find((e:any) => e.priority === p)?.count || 0 }));
  const moduleData = (d?.moduleBreakdown || []).map((m: any) => ({ name: m.code, value: m.count }));
  const trendData = (d?.monthlyTrend || []).map((t: any) => ({ month: t.month, count: Number(t.count) }));

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader title={`Good ${getGreeting()}, ${user?.firstName} 👋`} subtitle="Your company's support overview" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Tickets" value={s.openCount || 0} sub="Currently active" icon={<Ticket className="w-6 h-6"/>} color="blue" />
        <StatCard label="Resolved (30d)" value={s.resolvedMonth || 0} sub="Last 30 days" icon={<TrendingUp className="w-6 h-6"/>} color="green" />
        <StatCard label="Avg Resolution" value={`${s.avgResolutionHours || 0}h`} sub="Time to resolve" icon={<Clock className="w-6 h-6"/>} color="orange" />
        <StatCard label="SLA Compliance" value={`${s.slaCompliance || 0}%`} sub={`${(d?.slaStatus?.breached || 0)} breaches`} icon={<AlertTriangle className="w-6 h-6"/>} color={s.slaCompliance >= 95 ? 'green' : s.slaCompliance >= 85 ? 'orange' : 'red'} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="Open by Priority">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <BarChart data={priorityData} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} allowDecimals={false} /><Tooltip />
              <Bar dataKey="count" radius={[4,4,0,0]}>{priorityData.map((_:any, i:number) => <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="By SAP Module">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={moduleData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {moduleData.map((_:any, i:number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip />
            </PieChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Monthly Trend">
          <div className="p-4">{trendData.length > 0 ? (
            <ResponsiveContainer width="100%" height={200}>
              <LineChart data={trendData}><CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="month" tick={{ fontSize: 11 }} /><YAxis tick={{ fontSize: 11 }} allowDecimals={false} /><Tooltip />
                <Line type="monotone" dataKey="count" stroke="#3b82f6" strokeWidth={2} dot={{ r: 4 }} name="Tickets" />
              </LineChart>
            </ResponsiveContainer>
          ) : <p className="text-xs text-gray-400 text-center py-16">No trend data</p>}</div>
        </Card>
      </div>
      {(d?.awaitingResponse || []).length > 0 && (
        <Card title={`⚠ Tickets Awaiting Your Response (${d.awaitingResponse.length})`}>
          <div className="divide-y divide-gray-100">
            {d.awaitingResponse.map((t:any) => (
              <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-amber-50 cursor-pointer">
                <span className="font-mono text-xs text-gray-400">{t.recordNumber}</span><PriorityBadge priority={t.priority} short />
                <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span>
                <span className="text-xs text-amber-600 font-medium">Pending {Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 3600000)}h</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="Recent Tickets" actions={<button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>}>
        <div className="divide-y divide-gray-100">
          {(d?.recent || []).map((r:any) => (
            <div key={r.id} onClick={() => navigate(`/records/${r.id}`)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-mono text-gray-400">{r.recordNumber}</span><TypeBadge type={r.recordType} /><PriorityBadge priority={r.priority} short /></div>
                <p className="text-sm font-medium text-gray-900 truncate">{r.title}</p>
                {r.assignedAgent && <span className="text-xs text-blue-500">→ {r.assignedAgent.user?.firstName} {r.assignedAgent.user?.lastName}</span>}
              </div>
              <div className="flex flex-col items-end gap-1"><StatusBadge status={r.status} /><span className="text-xs text-gray-400">{formatDistanceToNow(new Date(r.createdAt), { addSuffix: true })}</span></div>
            </div>
          ))}
          {(d?.recent || []).length === 0 && <p className="text-sm text-gray-400 text-center py-8">No tickets yet</p>}
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// AGENT DASHBOARD
// ══════════════════════════════════════════════════════════════
function AgentDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard-agent'], queryFn: () => dashboardApi.agent().then(r => r.data) });
  if (isLoading) return <LoadingSpinner fullscreen label="Loading workload…" />;

  const assigned = d?.assigned || 0;
  const max = d?.max || 5;
  const pct = Math.min(100, Math.round((assigned / max) * 100));
  const myTickets = d?.myTickets || [];
  const byPriority = ['P1','P2','P3','P4'].map(p => ({ name: p, count: myTickets.filter((t:any) => t.priority === p).length }));
  const byStatus = ['NEW','OPEN','IN_PROGRESS','PENDING'].map(s => ({ name: s.replace('_',' '), value: myTickets.filter((t:any) => t.status === s).length })).filter(s => s.value > 0);

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader title={`Good ${getGreeting()}, ${user?.firstName} 👋`} subtitle="Your ticket workload and assignments" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Assigned to Me" value={assigned} sub={`${Math.max(0, max - assigned)} capacity left`} icon={<Ticket className="w-6 h-6"/>} color="blue" />
        <StatCard label="Utilization" value={`${pct}%`} sub={`${assigned} of ${max} slots`} icon={<Users className="w-6 h-6"/>} color={pct >= 90 ? 'red' : pct >= 60 ? 'orange' : 'green'} />
        <StatCard label="Urgent (P1/P2)" value={(d?.urgent || []).length} sub="Needs attention" icon={<AlertTriangle className="w-6 h-6"/>} color="red" />
        <StatCard label="Resolved (7d)" value={(d?.recentResolved || []).length} sub="Last 7 days" icon={<TrendingUp className="w-6 h-6"/>} color="green" />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="My Tickets by Priority">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <BarChart data={byPriority} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} allowDecimals={false} /><Tooltip />
              <Bar dataKey="count" radius={[4,4,0,0]}>{byPriority.map((_:any, i:number) => <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Status Breakdown">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byStatus} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {byStatus.map((_:any, i:number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip />
            </PieChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title={`🔴 Urgent Tickets (${(d?.urgent || []).length})`}>
          <div className="divide-y divide-gray-100 max-h-[200px] overflow-y-auto">
            {(d?.urgent || []).slice(0,6).map((t:any) => (
              <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-2 px-4 py-2.5 hover:bg-red-50 cursor-pointer">
                <span className="font-mono text-xs">{t.recordNumber}</span><PriorityBadge priority={t.priority} short />
                <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span><StatusBadge status={t.status} />
              </div>
            ))}
            {(d?.urgent || []).length === 0 && <p className="text-xs text-gray-400 text-center py-10">No urgent tickets</p>}
          </div>
        </Card>
      </div>
      <Card title="My Open Tickets" actions={<button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>}>
        <div className="divide-y divide-gray-100">
          {myTickets.map((t:any) => (
            <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-mono text-gray-400">{t.recordNumber}</span><PriorityBadge priority={t.priority} short /></div>
                <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                {t.customer && <span className="text-xs text-gray-400">{t.customer.companyName}</span>}
              </div>
              <div className="flex flex-col items-end gap-1"><StatusBadge status={t.status} /><span className="text-xs text-gray-400">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</span></div>
            </div>
          ))}
          {myTickets.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No open tickets — nice work!</p>}
        </div>
      </Card>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// USER (END USER) DASHBOARD
// ══════════════════════════════════════════════════════════════
function UserDashboard() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const { data: d, isLoading } = useQuery({ queryKey: ['dashboard-user'], queryFn: () => dashboardApi.user().then(r => r.data) });
  if (isLoading) return <LoadingSpinner fullscreen label="Loading your tickets…" />;

  const s = d?.summary || {};
  const myTickets = d?.myTickets || [];
  const statusData = [
    { name: 'Open', value: myTickets.filter((t:any) => ['NEW','OPEN','IN_PROGRESS'].includes(t.status)).length },
    { name: 'Pending', value: myTickets.filter((t:any) => t.status === 'PENDING').length },
    { name: 'Resolved', value: myTickets.filter((t:any) => ['RESOLVED','CLOSED'].includes(t.status)).length },
  ].filter(d => d.value > 0);
  const byPriority = ['P1','P2','P3','P4'].map(p => ({ name: p, count: myTickets.filter((t:any) => t.priority === p).length }));
  const byType = ['INCIDENT','REQUEST','PROBLEM','CHANGE'].map(t => ({ name: t, value: myTickets.filter((r:any) => r.recordType === t).length })).filter(d => d.value > 0);

  return (
    <div className="p-6 space-y-6 max-w-screen-2xl mx-auto">
      <PageHeader title={`Good ${getGreeting()}, ${user?.firstName} 👋`} subtitle="Your support tickets overview" />
      <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
        <StatCard label="Open Tickets" value={s.openCount || 0} sub="Currently active" icon={<Ticket className="w-6 h-6"/>} color="blue" />
        <StatCard label="Resolved" value={s.resolvedCount || 0} sub="Completed" icon={<TrendingUp className="w-6 h-6"/>} color="green" />
        <StatCard label="Awaiting Response" value={(d?.awaitingResponse || []).length} sub="Needs your input" icon={<Clock className="w-6 h-6"/>} color="orange" />
        <StatCard label="Total Created" value={s.totalCount || 0} sub="All time" icon={<Users className="w-6 h-6"/>} />
      </div>
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
        <Card title="By Priority">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <BarChart data={byPriority} margin={{ top: 0, right: 0, bottom: 0, left: -20 }}>
              <CartesianGrid strokeDasharray="3 3" stroke="#f0f0f0" /><XAxis dataKey="name" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} allowDecimals={false} /><Tooltip />
              <Bar dataKey="count" radius={[4,4,0,0]}>{byPriority.map((_:any, i:number) => <Cell key={i} fill={['#ef4444','#f97316','#eab308','#22c55e'][i]} />)}</Bar>
            </BarChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="Status Breakdown">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={statusData} dataKey="value" nameKey="name" cx="50%" cy="50%" outerRadius={75} label={({ name, percent }) => `${name} ${(percent*100).toFixed(0)}%`} labelLine={false}>
                {statusData.map((_:any, i:number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip />
            </PieChart>
          </ResponsiveContainer></div>
        </Card>
        <Card title="By Record Type">
          <div className="p-4"><ResponsiveContainer width="100%" height={200}>
            <PieChart>
              <Pie data={byType} dataKey="value" nameKey="name" cx="50%" cy="50%" innerRadius={50} outerRadius={80}>
                {byType.map((_:any, i:number) => <Cell key={i} fill={PIE_COLORS[i % PIE_COLORS.length]} />)}
              </Pie><Tooltip /><Legend />
            </PieChart>
          </ResponsiveContainer></div>
        </Card>
      </div>
      {(d?.awaitingResponse || []).length > 0 && (
        <Card title={`⚠ Awaiting Your Response (${d.awaitingResponse.length})`}>
          <div className="divide-y divide-gray-100">
            {d.awaitingResponse.map((t:any) => (
              <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-3 px-5 py-3 hover:bg-amber-50 cursor-pointer">
                <span className="font-mono text-xs text-gray-400">{t.recordNumber}</span><PriorityBadge priority={t.priority} short />
                <span className="text-sm text-gray-800 truncate flex-1">{t.title}</span>
                <span className="text-xs text-amber-600 font-medium">Pending {Math.floor((Date.now() - new Date(t.updatedAt).getTime()) / 3600000)}h</span>
              </div>
            ))}
          </div>
        </Card>
      )}
      <Card title="My Recent Tickets" actions={<button onClick={() => navigate('/records')} className="text-xs text-blue-600 hover:underline">View all →</button>}>
        <div className="divide-y divide-gray-100">
          {myTickets.map((t:any) => (
            <div key={t.id} onClick={() => navigate(`/records/${t.id}`)} className="flex items-center gap-4 px-5 py-3.5 hover:bg-gray-50 cursor-pointer">
              <div className="flex-1 min-w-0">
                <div className="flex items-center gap-2 mb-1"><span className="text-xs font-mono text-gray-400">{t.recordNumber}</span><TypeBadge type={t.recordType} /><PriorityBadge priority={t.priority} short /></div>
                <p className="text-sm font-medium text-gray-900 truncate">{t.title}</p>
                {t.assignedAgent && <span className="text-xs text-blue-500">→ {t.assignedAgent.user?.firstName} {t.assignedAgent.user?.lastName}</span>}
              </div>
              <div className="flex flex-col items-end gap-1"><StatusBadge status={t.status} /><span className="text-xs text-gray-400">{formatDistanceToNow(new Date(t.createdAt), { addSuffix: true })}</span></div>
            </div>
          ))}
          {myTickets.length === 0 && <p className="text-sm text-gray-400 text-center py-8">No tickets yet. Create one from the Tickets page.</p>}
        </div>
      </Card>
    </div>
  );
}
