import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { slaPoliciesApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { Plus, Pencil, Trash2, Target, CheckCircle, XCircle } from 'lucide-react';
import toast from 'react-hot-toast';

const PRIORITIES = ['P1','P2','P3','P4'];
const P_LABELS: Record<string, string> = { P1:'P1 – Critical', P2:'P2 – Major', P3:'P3 – Minor', P4:'P4 – Query' };
const P_COLORS: Record<string, string> = { P1:'text-red-600', P2:'text-orange-500', P3:'text-blue-600', P4:'text-green-600' };
const P_DESC: Record<string, string> = {
  P1: 'System down / business blocked',
  P2: 'Major impact, workaround exists',
  P3: 'Minor issue, low urgency',
  P4: 'General query',
};
const COLORS = ['#3B82F6','#8B5CF6','#10B981','#F59E0B','#EF4444','#EC4899','#06B6D4','#6366F1'];
const PRESETS = [
  { name:'GOLD Standard', code:'GOLD_STD', color:'#F59E0B', warningThreshold:0.80,
    priorities:{ P1:{response:15,resolution:240,enabled:true}, P2:{response:60,resolution:480,enabled:true}, P3:{response:240,resolution:1440,enabled:true}, P4:{response:480,resolution:2880,enabled:false} } },
  { name:'SILVER Standard', code:'SILVER_STD', color:'#6B7280', warningThreshold:0.80,
    priorities:{ P1:{response:30,resolution:480,enabled:true}, P2:{response:120,resolution:960,enabled:true}, P3:{response:480,resolution:2880,enabled:true}, P4:{response:960,resolution:5760,enabled:false} } },
  { name:'BRONZE Standard', code:'BRONZE_STD', color:'#92400E', warningThreshold:0.75,
    priorities:{ P1:{response:60,resolution:960,enabled:true}, P2:{response:240,resolution:1920,enabled:true}, P3:{response:960,resolution:5760,enabled:false}, P4:{response:1920,resolution:11520,enabled:false} } },
  { name:'P1 Only', code:'P1_ONLY', color:'#EF4444', warningThreshold:0.70,
    priorities:{ P1:{response:15,resolution:120,enabled:true}, P2:{response:60,resolution:480,enabled:false}, P3:{response:240,resolution:1440,enabled:false}, P4:{response:480,resolution:2880,enabled:false} } },
];

const blankPriorities = { P1:{response:15,resolution:240,enabled:true}, P2:{response:60,resolution:480,enabled:true}, P3:{response:240,resolution:1440,enabled:true}, P4:{response:480,resolution:2880,enabled:false} };
const ic = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white';

function minToHr(min: number) {
  if (!min) return '—';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60), m = min % 60;
  return m ? `${h}h ${m}m` : `${h}h`;
}

export default function SLAPolicyMasterPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [showModal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    name:'', code:'', description:'', color:'#3B82F6',
    warningThreshold: 0.80,
    priorities: JSON.parse(JSON.stringify(blankPriorities)),
    isActive: true,
  });

  const { data, isLoading } = useQuery({
    queryKey: ['sla-policies'],
    queryFn: () => slaPoliciesApi.list().then(r => r.data.policies || []),
  });
  const policies = data || [];

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const setPriority = (p: string, field: string, val: any) =>
    setForm((f: any) => ({ ...f, priorities: { ...f.priorities, [p]: { ...f.priorities[p], [field]: field === 'enabled' ? val : (parseInt(val) || 0) } } }));

  const applyPreset = (preset: typeof PRESETS[0]) => {
    setForm({
      name: preset.name, code: preset.code, description: '',
      color: preset.color, warningThreshold: preset.warningThreshold,
      priorities: JSON.parse(JSON.stringify(preset.priorities)),
      isActive: true,
    });
  };

  const handleOpen = (p?: any) => {
    if (p) {
      setForm({
        name: p.name, code: p.code, description: p.description || '',
        color: p.color || '#3B82F6', warningThreshold: p.warningThreshold ?? 0.80,
        priorities: { ...JSON.parse(JSON.stringify(blankPriorities)), ...p.priorities },
        isActive: p.isActive,
      });
      setEditId(p.id);
    } else {
      setForm({ name:'', code:'', description:'', color:'#3B82F6', warningThreshold:0.80, priorities: JSON.parse(JSON.stringify(blankPriorities)), isActive:true });
      setEditId(null);
    }
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim() || !form.code.trim()) { toast.error('Name and code required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, code: form.code.toUpperCase() };
      if (editId) {
        await slaPoliciesApi.update(editId, payload);
        toast.success('SLA Policy updated');
      } else {
        await slaPoliciesApi.create(payload);
        toast.success('SLA Policy created');
      }
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
      setModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!confirm(`Delete "${name}"? Cannot delete if in use by contracts.`)) return;
    try {
      await slaPoliciesApi.delete(id);
      toast.success('Policy deleted');
      qc.invalidateQueries({ queryKey: ['sla-policies'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">SLA Policy Master</h1>
          <p className="text-sm text-gray-500">Define reusable response/resolution targets by priority. Assign to contracts.</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => handleOpen()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> New SLA Policy
          </button>
        )}
      </div>

      <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-lg px-4 py-3 text-sm text-indigo-800">
        <strong>Design:</strong> Each policy (GOLD, SILVER, BRONZE, or custom) defines response and resolution targets per priority.
        If a customer negotiates different targets, create a new named policy — never modify an existing one that contracts depend on.
      </div>

      <div className="grid grid-cols-1 gap-4">
        {isLoading ? (
          <div className="text-center py-10 text-gray-400">Loading...</div>
        ) : policies.length === 0 ? (
          <div className="text-center py-16 text-gray-400">
            <Target className="w-12 h-12 mx-auto mb-3 opacity-20" />
            <p className="font-medium">No SLA policies yet</p>
            <p className="text-sm mt-1">Create GOLD, SILVER, BRONZE or custom policies</p>
          </div>
        ) : policies.map((p: any) => {
          const pris = p.priorities || {};
          return (
            <div key={p.id} className="bg-white rounded-xl border border-gray-100 shadow-sm overflow-hidden">
              <div className="flex items-center justify-between px-5 py-4 border-b border-gray-100">
                <div className="flex items-center gap-3">
                  <div className="w-3 h-3 rounded-full" style={{ backgroundColor: p.color }} />
                  <div>
                    <span className="font-bold text-gray-900">{p.name}</span>
                    <span className="ml-2 text-xs bg-gray-100 text-gray-500 px-2 py-0.5 rounded font-mono">{p.code}</span>
                    {!p.isActive && <span className="ml-2 text-xs bg-red-100 text-red-600 px-2 py-0.5 rounded">Inactive</span>}
                  </div>
                  {p.description && <span className="text-sm text-gray-400">— {p.description}</span>}
                </div>
                <div className="flex items-center gap-3">
                  <span className="text-xs text-gray-400">Warning at {Math.round((p.warningThreshold||0.80)*100)}%</span>
                  {isSuperAdmin && (
                    <>
                      <button onClick={() => handleOpen(p)} className="text-blue-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50"><Pencil className="w-4 h-4" /></button>
                      <button onClick={() => handleDelete(p.id, p.name)} className="text-red-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50"><Trash2 className="w-4 h-4" /></button>
                    </>
                  )}
                </div>
              </div>
              <div className="grid grid-cols-4 divide-x divide-gray-100">
                {PRIORITIES.map(pr => {
                  const t = pris[pr];
                  const enabled = t?.enabled !== false;
                  return (
                    <div key={pr} className={`px-5 py-4 ${!enabled ? 'bg-gray-50 opacity-50' : ''}`}>
                      <div className={`text-xs font-bold mb-2 ${P_COLORS[pr]}`}>{pr}</div>
                      {enabled && t ? (
                        <div className="space-y-1">
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Response</span>
                            <span className="font-semibold text-gray-800">{minToHr(t.response)}</span>
                          </div>
                          <div className="flex justify-between text-xs">
                            <span className="text-gray-500">Resolution</span>
                            <span className="font-semibold text-gray-800">{minToHr(t.resolution)}</span>
                          </div>
                        </div>
                      ) : (
                        <span className="text-xs text-gray-400 italic">Not tracked</span>
                      )}
                    </div>
                  );
                })}
              </div>
            </div>
          );
        })}
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-6 shadow-2xl">
            <div className="flex items-center justify-between px-7 py-5 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <Target className="w-5 h-5 text-blue-300" />
                <h2 className="text-lg font-bold text-white">{editId ? 'Edit SLA Policy' : 'New SLA Policy'}</h2>
              </div>
              <button onClick={() => setModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-7 space-y-6">
              {/* Presets */}
              {!editId && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Start from preset</label>
                  <div className="flex gap-2 flex-wrap">
                    {PRESETS.map(pr => (
                      <button key={pr.code} type="button" onClick={() => applyPreset(pr)}
                        className="px-3 py-1.5 rounded-lg text-sm border-2 font-medium transition-all hover:shadow-sm"
                        style={{ borderColor: pr.color, color: pr.color, backgroundColor: pr.color+'15' }}>
                        {pr.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Policy Name <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={e => setF('name', e.target.value)} className={ic} placeholder="e.g. GOLD Standard" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Code <span className="text-red-500">*</span></label>
                  <input value={form.code} onChange={e => setF('code', e.target.value.toUpperCase())} className={`${ic} font-mono`} placeholder="e.g. GOLD_STD" />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                <input value={form.description} onChange={e => setF('description', e.target.value)} className={ic} placeholder="Brief description..." />
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Color</label>
                  <div className="flex gap-2 flex-wrap">
                    {COLORS.map(c => (
                      <button key={c} type="button" onClick={() => setF('color', c)}
                        className={`w-7 h-7 rounded-full border-2 ${form.color === c ? 'border-gray-900 scale-110' : 'border-transparent'}`}
                        style={{ backgroundColor: c }} />
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Warning Threshold</label>
                  <select value={form.warningThreshold} onChange={e => setF('warningThreshold', parseFloat(e.target.value))} className={ic}>
                    <option value={0.70}>70% elapsed</option>
                    <option value={0.75}>75% elapsed</option>
                    <option value={0.80}>80% elapsed</option>
                    <option value={0.85}>85% elapsed</option>
                    <option value={0.90}>90% elapsed</option>
                  </select>
                  <p className="text-xs text-gray-400 mt-1">Warning email sent when this % of SLA time is consumed</p>
                </div>
              </div>

              {/* SLA targets table */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Response & Resolution Targets</label>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 font-semibold text-gray-700">Priority</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-700">Track SLA</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-700">Response (min)</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-700">Resolution (min)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {PRIORITIES.map(pr => {
                        const t = form.priorities[pr] || {};
                        return (
                          <tr key={pr} className={!t.enabled ? 'bg-gray-50 opacity-60' : 'hover:bg-gray-50'}>
                            <td className="px-4 py-3">
                              <p className={`font-semibold text-sm ${P_COLORS[pr]}`}>{P_LABELS[pr]}</p>
                              <p className="text-xs text-gray-400">{P_DESC[pr]}</p>
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="checkbox" checked={t.enabled !== false}
                                onChange={e => setPriority(pr, 'enabled', e.target.checked)}
                                className="accent-indigo-600 w-4 h-4" />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="number" min="1" value={t.response || ''}
                                disabled={!t.enabled}
                                onChange={e => setPriority(pr, 'response', e.target.value)}
                                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                            </td>
                            <td className="px-4 py-3 text-center">
                              <input type="number" min="1" value={t.resolution || ''}
                                disabled={!t.enabled}
                                onChange={e => setPriority(pr, 'resolution', e.target.value)}
                                className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400" />
                            </td>
                          </tr>
                        );
                      })}
                    </tbody>
                  </table>
                </div>
              </div>

              <div className="flex items-center gap-2">
                <input type="checkbox" id="isActive" checked={form.isActive}
                  onChange={e => setF('isActive', e.target.checked)} className="accent-indigo-600 w-4 h-4" />
                <label htmlFor="isActive" className="text-sm font-medium text-gray-700">Active (available for contract assignment)</label>
              </div>
            </div>

            <div className="flex justify-end gap-3 px-7 py-4 bg-gray-50 rounded-b-2xl border-t border-gray-100">
              <button onClick={() => setModal(false)} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                💾 {saving ? 'Saving...' : editId ? 'Update' : 'Create'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
