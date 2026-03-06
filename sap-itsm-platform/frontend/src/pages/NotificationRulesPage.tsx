import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { notificationRulesApi, customersApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button, Select } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import {
  Plus, Trash2, Pencil, Bell, BellOff, Mail, MailX, Monitor, Zap,
  Filter, Building2, ChevronDown, ChevronRight, Shield
} from 'lucide-react';
import toast from 'react-hot-toast';

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

export default function NotificationRulesPage() {
  const { user } = useAuthStore();
  const queryClient = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  const [filterCustomerId, setFilterCustomerId] = useState('');
  const [showModal, setModal] = useState(false);
  const [editRule, setEditRule] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [expandedEvents, setExpandedEvents] = useState<Set<string>>(new Set());
  const [seeding, setSeeding] = useState(false);

  // Fetch metadata
  const { data: metaData } = useQuery({
    queryKey: ['notification-rules-metadata'],
    queryFn: () => notificationRulesApi.metadata().then(r => r.data),
  });
  const metadata = metaData || { events: [], recipientRoles: [], priorities: [], statusFilters: [] };

  // Fetch rules
  const { data: rulesData, isLoading } = useQuery({
    queryKey: ['notification-rules', filterCustomerId],
    queryFn: () => notificationRulesApi.list(filterCustomerId ? { customerId: filterCustomerId } : {}).then(r => r.data),
  });
  const grouped = rulesData?.grouped || {};
  const allRules = rulesData?.rules || [];

  // Fetch customers for filter and form
  const { data: customersData } = useQuery({
    queryKey: ['customers-for-notif'],
    queryFn: () => customersApi.list({ limit: 100 }).then(r => r.data.data || []),
  });
  const customers: any[] = customersData || [];

  // Form state
  const defaultForm = {
    event: '', priority: '', statusFilter: '', recipients: [] as string[],
    customerId: '', emailEnabled: true, inAppEnabled: true,
  };
  const [form, setForm] = useState(defaultForm);

  const toggleEvent = (event: string) => {
    setExpandedEvents(prev => {
      const next = new Set(prev);
      if (next.has(event)) next.delete(event); else next.add(event);
      return next;
    });
  };

  const handleOpenCreate = () => {
    setForm(defaultForm);
    setEditRule(null);
    setModal(true);
  };

  const handleEdit = (rule: any) => {
    setForm({
      event: rule.event,
      priority: rule.priority || '',
      statusFilter: rule.statusFilter || '',
      recipients: rule.recipients || [],
      customerId: rule.customerId || '',
      emailEnabled: rule.emailEnabled,
      inAppEnabled: rule.inAppEnabled,
    });
    setEditRule(rule);
    setModal(true);
  };

  const handleToggleRecipient = (role: string) => {
    setForm(f => ({
      ...f,
      recipients: f.recipients.includes(role)
        ? f.recipients.filter(r => r !== role)
        : [...f.recipients, role],
    }));
  };

  const handleSave = async () => {
    if (!form.event || form.recipients.length === 0) {
      toast.error('Event and at least one recipient are required');
      return;
    }
    setSaving(true);
    try {
      if (editRule) {
        await notificationRulesApi.update(editRule.id, form);
        toast.success('Rule updated');
      } else {
        await notificationRulesApi.create(form);
        toast.success('Rule created');
      }
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
      setModal(false);
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this notification rule?')) return;
    try {
      await notificationRulesApi.delete(id);
      toast.success('Rule deleted');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleToggleActive = async (rule: any) => {
    try {
      await notificationRulesApi.update(rule.id, { isActive: !rule.isActive });
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    }
  };

  const handleSeedDefaults = async () => {
    setSeeding(true);
    try {
      const res = await notificationRulesApi.seed();
      toast.success(res.data.message || 'Default rules seeded');
      queryClient.invalidateQueries({ queryKey: ['notification-rules'] });
    } catch (e) {
      toast.error(getErrorMessage(e));
    } finally {
      setSeeding(false);
    }
  };

  const eventLabel = (event: string) => {
    const found = metadata.events.find((e: any) => e.value === event);
    return found?.label || event;
  };

  const recipientLabel = (role: string) => {
    const found = metadata.recipientRoles.find((r: any) => r.value === role);
    return found?.label || role;
  };

  return (
    <div className="p-6 space-y-5 max-w-screen-xl mx-auto">
      <PageHeader
        title="Notification Rules"
        subtitle={`${allRules.length} rules configured`}
        actions={isSuperAdmin ? (
          <div className="flex gap-2">
            {allRules.length === 0 && (
              <Button variant="secondary" onClick={handleSeedDefaults} loading={seeding}>
                <Zap className="w-4 h-4"/> Seed Defaults
              </Button>
            )}
            <Button onClick={handleOpenCreate}><Plus className="w-4 h-4"/> Add Rule</Button>
          </div>
        ) : undefined}
      />

      {/* Info banner */}
      <div className="bg-blue-50 border border-blue-200 rounded-xl px-4 py-3">
        <p className="text-sm font-semibold text-blue-700">How Notification Rules Work</p>
        <p className="text-xs text-blue-500 mt-0.5">
          When an event occurs (ticket created, status changed, etc.), the system finds matching rules based on event type, priority, and customer.
          Customer-specific rules override the defaults. Recipients are resolved by role and notified via email and in-app.
        </p>
      </div>

      {/* Filter by customer */}
      {isSuperAdmin && customers.length > 0 && (
        <div className="flex items-center gap-3">
          <Filter className="w-4 h-4 text-gray-400"/>
          <select value={filterCustomerId} onChange={e => setFilterCustomerId(e.target.value)}
            className="text-sm border border-gray-200 rounded-xl px-3 py-2 focus:outline-none bg-white min-w-[200px]">
            <option value="">All Rules (Defaults + Overrides)</option>
            {customers.map((c: any) => (
              <option key={c.id} value={c.id}>{c.companyName} — Show Overrides</option>
            ))}
          </select>
        </div>
      )}

      {/* Rules grouped by event */}
      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading rules…</div>
      ) : Object.keys(grouped).length === 0 ? (
        <div className="text-center py-16">
          <Bell className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No notification rules configured</p>
          <p className="text-sm text-gray-400 mt-1">Click "Seed Defaults" to create the standard notification matrix</p>
        </div>
      ) : (
        <div className="space-y-3">
          {metadata.events.map((evt: any) => {
            const rules = grouped[evt.value];
            if (!rules || rules.length === 0) return null;
            const isExpanded = expandedEvents.has(evt.value);

            return (
              <div key={evt.value} className="bg-white rounded-xl border border-gray-200 overflow-hidden">
                {/* Event header */}
                <button
                  onClick={() => toggleEvent(evt.value)}
                  className="w-full flex items-center gap-3 px-4 py-3 hover:bg-gray-50 transition-colors text-left"
                >
                  {isExpanded
                    ? <ChevronDown className="w-4 h-4 text-gray-400"/>
                    : <ChevronRight className="w-4 h-4 text-gray-400"/>
                  }
                  <Bell className="w-4 h-4 text-blue-500"/>
                  <span className="text-sm font-semibold text-gray-800">{evt.label}</span>
                  <span className="text-xs text-gray-400 ml-auto">{rules.length} rule{rules.length !== 1 ? 's' : ''}</span>
                </button>

                {/* Rules list */}
                {isExpanded && (
                  <div className="border-t border-gray-100 divide-y divide-gray-50">
                    {rules.map((rule: any) => (
                      <div key={rule.id} className={`px-4 py-3 flex items-center gap-3 group ${!rule.isActive ? 'opacity-50' : ''}`}>
                        {/* Default/Override indicator */}
                        <div className={`flex-shrink-0 w-2 h-2 rounded-full ${rule.isDefault ? 'bg-blue-400' : 'bg-amber-400'}`}
                          title={rule.isDefault ? 'Default rule' : 'Customer override'}/>

                        {/* Conditions */}
                        <div className="flex items-center gap-2 min-w-[180px]">
                          {rule.priority ? (
                            <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${PRIORITY_COLORS[rule.priority] || 'bg-gray-100'}`}>
                              {rule.priority}
                            </span>
                          ) : (
                            <span className="text-xs text-gray-400">Any priority</span>
                          )}
                          {rule.statusFilter && (
                            <span className="text-xs bg-gray-100 text-gray-600 px-2 py-0.5 rounded">
                              → {rule.statusFilter}
                            </span>
                          )}
                        </div>

                        {/* Customer badge */}
                        {rule.customer && (
                          <span className="flex items-center gap-1 text-xs bg-amber-50 text-amber-700 px-2 py-0.5 rounded-full">
                            <Building2 className="w-3 h-3"/> {rule.customer.companyName}
                          </span>
                        )}

                        {/* Recipients */}
                        <div className="flex-1 flex flex-wrap gap-1">
                          {rule.recipients.map((role: string) => (
                            <span key={role} className={`text-xs font-medium px-2 py-0.5 rounded-full ${RECIPIENT_COLORS[role] || 'bg-gray-100'}`}>
                              {recipientLabel(role)}
                            </span>
                          ))}
                        </div>

                        {/* Channels */}
                        <div className="flex items-center gap-1.5 flex-shrink-0">
                          {rule.emailEnabled
                            ? <Mail className="w-3.5 h-3.5 text-green-500" title="Email enabled"/>
                            : <MailX className="w-3.5 h-3.5 text-gray-300" title="Email disabled"/>}
                          {rule.inAppEnabled
                            ? <Monitor className="w-3.5 h-3.5 text-green-500" title="In-app enabled"/>
                            : <Monitor className="w-3.5 h-3.5 text-gray-300" title="In-app disabled"/>}
                        </div>

                        {/* Actions */}
                        {isSuperAdmin && (
                          <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity flex-shrink-0">
                            <button onClick={() => handleToggleActive(rule)}
                              className={`p-1 rounded-lg ${rule.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`}
                              title={rule.isActive ? 'Disable' : 'Enable'}>
                              {rule.isActive ? <Bell className="w-4 h-4"/> : <BellOff className="w-4 h-4"/>}
                            </button>
                            <button onClick={() => handleEdit(rule)}
                              className="p-1 text-orange-400 hover:text-orange-600 hover:bg-orange-50 rounded-lg" title="Edit">
                              <Pencil className="w-4 h-4"/>
                            </button>
                            <button onClick={() => handleDelete(rule.id)}
                              className="p-1 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg" title="Delete">
                              <Trash2 className="w-4 h-4"/>
                            </button>
                          </div>
                        )}
                      </div>
                    ))}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      )}

      {/* Legend */}
      <div className="flex items-center gap-4 text-xs text-gray-400 pt-2">
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-blue-400"/> Default rule</span>
        <span className="flex items-center gap-1"><span className="w-2 h-2 rounded-full bg-amber-400"/> Customer override</span>
        <span className="flex items-center gap-1"><Mail className="w-3 h-3 text-green-500"/> Email on</span>
        <span className="flex items-center gap-1"><Monitor className="w-3 h-3 text-green-500"/> In-app on</span>
      </div>

      {/* Create/Edit Modal */}
      <Modal open={showModal} onClose={() => setModal(false)}
        title={editRule ? 'Edit Notification Rule' : 'Create Notification Rule'} size="md"
        footer={<>
          <Button variant="secondary" onClick={() => setModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>
            {editRule ? 'Save Changes' : 'Create Rule'}
          </Button>
        </>}>
        <div className="space-y-4">
          {/* Event */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Event *</label>
            <select value={form.event} onChange={e => setForm(f => ({ ...f, event: e.target.value }))}
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
              <option value="">Select event…</option>
              {metadata.events.map((e: any) => (
                <option key={e.value} value={e.value}>{e.label}</option>
              ))}
            </select>
          </div>

          {/* Priority + Status filters */}
          <div className="grid grid-cols-2 gap-3">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Priority Filter</label>
              <select value={form.priority} onChange={e => setForm(f => ({ ...f, priority: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                {metadata.priorities.map((p: any) => (
                  <option key={p.value} value={p.value}>{p.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Blank = fires for any priority</p>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Status Filter</label>
              <select value={form.statusFilter} onChange={e => setForm(f => ({ ...f, statusFilter: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white"
                disabled={form.event !== 'STATUS_CHANGED'}>
                {metadata.statusFilters.map((s: any) => (
                  <option key={s.value} value={s.value}>{s.label}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Only for STATUS_CHANGED event</p>
            </div>
          </div>

          {/* Customer override */}
          {isSuperAdmin && (
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer Override</label>
              <select value={form.customerId} onChange={e => setForm(f => ({ ...f, customerId: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white">
                <option value="">Default (all customers)</option>
                {customers.map((c: any) => (
                  <option key={c.id} value={c.id}>{c.companyName}</option>
                ))}
              </select>
              <p className="text-xs text-gray-400 mt-1">Customer-specific rules override defaults for that customer</p>
            </div>
          )}

          {/* Recipients */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Recipients *</label>
            <div className="space-y-2">
              {metadata.recipientRoles.map((r: any) => (
                <label key={r.value}
                  className={`flex items-center gap-3 p-2.5 rounded-lg border cursor-pointer transition-colors ${
                    form.recipients.includes(r.value) ? 'border-blue-300 bg-blue-50' : 'border-gray-200 hover:bg-gray-50'
                  }`}>
                  <input type="checkbox" checked={form.recipients.includes(r.value)}
                    onChange={() => handleToggleRecipient(r.value)}
                    className="rounded text-blue-600"/>
                  <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${RECIPIENT_COLORS[r.value] || 'bg-gray-100'}`}>
                    {r.label}
                  </span>
                </label>
              ))}
            </div>
          </div>

          {/* Channels */}
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Channels</label>
            <div className="flex gap-4">
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.emailEnabled}
                  onChange={e => setForm(f => ({ ...f, emailEnabled: e.target.checked }))}
                  className="rounded text-blue-600"/>
                <Mail className="w-4 h-4 text-gray-500"/>
                <span className="text-sm text-gray-700">Email</span>
              </label>
              <label className="flex items-center gap-2 cursor-pointer">
                <input type="checkbox" checked={form.inAppEnabled}
                  onChange={e => setForm(f => ({ ...f, inAppEnabled: e.target.checked }))}
                  className="rounded text-blue-600"/>
                <Monitor className="w-4 h-4 text-gray-500"/>
                <span className="text-sm text-gray-700">In-App</span>
              </label>
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
