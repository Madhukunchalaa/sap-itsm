import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contractTypesApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Tag } from 'lucide-react';

// ── Constants ────────────────────────────────────────────────

const BASE_TYPES = [
  { value: 'GOLD',   label: 'Gold',   desc: 'Premium tier — highest SLA commitments',  bg: 'bg-yellow-50',  border: 'border-yellow-300', badge: 'bg-yellow-100 text-yellow-800' },
  { value: 'SILVER', label: 'Silver', desc: 'Standard tier — balanced SLA coverage',   bg: 'bg-gray-50',    border: 'border-gray-300',   badge: 'bg-gray-100 text-gray-700' },
  { value: 'BRONZE', label: 'Bronze', desc: 'Basic tier — essential SLA coverage',     bg: 'bg-orange-50',  border: 'border-orange-300', badge: 'bg-orange-100 text-orange-700' },
  { value: 'CUSTOM', label: 'Custom', desc: 'Fully configurable — define your own SLA', bg: 'bg-purple-50', border: 'border-purple-300', badge: 'bg-purple-100 text-purple-700' },
];

const PRESET_SLA: Record<string, any> = {
  GOLD:   { P1: { response: 15,  resolution: 240,  enabled: true }, P2: { response: 30,  resolution: 480,  enabled: true }, P3: { response: 120, resolution: 1440, enabled: true }, P4: { response: 240, resolution: 2880, enabled: true } },
  SILVER: { P1: { response: 30,  resolution: 480,  enabled: true }, P2: { response: 60,  resolution: 960,  enabled: true }, P3: { response: 240, resolution: 2880, enabled: true }, P4: { response: 480, resolution: 5760, enabled: true } },
  BRONZE: { P1: { response: 60,  resolution: 720,  enabled: true }, P2: { response: 120, resolution: 1440, enabled: true }, P3: { response: 480, resolution: 2880, enabled: true }, P4: { response: 960, resolution: 5760, enabled: true } },
  CUSTOM: { P1: { response: 60,  resolution: 480,  enabled: true }, P2: { response: 120, resolution: 960,  enabled: true }, P3: { response: 480, resolution: 2880, enabled: true }, P4: { response: 960, resolution: 5760, enabled: true } },
};

const SLA_LABELS  = { P1: 'P1 – Critical', P2: 'P2 – Major', P3: 'P3 – Minor', P4: 'P4 – Query' } as Record<string,string>;
const SLA_COLORS  = { P1: 'text-red-600',  P2: 'text-orange-500', P3: 'text-blue-600', P4: 'text-green-600' } as Record<string,string>;

const COLORS = [
  '#EAB308','#94A3B8','#F97316','#8B5CF6','#10B981','#3B82F6','#EF4444','#EC4899','#06B6D4','#84CC16',
];

const ic = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white';

interface TypeForm {
  name: string; code: string; baseType: string; color: string; description: string;
  isActive: boolean;
  slaConfig: Record<string, { response: number; resolution: number; enabled: boolean }>;
}
const blank: TypeForm = {
  name: '', code: '', baseType: 'CUSTOM', color: '#8B5CF6', description: '',
  isActive: true,
  slaConfig: JSON.parse(JSON.stringify(PRESET_SLA.CUSTOM)),
};

export default function ContractTypeMasterPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [showModal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<TypeForm>({ ...blank });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['contract-types'],
    queryFn: () => contractTypesApi.list().then(r => r.data.types || []),
  });
  const types: any[] = data || [];

  const setF = <K extends keyof TypeForm>(k: K, v: TypeForm[K]) => setForm(f => ({ ...f, [k]: v }));

  const setSLA = (p: string, field: string, val: string | boolean) =>
    setForm(f => ({ ...f, slaConfig: { ...f.slaConfig, [p]: { ...f.slaConfig[p], [field]: field === 'enabled' ? val : (parseInt(val as string) || 0) } } }));

  const handleBaseTypeChange = (bt: string) => {
    // Auto-fill code from name if empty, and load preset SLA
    setForm(f => ({
      ...f,
      baseType: bt,
      slaConfig: JSON.parse(JSON.stringify(PRESET_SLA[bt] || PRESET_SLA.CUSTOM)),
      color: bt === 'GOLD' ? '#EAB308' : bt === 'SILVER' ? '#94A3B8' : bt === 'BRONZE' ? '#F97316' : f.color,
    }));
  };

  const handleNameChange = (name: string) => {
    setForm(f => ({
      ...f,
      name,
      // Auto-generate code from name if code not manually set yet
      code: editId ? f.code : name.toUpperCase().replace(/[^A-Z0-9]/g, '_').replace(/_+/g,'_').slice(0, 20),
    }));
  };

  const handleOpen = (t?: any) => {
    if (t) {
      setForm({
        name: t.name, code: t.code, baseType: t.baseType || 'CUSTOM',
        color: t.color || '#8B5CF6', description: t.description || '',
        isActive: t.isActive !== false,
        slaConfig: t.slaConfig && Object.keys(t.slaConfig).length > 0
          ? t.slaConfig
          : JSON.parse(JSON.stringify(PRESET_SLA[t.baseType || 'CUSTOM'])),
      });
      setEditId(t.id);
    } else {
      setForm({ ...blank, slaConfig: JSON.parse(JSON.stringify(PRESET_SLA.CUSTOM)) });
      setEditId(null);
    }
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.code.trim()) { toast.error('Code is required'); return; }
    setSaving(true);
    try {
      const payload = { ...form, slaConfig: form.slaConfig };
      if (editId) {
        await contractTypesApi.update(editId, payload);
        toast.success('Contract type updated');
      } else {
        await contractTypesApi.create(payload);
        toast.success('Contract type created');
      }
      qc.invalidateQueries({ queryKey: ['contract-types'] });
      setModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete contract type "${name}"?\nThis cannot be undone.`)) return;
    setDeleting(id);
    try {
      await contractTypesApi.delete(id);
      toast.success('Contract type deleted');
      qc.invalidateQueries({ queryKey: ['contract-types'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setDeleting(null); }
  };

  const baseInfo = (bt: string) => BASE_TYPES.find(b => b.value === bt) || BASE_TYPES[3];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 rounded-lg bg-violet-600 flex items-center justify-center">
            <Tag className="w-4 h-4 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Contract Type Master</h1>
            <p className="text-xs text-gray-400">Define contract tiers with SLA templates — Gold, Silver, Bronze, and Custom</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button
            onClick={() => handleOpen()}
            className="flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors"
          >
            <Plus className="w-4 h-4" /> New Contract Type
          </button>
        )}
      </div>

      {/* Cards Grid */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading...</div>
      ) : types.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-14 text-center">
          <Tag className="w-10 h-10 text-gray-300 mx-auto mb-3" />
          <p className="text-gray-500 font-medium">No contract types configured yet</p>
          <p className="text-sm text-gray-400 mt-1">Create types like Gold, Silver, Bronze or custom tiers</p>
          {isSuperAdmin && (
            <button onClick={() => handleOpen()}
              className="mt-4 inline-flex items-center gap-2 bg-violet-600 hover:bg-violet-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
              <Plus className="w-4 h-4" /> Create First Type
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-3 gap-4">
          {types.map((t: any) => {
            const bi = baseInfo(t.baseType);
            const sla = t.slaConfig || {};
            return (
              <div key={t.id} className={`bg-white rounded-2xl border-2 shadow-sm p-5 flex flex-col gap-4 ${t.isActive ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
                {/* Card header */}
                <div className="flex items-start justify-between">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm"
                      style={{ backgroundColor: t.color || '#8B5CF6' }}>
                      {t.code?.slice(0,2)}
                    </div>
                    <div>
                      <h3 className="font-bold text-gray-900 text-base leading-tight">{t.name}</h3>
                      <div className="flex items-center gap-1.5 mt-0.5">
                        <span className="font-mono text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{t.code}</span>
                        <span className={`text-xs font-semibold px-1.5 py-0.5 rounded ${bi.badge}`}>{bi.label}</span>
                      </div>
                    </div>
                  </div>
                  <div className="flex items-center gap-1">
                    {!t.isActive && (
                      <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full font-medium">Inactive</span>
                    )}
                    {isSuperAdmin && (
                      <>
                        <button onClick={() => handleOpen(t)} className="p-1.5 text-blue-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
                          <Pencil className="w-3.5 h-3.5" />
                        </button>
                        <button
                          onClick={() => handleDelete(t.id, t.name)}
                          disabled={deleting === t.id || (t._count?.contracts || 0) > 0}
                          className="p-1.5 text-red-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-40 disabled:cursor-not-allowed"
                          title={(t._count?.contracts || 0) > 0 ? `${t._count.contracts} contracts use this type` : 'Delete'}
                        >
                          <Trash2 className="w-3.5 h-3.5" />
                        </button>
                      </>
                    )}
                  </div>
                </div>

                {/* Description */}
                {t.description && <p className="text-xs text-gray-500 -mt-2">{t.description}</p>}

                {/* SLA table */}
                <div className="border border-gray-100 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-100">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SLA Targets</span>
                  </div>
                  <table className="w-full text-xs">
                    <thead>
                      <tr className="border-b border-gray-100">
                        <th className="text-left px-3 py-1.5 text-gray-400 font-medium">Priority</th>
                        <th className="text-center px-3 py-1.5 text-gray-400 font-medium">Response</th>
                        <th className="text-center px-3 py-1.5 text-gray-400 font-medium">Resolution</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-50">
                      {['P1','P2','P3','P4'].map(p => (
                        <tr key={p}>
                          <td className={`px-3 py-1.5 font-semibold ${SLA_COLORS[p]}`}>{p}</td>
                          <td className="px-3 py-1.5 text-center text-gray-600 font-medium">{sla[p]?.response ?? '—'} min</td>
                          <td className="px-3 py-1.5 text-center text-gray-600">{sla[p]?.resolution ?? '—'} min</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>

                {/* Footer */}
                <div className="flex items-center justify-between text-xs text-gray-400 -mt-1">
                  <span>{t._count?.contracts || 0} contract{(t._count?.contracts || 0) !== 1 ? 's' : ''}</span>
                  <span className={`font-medium ${t.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                    {t.isActive ? '● Active' : '○ Inactive'}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-6 shadow-2xl flex flex-col">
            {/* Modal Header */}
            <div className="flex items-center justify-between px-7 py-5 bg-gradient-to-r from-slate-800 to-violet-900 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: form.color }}>
                  {form.code?.slice(0,2) || '?'}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">{editId ? 'Edit Contract Type' : 'New Contract Type'}</h2>
                  <p className="text-xs text-white/50">{editId ? 'Update type definition and SLA' : 'Define a new contract tier with SLA targets'}</p>
                </div>
              </div>
              <button onClick={() => setModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-7 space-y-6 overflow-y-auto">
              {/* Base Type selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Base Type</label>
                <div className="grid grid-cols-4 gap-2">
                  {BASE_TYPES.map(bt => (
                    <button key={bt.value} type="button" onClick={() => handleBaseTypeChange(bt.value)}
                      className={`flex flex-col items-center gap-1 p-3 rounded-xl border-2 transition-all text-center ${
                        form.baseType === bt.value
                          ? `${bt.border} ${bt.bg} shadow-sm`
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}>
                      <span className={`text-xs font-bold ${form.baseType === bt.value ? '' : 'text-gray-600'}`}>{bt.label}</span>
                    </button>
                  ))}
                </div>
                <p className="text-xs text-gray-400 mt-1.5">
                  {BASE_TYPES.find(b => b.value === form.baseType)?.desc}
                </p>
              </div>

              {/* Name + Code */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Type Name <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={e => handleNameChange(e.target.value)}
                    className={ic} placeholder="e.g. Gold Premium" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Code <span className="text-red-500">*</span></label>
                  <input value={form.code} onChange={e => setF('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g,''))}
                    className={`${ic} font-mono`} placeholder="GOLD_PREMIUM" maxLength={20} />
                  <p className="text-xs text-gray-400 mt-1">Uppercase letters, numbers, underscores only</p>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setF('description', e.target.value)}
                  rows={2} className={`${ic} resize-none`} placeholder="Brief description of this contract tier..." />
              </div>

              {/* Color + Active */}
              <div className="flex items-end gap-6">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Brand Color</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {COLORS.map(col => (
                      <button key={col} type="button" onClick={() => setF('color', col)}
                        className={`w-8 h-8 rounded-lg transition-all shadow-sm ${form.color === col ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: col }} />
                    ))}
                    <input type="color" value={form.color} onChange={e => setF('color', e.target.value)}
                      className="w-8 h-8 rounded-lg border border-gray-200 cursor-pointer" title="Custom color" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div
                      onClick={() => setF('isActive', !form.isActive)}
                      className={`w-11 h-6 rounded-full transition-colors flex items-center px-0.5 ${form.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Active' : 'Inactive'}</span>
                  </label>
                </div>
              </div>

              {/* SLA Table */}
              <div>
                <div className="flex items-center justify-between mb-3">
                  <label className="block text-sm font-semibold text-gray-700">SLA Targets</label>
                  <button type="button" onClick={() => setForm(f => ({ ...f, slaConfig: JSON.parse(JSON.stringify(PRESET_SLA[f.baseType] || PRESET_SLA.CUSTOM)) }))}
                    className="text-xs text-violet-600 hover:text-violet-800 font-medium">
                    ↺ Reset to {BASE_TYPES.find(b => b.value === form.baseType)?.label || 'Custom'} defaults
                  </button>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <table className="w-full text-sm">
                    <thead>
                      <tr className="bg-gray-50 border-b border-gray-200">
                        <th className="text-left px-4 py-3 font-semibold text-gray-600 w-1/2">Priority</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-600">SLA Active</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Response (min)</th>
                        <th className="text-center px-4 py-3 font-semibold text-gray-600">Resolution (min)</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-gray-100">
                      {['P1','P2','P3','P4'].map(p => (
                        <tr key={p} className="hover:bg-gray-50">
                          <td className="px-4 py-3">
                            <span className={`font-semibold text-sm ${SLA_COLORS[p]}`}>{SLA_LABELS[p]}</span>
                          </td>
                          <td className="px-4 py-3 text-center">
                            <label className="flex items-center justify-center cursor-pointer">
                              <div onClick={() => setSLA(p, 'enabled', !form.slaConfig[p]?.enabled)}
                                className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors ${form.slaConfig[p]?.enabled !== false ? 'bg-green-500' : 'bg-gray-300'}`}>
                                <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform ${form.slaConfig[p]?.enabled !== false ? 'translate-x-5' : 'translate-x-0'}`} />
                              </div>
                            </label>
                          </td>
                          <td className={`px-4 py-3 text-center transition-opacity ${form.slaConfig[p]?.enabled === false ? 'opacity-30' : ''}`}>
                            <input type="number" min="1"
                              disabled={form.slaConfig[p]?.enabled === false}
                              value={form.slaConfig[p]?.response ?? ''}
                              onChange={e => setSLA(p, 'response', e.target.value)}
                              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-violet-500 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed" />
                          </td>
                          <td className={`px-4 py-3 text-center transition-opacity ${form.slaConfig[p]?.enabled === false ? 'opacity-30' : ''}`}>
                            <input type="number" min="1"
                              disabled={form.slaConfig[p]?.enabled === false}
                              value={form.slaConfig[p]?.resolution ?? ''}
                              onChange={e => setSLA(p, 'resolution', e.target.value)}
                              className="w-24 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-violet-500 focus:outline-none disabled:bg-gray-50 disabled:cursor-not-allowed" />
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-7 py-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl flex-shrink-0">
              <button onClick={() => setModal(false)} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-violet-600 hover:bg-violet-700 text-white rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors">
                💾 {saving ? 'Saving...' : editId ? 'Update Type' : 'Create Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
