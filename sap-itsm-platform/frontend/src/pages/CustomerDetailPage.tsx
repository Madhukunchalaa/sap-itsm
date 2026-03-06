import React from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery } from '@tanstack/react-query';
import { customersApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { ArrowLeft, Building2, Pencil } from 'lucide-react';
import { StatusBadge } from '../components/ui/Badges';

function Row({ label, value }: { label: string; value?: string | null }) {
  return (
    <div className="flex items-start py-2.5 border-b border-gray-50 last:border-0">
      <span className="text-sm text-gray-400 w-48 flex-shrink-0">{label}</span>
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

export default function CustomerDetailPage() {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const { data, isLoading } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id!).then(r => r.data.customer),
  });

  if (isLoading) return <div className="p-10 text-center text-gray-400">Loading...</div>;
  if (!data) return <div className="p-10 text-center text-red-400">Customer not found</div>;

  const c = data;

  return (
    <div className="p-6 max-w-4xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-4">
          <button onClick={() => navigate('/customers')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-2 rounded-lg">
            <ArrowLeft className="w-4 h-4" /> Back
          </button>
          <div className="flex items-center gap-3">
            <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
              <Building2 className="w-5 h-5 text-white" />
            </div>
            <div>
              <h1 className="text-xl font-bold text-gray-900">{c.companyName}</h1>
              <p className="text-sm text-gray-400">{c.industry || ''} {c.country ? `• ${c.country}` : ''}</p>
            </div>
          </div>
        </div>
        {isSuperAdmin && (
          <button onClick={() => navigate(`/customers/${id}/edit`)} className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Pencil className="w-4 h-4" /> Edit
          </button>
        )}
      </div>

      <Sec icon="🏢" title="Company Details" color="text-blue-700">
        <Row label="Company Name" value={c.companyName} />
        <Row label="Industry" value={c.industry} />
        <Row label="Website" value={c.website} />
        <Row label="Country" value={c.country} />
        <Row label="Timezone" value={c.timezone} />
        <div className="flex items-start py-2.5">
          <span className="text-sm text-gray-400 w-48">Status</span>
          <StatusBadge status={c.status} />
        </div>
      </Sec>

      <Sec icon="👤" title="Primary Contact & Billing" color="text-purple-700">
        <Row label="Contact Name" value={c.contactName} />
        <Row label="Contact Email" value={c.contactEmail} />
        <Row label="Contact Phone" value={c.contactPhone} />
        <Row label="Billing Email" value={c.billingEmail} />
        <Row label="Billing Address" value={c.billingAddress} />
      </Sec>

      <Sec icon="⚙️" title="Service Configuration" color="text-orange-700">
        <Row
          label="Company Administrator"
          value={c.adminUser ? `${c.adminUser.firstName} ${c.adminUser.lastName} (${c.adminUser.email})` : undefined}
        />
        <Row
          label="Project Manager"
          value={c.projectManager ? `${c.projectManager.user?.firstName} ${c.projectManager.user?.lastName}` : undefined}
        />
        <Row label="Notes" value={c.notes} />
      </Sec>

      {/* Assigned People */}
      {(c.projectManager || (c.customerAgents?.length > 0)) && (
        <Sec icon="👥" title="Assigned Team" color="text-indigo-700">
          {c.projectManager && (
            <div className="flex items-center gap-3 py-2.5 border-b border-gray-50">
              <div className="w-8 h-8 rounded-full bg-indigo-100 flex items-center justify-center text-xs font-bold text-indigo-700">
                {c.projectManager.user?.firstName?.[0]}{c.projectManager.user?.lastName?.[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{c.projectManager.user?.firstName} {c.projectManager.user?.lastName}</p>
                <p className="text-xs text-indigo-600 font-medium">Project Manager</p>
              </div>
            </div>
          )}
          {(c.customerAgents||[]).map((ca: any) => (
            <div key={ca.agent?.id} className="flex items-center gap-3 py-2.5 border-b border-gray-50 last:border-0">
              <div className="w-8 h-8 rounded-full bg-gray-100 flex items-center justify-center text-xs font-bold text-gray-600">
                {ca.agent?.user?.firstName?.[0]}{ca.agent?.user?.lastName?.[0]}
              </div>
              <div>
                <p className="text-sm font-medium text-gray-900">{ca.agent?.user?.firstName} {ca.agent?.user?.lastName}</p>
                <p className="text-xs text-gray-400 font-medium">Support Agent</p>
              </div>
            </div>
          ))}
        </Sec>
      )}

      {c.contracts?.length > 0 && (
        <Sec icon="📋" title="Contracts" color="text-green-700">
          <div className="space-y-2">
            {c.contracts.map((ct: any) => (
              <div key={ct.id} className="flex items-center justify-between py-2.5 border-b border-gray-50 last:border-0">
                <div>
                  <span className="text-sm font-semibold text-gray-900 font-mono">{ct.contractNumber}</span>

                </div>
                <button onClick={() => navigate(`/contracts/${ct.id}`)} className="text-xs text-blue-600 hover:underline">
                  View Contract →
                </button>
              </div>
            ))}
          </div>
        </Sec>
      )}
    </div>
  );
}
