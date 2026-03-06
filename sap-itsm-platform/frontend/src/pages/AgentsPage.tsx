import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { agentsApi, usersApi, sapModulesApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import toast from 'react-hot-toast';
import { Plus, Pencil, Trash2, UserCog, Users, X } from 'lucide-react';

const TIMEZONES   = ['UTC','IST','EST','CST','PST','CET','JST','AEST'];
const LEVELS      = [
  { value:'L1', label:'L1 — First Line' },
  { value:'L2', label:'L2 — Second Line' },
  { value:'L3', label:'L3 — Third Line' },
  { value:'SPECIALIST', label:'Specialist' },
];
const STATUSES = [
  { value:'AVAILABLE', label:'Active',    color:'bg-green-100 text-green-700' },
  { value:'BUSY',      label:'Busy',      color:'bg-orange-100 text-orange-700' },
  { value:'OFFLINE',   label:'Inactive',  color:'bg-gray-100 text-gray-500' },
  { value:'ON_LEAVE',  label:'On Leave',  color:'bg-red-100 text-red-500' },
];
const LEVEL_COLORS: Record<string,string> = {
  L1:'bg-blue-100 text-blue-700', L2:'bg-purple-100 text-purple-700',
  L3:'bg-orange-100 text-orange-700', SPECIALIST:'bg-red-100 text-red-700',
};
const AGENT_TYPE_COLORS: Record<string,string> = {
  AGENT:'bg-blue-100 text-blue-700',
  PROJECT_MANAGER:'bg-violet-100 text-violet-700',
};

interface SpecEntry {
  sapModuleId: string;
  sapSubModuleIds: string[];
}

interface AgentForm {
  agentType: 'AGENT' | 'PROJECT_MANAGER';
  fullName: string; email: string; phone: string; password: string;
  specialization: string; level: string; timezone: string;
  status: string; skills: string[];
  specializations: SpecEntry[];
}
const blank: AgentForm = {
  agentType: 'AGENT', fullName:'', email:'', phone:'', password:'',
  specialization:'', level:'L1', timezone:'IST', status:'AVAILABLE', skills:[],
  specializations: [],
};

export default function AgentsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [tab, setTab] = useState<'AGENT'|'PROJECT_MANAGER'>('AGENT');
  const [showModal, setShowModal] = useState(false);
  const [editId, setEditId] = useState<string|null>(null);
  const [form, setForm] = useState<AgentForm>(blank);
  const [saving, setSaving] = useState(false);
  const [linkMode, setLinkMode] = useState(false);  // true = fix existing user
  const [linkEmail, setLinkEmail] = useState('');

  const { data, isLoading } = useQuery({
    queryKey: ['agents'],
    queryFn: () => agentsApi.list({ limit: 200 }).then(r => r.data.data || []),
  });
  const { data: sapModulesData } = useQuery({
    queryKey: ['sap-modules-active'],
    queryFn: () => sapModulesApi.active().then(r => r.data.data || []),
  });
  const sapModules: any[] = sapModulesData || [];
  const all: any[] = data || [];
  const agents  = all.filter(a => (a.agentType || 'AGENT') === 'AGENT');
  const pms     = all.filter(a => a.agentType === 'PROJECT_MANAGER');
  const list    = tab === 'AGENT' ? agents : pms;

  const setF = (k: keyof AgentForm, v: any) => setForm(f => ({...f, [k]: v}));
  // toggleSkill removed — specializations now use structured data

  const openCreate = () => {
    setForm({ ...blank, agentType: tab });
    setEditId(null);
    setLinkMode(false);
    setLinkEmail('');
    setShowModal(true);
  };
  const openEdit = (a: any) => {
    const specs: SpecEntry[] = (a.specializations || []).map((s: any) => ({
      sapModuleId: s.sapModuleId || s.sapModule?.id,
      sapSubModuleIds: s.sapSubModuleIds || [],
    }));
    setForm({
      agentType: a.agentType || 'AGENT',
      fullName: `${a.user?.firstName} ${a.user?.lastName}`,
      email: a.user?.email || '', phone: a.metadata?.phone || '',
      password: '', specialization: a.specialization || '',
      level: a.level || 'L1', timezone: a.timezone || 'IST',
      status: a.status || 'AVAILABLE', skills: [],
      specializations: specs,
    });
    setEditId(a.id);
    setShowModal(true);
  };

  const handleFixRole = async (a: any) => {
    const correctRole = a.agentType === 'PROJECT_MANAGER' ? 'PROJECT_MANAGER' : 'AGENT';
    if (!window.confirm(`Fix role for ${a.user?.firstName} ${a.user?.lastName}?\nCurrent: ${a.user?.role} → Correct: ${correctRole}`)) return;
    try {
      const res = await agentsApi.linkUser({
        email: a.user?.email,
        agentType: a.agentType,
        specialization: a.specialization,
        level: a.level,
        timezone: a.timezone,
        status: a.status,
        metadata: a.metadata || {},
      });
      toast.success(`Role fixed: ${a.user?.firstName} is now ${correctRole}`);
      qc.invalidateQueries({ queryKey: ['agents'] });
    } catch(e) { toast.error(getErrorMessage(e)); }
  };

  const handleDelete = async (a: any) => {
    if (!window.confirm(`Delete ${a.user?.firstName} ${a.user?.lastName}?\nThis removes both the agent record AND the user account permanently.`)) return;
    try {
      await agentsApi.delete(a.id);
      toast.success(`${a.user?.firstName} ${a.user?.lastName} deleted`);
      qc.invalidateQueries({ queryKey: ['agents'] });
    } catch(e) { toast.error(getErrorMessage(e)); }
  };

  const handleSave = async () => {
    if (!form.fullName.trim()) { toast.error('Full name required'); return; }
    if (!editId && !form.email.trim()) { toast.error('Email required'); return; }
    setSaving(true);
    try {
      if (linkMode && !editId) {
        // Link an existing user who has the wrong role
        if (!linkEmail.trim()) { toast.error('Email required to link existing user'); setSaving(false); return; }
        const res = await agentsApi.linkUser({
          email: linkEmail.trim(),
          agentType: form.agentType,
          specialization: form.specialization,
          level: form.level,
          timezone: form.timezone,
          status: form.status,
          metadata: { skills: form.skills, phone: form.phone },
        });
        toast.success(`${res.data.userName} linked as ${form.agentType === 'PROJECT_MANAGER' ? 'Project Manager' : 'Agent'} — role corrected to ${res.data.fixedRole}`);
        qc.invalidateQueries({ queryKey: ['agents'] });
        setShowModal(false);
        setSaving(false);
        return;
      }
      if (editId) {
        // Update existing agent record
        await agentsApi.update(editId, {
          agentType: form.agentType,
          specialization: form.specializations.length > 0
            ? sapModules.find((m:any) => m.id === form.specializations[0]?.sapModuleId)?.code || ''
            : '',
          level: form.level,
          timezone: form.timezone,
          status: form.status,
          metadata: { phone: form.phone },
        });
        // Save specializations
        await agentsApi.updateSpecializations(editId, { specializations: form.specializations });
        toast.success(`${form.agentType === 'PROJECT_MANAGER' ? 'Project Manager' : 'Agent'} updated`);
      } else {
        // 1. Create user account — role based on agentType
        const [firstName, ...rest] = form.fullName.trim().split(' ');
        const lastName = rest.join(' ') || '-';
        const userRole = form.agentType === 'PROJECT_MANAGER' ? 'PROJECT_MANAGER' : 'AGENT';
        const userRes = await usersApi.create({
          firstName, lastName,
          email: form.email,
          password: form.password || 'Agent@123456',
          role: userRole,
        });
        // 2. Create agent record (same model for both types)
        const agentRes = await agentsApi.create({
          userId: userRes.data.user.id,
          agentType: form.agentType,
          specialization: form.specializations.length > 0
            ? sapModules.find((m:any) => m.id === form.specializations[0]?.sapModuleId)?.code || ''
            : '',
          level: form.level,
          timezone: form.timezone,
          status: form.status,
          metadata: { phone: form.phone },
        });
        // 3. Save specializations
        const newAgentId = agentRes.data.agent?.id;
        if (newAgentId && form.specializations.length > 0) {
          await agentsApi.updateSpecializations(newAgentId, { specializations: form.specializations });
        }
        toast.success(`${form.agentType === 'PROJECT_MANAGER' ? 'Project Manager' : 'Agent'} created`);
      }
      qc.invalidateQueries({ queryKey: ['agents'] });
      setShowModal(false);
    } catch(e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const TABS = [
    { key: 'AGENT',           label: 'Agents',           count: agents.length,  icon: '🧑‍💼' },
    { key: 'PROJECT_MANAGER', label: 'Project Managers', count: pms.length,     icon: '📋' },
  ] as const;

  const showAgentCols = tab === 'AGENT';

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900 flex items-center gap-2">
            <UserCog className="w-5 h-5 text-blue-600"/> Support Team
          </h1>
          <p className="text-sm text-gray-500 mt-0.5">{all.length} team members</p>
        </div>
        {isSuperAdmin && (
          <button onClick={openCreate}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4"/>
            Add {tab === 'PROJECT_MANAGER' ? 'Project Manager' : 'Agent'}
          </button>
        )}
      </div>

      {/* Tabs */}
      <div className="flex gap-0 border-b border-gray-200">
        {TABS.map(t => (
          <button key={t.key} onClick={() => setTab(t.key)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              tab === t.key ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            <span>{t.icon}</span> {t.label}
            <span className={`text-xs font-bold px-1.5 py-0.5 rounded-full ml-1 ${
              tab === t.key ? 'bg-blue-100 text-blue-700' : 'bg-gray-100 text-gray-500'
            }`}>{t.count}</span>
          </button>
        ))}
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white">
              <th className="text-left px-4 py-3 font-medium text-xs">Name</th>
              <th className="text-left px-4 py-3 font-medium text-xs">Email</th>
              <th className="text-left px-4 py-3 font-medium text-xs">Specialization</th>
              {showAgentCols && <th className="text-left px-4 py-3 font-medium text-xs">Skills</th>}
              <th className="text-left px-4 py-3 font-medium text-xs">Level</th>
              <th className="text-left px-4 py-3 font-medium text-xs">Timezone</th>
              <th className="text-left px-4 py-3 font-medium text-xs">Status</th>
              {showAgentCols && <th className="text-left px-4 py-3 font-medium text-xs">Open Tickets</th>}
              {isSuperAdmin && <th className="text-left px-4 py-3 font-medium text-xs">Actions</th>}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={9} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : list.length === 0 ? (
              <tr><td colSpan={9} className="text-center py-14 text-gray-400">
                No {tab === 'PROJECT_MANAGER' ? 'project managers' : 'agents'} yet.
              </td></tr>
            ) : list.map(a => {
              const skills: string[] = a.metadata?.skills || [];
              const status = STATUSES.find(s => s.value === a.status);
              return (
                <tr key={a.id} className="hover:bg-gray-50 transition-colors">
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <div className={`w-8 h-8 rounded-full flex items-center justify-center text-white text-xs font-bold flex-shrink-0 ${
                        tab === 'PROJECT_MANAGER' ? 'bg-gradient-to-br from-violet-500 to-purple-600' : 'bg-gradient-to-br from-blue-500 to-blue-700'
                      }`}>
                        {a.user?.firstName?.[0]}{a.user?.lastName?.[0]}
                      </div>
                      <span className="font-medium text-gray-900">{a.user?.firstName} {a.user?.lastName}</span>
                    </div>
                  </td>
                  <td className="px-4 py-3 text-gray-500 text-xs">{a.user?.email}</td>
                  <td className="px-4 py-3">
                    <span className="text-xs font-semibold px-2 py-0.5 rounded bg-blue-50 text-blue-700">
                      {a.specializations?.length > 0
                        ? a.specializations.map((s:any) => s.sapModule?.code || s.sapModuleId?.slice(0,4)).join(', ')
                        : a.specialization || '—'}
                    </span>
                  </td>
                  {showAgentCols && (
                    <td className="px-4 py-3">
                      <div className="flex flex-wrap gap-1">
                        {skills.length > 0 ? skills.slice(0,3).map(s=>(
                          <span key={s} className="text-xs px-1.5 py-0.5 rounded bg-slate-100 text-slate-600">{s}</span>
                        )) : <span className="text-gray-300 text-xs">—</span>}
                        {skills.length > 3 && <span className="text-xs text-gray-400">+{skills.length-3}</span>}
                      </div>
                    </td>
                  )}
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${LEVEL_COLORS[a.level]||'bg-gray-100 text-gray-600'}`}>{a.level}</span>
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500">{a.timezone}</td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${status?.color||'bg-gray-100 text-gray-500'}`}>
                      {status?.label||a.status}
                    </span>
                  </td>
                  {showAgentCols && (
                    <td className="px-4 py-3 text-center">
                      <span className="text-sm font-semibold text-blue-600">{a._count?.assignments||0}</span>
                    </td>
                  )}
                  {isSuperAdmin && (
                    <td className="px-4 py-3">
                      <div className="flex items-center gap-1">
                        <button onClick={() => openEdit(a)} className="text-blue-400 hover:text-blue-600 p-1 rounded hover:bg-blue-50">
                          <Pencil className="w-4 h-4"/>
                        </button>
                        {/* Show fix button if user role doesn't match agentType */}
                        {a.user?.role !== (a.agentType === 'PROJECT_MANAGER' ? 'PROJECT_MANAGER' : 'AGENT') && (
                          <button
                            onClick={() => handleFixRole(a)}
                            title={`Fix role: currently ${a.user?.role}, should be ${a.agentType}`}
                            className="text-xs bg-amber-100 text-amber-700 hover:bg-amber-200 px-2 py-1 rounded font-semibold border border-amber-300">
                            Fix Role
                          </button>
                        )}
                        <button onClick={() => handleDelete(a)} title="Delete agent and user account"
                          className="text-red-400 hover:text-red-600 p-1 rounded hover:bg-red-50">
                          <Trash2 className="w-4 h-4"/>
                        </button>
                      </div>
                    </td>
                  )}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Modal */}
      {showModal && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-lg shadow-2xl max-h-[90vh] flex flex-col">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl flex-shrink-0">
              <h2 className="font-bold text-white text-lg">
                {editId ? 'Edit Team Member' : 'Add Team Member'}
              </h2>
              <button onClick={()=>setShowModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4 overflow-y-auto flex-1">

              {/* Agent Type Selector */}
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Role Type</label>
                <div className="grid grid-cols-2 gap-3">
                  {[
                    { val:'AGENT', label:'Agent', desc:'Handles support tickets', icon:'🧑‍💼' },
                    { val:'PROJECT_MANAGER', label:'Project Manager', desc:'Oversees customer accounts', icon:'📋' },
                  ].map(opt => (
                    <button key={opt.val} type="button" onClick={() => setF('agentType', opt.val)}
                      className={`flex flex-col items-start p-3 rounded-xl border-2 transition-all text-left ${
                        form.agentType === opt.val
                          ? 'border-blue-500 bg-blue-50'
                          : 'border-gray-200 hover:border-gray-300 bg-white'
                      }`}>
                      <div className="flex items-center gap-2 mb-1">
                        <span className="text-xl">{opt.icon}</span>
                        <span className={`text-sm font-semibold ${form.agentType===opt.val?'text-blue-700':'text-gray-700'}`}>{opt.label}</span>
                        {form.agentType===opt.val && <span className="ml-auto text-blue-500 text-xs">✓</span>}
                      </div>
                      <span className="text-xs text-gray-400">{opt.desc}</span>
                    </button>
                  ))}
                </div>
              </div>

              {/* Link mode toggle — only on create */}
              {!editId && (
                <div className="flex items-center gap-3 p-3 bg-amber-50 border border-amber-200 rounded-xl">
                  <input type="checkbox" id="linkMode" checked={linkMode}
                    onChange={e => { setLinkMode(e.target.checked); setLinkEmail(''); }}
                    className="w-4 h-4 accent-amber-500 rounded" />
                  <label htmlFor="linkMode" className="text-sm font-semibold text-amber-800 cursor-pointer">
                    Fix existing user — link a user who was created with the wrong role
                  </label>
                </div>
              )}

              {/* Link existing user by email */}
              {!editId && linkMode && (
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                    Existing User Email <span className="text-red-500">*</span>
                  </label>
                  <input type="email" value={linkEmail} onChange={e => setLinkEmail(e.target.value)}
                    className="w-full border border-amber-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-amber-400 focus:outline-none bg-amber-50"
                    placeholder="narsimha@intraedge.com" />
                  <p className="text-xs text-amber-700 mt-1.5 bg-amber-50 px-2 py-1 rounded-lg border border-amber-200">
                    ⚠ This will fix their user role to <strong>{form.agentType === 'PROJECT_MANAGER' ? 'PROJECT_MANAGER' : 'AGENT'}</strong> and create an agent record for them.
                  </p>
                </div>
              )}

              {/* Personal details (only on create, only when NOT in link mode) */}
              {!editId && !linkMode && (
                <>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">Full Name <span className="text-red-500">*</span></label>
                    <input value={form.fullName} onChange={e=>setF('fullName',e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                      placeholder="John Smith"/>
                  </div>
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Email <span className="text-red-500">*</span></label>
                      <input type="email" value={form.email} onChange={e=>setF('email',e.target.value)}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="agent@company.com"/>
                    </div>
                    <div>
                      <label className="block text-sm font-semibold text-gray-700 mb-1.5">Phone</label>
                      <input value={form.phone} onChange={e=>setF('phone',e.target.value)}
                        className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                        placeholder="+91-98765-00001"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                      Password <span className="text-gray-400 font-normal text-xs">(default: Agent@123456)</span>
                    </label>
                    <input type="password" value={form.password} onChange={e=>setF('password',e.target.value)}
                      className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                  </div>
                </>
              )}

              {/* Shared fields */}
              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Level</label>
                  <select value={form.level} onChange={e=>setF('level',e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {LEVELS.map(l=><option key={l.value} value={l.value}>{l.label}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Timezone</label>
                  <select value={form.timezone} onChange={e=>setF('timezone',e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {TIMEZONES.map(t=><option key={t}>{t}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Status</label>
                  <select value={form.status} onChange={e=>setF('status',e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {STATUSES.map(s=><option key={s.value} value={s.value}>{s.label}</option>)}
                  </select>
                </div>
              </div>

              {/* SAP Specializations */}
              <div>
                <div className="flex items-center justify-between mb-2">
                  <label className="block text-sm font-semibold text-gray-700">SAP Specializations</label>
                  <button type="button" onClick={() => setForm((f: AgentForm) => ({
                    ...f, specializations: [...f.specializations, { sapModuleId: '', sapSubModuleIds: [] }]
                  }))} className="text-xs text-blue-600 hover:text-blue-800 flex items-center gap-1">
                    <Plus className="w-3 h-3"/> Add Module
                  </button>
                </div>
                {form.specializations.length === 0 ? (
                  <div className="text-center py-4 border-2 border-dashed border-gray-200 rounded-xl">
                    <p className="text-sm text-gray-400">No specializations added</p>
                    <button type="button" onClick={() => setForm((f: AgentForm) => ({
                      ...f, specializations: [{ sapModuleId: '', sapSubModuleIds: [] }]
                    }))} className="mt-1 text-xs text-blue-600">+ Add specialization</button>
                  </div>
                ) : (
                  <div className="space-y-3">
                    {form.specializations.map((spec: SpecEntry, idx: number) => {
                      const mod = sapModules.find((m: any) => m.id === spec.sapModuleId);
                      const subModules = mod?.subModules || [];
                      return (
                        <div key={idx} className="border border-gray-200 rounded-xl p-3 bg-gray-50">
                          <div className="flex items-center gap-2 mb-2">
                            <select value={spec.sapModuleId}
                              onChange={e => {
                                const newSpecs = [...form.specializations];
                                newSpecs[idx] = { sapModuleId: e.target.value, sapSubModuleIds: [] };
                                setForm((f: AgentForm) => ({ ...f, specializations: newSpecs }));
                              }}
                              className="flex-1 border border-gray-300 rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none">
                              <option value="">— Select SAP Module —</option>
                              {sapModules
                                .filter((m: any) => m.id === spec.sapModuleId || !form.specializations.some((s: SpecEntry) => s.sapModuleId === m.id))
                                .map((m: any) => <option key={m.id} value={m.id}>{m.code} — {m.name}</option>)}
                            </select>
                            <button type="button" onClick={() => {
                              const newSpecs = form.specializations.filter((_: SpecEntry, i: number) => i !== idx);
                              setForm((f: AgentForm) => ({ ...f, specializations: newSpecs }));
                            }} className="p-1.5 text-gray-400 hover:text-red-500 rounded-lg hover:bg-red-50">
                              <X className="w-4 h-4"/>
                            </button>
                          </div>
                          {spec.sapModuleId && subModules.length > 0 && (
                            <div className="grid grid-cols-3 gap-1.5 mt-2">
                              {subModules.map((sub: any) => (
                                <label key={sub.id} className={`flex items-center gap-1.5 border rounded-lg px-2 py-1.5 cursor-pointer text-xs transition-colors ${
                                  spec.sapSubModuleIds.includes(sub.id) ? 'border-blue-400 bg-blue-50 text-blue-700 font-medium' : 'border-gray-200 hover:border-gray-300 text-gray-600'
                                }`}>
                                  <input type="checkbox" checked={spec.sapSubModuleIds.includes(sub.id)}
                                    onChange={() => {
                                      const newSpecs = [...form.specializations];
                                      const current = newSpecs[idx].sapSubModuleIds;
                                      newSpecs[idx] = {
                                        ...newSpecs[idx],
                                        sapSubModuleIds: current.includes(sub.id)
                                          ? current.filter((id: string) => id !== sub.id)
                                          : [...current, sub.id],
                                      };
                                      setForm((f: AgentForm) => ({ ...f, specializations: newSpecs }));
                                    }}
                                    className="accent-blue-600 w-3.5 h-3.5"/>
                                  {sub.code} — {sub.name}
                                </label>
                              ))}
                            </div>
                          )}
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 border-t border-gray-100 flex-shrink-0">
              <button onClick={()=>setShowModal(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                {saving ? 'Saving...' : editId ? 'Save Changes' : `Create ${form.agentType === 'PROJECT_MANAGER' ? 'PM' : 'Agent'}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
