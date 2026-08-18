import React from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usersApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader } from '../components/ui/Forms';
import { Database, ToggleLeft, ToggleRight, UserCog } from 'lucide-react';
import toast from 'react-hot-toast';

export default function AiAnalysisAccessPage() {
  const queryClient = useQueryClient();

  const { data, isLoading } = useQuery({
    queryKey: ['users-project-managers'],
    queryFn: () => usersApi.list({ role: 'PROJECT_MANAGER', status: 'ACTIVE', limit: 200 }).then(r => r.data.data || []),
  });

  const pms: any[] = data || [];

  const handleToggle = async (user: any) => {
    try {
      await usersApi.update(user.id, { canRunSapAnalysis: !user.canRunSapAnalysis });
      toast.success(!user.canRunSapAnalysis
        ? `${user.firstName} can now use "Perform AI Analysis"`
        : `${user.firstName}'s AI Analysis access removed`);
      queryClient.invalidateQueries({ queryKey: ['users-project-managers'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader
        title="AI Analysis Access"
        subtitle='Choose which Project Managers can see the "Perform AI Analysis" button on tickets and query live SAP via MCP. Super Admin always has access.'
      />

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : pms.length === 0 ? (
        <div className="text-center py-16">
          <UserCog className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No Project Managers found</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {pms.map((user: any) => (
            <div key={user.id} className="flex items-center gap-3 px-5 py-3 border-b border-gray-100 last:border-0">
              <div className="w-8 h-8 rounded-full bg-orange-500 text-white text-xs font-bold flex items-center justify-center flex-shrink-0">
                {user.firstName?.[0] || '?'}
              </div>
              <div className="flex-1 min-w-0">
                <p className="text-sm font-medium text-gray-800">{user.firstName} {user.lastName}</p>
                <p className="text-xs text-gray-400">{user.email}</p>
              </div>
              {user.canRunSapAnalysis && (
                <span className="flex items-center gap-1 text-xs font-medium px-2 py-0.5 rounded-full bg-cyan-100 text-cyan-800">
                  <Database className="w-3 h-3"/> AI Analysis enabled
                </span>
              )}
              <button
                onClick={() => handleToggle(user)}
                className={`flex items-center gap-1.5 px-3 py-1.5 text-sm rounded-lg border ${
                  user.canRunSapAnalysis
                    ? 'border-cyan-300 bg-cyan-50 text-cyan-700 hover:bg-cyan-100'
                    : 'border-gray-200 text-gray-500 hover:bg-gray-50'
                }`}
              >
                {user.canRunSapAnalysis ? <ToggleRight className="w-4 h-4"/> : <ToggleLeft className="w-4 h-4"/>}
                {user.canRunSapAnalysis ? 'Enabled' : 'Disabled'}
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}
