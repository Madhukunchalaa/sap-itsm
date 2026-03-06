import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { supportTypesApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, Shield, CheckCircle, XCircle, Clock, Phone } from 'lucide-react';

// ── Constants ─────────────────────────────────────────────────────────────────

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const PRIORITIES = ['P1', 'P2', 'P3', 'P4'];
const PRIORITY_COLORS: Record<string, string> = {
  P1: 'text-red-600 bg-red-50 border-red-200',
  P2: 'text-orange-600 bg-orange-50 border-orange-200',
  P3: 'text-blue-600 bg-blue-50 border-blue-200',
  P4: 'text-green-600 bg-green-50 border-green-200',
};
const PRIORITY_LABELS: Record<string, string> = {
  P1: 'P1 – Critical', P2: 'P2 – Major', P3: 'P3 – Minor', P4: 'P4 – Query',
};

const PAUSE_CONDITIONS = [
  { value: 'OUTSIDE_BUSINESS_HOURS', label: 'Outside Business Hours' },
  { value: 'WEEKENDS',               label: 'Weekends' },
  { value: 'HOLIDAYS',               label: 'Public Holidays' },
  { value: 'WAITING_CUSTOMER',       label: 'Waiting for Customer' },
  { value: 'CUSTOMER_HOLD',          label: 'Customer Requested Hold' },
];

const COVERAGE_OPTIONS = [
  { value: 'NONE',    label: 'None',    badge: 'bg-gray-100 text-gray-600' },
  { value: 'ON_CALL', label: 'On-Call', badge: 'bg-amber-100 text-amber-700' },
  { value: 'FULL',    label: 'Full',    badge: 'bg-green-100 text-green-700' },
];

const TYPE_COLORS = [
  '#3B82F6', '#8B5CF6', '#10B981', '#F97316', '#EF4444',
  '#EC4899', '#06B6D4', '#EAB308', '#6366F1', '#14B8A6',
];

// 5 preset templates matching the spec exactly
const PRESETS = [
  {
    name: 'Basic', code: 'BASIC', color: '#3B82F6',
    description: '5-day Mon–Fri, 9h/day, local business hours. No weekend/holiday coverage.',
    workDays: [1,2,3,4,5], dailyHours: 9, weekendCoverage: 'NONE', holidayCoverage: 'NONE',
    onCallPriorities: [], priorityScope: 'ALL',
    slaPauseConditions: ['OUTSIDE_BUSINESS_HOURS', 'WEEKENDS', 'HOLIDAYS'],
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  },
  {
    name: 'Basic Plus', code: 'BASIC_PLUS', color: '#8B5CF6',
    description: '5-day Mon–Fri, 9h/day. On-call weekend & holiday coverage (P1 only).',
    workDays: [1,2,3,4,5], dailyHours: 9, weekendCoverage: 'ON_CALL', holidayCoverage: 'ON_CALL',
    onCallPriorities: ['P1'], priorityScope: 'ALL',
    slaPauseConditions: ['OUTSIDE_BUSINESS_HOURS', 'WEEKENDS'],
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  },
  {
    name: 'Extended', code: 'EXTENDED', color: '#10B981',
    description: '6-day Mon–Sat, 9h/day, local business hours. No weekend/holiday coverage.',
    workDays: [1,2,3,4,5,6], dailyHours: 9, weekendCoverage: 'NONE', holidayCoverage: 'NONE',
    onCallPriorities: [], priorityScope: 'ALL',
    slaPauseConditions: ['OUTSIDE_BUSINESS_HOURS', 'WEEKENDS'],
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  },
  {
    name: 'Extended Plus', code: 'EXTENDED_PLUS', color: '#F97316',
    description: '6-day Mon–Sat, 9h/day. On-call weekend & holiday coverage (P1 only).',
    workDays: [1,2,3,4,5,6], dailyHours: 9, weekendCoverage: 'ON_CALL', holidayCoverage: 'ON_CALL',
    onCallPriorities: ['P1'], priorityScope: 'ALL',
    slaPauseConditions: ['OUTSIDE_BUSINESS_HOURS', 'WEEKENDS'],
    slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  },
  {
    name: 'On-Call', code: 'ON_CALL', color: '#EF4444',
    description: 'Business hours support with after-hours & weekend P1 on-call. SLA applies to P1 only.',
    workDays: [1,2,3,4,5], dailyHours: 9, weekendCoverage: 'ON_CALL', holidayCoverage: 'ON_CALL',
    onCallPriorities: ['P1'], priorityScope: 'P1_ONLY',
    slaPauseConditions: ['OUTSIDE_BUSINESS_HOURS', 'WEEKENDS', 'HOLIDAYS'],
    slaEnabled: { P1: true, P2: false, P3: false, P4: false },
  },
];

const ic = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:outline-none bg-white';

interface SupportTypeForm {
  name: string; code: string; description: string; color: string;
  workDays: number[];
  weekendCoverage: string; holidayCoverage: string; afterHoursCoverage: string;
  weekendMultiplier: number; holidayMultiplier: number; afterHoursMultiplier: number;
  onCallPriorities: string[];
  slaPauseConditions: string[];
  priorityScope: string;
  slaEnabled: Record<string, boolean>;
  isActive: boolean;
}

const blankForm: SupportTypeForm = {
  name: '', code: '', description: '', color: '#3B82F6',
  workDays: [1,2,3,4,5],
  weekendCoverage: 'NONE', holidayCoverage: 'NONE', afterHoursCoverage: 'NONE',
  weekendMultiplier: 2.0, holidayMultiplier: 2.0, afterHoursMultiplier: 1.5,
  onCallPriorities: [], slaPauseConditions: [],
  priorityScope: 'ALL',
  slaEnabled: { P1: true, P2: true, P3: true, P4: true },
  isActive: true,
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function coverageBadge(v: string) {
  return COVERAGE_OPTIONS.find(c => c.value === v) || COVERAGE_OPTIONS[0];
}

function applyPreset(preset: typeof PRESETS[0]): SupportTypeForm {
  return {
    name: preset.name, code: preset.code, description: preset.description,
    color: preset.color, workDays: [...preset.workDays],
    weekendCoverage: preset.weekendCoverage, holidayCoverage: preset.holidayCoverage,
    afterHoursCoverage: (preset as any).afterHoursCoverage || 'NONE',
    weekendMultiplier: 2.0, holidayMultiplier: 2.0, afterHoursMultiplier: 1.5,
    onCallPriorities: [...preset.onCallPriorities],
    slaPauseConditions: [...preset.slaPauseConditions],
    priorityScope: preset.priorityScope,
    slaEnabled: { ...preset.slaEnabled },
    isActive: true,
  };
}

// ── Component ─────────────────────────────────────────────────────────────────

export default function SupportTypeMasterPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [showModal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<SupportTypeForm>({ ...blankForm });
  const [saving, setSaving] = useState(false);
  const [deleting, setDeleting] = useState<string | null>(null);

  const { data, isLoading } = useQuery({
    queryKey: ['support-types'],
    queryFn: () => supportTypesApi.list().then(r => r.data.types || []),
  });
  const types: any[] = data || [];

  const setF = <K extends keyof SupportTypeForm>(k: K, v: SupportTypeForm[K]) =>
    setForm(f => ({ ...f, [k]: v }));

  const toggleDay = (d: number) =>
    setF('workDays', form.workDays.includes(d)
      ? form.workDays.filter(x => x !== d)
      : [...form.workDays, d].sort());

  const togglePause = (c: string) =>
    setF('slaPauseConditions', form.slaPauseConditions.includes(c)
      ? form.slaPauseConditions.filter(x => x !== c)
      : [...form.slaPauseConditions, c]);

  const toggleOnCallPriority = (p: string) =>
    setF('onCallPriorities', form.onCallPriorities.includes(p)
      ? form.onCallPriorities.filter(x => x !== p)
      : [...form.onCallPriorities, p]);

  const toggleSLAEnabled = (p: string) => {
    const next = { ...form.slaEnabled, [p]: !form.slaEnabled[p] };
    // If On-Call priorityScope and P1 is being disabled, warn
    setF('slaEnabled', next);
  };

  // When priorityScope changes to P1_ONLY, auto-disable P2/P3/P4 SLA
  const handleScopeChange = (scope: string) => {
    setF('priorityScope', scope);
    if (scope === 'P1_ONLY') {
      setF('slaEnabled', { P1: true, P2: false, P3: false, P4: false });
    }
  };

  // When any on-call coverage is set, auto-restrict onCallPriorities to P1
  const handleCoverageChange = (field: 'weekendCoverage' | 'holidayCoverage' | 'afterHoursCoverage', val: string) => {
    setF(field, val);
    if (val === 'ON_CALL' && form.onCallPriorities.length === 0) {
      setF('onCallPriorities', ['P1']);
    }
  };

  const handleOpen = (t?: any) => {
    if (t) {
      setForm({
        name: t.name, code: t.code, description: t.description || '',
        color: t.color || '#3B82F6',
        workDays: t.workDays || [1,2,3,4,5], dailyHours: t.dailyHours || 9,
        weekendCoverage: t.weekendCoverage || 'NONE',
        holidayCoverage: t.holidayCoverage || 'NONE',
        afterHoursCoverage: t.afterHoursCoverage || 'NONE',
        weekendMultiplier: t.weekendMultiplier || 2.0,
        holidayMultiplier: t.holidayMultiplier || 2.0,
        afterHoursMultiplier: t.afterHoursMultiplier || 1.5,
        onCallPriorities: t.onCallPriorities || [],
        slaPauseConditions: t.slaPauseConditions || [],
        priorityScope: t.priorityScope || 'ALL',
        slaEnabled: t.slaEnabled || { P1: true, P2: true, P3: true, P4: true },
        isActive: t.isActive !== false,
      });
      setEditId(t.id);
    } else {
      setForm({ ...blankForm });
      setEditId(null);
    }
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Name is required'); return; }
    if (!form.code.trim()) { toast.error('Code is required'); return; }
    if (form.workDays.length === 0) { toast.error('Select at least one work day'); return; }
    setSaving(true);
    try {
      if (editId) {
        await supportTypesApi.update(editId, form);
        toast.success('Support type updated');
      } else {
        await supportTypesApi.create(form);
        toast.success('Support type created');
      }
      qc.invalidateQueries({ queryKey: ['support-types'] });
      setModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string, name: string) => {
    if (!window.confirm(`Delete "${name}"? This cannot be undone.`)) return;
    setDeleting(id);
    try {
      await supportTypesApi.delete(id);
      toast.success('Support type deleted');
      qc.invalidateQueries({ queryKey: ['support-types'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setDeleting(null); }
  };

  const hasOnCall = form.weekendCoverage === 'ON_CALL' || form.holidayCoverage === 'ON_CALL' || form.afterHoursCoverage === 'ON_CALL'
    || form.weekendCoverage === 'FULL' || form.holidayCoverage === 'FULL' || form.afterHoursCoverage === 'FULL';

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-6">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-3">
          <div className="w-9 h-9 bg-indigo-600 rounded-xl flex items-center justify-center">
            <Shield className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">Support Type Master</h1>
            <p className="text-xs text-gray-400">Define support coverage models with SLA rules per priority</p>
          </div>
        </div>
        {isSuperAdmin && (
          <button onClick={() => handleOpen()}
            className="flex items-center gap-2 bg-indigo-600 hover:bg-indigo-700 text-white px-4 py-2 rounded-lg text-sm font-semibold transition-colors">
            <Plus className="w-4 h-4" /> New Support Type
          </button>
        )}
      </div>

      {/* Preset quick-create bar */}
      {isSuperAdmin && types.length === 0 && (
        <div className="bg-indigo-50 border border-indigo-200 rounded-xl p-4">
          <p className="text-sm font-semibold text-indigo-800 mb-3">
            Quick start — create from standard templates:
          </p>
          <div className="flex flex-wrap gap-2">
            {PRESETS.map(p => (
              <button key={p.code} onClick={() => { setForm(applyPreset(p)); setEditId(null); setModal(true); }}
                className="flex items-center gap-2 px-3 py-1.5 rounded-lg text-sm font-medium border-2 bg-white hover:shadow-sm transition-all"
                style={{ borderColor: p.color, color: p.color }}>
                <span className="w-2 h-2 rounded-full" style={{ backgroundColor: p.color }} />
                {p.name}
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Cards Grid */}
      {isLoading ? (
        <div className="text-center py-16 text-gray-400">Loading...</div>
      ) : types.length === 0 ? (
        <div className="bg-white rounded-xl border border-gray-100 shadow-sm p-16 text-center">
          <Shield className="w-10 h-10 text-gray-200 mx-auto mb-3" />
          <p className="text-gray-500 font-semibold">No support types configured yet</p>
          <p className="text-sm text-gray-400 mt-1">Create types like Basic, Extended, or On-Call</p>
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-2 xl:grid-cols-3 gap-5">
          {types.map((t: any) => {
            const wc = coverageBadge(t.weekendCoverage);
            const hc = coverageBadge(t.holidayCoverage);
            const slaEn = t.slaEnabled || { P1: true, P2: true, P3: true, P4: true };
            return (
              <div key={t.id}
                className={`bg-white rounded-2xl border-2 shadow-sm overflow-hidden flex flex-col ${t.isActive ? 'border-gray-100' : 'border-gray-100 opacity-60'}`}>
                {/* Card top bar */}
                <div className="h-1.5 w-full" style={{ backgroundColor: t.color || '#6366f1' }} />

                <div className="p-5 flex flex-col gap-4 flex-1">
                  {/* Title row */}
                  <div className="flex items-start justify-between">
                    <div className="flex items-center gap-3">
                      <div className="w-10 h-10 rounded-xl flex items-center justify-center text-white font-bold text-sm shadow-sm"
                        style={{ backgroundColor: t.color || '#6366f1' }}>
                        {t.code?.slice(0, 2)}
                      </div>
                      <div>
                        <h3 className="font-bold text-gray-900 text-base leading-tight">{t.name}</h3>
                        <span className="font-mono text-xs text-gray-400 bg-gray-50 px-1.5 py-0.5 rounded">{t.code}</span>
                      </div>
                    </div>
                    <div className="flex items-center gap-1">
                      {!t.isActive && <span className="text-xs bg-gray-100 text-gray-400 px-2 py-0.5 rounded-full">Inactive</span>}
                      {isSuperAdmin && (
                        <>
                          <button onClick={() => handleOpen(t)}
                            className="p-1.5 text-blue-400 hover:text-blue-600 rounded hover:bg-blue-50 transition-colors">
                            <Pencil className="w-3.5 h-3.5" />
                          </button>
                          <button
                            onClick={() => handleDelete(t.id, t.name)}
                            disabled={deleting === t.id || (t._count?.contracts || 0) > 0}
                            title={(t._count?.contracts || 0) > 0 ? `${t._count.contracts} contracts use this` : 'Delete'}
                            className="p-1.5 text-red-300 hover:text-red-500 rounded hover:bg-red-50 transition-colors disabled:opacity-30 disabled:cursor-not-allowed">
                            <Trash2 className="w-3.5 h-3.5" />
                          </button>
                        </>
                      )}
                    </div>
                  </div>

                  {t.description && <p className="text-xs text-gray-500 -mt-1">{t.description}</p>}

                  {/* Work days */}
                  <div className="flex items-center gap-1">
                    {DAYS.map((d, i) => (
                      <span key={d}
                        className={`text-xs px-1.5 py-0.5 rounded font-semibold ${(t.workDays || []).includes(i) ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-300'}`}>
                        {d}
                      </span>
                    ))}
                    <span className="ml-1 text-xs text-gray-400 font-medium">{t.dailyHours || 9}h/day</span>
                  </div>

                  {/* Coverage */}
                  <div className="grid grid-cols-2 gap-2">
                    <div className="bg-gray-50 rounded-xl p-2.5">
                      <p className="text-xs text-gray-400 font-medium mb-1">Weekend</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${coverageBadge(t.weekendCoverage).badge}`}>
                        {coverageBadge(t.weekendCoverage).label}
                      </span>
                      {t.weekendCoverage === 'ON_CALL' && t.onCallPriorities?.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1 font-medium">
                          <Phone className="w-3 h-3 inline mr-0.5" />{t.onCallPriorities.join(', ')} only
                        </p>
                      )}
                    </div>
                    <div className="bg-gray-50 rounded-xl p-2.5">
                      <p className="text-xs text-gray-400 font-medium mb-1">Holiday</p>
                      <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${coverageBadge(t.holidayCoverage).badge}`}>
                        {coverageBadge(t.holidayCoverage).label}
                      </span>
                      {t.holidayCoverage === 'ON_CALL' && t.onCallPriorities?.length > 0 && (
                        <p className="text-xs text-amber-600 mt-1 font-medium">
                          <Phone className="w-3 h-3 inline mr-0.5" />{t.onCallPriorities.join(', ')} only
                        </p>
                      )}
                    </div>
                  </div>

                  {/* SLA enabled per priority */}
                  <div className="border border-gray-100 rounded-xl overflow-hidden">
                    <div className="bg-gray-50 px-3 py-1.5 border-b border-gray-100 flex items-center justify-between">
                      <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">SLA Tracking</span>
                      {t.priorityScope === 'P1_ONLY' && (
                        <span className="text-xs bg-red-100 text-red-600 font-bold px-2 py-0.5 rounded-full">P1 Only</span>
                      )}
                    </div>
                    <div className="flex divide-x divide-gray-100">
                      {PRIORITIES.map(p => {
                        const enabled = slaEn[p] !== false;
                        return (
                          <div key={p} className={`flex-1 flex flex-col items-center py-2 gap-1 ${enabled ? '' : 'opacity-40'}`}>
                            <span className={`text-xs font-bold ${enabled ? PRIORITY_COLORS[p].split(' ')[0] : 'text-gray-400'}`}>{p}</span>
                            {enabled
                              ? <CheckCircle className="w-4 h-4 text-green-500" />
                              : <XCircle className="w-4 h-4 text-gray-300" />}
                          </div>
                        );
                      })}
                    </div>
                  </div>

                  {/* SLA pause conditions */}
                  {(t.slaPauseConditions || []).length > 0 && (
                    <div className="flex flex-wrap gap-1">
                      <span className="text-xs text-gray-400 font-medium w-full">SLA pauses on:</span>
                      {(t.slaPauseConditions || []).map((c: string) => {
                        const label = PAUSE_CONDITIONS.find(p => p.value === c)?.label || c;
                        return (
                          <span key={c} className="text-xs bg-amber-50 text-amber-700 border border-amber-200 px-2 py-0.5 rounded-full font-medium">
                            {label}
                          </span>
                        );
                      })}
                    </div>
                  )}

                  {/* Footer */}
                  <div className="flex items-center justify-between text-xs text-gray-400 mt-auto pt-2 border-t border-gray-50">
                    <span>{t._count?.contracts || 0} contract{(t._count?.contracts || 0) !== 1 ? 's' : ''}</span>
                    <span className={`font-semibold ${t.isActive ? 'text-green-600' : 'text-gray-400'}`}>
                      {t.isActive ? '● Active' : '○ Inactive'}
                    </span>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* ── Modal ─────────────────────────────────────────────────────────── */}
      {showModal && (
        <div className="fixed inset-0 bg-black/50 z-50 flex items-start justify-center p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-2xl my-6 shadow-2xl flex flex-col">
            {/* Modal header */}
            <div className="flex items-center justify-between px-7 py-5 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl flex-shrink-0">
              <div className="flex items-center gap-3">
                <div className="w-8 h-8 rounded-lg flex items-center justify-center text-white font-bold text-sm"
                  style={{ backgroundColor: form.color }}>
                  {form.code?.slice(0, 2) || '?'}
                </div>
                <div>
                  <h2 className="text-lg font-bold text-white">{editId ? 'Edit Support Type' : 'New Support Type'}</h2>
                  <p className="text-xs text-white/50">Configure coverage model and SLA rules</p>
                </div>
              </div>
              <button onClick={() => setModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-7 space-y-6 overflow-y-auto max-h-[75vh]">

              {/* Preset loader (only on create) */}
              {!editId && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Load from Template</label>
                  <div className="flex flex-wrap gap-2">
                    {PRESETS.map(p => (
                      <button key={p.code} type="button" onClick={() => setForm(applyPreset(p))}
                        className={`px-3 py-1.5 rounded-lg text-xs font-semibold border-2 transition-all ${
                          form.code === p.code ? 'text-white border-current' : 'bg-white border-gray-200 text-gray-500 hover:border-gray-300'
                        }`}
                        style={form.code === p.code ? { backgroundColor: p.color, borderColor: p.color } : {}}>
                        {p.name}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Name + Code */}
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Name <span className="text-red-500">*</span></label>
                  <input value={form.name} onChange={e => setF('name', e.target.value)}
                    className={ic} placeholder="e.g. Basic Plus" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Code <span className="text-red-500">*</span></label>
                  <input value={form.code}
                    onChange={e => setF('code', e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, ''))}
                    className={`${ic} font-mono`} placeholder="BASIC_PLUS" maxLength={20} />
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Description</label>
                <textarea value={form.description} onChange={e => setF('description', e.target.value)}
                  rows={2} className={`${ic} resize-none`} placeholder="Brief description..." />
              </div>

              {/* Work Days + Daily Hours */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  Work Days <span className="text-red-500">*</span>
                  <span className="ml-2 text-xs text-gray-400 font-normal">(select which days are regular business days)</span>
                </label>
                <div className="flex gap-2 flex-wrap">
                  {DAYS.map((d, i) => (
                    <button key={d} type="button" onClick={() => toggleDay(i)}
                      className={`px-3 py-2 rounded-lg text-sm font-bold border-2 transition-all ${
                        form.workDays.includes(i)
                          ? 'bg-indigo-600 text-white border-indigo-600'
                          : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                      }`}>{d}</button>
                  ))}
                  <div className="ml-auto flex items-center gap-2">
                    <label className="text-sm font-semibold text-gray-700">Hours/day:</label>
                    <input type="number" min={1} max={24} value={form.dailyHours}
                      onChange={e => setF('dailyHours', parseInt(e.target.value) || 9)}
                      className="w-16 border border-gray-200 rounded-xl px-3 py-2 text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:outline-none" />
                  </div>
                </div>
              </div>

              {/* Weekend + Holiday + Post Business Hours Coverage */}
              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Weekend Coverage</label>
                  <div className="flex flex-col gap-2">
                    {COVERAGE_OPTIONS.map(opt => (
                      <label key={opt.value}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                          form.weekendCoverage === opt.value
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <input type="radio" name="weekendCoverage" value={opt.value}
                          checked={form.weekendCoverage === opt.value}
                          onChange={() => handleCoverageChange('weekendCoverage', opt.value)}
                          className="accent-indigo-600" />
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${opt.badge}`}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Holiday Coverage</label>
                  <div className="flex flex-col gap-2">
                    {COVERAGE_OPTIONS.map(opt => (
                      <label key={opt.value}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                          form.holidayCoverage === opt.value
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <input type="radio" name="holidayCoverage" value={opt.value}
                          checked={form.holidayCoverage === opt.value}
                          onChange={() => handleCoverageChange('holidayCoverage', opt.value)}
                          className="accent-indigo-600" />
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${opt.badge}`}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Post Business Hours</label>
                  <div className="flex flex-col gap-2">
                    {COVERAGE_OPTIONS.map(opt => (
                      <label key={opt.value}
                        className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                          form.afterHoursCoverage === opt.value
                            ? 'border-indigo-500 bg-indigo-50'
                            : 'border-gray-200 hover:border-gray-300'
                        }`}>
                        <input type="radio" name="afterHoursCoverage" value={opt.value}
                          checked={form.afterHoursCoverage === opt.value}
                          onChange={() => handleCoverageChange('afterHoursCoverage', opt.value)}
                          className="accent-indigo-600" />
                        <span className={`text-xs font-bold px-2 py-0.5 rounded-full ${opt.badge}`}>{opt.label}</span>
                      </label>
                    ))}
                  </div>
                </div>
              </div>

              {/* On-Call Priorities — only shown when on-call coverage is set */}
              {hasOnCall && (
                <div className="bg-amber-50 border border-amber-200 rounded-xl p-4">
                  <label className="block text-sm font-semibold text-amber-800 mb-2">
                    <Phone className="w-4 h-4 inline mr-1" />
                    On-Call Coverage — Which priorities trigger on-call?
                  </label>
                  <div className="flex gap-2">
                    {PRIORITIES.map(p => (
                      <button key={p} type="button" onClick={() => toggleOnCallPriority(p)}
                        className={`px-3 py-1.5 rounded-lg text-sm font-bold border-2 transition-all ${
                          form.onCallPriorities.includes(p)
                            ? 'bg-amber-500 text-white border-amber-500'
                            : 'bg-white text-gray-400 border-gray-200 hover:border-gray-300'
                        }`}>{p}</button>
                    ))}
                  </div>
                  <p className="text-xs text-amber-700 mt-2">
                    Only selected priorities will trigger on-call response outside business hours.
                  </p>
                </div>
              )}

              {/* SLA Enabled per Priority */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700">
                    SLA Tracking — Enable per Priority
                  </label>
                  <div className="flex items-center gap-2">
                    <label className="text-xs font-semibold text-gray-600">Priority Scope:</label>
                    <select value={form.priorityScope} onChange={e => handleScopeChange(e.target.value)}
                      className="border border-gray-200 rounded-lg px-2 py-1 text-xs focus:ring-2 focus:ring-indigo-500 focus:outline-none">
                      <option value="ALL">All Priorities</option>
                      <option value="P1_ONLY">P1 Only (On-Call)</option>
                    </select>
                  </div>
                </div>
                <div className="border border-gray-200 rounded-xl overflow-hidden">
                  <div className="bg-gray-50 px-4 py-2 border-b border-gray-200">
                    <span className="text-xs font-semibold text-gray-500 uppercase tracking-wide">
                      Check to enable SLA tracking for that priority level
                    </span>
                  </div>
                  <div className="divide-y divide-gray-100">
                    {PRIORITIES.map(p => (
                      <label key={p}
                        className={`flex items-center gap-4 px-4 py-3 cursor-pointer hover:bg-gray-50 transition-colors ${
                          form.priorityScope === 'P1_ONLY' && p !== 'P1' ? 'opacity-40 cursor-not-allowed' : ''
                        }`}>
                        <input type="checkbox"
                          checked={form.slaEnabled[p] !== false}
                          onChange={() => form.priorityScope !== 'P1_ONLY' || p === 'P1' ? toggleSLAEnabled(p) : undefined}
                          disabled={form.priorityScope === 'P1_ONLY' && p !== 'P1'}
                          className="w-4 h-4 rounded accent-indigo-600" />
                        <span className={`text-sm font-semibold ${PRIORITY_COLORS[p].split(' ')[0]}`}>
                          {PRIORITY_LABELS[p]}
                        </span>
                        {form.slaEnabled[p] !== false ? (
                          <span className="ml-auto text-xs text-green-600 font-medium flex items-center gap-1">
                            <CheckCircle className="w-3.5 h-3.5" /> SLA tracked
                          </span>
                        ) : (
                          <span className="ml-auto text-xs text-gray-400 font-medium flex items-center gap-1">
                            <XCircle className="w-3.5 h-3.5" /> No SLA
                          </span>
                        )}
                      </label>
                    ))}
                  </div>
                </div>
                {form.priorityScope === 'P1_ONLY' && (
                  <p className="text-xs text-amber-600 mt-1.5 font-medium">
                    ⚡ P1 Only scope — SLA is automatically disabled for P2, P3, P4
                  </p>
                )}
              </div>

              {/* SLA Pause Conditions */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">
                  SLA Pause Conditions
                  <span className="ml-1 text-xs text-gray-400 font-normal">(SLA clock stops when these apply)</span>
                </label>
                <div className="grid grid-cols-2 gap-2">
                  {PAUSE_CONDITIONS.map(c => (
                    <label key={c.value}
                      className={`flex items-center gap-2.5 p-2.5 rounded-xl border-2 cursor-pointer transition-all ${
                        form.slaPauseConditions.includes(c.value)
                          ? 'border-amber-400 bg-amber-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}>
                      <input type="checkbox" checked={form.slaPauseConditions.includes(c.value)}
                        onChange={() => togglePause(c.value)} className="accent-amber-500 w-4 h-4" />
                      <span className="text-sm font-medium text-gray-700">{c.label}</span>
                    </label>
                  ))}
                </div>
              </div>

              {/* Color + Status */}
              <div className="flex items-end gap-6">
                <div className="flex-1">
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Color</label>
                  <div className="flex items-center gap-2 flex-wrap">
                    {TYPE_COLORS.map(col => (
                      <button key={col} type="button" onClick={() => setF('color', col)}
                        className={`w-7 h-7 rounded-lg transition-all ${form.color === col ? 'ring-2 ring-offset-2 ring-gray-400 scale-110' : 'hover:scale-105'}`}
                        style={{ backgroundColor: col }} />
                    ))}
                    <input type="color" value={form.color} onChange={e => setF('color', e.target.value)}
                      className="w-7 h-7 rounded-lg border border-gray-200 cursor-pointer" />
                  </div>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-2">Status</label>
                  <label className="flex items-center gap-2 cursor-pointer">
                    <div onClick={() => setF('isActive', !form.isActive)}
                      className={`w-11 h-6 rounded-full flex items-center px-0.5 transition-colors ${form.isActive ? 'bg-green-500' : 'bg-gray-300'}`}>
                      <div className={`w-5 h-5 bg-white rounded-full shadow transition-transform ${form.isActive ? 'translate-x-5' : 'translate-x-0'}`} />
                    </div>
                    <span className="text-sm font-medium text-gray-700">{form.isActive ? 'Active' : 'Inactive'}</span>
                  </label>
                </div>
              </div>

            </div>

            {/* Footer */}
            <div className="flex justify-end gap-3 px-7 py-5 border-t border-gray-100 bg-gray-50 rounded-b-2xl">
              <button onClick={() => setModal(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">
                Cancel
              </button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-6 py-2.5 bg-indigo-600 hover:bg-indigo-700 text-white rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors">
                💾 {saving ? 'Saving...' : editId ? 'Update Type' : 'Create Type'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
