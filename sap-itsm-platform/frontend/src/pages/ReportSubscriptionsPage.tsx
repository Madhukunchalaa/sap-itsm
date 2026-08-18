import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { reportSubscriptionsApi, plantsApi, customersApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button } from '../components/ui/Forms';
import { Modal } from '../components/ui/Modal';
import { Plus, Pencil, Trash2, ToggleLeft, ToggleRight, Mail, Factory, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';

const CADENCE_BADGES: { key: 'dailyEnabled' | 'weeklyEnabled' | 'monthlyEnabled'; label: string; classes: string }[] = [
  { key: 'dailyEnabled', label: 'Daily', classes: 'bg-cyan-100 text-cyan-800' },
  { key: 'weeklyEnabled', label: 'Weekly', classes: 'bg-indigo-100 text-indigo-800' },
  { key: 'monthlyEnabled', label: 'Monthly', classes: 'bg-violet-100 text-violet-800' },
];

const EMPTY_FORM = { email: '', name: '', customerId: '', plant: '', dailyEnabled: false, weeklyEnabled: false, monthlyEnabled: true };

function scopeLabel(row: any): string {
  if (!row.customerId) return 'Tenant Overall';
  if (!row.plant) return `${row.customer?.companyName || 'Customer'} Overall`;
  return `${row.customer?.companyName || 'Customer'} / ${row.plant}`;
}

export default function ReportSubscriptionsPage() {
  const queryClient = useQueryClient();
  const [showModal, setShowModal] = useState(false);
  const [editRow, setEditRow] = useState<any>(null);
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);

  const { data: rows, isLoading } = useQuery({
    queryKey: ['report-subscriptions'],
    queryFn: () => reportSubscriptionsApi.list().then(r => r.data.data),
  });
  const { data: customersRaw = [] } = useQuery({
    queryKey: ['customers-for-subscriptions'],
    queryFn: () => customersApi.list({ limit: 500 }).then(r => r.data.data || []),
  });
  const { data: plantsForCustomer = [] } = useQuery({
    queryKey: ['plants-by-customer', form.customerId],
    queryFn: () => plantsApi.byCustomer(form.customerId).then(r => r.data.data || []),
    enabled: !!form.customerId,
  });

  const allRows: any[] = rows || [];
  const customers: any[] = customersRaw || [];

  const openCreate = () => {
    setForm(EMPTY_FORM);
    setEditRow(null);
    setShowModal(true);
  };

  const openEdit = (row: any) => {
    setForm({
      email: row.email, name: row.name || '', customerId: row.customerId || '', plant: row.plant || '',
      dailyEnabled: row.dailyEnabled, weeklyEnabled: row.weeklyEnabled, monthlyEnabled: row.monthlyEnabled,
    });
    setEditRow(row);
    setShowModal(true);
  };

  const handleSave = async () => {
    if (!form.email.trim()) { toast.error('Email is required'); return; }
    if (!form.dailyEnabled && !form.weeklyEnabled && !form.monthlyEnabled) {
      toast.error('Select at least one cadence (Daily/Weekly/Monthly)'); return;
    }
    if (form.plant && !form.customerId) { toast.error('A Plant scope requires a Customer'); return; }
    setSaving(true);
    try {
      const payload = { ...form, customerId: form.customerId || undefined, name: form.name || undefined };
      if (editRow) {
        await reportSubscriptionsApi.update(editRow.id, { ...form, customerId: form.customerId || null });
        toast.success('Subscription updated');
      } else {
        await reportSubscriptionsApi.create(payload);
        toast.success('Subscription added');
      }
      queryClient.invalidateQueries({ queryKey: ['report-subscriptions'] });
      setShowModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  const handleDelete = async (row: any) => {
    if (!confirm(`Remove ${row.email} from all report subscriptions?`)) return;
    try {
      await reportSubscriptionsApi.delete(row.id);
      toast.success('Subscription removed');
      queryClient.invalidateQueries({ queryKey: ['report-subscriptions'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const handleToggleActive = async (row: any) => {
    try {
      await reportSubscriptionsApi.update(row.id, { isActive: !row.isActive });
      queryClient.invalidateQueries({ queryKey: ['report-subscriptions'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const toggleCadence = (key: 'dailyEnabled' | 'weeklyEnabled' | 'monthlyEnabled') => {
    setForm(f => ({ ...f, [key]: !f[key] }));
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <PageHeader
        title="Report Subscriptions"
        subtitle="Who receives Daily/Weekly/Monthly status emails, at three scopes: Tenant Overall, Customer Overall, or a single Plant"
      />

      <div className="flex justify-end">
        <Button onClick={openCreate}><Plus className="w-4 h-4"/> Add Recipient</Button>
      </div>

      {isLoading ? (
        <div className="text-center py-12 text-gray-400">Loading…</div>
      ) : allRows.length === 0 ? (
        <div className="text-center py-16">
          <Mail className="w-12 h-12 mx-auto text-gray-300 mb-3"/>
          <p className="text-gray-500 font-medium">No report subscriptions configured yet</p>
          <p className="text-sm text-gray-400 mt-1">Add a recipient and choose which status emails they should receive</p>
        </div>
      ) : (
        <div className="bg-white rounded-xl border border-gray-200 overflow-hidden">
          {allRows.map((row: any) => (
            <div key={row.id} className={`flex items-center gap-3 px-5 py-3 border-b border-gray-100 last:border-0 group ${!row.isActive ? 'opacity-50' : ''}`}>
              <Mail className="w-4 h-4 text-gray-400 flex-shrink-0"/>
              <div className="flex-1 min-w-0">
                <p className="text-sm text-gray-800">{row.email}</p>
                {row.name && <p className="text-xs text-gray-400">{row.name}</p>}
              </div>
              <span className="flex items-center gap-1 text-xs font-semibold text-gray-700 bg-gray-50 border border-gray-200 rounded px-1.5 py-0.5">
                {row.plant ? <Factory className="w-3 h-3"/> : <Building2 className="w-3 h-3"/>} {scopeLabel(row)}
              </span>
              <div className="flex gap-1.5">
                {CADENCE_BADGES.filter(c => row[c.key]).map(c => (
                  <span key={c.key} className={`text-xs font-medium px-2 py-0.5 rounded-full ${c.classes}`}>{c.label}</span>
                ))}
              </div>
              <div className="flex items-center gap-1 opacity-0 group-hover:opacity-100 transition-opacity">
                <button onClick={() => handleToggleActive(row)} className={`p-1.5 rounded-lg ${row.isActive ? 'text-green-500 hover:bg-green-50' : 'text-gray-400 hover:bg-gray-100'}`} title={row.isActive ? 'Active — click to disable' : 'Disabled — click to enable'}>
                  {row.isActive ? <ToggleRight className="w-4 h-4"/> : <ToggleLeft className="w-4 h-4"/>}
                </button>
                <button onClick={() => openEdit(row)} className="p-1.5 text-orange-400 hover:bg-orange-50 rounded-lg">
                  <Pencil className="w-4 h-4"/>
                </button>
                <button onClick={() => handleDelete(row)} className="p-1.5 text-gray-300 hover:text-red-500 hover:bg-red-50 rounded-lg">
                  <Trash2 className="w-4 h-4"/>
                </button>
              </div>
            </div>
          ))}
        </div>
      )}

      <Modal open={showModal} onClose={() => setShowModal(false)}
        title={editRow ? 'Edit Recipient' : 'Add Recipient'}
        footer={<>
          <Button variant="secondary" onClick={() => setShowModal(false)}>Cancel</Button>
          <Button loading={saving} onClick={handleSave}>{editRow ? 'Save' : 'Add'}</Button>
        </>}>
        <div className="space-y-4">
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Email *</label>
            <input type="email" value={form.email} onChange={e => setForm(f => ({ ...f, email: e.target.value }))}
              placeholder="head@example.com"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>
          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Name</label>
            <input value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))}
              placeholder="Optional display name"
              className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"/>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Scope</label>
            <div className="grid grid-cols-2 gap-2">
              <select value={form.customerId}
                onChange={e => setForm(f => ({ ...f, customerId: e.target.value, plant: '' }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                <option value="">— Tenant Overall (all customers) —</option>
                {customers.map((c: any) => <option key={c.id} value={c.id}>{c.companyName}</option>)}
              </select>
              <select value={form.plant} disabled={!form.customerId}
                onChange={e => setForm(f => ({ ...f, plant: e.target.value }))}
                className="w-full border border-gray-300 rounded-xl px-3 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none disabled:bg-gray-100 disabled:text-gray-400">
                <option value="">{form.customerId ? '— Customer Overall (all plants) —' : '— Pick a customer first —'}</option>
                {plantsForCustomer.map((p: any) => <option key={p.id} value={p.name}>{p.name}</option>)}
              </select>
            </div>
            <p className="text-xs text-gray-400 mt-1">
              {!form.customerId
                ? 'Tenant Overall: everything across all customers — for top management.'
                : !form.plant
                  ? `Customer Overall: all plants under this customer combined.`
                  : `Plant Status: just this one plant.`}
            </p>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-2">Send this recipient *</label>
            <div className="space-y-2">
              {[
                { key: 'dailyEnabled' as const, label: 'Daily Status', desc: 'Every day, 08:00 IST — status counts; Excel attached when scoped to a Customer or Plant' },
                { key: 'weeklyEnabled' as const, label: 'Weekly Status', desc: 'Mondays, 08:00 IST — volumes, SLA compliance, agent performance, hotspots' },
                { key: 'monthlyEnabled' as const, label: 'Monthly Status', desc: '1st of month, 08:00 IST — same as weekly, month-over-month' },
              ].map(c => (
                <label key={c.key} className="flex items-start gap-2.5 p-2.5 rounded-lg border border-gray-200 hover:bg-gray-50 cursor-pointer">
                  <input type="checkbox" checked={form[c.key]} onChange={() => toggleCadence(c.key)}
                    className="mt-0.5 rounded border-gray-300 text-blue-600 focus:ring-blue-500"/>
                  <div>
                    <p className="text-sm font-medium text-gray-800">{c.label}</p>
                    <p className="text-xs text-gray-400">{c.desc}</p>
                  </div>
                </label>
              ))}
            </div>
          </div>
        </div>
      </Modal>
    </div>
  );
}
