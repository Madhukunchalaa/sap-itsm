import React, { useState, useRef, useCallback } from 'react';
import { useNavigate } from 'react-router-dom';
import { ArrowLeft, Paperclip, X, Upload } from 'lucide-react';
import { useQuery } from '@tanstack/react-query';
import { useCreateRecord, useCustomers } from '../hooks/useApi';
import { Input, Select, Textarea, Button, PageHeader, Card } from '../components/ui/Forms';
import { useAuthStore } from '../store/auth.store';
import { agentsApi, sapModulesApi } from '../api/services';

const TYPE_OPTIONS = [
  { value: 'INCIDENT', label: '🔴 Incident — Something is broken' },
  { value: 'REQUEST',  label: '🔵 Request — Need something done' },
  { value: 'PROBLEM',  label: '🟣 Problem — Root cause investigation' },
  { value: 'CHANGE',   label: '🟢 Change — Planned modification' },
];
const PRIORITY_OPTIONS = [
  { value: 'P1', label: 'P1 — Critical' },
  { value: 'P2', label: 'P2 — High' },
  { value: 'P3', label: 'P3 — Medium' },
  { value: 'P4', label: 'P4 — Low' },
];

export default function NewRecordPage() {
  const navigate = useNavigate();
  const { user } = useAuthStore();
  const createRecord = useCreateRecord();
  const { data: customers } = useCustomers();

  const [form, setForm] = useState({
    recordType: 'INCIDENT', title: '', description: '',
    priority: 'P3', customerId: '',
    assignedAgentId: '', tags: '',
    sapModuleId: '', sapSubModuleId: '',
  });
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [attachments, setAttachments] = useState<File[]>([]);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const isUserRole = user?.role === 'USER';
  const canAssign = ['SUPER_ADMIN', 'COMPANY_ADMIN', 'AGENT', 'PROJECT_MANAGER'].includes(user?.role || '');

  const { data: agentsData } = useQuery({
    queryKey: ['agents-assign', form.customerId],
    queryFn: () => agentsApi.list({
      agentType: 'AGENT', limit: 200,
      ...(form.customerId ? { customerId: form.customerId } : {}),
    }).then(r => r.data.data || r.data.agents || []),
    enabled: canAssign,
  });

  const { data: sapModulesData } = useQuery({
    queryKey: ['sap-modules-active'],
    queryFn: () => sapModulesApi.active().then(r => r.data.data || []),
  });
  const sapModules: any[] = sapModulesData || [];
  const selectedModule = sapModules.find((m: any) => m.id === form.sapModuleId);
  const sapSubModules: any[] = selectedModule?.subModules || [];



  const agents: any[] = agentsData || [];

  const set = (key: string, val: string) => {
    setForm(f => {
      const next = { ...f, [key]: val };
      if (key === 'sapModuleId') next.sapSubModuleId = '';
      if (key === 'customerId') next.assignedAgentId = '';
      return next;
    });
    setErrors(e => { const n = { ...e }; delete n[key]; return n; });
  };

  const validate = () => {
    const errs: Record<string, string> = {};
    if (!form.title.trim() || form.title.length < 5) errs.title = 'Title must be at least 5 characters';
    if (!form.description.trim() || form.description.length < 10) errs.description = 'Description must be at least 10 characters';
    setErrors(errs);
    return Object.keys(errs).length === 0;
  };

  const handleFiles = (files: FileList | null) => {
    if (!files) return;
    setAttachments(prev => [...prev, ...Array.from(files).filter(f => f.size <= 10 * 1024 * 1024)].slice(0, 5));
  };

  const handleDrop = useCallback((e: React.DragEvent) => {
    e.preventDefault(); setDragging(false); handleFiles(e.dataTransfer.files);
  }, []);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (!validate()) return;
    const record = await createRecord.mutateAsync({
      recordType: form.recordType, title: form.title.trim(),
      description: form.description.trim(), priority: form.priority,
      customerId:      form.customerId      || undefined,
      assignedAgentId: form.assignedAgentId || undefined,
      sapModuleId:     form.sapModuleId     || undefined,
      sapSubModuleId:  form.sapSubModuleId  || undefined,
      tags: form.tags.split(',').map(t => t.trim()).filter(Boolean),
      metadata: attachments.length > 0 ? { attachmentNames: attachments.map(f => f.name) } : undefined,
    });
    navigate(`/records/${record.id}`);
  };

  const customerList: any[] = customers?.data || [];

  return (
    <div className="p-6 max-w-3xl mx-auto">
      <button onClick={() => navigate('/records')} className="flex items-center gap-2 text-sm text-gray-500 hover:text-gray-700 mb-5">
        <ArrowLeft className="w-4 h-4" /> Back to Tickets
      </button>

      <PageHeader title="Create New Ticket" subtitle="Fill in the details to open a new ITSM record" />

      <form onSubmit={handleSubmit} className="space-y-5">
        <Card>
          <div className="p-5 space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <Select label="Record Type" value={form.recordType} onChange={e => set('recordType', e.target.value)} options={TYPE_OPTIONS}/>
              <Select label="Priority" value={form.priority} onChange={e => set('priority', e.target.value)} options={PRIORITY_OPTIONS}/>
            </div>

            {/* SAP Module / Sub-Module */}
            <div className="grid grid-cols-2 gap-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">SAP Module</label>
                <select value={form.sapModuleId} onChange={e => set('sapModuleId', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                  <option value="">— Select Module —</option>
                  {sapModules.map((m: any) => (
                    <option key={m.id} value={m.id}>{m.code} — {m.name}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Sub-Module</label>
                <select value={form.sapSubModuleId} onChange={e => set('sapSubModuleId', e.target.value)}
                  disabled={!form.sapModuleId}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400">
                  <option value="">{form.sapModuleId ? '— Select Sub-Module —' : '— Select a module first —'}</option>
                  {sapSubModules.map((s: any) => (
                    <option key={s.id} value={s.id}>{s.code} — {s.name}</option>
                  ))}
                </select>
              </div>
            </div>

            <Input label="Title" value={form.title} onChange={e => set('title', e.target.value)}
              placeholder="Brief, descriptive title" error={errors.title} maxLength={500}/>

            <Textarea label="Description" value={form.description} onChange={e => set('description', e.target.value)}
              placeholder={
                form.recordType === 'INCIDENT' ? "What happened, when, who is affected, error messages…" :
                form.recordType === 'REQUEST'  ? "What you need, system, user, business justification…" :
                form.recordType === 'CHANGE'   ? "What, why, risk assessment, rollback plan…" :
                "Problem description and symptoms…"
              }
              error={errors.description} rows={6}/>

            {/* Customer + Contract */}
            {!isUserRole && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Customer</label>
                  <select value={form.customerId} onChange={e => set('customerId', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">— No Customer —</option>
                    {customerList.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                  </select>
                </div>

              </div>
            )}

            {/* Agent Assignment */}
            {canAssign && (
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Assign Agent</label>
                  <select value={form.assignedAgentId} onChange={e => set('assignedAgentId', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="">— Unassigned —</option>
                    {agents.map((a: any) => (
                      <option key={a.id} value={a.id}>
                        {a.user?.firstName} {a.user?.lastName} ({a.level})
                      </option>
                    ))}
                  </select>
                  {agents.length === 0 && (
                    <p className="text-xs text-amber-600 mt-1 italic">No agents configured yet</p>
                  )}
                </div>
                <Input label="Tags (comma-separated)" value={form.tags}
                  onChange={e => set('tags', e.target.value)} placeholder="sap-basis, production"/>
              </div>
            )}

            {/* Attachments */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">
                Attachments <span className="text-gray-400 font-normal">— max 5 files, 10MB each</span>
              </label>
              <div onDragOver={e => { e.preventDefault(); setDragging(true); }}
                onDragLeave={() => setDragging(false)} onDrop={handleDrop}
                onClick={() => fileInputRef.current?.click()}
                className={`border-2 border-dashed rounded-xl p-6 text-center cursor-pointer transition-colors ${
                  dragging ? 'border-blue-400 bg-blue-50' : 'border-gray-300 hover:border-gray-400 hover:bg-gray-50'
                }`}>
                <Upload className="w-6 h-6 text-gray-400 mx-auto mb-2"/>
                <p className="text-sm text-gray-500">Click to attach files, or drag and drop</p>
                <input ref={fileInputRef} type="file" multiple className="hidden"
                  onChange={e => handleFiles(e.target.files)}
                  accept=".pdf,.doc,.docx,.xls,.xlsx,.png,.jpg,.jpeg,.zip,.txt"/>
              </div>
              {attachments.length > 0 && (
                <div className="mt-3 space-y-2">
                  {attachments.map((file, i) => (
                    <div key={i} className="flex items-center gap-3 p-2.5 bg-gray-50 rounded-lg border border-gray-200">
                      <Paperclip className="w-4 h-4 text-gray-400 flex-shrink-0"/>
                      <div className="flex-1 min-w-0">
                        <p className="text-sm text-gray-700 truncate">{file.name}</p>
                        <p className="text-xs text-gray-400">{(file.size/1024).toFixed(1)} KB</p>
                      </div>
                      <button type="button" onClick={() => setAttachments(prev => prev.filter((_,j)=>j!==i))}
                        className="text-gray-400 hover:text-red-500 p-1 rounded"><X className="w-4 h-4"/></button>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        </Card>

        {(form.priority === 'P1' || form.priority === 'P2') && (
          <div className={`p-4 rounded-xl border flex items-start gap-3 ${
            form.priority === 'P1' ? 'bg-red-50 border-red-200 text-red-800' : 'bg-orange-50 border-orange-200 text-orange-800'
          }`}>
            <span className="text-lg">⚡</span>
            <div className="text-sm">
              <p className="font-semibold">{form.priority === 'P1' ? 'P1 Critical — Immediate Response Required' : 'P2 High Priority'}</p>
              <p className="mt-0.5 opacity-80">{form.priority === 'P1' ? 'SLA clock starts immediately. On-call may be triggered.' : 'High priority SLA applies.'}</p>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3">
          <Button variant="secondary" type="button" onClick={() => navigate('/records')}>Cancel</Button>
          <Button type="submit" loading={createRecord.isPending}>Create Ticket</Button>
        </div>
      </form>
    </div>
  );
}
