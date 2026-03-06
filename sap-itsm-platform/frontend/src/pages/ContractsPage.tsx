// This file retained only for its secondary exports (CMDBPage, SLAReportPage, AuditPage, ProfilePage)
// The primary ContractsPage has been moved to ContractsListPage.tsx + ContractFormPage.tsx + ContractDetailPage.tsx
import React, { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { cmdbApi, auditApi, reportsApi } from '../api/services';
import { DataTable, Column } from '../components/ui/DataTable';
import { PageHeader, Card, StatCard } from '../components/ui/Forms';
import { format, formatDistanceToNow } from 'date-fns';
import { useSLAReport } from '../hooks/useApi';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { useAuthStore } from '../store/auth.store';
import { Shield, Clock, AlertTriangle, CheckCircle } from 'lucide-react';

export function CMDBPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['cmdb', page],
    queryFn: () => cmdbApi.list({ page, limit: 20 }).then(r => r.data),
  });
  const columns: Column<any>[] = [
    { key:'name', header:'Name', render:r=><span className="font-medium text-gray-900">{r.name}</span> },
    { key:'ciType', header:'Type', render:r=><span className="text-xs bg-blue-50 text-blue-700 px-2 py-0.5 rounded font-medium">{r.ciType}</span> },
    { key:'environment', header:'Environment', render:r=><span className="text-sm text-gray-600">{r.environment||'—'}</span> },
    { key:'status', header:'Status', render:r=>(
      <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${r.status==='ACTIVE'?'bg-green-100 text-green-700':'bg-gray-100 text-gray-500'}`}>{r.status}</span>
    )},
    { key:'customer', header:'Customer', render:r=><span className="text-sm text-gray-600">{r.customer?.companyName||'—'}</span> },
    { key:'tickets', header:'Open Tickets', render:r=><span className="text-sm font-semibold text-blue-600">{r._count?.records||0}</span> },
  ];
  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <PageHeader title="CMDB" subtitle="Configuration Management Database"/>
      <DataTable columns={columns} data={data?.data||[]} loading={isLoading} keyExtractor={r=>r.id}
        pagination={data?.pagination ? {...data.pagination, onPage:setPage} : undefined}
        emptyMessage="No configuration items found."/>
    </div>
  );
}

export function SLAReportPage() {
  const { data, isLoading } = useSLAReport();
  const metrics = data?.metrics;
  if (isLoading) return <div className="p-8 text-center text-gray-400">Loading SLA report...</div>;
  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      <PageHeader title="SLA Reports" subtitle="Service Level Agreement performance"/>
      {metrics && (
        <div className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <StatCard title="Total Tickets" value={metrics.totalRecords||0} icon={<Shield className="w-5 h-5"/>} color="blue"/>
          <StatCard title="Response Met" value={`${metrics.responseMetPct||0}%`} icon={<Clock className="w-5 h-5"/>} color="green"/>
          <StatCard title="Resolution Met" value={`${metrics.resolutionMetPct||0}%`} icon={<CheckCircle className="w-5 h-5"/>} color="purple"/>
          <StatCard title="Breaches" value={metrics.breaches||0} icon={<AlertTriangle className="w-5 h-5"/>} color="red"/>
        </div>
      )}
      {data?.byPriority && (
        <Card title="Tickets by Priority">
          <div className="p-4 h-64">
            <ResponsiveContainer width="100%" height="100%">
              <BarChart data={data.byPriority}>
                <CartesianGrid strokeDasharray="3 3"/>
                <XAxis dataKey="priority"/><YAxis/>
                <Tooltip/>
                <Bar dataKey="count" fill="#3b82f6" radius={[4,4,0,0]}/>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </Card>
      )}
    </div>
  );
}

export function AuditPage() {
  const [page, setPage] = useState(1);
  const { data, isLoading } = useQuery({
    queryKey: ['audit', page],
    queryFn: () => auditApi.list({ page, limit: 20 }).then(r => r.data),
  });
  const columns: Column<any>[] = [
    { key:'user', header:'User', render:r=><span className="text-sm font-medium text-gray-900">{r.user ? `${r.user.firstName} ${r.user.lastName}` : 'System'}</span> },
    { key:'action', header:'Action', render:r=><span className="text-xs font-bold px-2 py-0.5 rounded bg-blue-50 text-blue-700">{r.action}</span> },
    { key:'entity', header:'Entity', render:r=><span className="text-sm text-gray-600">{r.entityType} {r.entityId?.slice(0,8)}</span> },
    { key:'createdAt', header:'Time', render:r=><span className="text-xs text-gray-400">{formatDistanceToNow(new Date(r.createdAt),{addSuffix:true})}</span> },
  ];
  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <PageHeader title="Audit Log" subtitle="System activity and change history"/>
      <DataTable columns={columns} data={data?.data||[]} loading={isLoading} keyExtractor={r=>r.id}
        pagination={data?.pagination ? {...data.pagination, onPage:setPage} : undefined}
        emptyMessage="No audit entries found."/>
    </div>
  );
}

export function ProfilePage() {
  const { user } = useAuthStore();
  return (
    <div className="p-6 max-w-2xl mx-auto">
      <PageHeader title="My Profile" subtitle="Your account details"/>
      <Card>
        <div className="p-6 space-y-4">
          <div className="flex items-center gap-4">
            <div className="w-16 h-16 rounded-full bg-gradient-to-br from-blue-500 to-purple-600 text-white text-2xl font-bold flex items-center justify-center">
              {user?.firstName?.[0]}{user?.lastName?.[0]}
            </div>
            <div>
              <h2 className="text-xl font-bold text-gray-900">{user?.firstName} {user?.lastName}</h2>
              <p className="text-sm text-gray-500">{user?.email}</p>
              <span className="text-xs font-medium bg-slate-100 text-slate-700 px-2 py-0.5 rounded mt-1 inline-block">
                {user?.role?.replace(/_/g,' ')}
              </span>
            </div>
          </div>
        </div>
      </Card>
    </div>
  );
}

export default function ContractsPage() {
  return null; // replaced by ContractsListPage
}
