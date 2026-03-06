import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationRulesApi, customersApi, emailLogsApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import {
  Plus, Trash2, Pencil, Bell, BellOff, Mail, MailX, Monitor,
  Zap, Filter, Building2, ChevronDown, ChevronRight, Eye,
  FileText, Clock, X
} from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

// ── Constants ─────────────────────────────────────────────────

const PRIORITY_COLORS: Record<string,string> = {
  P1: 'bg-red-100 text-red-700', P2: 'bg-orange-100 text-orange-700',
  P3: 'bg-yellow-100 text-yellow-700', P4: 'bg-green-100 text-green-700',
};

const RECIPIENT_COLORS: Record<string,string> = {
  CREATOR: 'bg-slate-100 text-slate-700',
  ASSIGNED_AGENT: 'bg-blue-100 text-blue-700',
  COMPANY_ADMIN: 'bg-orange-100 text-orange-700',
  PROJECT_MANAGER: 'bg-purple-100 text-purple-700',
  SUPER_ADMIN: 'bg-red-100 text-red-700',
};

const TYPE_COLORS: Record<string,string> = {
  PRIMARY: 'bg-green-100 text-green-700 border-green-200',
  SECONDARY: 'bg-blue-100 text-blue-700 border-blue-200',
  ESCALATION: 'bg-red-100 text-red-700 border-red-200',
};

const STATUS_COLORS: Record<string,string> = {
  QUEUED: 'bg-blue-100 text-blue-700',
  SENT: 'bg-green-100 text-green-700',
  PENDING: 'bg-yellow-100 text-yellow-700',
  FAILED: 'bg-red-100 text-red-700',
};

interface RecipientEntry {
  role: string;
  recipientType: string;
}

// ── Main Component ────────────────────────────────────────────

export default function NotificationsPage() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [activeTab, setActiveTab] = useState<'rules'|'templates'|'log'>('rules');

  const TABS = [
    { key: 'rules', icon: <Bell className="w-4 h-4"/>, label: 'Notification Rules' },
    { key: 'templates', icon: <FileText className="w-4 h-4"/>, label: 'Email Templates' },
    { key: 'log', icon: <Clock className="w-4 h-4"/>, label: 'Sent Log' },
  ];

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader title="Notifications" subtitle="Configure notification rules, manage email templates, and track sent emails" />

      <div className="flex gap-0 border-b border-gray-200">
        {TABS.map(tab => (
          <button key={tab.key} onClick={() => setActiveTab(tab.key as any)}
            className={`flex items-center gap-2 px-5 py-3 text-sm font-medium border-b-2 transition-colors ${
              activeTab === tab.key ? 'border-blue-600 text-blue-600 bg-blue-50/50' : 'border-transparent text-gray-500 hover:text-gray-700'
            }`}>
            {tab.icon}{tab.label}
          </button>
        ))}
      </div>

      {activeTab === 'rules' && <RulesTab isSuperAdmin={isSuperAdmin} />}
      {activeTab === 'templates' && <TemplatesTab />}
      {activeTab === 'log' && <LogTab />}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// RULES TAB
// ══════════════════════════════════════════════════════════════

function RulesTab({ isSuperAdmin }: { isSuperAdmin: boolean }) {
  const queryClient = useQueryClient();
  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [showModal, setModal] = useState(false);
  const [editRule, setEditRule] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);

  const { data: metaData } = useQuery({
    queryKey: ['notification-rules-metadata'],
    queryFn: () => notificationRulesApi.metadata().then(r => r.data),
  });
  const metadata = metaData || { events: [], recipientRoles: [], recipientTypes: [], emailTemplates: [], priorities: [], statusFilters: [] };

  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['notification-rules', filterCustomerId],
    queryFn: () => notificationRulesApi.list(filterCustomerId ? { customerId: filterCustomerId } : {}).then(r => r.data),
  });
  const grouped = rulesData?.grouped || {};
  const allRules = rulesData?.rules || [];

  const { data: customersData } = useQuery({
    queryKey: ['customers-for-notif'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
  });
  const customers: any[] = customersData || [];

  const defaultForm = {
    event: '', priority: '', statusFilter: '',
    recipients: [] as RecipientEntry[],
    primaryTemplateId: '', secondaryTemplateId: '', escalationTemplateId: '',
    customerId: '', emailEnabled: true, inAppEnabled: true,
  };
  const [form, setForm] = useState(defaultForm);

  const toggleEvent = (event: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      next.has(event) ? next.delete(event) : next.add(event);
      return next;
    });
  };

  const handleOpenCreate = () => { setForm(defaultForm); setEditRule(null); setModal(true); };

  const handleEdit = (rule: any) => {
    const recipients = Array.isArray(rule.recipients)
      ? rule.recipients.map((r: any) => typeof r === 'string'
        ? { role: r, recipientType: 'PRIMARY' }
        : { role: r.role, recipientType: r.recipientType || 'PRIMARY' }
      )
      : [];
    setForm({
      event: rule.event, priority: rule.priority || '', statusFilter: rule.statusFilter || '',
      recipients,
      primaryTemplateId: rule.primaryTemplateId || '',
      secondaryTemplateId: rule.secondaryTemplateId || '',
      escalationTemplateId: rule.escalationTemplateId || '',
      customerId: rule.customerId || '',
      emailEnabled: rule.emailEnabled, inAppEnabled: rule.inAppEnabled,
    });
    setEditRule(rule);
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.event || form.recipients.length === 0) {
      toast.error('Event and at least one recipient are required');
      return;
    }
    const hasPrimary = form.recipients.some(r => r.recipientType === 'PRIMARY');
    const hasSecondary = form.recipients.some(r => r.recipientType === 'SECONDARY');
    const hasEscalation = form.recipients.some(r => r.recipientType === 'ESCALATION');
    if (hasPrimary && !form.primaryTemplateId) {
      toast.error('Primary email template is required when primary recipients are selected');
      return;
    }
    if (hasSecondary && !form.secondaryTemplateId) {
      toast.error('Secondary email template is required when secondary recipients are selected');
      return;
    }
    if (hasEscalation && !form.escalationTemplateId) {
      toast.error('Escalation email template is required when escalation recipients are selected');
      return;
    }
    setSaving(true);
    try {
      const payload = {
        ...form,
        primaryTemplateId: form.primaryTemplateId || null,
        secondaryTemplateId: form.secondaryTemplateId || null,
        escalationTemplateId: form.escalationTemplateId || null,
        recipients: form.recipients.map(r => ({
          role: r.role,
          recipientType: r.recipientType,
        })),
      };
      if (editRule) {
        await notificationRulesApi.update(editRule.id, payload);
        toast.success('Rule updated');
      } else {
        await notificationRulesApi.create(payload);
        toast.success('Rule created');
      }
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
      setModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this notification rule?')) return;
    try {
      await notificationRulesApi.delete(id);
      toast.success('Rule deleted');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleActive = async (rule: any) => {
    try {
      await notificationRulesApi.update(rule.id, { isActive: !rule.isActive });
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await notificationRulesApi.seed();
      toast.success(res.data.message || 'Defaults seeded');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSeeding(false); }
  };

  const recipientLabel = (role: string) => {
    const found = metadata.recipientRoles.find((r: any) => r.value === role);
    return found?.label || role;
  };

  const templateLabel = (templateId: string) => {
    const found = metadata.emailTemplates.find((t: any) => t.id === templateId);
    return found?.label || '';
  };

  const parseRecipients = (rule: any): RecipientEntry[] => {
    if (!Array.isArray(rule.recipients)) return [];
    return rule.recipients.map((r: any) =>
      typeof r === 'string' ? { role: r, recipientType: 'PRIMARY' } : r
    );
  };

  return (
    <div className="space-y-4">
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700">How Notification Rules Work</p>
        <p className="text-xs text-blue-500 mt-0.5">
          When an event occurs, matching rules determine who gets notified. Each recipient has a type (Primary, Secondary, Escalation) and an optional email template.
          {!isSuperAdmin && <span className="font-medium"> You can view rules but only Super Admin can edit them.</span>}
        </p>
      </div>

      <div className="flex items-center gap-3">
        {customers.length > 0 && (
          <>
            <Filter className="w-4 h-4 text-gray-400"/>
            <select value={filterCustomerId} onChange={e => setFilterCustomerId(e.target.value)}
              className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none bg-white min-w-[200px]">
              <option value="">All Rules (Defaults + Overrides)</option>
              {customers.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
            </select>
          </>
        )}
        {isSuperAdmin && (
          <div className="flex gap-2 ml-auto">
            {allRules.length === 0 && (
              <Button variant="secondary" onClick={handleSeedDefaults} loading={seeding}>
                <Zap className="w-4 h-4"/> Seed Defaults
              </Button>
            )}
            <Button onClick={handleOpenCreate}><Plus className="w-4 h-4"/> Add Rule</Button>
          </div>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading rules…</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16">
          <Bell className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No notification rules configured</p>
          {isSuperAdmin && (
            <button onClick={handleSeedDefaults} disabled={seeding}
              className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
              <Zap className="w-4 h-4"/> {seeding ? 'Seeding…' : 'Seed Default Rules & Templates'}
            </button>
          )}
        </div>
      ) : (
        <div className="space-y-3">
          {metadata.events.map((evt: any) => {
            const rules = grouped[evt.value];
            if (!rules || rules.length === 0) return null;
            const isExpanded = expandedEvents.has(evt.value);

            return (
              <div key={evt.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <button onClick={() => toggleEvent(evt.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left">
                  {isExpanded ? <ChevronDown className="w-4 h-4 text-gray-400"/> : <ChevronRight className="w-4 h-4 text-gray-400"/>}
                  <Bell className="w-4 h-4 text-blue-500"/>
                  <span className="text-sm font-semibold text-gray-800">{evt.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
                </button>

                {isExpanded && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {rules.map((rule: any) => {
                      const entries = parseRecipients(rule);
                      return (
                        <div key={rule.id} className={`px-4 py-3 group ${!rule.isActive ? 'opacity-50' : ''}`}>
                          <div className="flex items-center gap-3">
                            <div className={`flex-shrink-0 w-2 h-2 rounded-full ${!rule.customerId ? 'bg-blue-400' : 'bg-amber-400'}`}/>

                            <div className="flex items-center gap-2 min-w-[120px]">
                              {rule.priority
                                ? <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[rule.priority] || 'bg-gray-100'}`}>{rule.priority}</span>
                                : <span className="text-xs text-gray-400">Any</span>}
                              {rule.statusFilter && <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">→ {rule.statusFilter}</span>}
                            </div>

                            {rule.customer && (
                              <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                                <Building2 className="w-3 h-3"/> {rule.customer.companyName}
                              </span>
                            )}

                            <div className="flex-1 flex flex-wrap gap-1">
                              {entries.map((entry: RecipientEntry, idx: number) => (
                                <span key={idx} className="inline-flex items-center gap-1">
                                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${RECIPIENT_COLORS[entry.role] || 'bg-gray-100'}`}>
                                    {recipientLabel(entry.role)}
                                  </span>
                                  <span className={`text-[10px] px-1.5 py-0.5 rounded border ${TYPE_COLORS[entry.recipientType] || 'bg-gray-50'}`}>
                                    {entry.recipientType?.charAt(0)}
                                  </span>
                                </span>
                              ))}
                            </div>

                            <div className="flex items-center gap-1.5 flex-shrink-0">
                              {rule.emailEnabled ? <Mail className="w-3.5 h-3.5 text-green-500"/> : <MailX className="w-3.5 h-3.5 text-gray-300"/>}
                              {rule.inAppEnabled ? <Monitor className="w-3.5 h-3.5 text-green-500"/> : <Monitor className="w-3.5 h-3.5 text-gray-300"/>}
                            </div>

                            {isSuperAdmin && (
                              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                                <button onClick={() => handleToggleActive(rule)} className={`p-1 rounded-lg ${rule.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}>
                                  {rule.isActive ? <Bell className="w-4 h-4"/> : <BellOff className="w-4 h-4"/>}
                                </button>
                                <button onClick={() => handleEdit(rule)} className="p-1 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg"><Pencil className="w-4 h-4"/></button>
                                <button onClick={() => handleDelete(rule.id)} className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg"><Trash2 className="w-4 h-4"/></button>
                              </div>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      <div className="flex items-center gap-4 text-xs text-gray-400 pt-1">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"/> Default</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"/> Override</span>
        <span className="flex items-center gap-1"><span className="px-1 py-0.5 rounded bg-green-100 text-green-700 text-[10px] border border-green-200">P</span> Primary</span>
        <span className="flex items-center gap-1"><span className="px-1 py-0.5 rounded bg-blue-100 text-blue-700 text-[10px] border border-blue-200">S</span> Secondary</span>
        <span className="flex items-center gap-1"><span className="px-1 py-0.5 rounded bg-red-100 text-red-700 text-[10px] border border-red-200">E</span> Escalation</span>
      </div>

      {/* Create/Edit Rule Modal */}
      <Modal open={showModal} onClose={() => setModal(false)}
        title={editRule ? 'Edit Notification Rule' : 'Create Notification Rule'} size="lg"
        footer={<>
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editRule ? 'Save Changes' : 'Create Rule'}</Button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event *</label>
            <select value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
              <option value="">Select event…</option>
              {metadata.events.map((e: any) => <option key={e.value} value={e.value}>{e.label}</option>)}
            </select>
          </div>

          <div className="grid grid-cols-3 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                {metadata.priorities.map((p: any) => <option key={p.value} value={p.value}>{p.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status Filter</label>
              <select value={form.statusFilter} onChange={e => setForm(f => ({ ...f, statusFilter: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                disabled={form.event !== 'STATUS_CHANGED'}>
                {metadata.statusFilters.map((s: any) => <option key={s.value} value={s.value}>{s.label}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="">Default (all)</option>
                {customers.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
            </div>
          </div>

          {/* Recipients - checkbox style with type dropdown */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Recipients *</label>
            <div className="space-y-2">
              {(metadata.recipientRoles || []).map((role: any) => {
                const isChecked = form.recipients.some(r => r.role === role.value);
                const entry = form.recipients.find(r => r.role === role.value);

                const toggleRecipient = () => {
                  if (isChecked) {
                    setForm(f => ({ ...f, recipients: f.recipients.filter(r => r.role !== role.value) }));
                  } else {
                    setForm(f => ({ ...f, recipients: [...f.recipients, { role: role.value, recipientType: 'PRIMARY' }] }));
                  }
                };

                const changeType = (type: string) => {
                  setForm(f => ({
                    ...f,
                    recipients: f.recipients.map(r => r.role === role.value ? { ...r, recipientType: type } : r),
                  }));
                };

                return (
                  <div key={role.value}
                    className={`flex items-center gap-3 px-4 py-3 rounded-xl border transition-all cursor-pointer ${
                      isChecked ? 'bg-blue-50 border-blue-300' : 'bg-white border-gray-200 hover:border-gray-300'
                    }`}
                    onClick={() => !isChecked && toggleRecipient()}>
                    <input type="checkbox" checked={isChecked} onChange={toggleRecipient}
                      onClick={e => e.stopPropagation()}
                      className="w-5 h-5 rounded text-blue-600 border-gray-300 focus:ring-blue-500 cursor-pointer flex-shrink-0"/>
                    <span className={`text-sm font-medium flex-1 ${RECIPIENT_COLORS[role.value] ? '' : ''}`}>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-semibold ${RECIPIENT_COLORS[role.value] || 'bg-gray-100 text-gray-600'}`}>
                        {role.label}
                      </span>
                    </span>
                    {isChecked && (
                      <select value={entry?.recipientType || 'PRIMARY'}
                        onChange={e => { e.stopPropagation(); changeType(e.target.value); }}
                        onClick={e => e.stopPropagation()}
                        className={`w-44 border rounded-lg px-2.5 py-1.5 text-xs font-medium focus:ring-2 focus:ring-blue-500 focus:outline-none ${
                          entry?.recipientType === 'PRIMARY' ? 'border-green-300 bg-green-50 text-green-700'
                          : entry?.recipientType === 'SECONDARY' ? 'border-blue-300 bg-blue-50 text-blue-700'
                          : 'border-red-300 bg-red-50 text-red-700'
                        }`}>
                        {(metadata.recipientTypes || []).map((t: any) => (
                          <option key={t.value} value={t.value}>{t.label}</option>
                        ))}
                      </select>
                    )}
                  </div>
                );
              })}
            </div>
          </div>

          {/* Email Templates per type - only show for types that have recipients */}
          {(() => {
            const hasPrimary = form.recipients.some(r => r.recipientType === 'PRIMARY');
            const hasSecondary = form.recipients.some(r => r.recipientType === 'SECONDARY');
            const hasEscalation = form.recipients.some(r => r.recipientType === 'ESCALATION');
            if (!hasPrimary && !hasSecondary && !hasEscalation) return null;
            return (
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-2">Email Templates *</label>
                <p className="text-xs text-gray-400 mb-3">Select the email template for each recipient type.</p>
                <div className="space-y-2">
                  {hasPrimary && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl border ${!form.primaryTemplateId ? 'bg-red-50 border-red-300' : 'bg-green-50 border-green-200'}`}>
                      <span className="text-xs font-semibold text-green-700 w-24 flex-shrink-0">Primary *</span>
                      <select value={form.primaryTemplateId} onChange={e => setForm(f => ({ ...f, primaryTemplateId: e.target.value }))}
                        className={`flex-1 border rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none ${!form.primaryTemplateId ? 'border-red-400' : 'border-gray-300'}`}>
                        <option value="">— Select template —</option>
                        {(metadata.emailTemplates || []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                  {hasSecondary && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl border ${!form.secondaryTemplateId ? 'bg-red-50 border-red-300' : 'bg-blue-50 border-blue-200'}`}>
                      <span className="text-xs font-semibold text-blue-700 w-24 flex-shrink-0">Secondary *</span>
                      <select value={form.secondaryTemplateId} onChange={e => setForm(f => ({ ...f, secondaryTemplateId: e.target.value }))}
                        className={`flex-1 border rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none ${!form.secondaryTemplateId ? 'border-red-400' : 'border-gray-300'}`}>
                        <option value="">— Select template —</option>
                        {(metadata.emailTemplates || []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                  {hasEscalation && (
                    <div className={`flex items-center gap-3 p-3 rounded-xl border ${!form.escalationTemplateId ? 'bg-red-50 border-red-300' : 'bg-red-50 border-red-200'}`}>
                      <span className="text-xs font-semibold text-red-700 w-24 flex-shrink-0">Escalation *</span>
                      <select value={form.escalationTemplateId} onChange={e => setForm(f => ({ ...f, escalationTemplateId: e.target.value }))}
                        className={`flex-1 border rounded-lg px-2.5 py-2 text-sm bg-white focus:ring-2 focus:ring-blue-500 focus:outline-none ${!form.escalationTemplateId ? 'border-red-400' : 'border-gray-300'}`}>
                        <option value="">— Select template —</option>
                        {(metadata.emailTemplates || []).map((t: any) => <option key={t.id} value={t.id}>{t.label}</option>)}
                      </select>
                    </div>
                  )}
                </div>
              </div>
            );
          })()}

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channels</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.emailEnabled} onChange={e => setForm(f => ({ ...f, emailEnabled: e.target.checked }))} className="rounded text-blue-600"/>
                <Mail className="w-4 h-4 text-gray-500"/> <span className="text-sm text-gray-700">Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.inAppEnabled} onChange={e => setForm(f => ({ ...f, inAppEnabled: e.target.checked }))} className="rounded text-blue-600"/>
                <Monitor className="w-4 h-4 text-gray-500"/> <span className="text-sm text-gray-700">In-App</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// TEMPLATES TAB
// ══════════════════════════════════════════════════════════════

function TemplatesTab() {
  const { user } = useAuthStore();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const queryClient = useQueryClient();

  const [selectedTpl, setSelectedTpl] = useState<any>(null);
  const [mode, setMode] = useState<'view'|'edit'|'preview'|'create'>('view');
  const [editForm, setEditForm] = useState({ subjectTemplate: '', bodyTemplate: '' });
  const [createForm, setCreateForm] = useState({ templateKey: '', label: '', description: '', subjectTemplate: '', bodyTemplate: '' });
  const [saving, setSaving] = useState(false);
  const [previewHtml, setPreviewHtml] = useState('');
  const [previewSubject, setPreviewSubject] = useState('');
  const [loadingPreview, setLoadingPreview] = useState(false);
  const [seedingTpl, setSeedingTpl] = useState(false);

  const { data: templates, isLoading } = useQuery({
    queryKey: ['notification-templates'],
    queryFn: () => notificationRulesApi.templates().then(r => r.data.templates),
  });

  const templateIcons: Record<string, string> = {
    RECORD_CREATED: '🎫', RECORD_ASSIGNED: '👤', STATUS_CHANGED: '🔄',
    COMMENT_ADDED: '💬', SLA_WARNING: '⚠️', SLA_BREACH: '🔴',
    RECORD_CREATED_FYI: '📋', RECORD_ASSIGNED_FYI: '📌', STATUS_CHANGED_FYI: '📝', COMMENT_ADDED_FYI: '📄',
  };

  const handleSelect = (tpl: any) => {
    setSelectedTpl(tpl);
    setEditForm({ subjectTemplate: tpl.subjectTemplate, bodyTemplate: tpl.bodyTemplate });
    setMode('view');
  };

  const handleSeedTemplates = async () => {
    setSeedingTpl(true);
    try {
      const res = await notificationRulesApi.seed();
      toast.success(res.data.message || 'Templates seeded');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      queryClient.invalidateQueries({ queryKey: ['notification-rules-metadata'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSeedingTpl(false); }
  };

  const handlePreview = async () => {
    if (!selectedTpl) return;
    setLoadingPreview(true);
    try {
      const res = await notificationRulesApi.previewTemplate(selectedTpl.id);
      setPreviewSubject(res.data.subjectRendered);
      setPreviewHtml(res.data.bodyRendered);
      setMode('preview');
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setLoadingPreview(false); }
  };

  const handleSave = async () => {
    if (!selectedTpl) return;
    setSaving(true);
    try {
      await notificationRulesApi.updateTemplate(selectedTpl.id, editForm);
      toast.success('Template saved');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      setMode('view');
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleCreate = async () => {
    if (!createForm.templateKey || !createForm.label || !createForm.subjectTemplate || !createForm.bodyTemplate) {
      toast.error('Template Key, Label, Subject, and Body are required');
      return;
    }
    setSaving(true);
    try {
      await notificationRulesApi.createTemplate(createForm);
      toast.success('Template created');
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      queryClient.invalidateQueries({ queryKey: ['notification-rules-metadata'] });
      setMode('view');
      setCreateForm({ templateKey: '', label: '', description: '', subjectTemplate: '', bodyTemplate: '' });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleReset = async () => {
    if (!selectedTpl || !confirm('Reset this template to the default?')) return;
    try {
      const res = await notificationRulesApi.resetTemplate(selectedTpl.id);
      toast.success('Template reset');
      setSelectedTpl(res.data.template);
      setEditForm({ subjectTemplate: res.data.template.subjectTemplate, bodyTemplate: res.data.template.bodyTemplate });
      queryClient.invalidateQueries({ queryKey: ['notification-templates'] });
      setMode('view');
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const variablesHint = (
    <div className="bg-amber-50 border border-amber-200 rounded-lg px-4 py-2.5 text-xs text-amber-700">
      Variables: <code className="bg-amber-100 px-1 rounded">{'{{recordNumber}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{title}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{priority}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{status}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{customer}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{recipientName}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{assignedAgentName}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{oldStatus}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{newStatus}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{slaType}}'}</code>{' '}
      <code className="bg-amber-100 px-1 rounded">{'{{portalUrl}}'}</code>
    </div>
  );

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3 flex-1">
          <p className="text-sm font-semibold text-blue-700">Email Templates</p>
          <p className="text-xs text-blue-500 mt-0.5">
            Manage HTML email templates. Each notification rule can reference a specific template per recipient.
          </p>
        </div>
        {isSuperAdmin && templates && templates.length > 0 && (
          <button onClick={() => { setMode('create'); setSelectedTpl(null); }}
            className="ml-3 flex items-center gap-1.5 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2.5 rounded-xl text-sm font-medium flex-shrink-0">
            <Plus className="w-4 h-4"/> New Template
          </button>
        )}
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading templates…</div>
      ) : !templates || templates.length === 0 ? (
        <div className="text-center py-16">
          <FileText className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No email templates found</p>
          {isSuperAdmin && (
            <button onClick={handleSeedTemplates} disabled={seedingTpl}
              className="mt-4 inline-flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-5 py-2.5 rounded-xl text-sm font-medium disabled:opacity-50">
              <Zap className="w-4 h-4"/> {seedingTpl ? 'Seeding…' : 'Seed Default Templates'}
            </button>
          )}
        </div>
      ) : (
        <div className="grid grid-cols-1 lg:grid-cols-3 gap-4">
          {/* Template list */}
          <div className="space-y-2 max-h-[65vh] overflow-y-auto">
            {templates.map((tpl: any) => (
              <button key={tpl.id} onClick={() => handleSelect(tpl)}
                className={`w-full text-left px-4 py-3 rounded-xl border transition-all ${
                  selectedTpl?.id === tpl.id ? 'border-blue-400 bg-blue-50 shadow-sm' : 'border-gray-200 bg-white hover:border-gray-300'
                }`}>
                <div className="flex items-center gap-3">
                  <span className="text-lg">{templateIcons[tpl.templateKey] || '📧'}</span>
                  <div className="min-w-0">
                    <p className="text-sm font-semibold text-gray-800 truncate">{tpl.label}</p>
                    <p className="text-xs text-gray-400 font-mono truncate">{tpl.templateKey}</p>
                  </div>
                </div>
              </button>
            ))}
          </div>

          {/* Detail panel */}
          <div className="lg:col-span-2">
            {mode === 'create' ? (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="px-5 py-3 bg-gray-50 border-b border-gray-200 flex items-center justify-between">
                  <p className="text-sm font-semibold text-gray-800">Create New Template</p>
                  <div className="flex gap-2">
                    <Button variant="secondary" onClick={() => setMode('view')}>Cancel</Button>
                    <Button loading={saving} onClick={handleCreate}>Create</Button>
                  </div>
                </div>
                <div className="p-5 space-y-4 max-h-[55vh] overflow-y-auto">
                  <div className="grid grid-cols-2 gap-3">
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Template Key *</label>
                      <input value={createForm.templateKey} onChange={e => setCreateForm(f => ({ ...f, templateKey: e.target.value.toUpperCase().replace(/[^A-Z0-9_]/g, '') }))}
                        placeholder="e.g. CUSTOM_ESCALATION" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                    </div>
                    <div>
                      <label className="block text-sm font-medium text-gray-700 mb-1">Label *</label>
                      <input value={createForm.label} onChange={e => setCreateForm(f => ({ ...f, label: e.target.value }))}
                        placeholder="e.g. Custom Escalation Email" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                    </div>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Description</label>
                    <input value={createForm.description} onChange={e => setCreateForm(f => ({ ...f, description: e.target.value }))}
                      placeholder="When this template is used" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">Subject Template *</label>
                    <input value={createForm.subjectTemplate} onChange={e => setCreateForm(f => ({ ...f, subjectTemplate: e.target.value }))}
                      placeholder="[{{priority}}] {{recordNumber}} — your subject" className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                  </div>
                  <div>
                    <label className="block text-sm font-medium text-gray-700 mb-1">HTML Body *</label>
                    <textarea value={createForm.bodyTemplate} onChange={e => setCreateForm(f => ({ ...f, bodyTemplate: e.target.value }))}
                      rows={14} placeholder="<div>Your HTML email template here...</div>"
                      className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none leading-relaxed"/>
                  </div>
                  {variablesHint}
                </div>
              </div>
            ) : !selectedTpl ? (
              <div className="text-center py-20 text-gray-400 bg-white rounded-xl border border-gray-200">
                <FileText className="w-10 h-10 mx-auto mb-2 opacity-30"/>
                <p className="text-sm">Select a template to view</p>
              </div>
            ) : (
              <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                <div className="flex items-center justify-between px-5 py-3 bg-gray-50 border-b border-gray-200">
                  <div className="flex items-center gap-2">
                    <span className="text-lg">{templateIcons[selectedTpl.templateKey] || '📧'}</span>
                    <div>
                      <p className="text-sm font-semibold text-gray-800">{selectedTpl.label}</p>
                      <p className="text-xs text-gray-400 font-mono">{selectedTpl.templateKey}</p>
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {mode === 'view' && (
                      <>
                        <button onClick={handlePreview} disabled={loadingPreview}
                          className="flex items-center gap-1 text-xs text-blue-600 hover:text-blue-800 border border-blue-200 px-3 py-1.5 rounded-lg">
                          <Eye className="w-3.5 h-3.5"/> Preview
                        </button>
                        {isSuperAdmin && (
                          <>
                            <button onClick={() => setMode('edit')}
                              className="flex items-center gap-1 text-xs text-orange-600 border border-orange-200 px-3 py-1.5 rounded-lg">
                              <Pencil className="w-3.5 h-3.5"/> Edit
                            </button>
                            <button onClick={handleReset} className="text-xs text-gray-400 hover:text-red-500 px-2 py-1.5 rounded-lg">Reset</button>
                          </>
                        )}
                      </>
                    )}
                    {mode === 'edit' && (
                      <>
                        <Button variant="secondary" onClick={() => { setMode('view'); setEditForm({ subjectTemplate: selectedTpl.subjectTemplate, bodyTemplate: selectedTpl.bodyTemplate }); }}>Cancel</Button>
                        <Button loading={saving} onClick={handleSave}>Save</Button>
                      </>
                    )}
                    {mode === 'preview' && (
                      <button onClick={() => setMode('view')} className="text-xs text-gray-500 border border-gray-200 px-3 py-1.5 rounded-lg">← Back</button>
                    )}
                  </div>
                </div>
                <div className="p-5 space-y-4 max-h-[55vh] overflow-y-auto">
                  {mode === 'preview' ? (
                    <>
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Rendered Subject</p>
                        <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-sm font-medium text-gray-800">{previewSubject}</div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-2">Rendered Email</p>
                        <div className="border border-gray-200 rounded-xl overflow-hidden shadow-sm">
                          <div className="p-6 bg-white" dangerouslySetInnerHTML={{ __html: previewHtml }}/>
                        </div>
                      </div>
                    </>
                  ) : mode === 'edit' ? (
                    <>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">Subject Template</label>
                        <input value={editForm.subjectTemplate} onChange={e => setEditForm(f => ({ ...f, subjectTemplate: e.target.value }))}
                          className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
                      </div>
                      <div>
                        <label className="block text-sm font-medium text-gray-700 mb-1">HTML Body Template</label>
                        <textarea value={editForm.bodyTemplate} onChange={e => setEditForm(f => ({ ...f, bodyTemplate: e.target.value }))}
                          rows={16} className="w-full border border-gray-300 rounded-xl px-4 py-3 text-xs font-mono focus:ring-2 focus:ring-blue-500 focus:outline-none resize-none leading-relaxed"/>
                      </div>
                      {variablesHint}
                    </>
                  ) : (
                    <>
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">Subject Template</p>
                        <div className="bg-gray-50 rounded-lg px-4 py-2.5 text-sm font-mono text-gray-700">{selectedTpl.subjectTemplate}</div>
                      </div>
                      <div>
                        <p className="text-xs font-medium text-gray-400 uppercase tracking-wide mb-1">HTML Body Template</p>
                        <pre className="bg-gray-50 rounded-lg px-4 py-3 text-xs font-mono text-gray-600 whitespace-pre-wrap leading-relaxed overflow-auto max-h-[40vh]">{selectedTpl.bodyTemplate}</pre>
                      </div>
                    </>
                  )}
                </div>
              </div>
            )}
          </div>
        </div>
      )}
    </div>
  );
}

// ══════════════════════════════════════════════════════════════
// LOG TAB
// ══════════════════════════════════════════════════════════════

function LogTab() {
  const [page, setPage] = useState(1);
  const [previewLog, setPreviewLog] = useState<any>(null);
  const [loadingPreview, setLoadingPreview] = useState(false);

  const { data: logData, isLoading } = useQuery({
    queryKey: ['email-logs', page],
    queryFn: () => emailLogsApi.list({ page, limit: 20 }).then(r => r.data),
  });
  const logs = logData?.logs || [];
  const total = logData?.pagination?.total || 0;
  const totalPages = Math.ceil(total / 20);

  const handlePreview = async (id: string) => {
    setLoadingPreview(true);
    try {
      const res = await emailLogsApi.get(id);
      setPreviewLog(res.data.log);
    } catch { /* ignore */ }
    finally { setLoadingPreview(false); }
  };

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <p className="text-sm text-gray-500">{total} emails in log</p>
        <div className="flex items-center gap-2 text-xs text-gray-400">
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"/> QUEUED</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-green-400"/> SENT</span>
          <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-red-400"/> FAILED</span>
        </div>
      </div>

      <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-gray-50 border-b border-gray-200">
              {['Template','Subject','Recipient','Ticket','Status','Created',''].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-xs text-gray-500 uppercase tracking-wide">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={7} className="text-center py-10 text-gray-400">Loading…</td></tr>
            ) : logs.length === 0 ? (
              <tr><td colSpan={7} className="text-center py-16 text-gray-400">
                <Mail className="w-10 h-10 mx-auto mb-2 opacity-20"/>No emails yet — create a ticket to generate notifications
              </td></tr>
            ) : logs.map((log: any) => (
              <tr key={log.id} className="hover:bg-gray-50 group">
                <td className="px-4 py-3"><span className="text-xs font-mono bg-gray-100 px-2 py-0.5 rounded text-gray-600">{log.templateKey}</span></td>
                <td className="px-4 py-3 text-gray-700 max-w-xs truncate">{log.subject}</td>
                <td className="px-4 py-3 text-gray-500 text-xs">{log.recipient}</td>
                <td className="px-4 py-3">{log.record ? <span className="text-xs font-mono text-blue-600">{log.record.recordNumber}</span> : '—'}</td>
                <td className="px-4 py-3"><span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[log.status] || 'bg-gray-100'}`}>{log.status}</span></td>
                <td className="px-4 py-3 text-xs text-gray-400">{format(new Date(log.createdAt), 'dd MMM yyyy HH:mm')}</td>
                <td className="px-4 py-3 text-right">
                  <button onClick={() => handlePreview(log.id)}
                    className="opacity-0 group-hover:opacity-100 transition-opacity flex items-center gap-1 text-xs text-blue-600 border border-blue-200 px-2.5 py-1 rounded-lg">
                    <Eye className="w-3.5 h-3.5"/> View
                  </button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {totalPages > 1 && (
        <div className="flex items-center justify-between text-sm text-gray-500">
          <span>Page {page} of {totalPages}</span>
          <div className="flex gap-2">
            <button disabled={page <= 1} onClick={() => setPage(p => p - 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">← Prev</button>
            <button disabled={page >= totalPages} onClick={() => setPage(p => p + 1)} className="px-3 py-1.5 border rounded-lg disabled:opacity-40 hover:bg-gray-50">Next →</button>
          </div>
        </div>
      )}

      {/* Email Preview Modal */}
      {previewLog && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4" onClick={() => setPreviewLog(null)}>
          <div className="bg-white rounded-2xl w-full max-w-3xl max-h-[90vh] flex flex-col shadow-2xl" onClick={e => e.stopPropagation()}>
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-blue-700 to-blue-900 rounded-t-2xl flex-shrink-0">
              <div>
                <h2 className="font-bold text-white">Email Preview</h2>
                <p className="text-xs text-white/60">{previewLog.templateKey} • {format(new Date(previewLog.createdAt), 'dd MMM yyyy HH:mm')}</p>
              </div>
              <button onClick={() => setPreviewLog(null)} className="text-white/60 hover:text-white text-2xl">×</button>
            </div>
            <div className="px-6 py-4 bg-gray-50 border-b border-gray-200 space-y-2">
              <div className="flex items-center gap-2 text-sm"><span className="font-medium text-gray-500 w-16">To:</span><span className="text-gray-800">{previewLog.recipient}</span></div>
              <div className="flex items-center gap-2 text-sm"><span className="font-medium text-gray-500 w-16">Subject:</span><span className="text-gray-800 font-medium">{previewLog.subject}</span></div>
              <div className="flex items-center gap-2 text-sm">
                <span className="font-medium text-gray-500 w-16">Status:</span>
                <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${STATUS_COLORS[previewLog.status] || 'bg-gray-100'}`}>{previewLog.status}</span>
                {previewLog.record && <span className="text-xs text-blue-600 font-mono ml-2">{previewLog.record.recordNumber}</span>}
              </div>
              {previewLog.error && <div className="text-xs text-red-600">Error: {previewLog.error}</div>}
            </div>
            <div className="flex-1 overflow-y-auto p-6">
              <div className="border border-gray-200 rounded-xl overflow-hidden">
                <div className="p-6 bg-white" dangerouslySetInnerHTML={{ __html: previewLog.body }}/>
              </div>
            </div>
            <div className="flex justify-end px-6 py-4 bg-gray-50 border-t rounded-b-2xl">
              <button onClick={() => setPreviewLog(null)} className="px-5 py-2 border border-gray-300 text-gray-600 hover:bg-gray-100 rounded-xl text-sm font-medium">Close</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
