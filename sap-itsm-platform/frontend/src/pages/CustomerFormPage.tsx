import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { customersApi, usersApi, agentsApi, holidaysApi } from '../api/services';
import { getErrorMessage } from '../api/client';
import { ArrowLeft, Building2 } from 'lucide-react';
import toast from 'react-hot-toast';

const INDUSTRIES = ['Technology','Manufacturing','Finance','Healthcare','Retail','Energy','Telecom','Logistics','Education','Government','Other'];
const COUNTRIES  = ['India','USA','UK','Germany','Australia','Singapore','UAE','Canada','Japan','France','Other'];
const TIMEZONES  = ['IST','UTC','EST','CST','PST','CET','JST','AEST','GST'];
const ic = 'w-full border border-gray-200 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none bg-white';

function Sec({ icon, title, color }: { icon: string; title: string; color: string }) {
  return (
    <div className="flex items-center gap-2 pb-3 border-b border-gray-100 mb-5">
      <span className="text-xl">{icon}</span>
      <h3 className={`font-semibold text-base ${color}`}>{title}</h3>
    </div>
  );
}
function F({ label, required, hint, children }: { label: string; required?: boolean; hint?: string; children: React.ReactNode }) {
  return (
    <div>
      <label className="block text-sm font-medium text-gray-700 mb-1.5">
        {label}{required && <span className="text-red-500 ml-1">*</span>}
      </label>
      {children}
      {hint && <p className="text-xs text-gray-400 mt-1">{hint}</p>}
    </div>
  );
}

const blank = {
  companyName: '', industry: '', country: 'India', timezone: 'IST', status: 'ACTIVE', website: '',
  contactName: '', contactEmail: '', contactPhone: '', billingEmail: '', billingAddress: '',
  adminUserId: '', projectManagerAgentId: '', holidayCalendarId: '',
  agentIds: [] as string[], notes: '', allowedDomains: '',
};

export default function CustomerFormPage() {
  const { id } = useParams<{ id?: string }>();
  const navigate = useNavigate();
  const qc = useQueryClient();
  const isEdit = !!id;
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState({ ...blank });

  const { data: existing, isLoading: loadingExisting } = useQuery({
    queryKey: ['customer', id],
    queryFn: () => customersApi.get(id!).then(r => r.data.customer),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existing) {
      setForm({
        companyName: existing.companyName || '',
        industry: existing.industry || '',
        country: existing.country || 'India',
        timezone: existing.timezone || 'IST',
        status: existing.status || 'ACTIVE',
        website: existing.website || '',
        contactName: existing.contactName || '',
        contactEmail: existing.contactEmail || '',
        contactPhone: existing.contactPhone || '',
        billingEmail: existing.billingEmail || '',
        billingAddress: existing.billingAddress || '',
        adminUserId: existing.adminUserId || '',
        projectManagerAgentId: existing.projectManagerAgentId || '',
        holidayCalendarId: existing.holidayCalendarId || '',
        agentIds: [],
        notes: existing.notes || '',
        allowedDomains: (existing.allowedDomains || []).join(', '),
      });
    }
  }, [existing]);

  const { data: caUsers }  = useQuery({ queryKey: ['users-ca'],    queryFn: () => usersApi.list({ role: 'COMPANY_ADMIN', limit: 100 }).then(r => r.data.data || []) });
  const { data: pmAgents } = useQuery({ queryKey: ['agents-pm'],   queryFn: () => agentsApi.list({ agentType: 'PROJECT_MANAGER', limit: 100 }).then(r => r.data.data || r.data.agents || []) });
  const { data: agentList }= useQuery({ queryKey: ['agents-only'], queryFn: () => agentsApi.list({ agentType: 'AGENT', limit: 100 }).then(r => r.data.data || r.data.agents || []) });
  const { data: holList }  = useQuery({ queryKey: ['holidays'],    queryFn: () => holidaysApi.list().then(r => r.data.calendars || []) });

  const cas: any[]  = caUsers  || [];
  const pms: any[]  = pmAgents || [];
  const ags: any[]  = agentList|| [];
  const hols: any[] = holList  || [];

  const setF = (k: keyof typeof blank, v: any) => setForm(f => ({ ...f, [k]: v }));
  const toggle = (k: 'agentIds', id: string) =>
    setF(k, form[k].includes(id) ? form[k].filter((x: string) => x !== id) : [...form[k], id]);

  const handleSave = async () => {
    if (!form.companyName.trim()) { toast.error('Company name is required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...form,
        allowedDomains: form.allowedDomains
          ? form.allowedDomains.split(',').map((d: string) => d.trim().toLowerCase()).filter(Boolean)
          : [],
        adminUserId:           form.adminUserId           || undefined,
        projectManagerAgentId: form.projectManagerAgentId || undefined,
        holidayCalendarId:     form.holidayCalendarId     || undefined,
      };
      if (isEdit) {
        await customersApi.update(id!, payload);
        toast.success('Customer updated');
      } else {
        await customersApi.create(payload);
        toast.success('Customer created');
      }
      qc.invalidateQueries({ queryKey: ['customers'] });
      navigate('/customers');
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  if (isEdit && loadingExisting) {
    return <div className="p-10 text-center text-gray-400">Loading customer...</div>;
  }

  return (
    <div className="p-6 max-w-4xl mx-auto pb-28">
      {/* Page Header */}
      <div className="flex items-center gap-4 mb-7">
        <button
          onClick={() => navigate('/customers')}
          className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-2 rounded-lg transition-colors"
        >
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-blue-600 flex items-center justify-center">
            <Building2 className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Customer' : 'New Customer'}</h1>
            <p className="text-sm text-gray-400">{isEdit ? 'Update customer details' : 'Fill in the details to create a new customer'}</p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Section 1 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="🏢" title="Company Details" color="text-blue-700" />
          <div className="space-y-4">
            <F label="Company Name" required>
              <input value={form.companyName} onChange={e => setF('companyName', e.target.value)} className={ic} placeholder="Acme Corporation" />
            </F>
            <div className="grid grid-cols-2 gap-4">
              <F label="Industry">
                <select value={form.industry} onChange={e => setF('industry', e.target.value)} className={ic}>
                  <option value="">— Select Industry —</option>
                  {INDUSTRIES.map(i => <option key={i}>{i}</option>)}
                </select>
              </F>
              <F label="Website">
                <input value={form.website} onChange={e => setF('website', e.target.value)} className={ic} placeholder="https://company.com" />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Country">
                <select value={form.country} onChange={e => setF('country', e.target.value)} className={ic}>
                  {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                </select>
              </F>
              <F label="Timezone">
                <select value={form.timezone} onChange={e => setF('timezone', e.target.value)} className={ic}>
                  {TIMEZONES.map(t => <option key={t}>{t}</option>)}
                </select>
              </F>
            </div>
            <div className="w-1/2">
              <F label="Status">
                <select value={form.status} onChange={e => setF('status', e.target.value)} className={ic}>
                  {['ACTIVE','INACTIVE','SUSPENDED'].map(s => <option key={s} value={s}>{s[0] + s.slice(1).toLowerCase()}</option>)}
                </select>
              </F>
            </div>
          </div>
          <F label="Allowed Email Domains">
            <input value={form.allowedDomains} onChange={e => setF('allowedDomains', e.target.value)} className={ic} placeholder="acme.com, acme.in (comma-separated, leave blank for no restriction)" />
            <p className="text-xs text-gray-400 mt-1">Only users with these email domains can be created under this customer. Leave blank for no restriction.</p>
          </F>
        </div>

        {/* Section 2 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="👤" title="Primary Contact & Billing" color="text-purple-700" />
          <div className="space-y-4">
            <div className="grid grid-cols-2 gap-4">
              <F label="Contact Name" required>
                <input value={form.contactName} onChange={e => setF('contactName', e.target.value)} className={ic} placeholder="John Smith" />
              </F>
              <F label="Contact Email" required>
                <input type="email" value={form.contactEmail} onChange={e => setF('contactEmail', e.target.value)} className={ic} placeholder="john@company.com" />
              </F>
            </div>
            <div className="grid grid-cols-2 gap-4">
              <F label="Contact Phone">
                <input value={form.contactPhone} onChange={e => setF('contactPhone', e.target.value)} className={ic} placeholder="+91 98765 43210" />
              </F>
              <F label="Billing Email">
                <input type="email" value={form.billingEmail} onChange={e => setF('billingEmail', e.target.value)} className={ic} placeholder="billing@company.com" />
              </F>
            </div>
            <F label="Billing Address">
              <input value={form.billingAddress} onChange={e => setF('billingAddress', e.target.value)} className={ic} placeholder="123 Business Park, City, Country" />
            </F>
          </div>
        </div>

        {/* Section 3 */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="⚙️" title="Service Configuration" color="text-orange-700" />
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-4">
              <F label="Company Administrator" hint="Only Company Admin role users are listed">
                <select value={form.adminUserId} onChange={e => setF('adminUserId', e.target.value)} className={ic}>
                  <option value="">— None —</option>
                  {cas.map(u => <option key={u.id} value={u.id}>{u.firstName} {u.lastName}</option>)}
                </select>
              </F>
              <F label="Project Manager" hint="Only Project Manager agents are listed">
                <select value={form.projectManagerAgentId} onChange={e => setF('projectManagerAgentId', e.target.value)} className={ic}>
                  <option value="">— None —</option>
                  {pms.map(a => <option key={a.id} value={a.id}>{a.user?.firstName} {a.user?.lastName}</option>)}
                </select>
              </F>
            </div>
            <F label="Holiday Calendar">
              <select value={form.holidayCalendarId} onChange={e => setF('holidayCalendarId', e.target.value)} className={ic}>
                <option value="">— None —</option>
                {hols.map((h: any) => <option key={h.id} value={h.id}>{h.name} ({h.country} {h.year})</option>)}
              </select>
            </F>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">Assign Agents</label>
              {ags.length === 0
                ? <p className="text-xs text-gray-400 italic">No agents available yet</p>
                : <div className="grid grid-cols-3 gap-2">
                    {ags.map((a: any) => (
                      <label key={a.id} className={`flex items-start gap-2 border-2 rounded-xl px-3 py-2.5 cursor-pointer transition-colors ${form.agentIds.includes(a.id) ? 'border-blue-400 bg-blue-50' : 'border-gray-200 hover:border-gray-300'}`}>
                        <input type="checkbox" checked={form.agentIds.includes(a.id)} onChange={() => toggle('agentIds', a.id)} className="accent-blue-600 mt-0.5" />
                        <div>
                          <p className="text-sm font-medium text-gray-900 leading-tight">{a.user?.firstName} {a.user?.lastName}</p>
                          <p className="text-xs text-gray-400">({a.specialization})</p>
                        </div>
                      </label>
                    ))}
                  </div>
              }
            </div>
            
            <F label="Notes">
              <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={3} className={`${ic} resize-none`} placeholder="Any additional notes about this customer..." />
            </F>
          </div>
        </div>
      </div>

      {/* Sticky footer bar */}
      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-4 flex justify-between items-center z-30">
        <button onClick={() => navigate('/customers')} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 font-medium">
          Cancel
        </button>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-7 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors shadow-sm">
          💾 {saving ? 'Saving...' : isEdit ? 'Update Customer' : 'Save Customer'}
        </button>
      </div>
    </div>
  );
}
