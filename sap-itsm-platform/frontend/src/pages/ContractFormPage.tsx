import React, { useState, useEffect } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { contractsApi, shiftsApi, holidaysApi, supportTypesApi, slaPoliciesApi } from '../api/services';
import { useCustomers } from '../hooks/useApi';
import { getErrorMessage } from '../api/client';
import { ArrowLeft, FileText } from 'lucide-react';
import toast from 'react-hot-toast';

const CURRENCIES    = ['USD','EUR','GBP','INR','SGD','AED'];
const BILLING_FREQ  = ['Monthly','Quarterly','Annually','One-time'];
const PAYMENT_TERMS = ['Net 15','Net 30','Net 45','Net 60','Advance'];
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

export default function ContractFormPage() {
  const { id } = useParams<{ id?: string }>();
  const isEdit = !!id;
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [saving, setSaving] = useState(false);
  const [form, setForm] = useState<any>({
    contractNumber: '', customerId: '',
    supportTypeMasterId: '', slaPolicyMasterId: '',
    startDate: '', endDate: '',
    billingAmount: '', currency: 'USD',
    billingFrequency: 'Monthly', paymentTerms: 'Net 30',
    autoRenewal: false, renewalNoticeDays: 60,
    notes: '',
    shiftIds: [] as string[],
    holidayCalendarIds: [] as string[],
  });

  // Load existing contract for edit mode
  const { data: existingContract } = useQuery({
    queryKey: ['contract-edit', id],
    queryFn: () => contractsApi.get(id!).then(r => r.data.contract),
    enabled: isEdit,
  });

  useEffect(() => {
    if (existingContract) {
      const c = existingContract;
      setForm({
        contractNumber: c.contractNumber || '',
        customerId: c.customerId || '',
        supportTypeMasterId: c.supportTypeMasterId || '',
        slaPolicyMasterId: c.slaPolicyMasterId || '',
        startDate: c.startDate ? new Date(c.startDate).toISOString().slice(0,10) : '',
        endDate: c.endDate ? new Date(c.endDate).toISOString().slice(0,10) : '',
        billingAmount: c.billingAmount ? String(c.billingAmount) : '',
        currency: c.currency || 'USD',
        billingFrequency: c.billingFrequency || 'Monthly',
        paymentTerms: c.paymentTerms || 'Net 30',
        autoRenewal: c.autoRenewal || false,
        renewalNoticeDays: c.renewalNoticeDays || 60,
        notes: c.notes || '',
        shiftIds: c.shifts?.map((s: any) => s.shiftId || s.shift?.id) || [],
        holidayCalendarIds: c.holidayCalendars?.map((h: any) => h.calendarId || h.calendar?.id) || [],
      });
    }
  }, [existingContract]);

  const { data: customersData } = useCustomers({ limit: 100 });
  const { data: shiftsData }    = useQuery({ queryKey: ['shifts'],        queryFn: () => shiftsApi.list().then(r => r.data.shifts || []) });
  const { data: holidaysData }  = useQuery({ queryKey: ['holidays'],      queryFn: () => holidaysApi.list().then(r => r.data.calendars || []) });
  const { data: stData }        = useQuery({ queryKey: ['support-types'], queryFn: () => supportTypesApi.list().then(r => r.data.types || []) });
  const { data: slaData }       = useQuery({ queryKey: ['sla-policies'],  queryFn: () => slaPoliciesApi.list().then(r => r.data.policies || []) });

  const customers:    any[] = customersData?.data || [];
  const shifts:       any[] = shiftsData    || [];
  const holidays:     any[] = holidaysData  || [];
  const supportTypes: any[] = (stData  || []).filter((t: any) => t.isActive);
  const slaPolicies:  any[] = (slaData || []).filter((p: any) => p.isActive);

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const toggleId = (k: string, id: string) =>
    setF(k, form[k].includes(id) ? form[k].filter((x: string) => x !== id) : [...form[k], id]);

  const selectedST = supportTypes.find((t: any) => t.id === form.supportTypeMasterId);
  const selectedSLA = slaPolicies.find((p: any) => p.id === form.slaPolicyMasterId);

  const DAYS = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];

  const handleSave = async () => {
    if (!isEdit && !form.contractNumber.trim()) { toast.error('Contract number required'); return; }
    if (!isEdit && !form.customerId) { toast.error('Customer required'); return; }
    if (!form.startDate || !form.endDate) { toast.error('Start and end dates required'); return; }
    setSaving(true);
    try {
      const payload = {
        ...(!isEdit && { contractNumber: form.contractNumber, customerId: form.customerId }),
        supportTypeMasterId: form.supportTypeMasterId || undefined,
        slaPolicyMasterId:   form.slaPolicyMasterId   || undefined,
        startDate:           new Date(form.startDate).toISOString(),
        endDate:             new Date(form.endDate).toISOString(),
        billingAmount:       parseFloat(form.billingAmount) || 0,
        currency:            form.currency,
        billingFrequency:    form.billingFrequency,
        paymentTerms:        form.paymentTerms,
        autoRenewal:         form.autoRenewal,
        renewalNoticeDays:   form.renewalNoticeDays,
        notes:               form.notes || undefined,
        shiftIds:            form.shiftIds,
        holidayCalendarIds:  form.holidayCalendarIds,
      };
      if (isEdit) {
        await contractsApi.update(id!, payload);
        toast.success('Contract updated');
        qc.invalidateQueries({ queryKey: ['contract', id] });
        navigate(`/contracts/${id}`);
      } else {
        await contractsApi.create(payload);
        toast.success('Contract created');
        qc.invalidateQueries({ queryKey: ['contracts'] });
        navigate('/contracts');
      }
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-4xl mx-auto pb-28">
      <div className="flex items-center gap-4 mb-7">
        <button onClick={() => navigate('/contracts')} className="flex items-center gap-1.5 text-sm text-gray-500 hover:text-gray-800 bg-white border border-gray-200 px-3 py-2 rounded-lg">
          <ArrowLeft className="w-4 h-4" /> Back
        </button>
        <div className="flex items-center gap-3">
          <div className="w-10 h-10 rounded-xl bg-green-600 flex items-center justify-center">
            <FileText className="w-5 h-5 text-white" />
          </div>
          <div>
            <h1 className="text-xl font-bold text-gray-900">{isEdit ? 'Edit Contract' : 'New Contract'}</h1>
            <p className="text-sm text-gray-400">Assign Shift + Support Type + SLA Policy to a customer</p>
          </div>
        </div>
      </div>

      <div className="space-y-6">
        {/* Section 1 — Contract Identity */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="📋" title="Contract Details" color="text-slate-700" />
          <div className="space-y-5">
            <div className="grid grid-cols-2 gap-5">
              <F label="Contract Number" required>
                <input value={form.contractNumber} onChange={e => setF('contractNumber', e.target.value)} className={ic} placeholder="CNT-2026-001" />
              </F>
              <F label="Customer" required>
                <select value={form.customerId} onChange={e => setF('customerId', e.target.value)} className={ic}>
                  <option value="">— Select Customer —</option>
                  {customers.map(c => <option key={c.id} value={c.id}>{c.companyName}</option>)}
                </select>
              </F>
            </div>
            <div className="grid grid-cols-2 gap-5">
              <F label="Start Date" required>
                <input type="date" value={form.startDate} onChange={e => setF('startDate', e.target.value)} className={ic} />
              </F>
              <F label="End Date" required>
                <input type="date" value={form.endDate} onChange={e => setF('endDate', e.target.value)} className={ic} />
              </F>
            </div>
          </div>
        </div>

        {/* Section 2 — Coverage (Shift + Support Type) */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="🕐" title="Coverage Configuration" color="text-blue-700" />
          <div className="space-y-5">

            {/* Shifts */}
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-2">
                Support Shifts <span className="text-xs text-gray-400 ml-1">(select one or more)</span>
              </label>
              {shifts.length === 0
                ? <p className="text-xs text-amber-600">💡 No shifts defined — <a href="/shifts" className="underline">create shifts</a> first.</p>
                : <div className="grid grid-cols-3 gap-3">
                    {shifts.filter((s: any) => s.status === 'active').map((s: any) => (
                      <label key={s.id} className={`flex items-start gap-2 border-2 rounded-xl px-3 py-2.5 cursor-pointer transition-all text-sm ${form.shiftIds.includes(s.id) ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                        <input type="checkbox" checked={form.shiftIds.includes(s.id)} onChange={() => toggleId('shiftIds', s.id)} className="accent-blue-600 mt-0.5" />
                        <div>
                          <p className="font-medium">{s.name}</p>
                          <p className="text-xs opacity-70">{s.startTime}–{s.endTime} {s.timezone}</p>
                        </div>
                      </label>
                    ))}
                  </div>
              }
            </div>

            {/* Support Type */}
            <F label="Support Type" hint="Defines work week, weekend/holiday coverage, and SLA pause conditions">
              <select value={form.supportTypeMasterId} onChange={e => setF('supportTypeMasterId', e.target.value)} className={ic}>
                <option value="">— No Support Type —</option>
                {supportTypes.map((t: any) => (
                  <option key={t.id} value={t.id}>{t.name} ({t.code})</option>
                ))}
              </select>
              {supportTypes.length === 0 && (
                <p className="text-xs text-amber-600 mt-1">💡 No support types — <a href="/support-types" className="underline">create one</a> first.</p>
              )}
              {selectedST && (
                <div className="mt-2 bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm">
                  <div className="flex flex-wrap gap-2 text-xs">
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium">
                      Work days: {(selectedST.workDays || []).map((d: number) => DAYS[d]).join(', ')}
                    </span>
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium">
                      Weekend: {selectedST.weekendCoverage}
                    </span>
                    <span className="bg-indigo-100 text-indigo-700 px-2 py-1 rounded font-medium">
                      Holiday: {selectedST.holidayCoverage}
                    </span>
                    {selectedST.slaPauseConditions?.length > 0 && (
                      <span className="bg-purple-100 text-purple-700 px-2 py-1 rounded font-medium">
                        Pause: {selectedST.slaPauseConditions.join(', ')}
                      </span>
                    )}
                  </div>
                </div>
              )}
            </F>

            {/* Holiday Calendar */}
            <F label="Holiday Calendars" hint="Holidays excluded from SLA working-hours calculation">
              {holidays.length === 0
                ? <p className="text-xs text-gray-400 italic">No holiday calendars configured.</p>
                : <div className="grid grid-cols-3 gap-3">
                    {holidays.map((h: any) => (
                      <label key={h.id} className={`flex items-start gap-2 border-2 rounded-xl px-3 py-2.5 cursor-pointer transition-all text-sm ${form.holidayCalendarIds.includes(h.id) ? 'border-green-500 bg-green-50 text-green-700' : 'border-gray-200 hover:border-gray-300 text-gray-600'}`}>
                        <input type="checkbox" checked={form.holidayCalendarIds.includes(h.id)} onChange={() => toggleId('holidayCalendarIds', h.id)} className="accent-green-600 mt-0.5" />
                        <div>
                          <p className="font-medium">{h.name}</p>
                          <p className="text-xs opacity-70">{h.country} · {h.year}</p>
                        </div>
                      </label>
                    ))}
                  </div>
              }
            </F>
          </div>
        </div>

        {/* Section 3 — SLA Policy */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="📊" title="SLA Policy" color="text-indigo-700" />
          <F label="SLA Policy" hint="Defines response/resolution targets and warning threshold per priority">
            <select value={form.slaPolicyMasterId} onChange={e => setF('slaPolicyMasterId', e.target.value)} className={ic}>
              <option value="">— No SLA Policy (SLA not tracked) —</option>
              {slaPolicies.map((p: any) => (
                <option key={p.id} value={p.id}>{p.name} ({p.code})</option>
              ))}
            </select>
            {slaPolicies.length === 0 && (
              <p className="text-xs text-amber-600 mt-1">💡 No SLA policies — <a href="/sla-policies" className="underline">create one</a> in Admin.</p>
            )}
            {selectedSLA && (
              <div className="mt-3 border border-gray-200 rounded-xl overflow-hidden">
                <table className="w-full text-xs">
                  <thead>
                    <tr className="bg-gray-50 border-b border-gray-200">
                      <th className="text-left px-4 py-2 font-semibold text-gray-600">Priority</th>
                      <th className="text-center px-4 py-2 font-semibold text-gray-600">Response</th>
                      <th className="text-center px-4 py-2 font-semibold text-gray-600">Resolution</th>
                      <th className="text-center px-4 py-2 font-semibold text-gray-600">Tracked</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {['P1','P2','P3','P4'].map(pr => {
                      const t = (selectedSLA.priorities || {})[pr];
                      const enabled = t?.enabled !== false;
                      function minToHr(min: number) {
                        if (!min) return '—';
                        const h = Math.floor(min/60), m = min%60;
                        return m ? `${h}h ${m}m` : (h ? `${h}h` : `${min}m`);
                      }
                      return (
                        <tr key={pr} className={!enabled ? 'opacity-40 bg-gray-50' : ''}>
                          <td className="px-4 py-2 font-semibold text-gray-700">{pr}</td>
                          <td className="px-4 py-2 text-center">{enabled && t ? minToHr(t.response) : '—'}</td>
                          <td className="px-4 py-2 text-center">{enabled && t ? minToHr(t.resolution) : '—'}</td>
                          <td className="px-4 py-2 text-center">{enabled ? '✅' : '❌'}</td>
                        </tr>
                      );
                    })}
                  </tbody>
                </table>
                <div className="px-4 py-2 bg-gray-50 border-t border-gray-200 text-xs text-gray-500">
                  Warning sent at {Math.round((selectedSLA.warningThreshold||0.80)*100)}% elapsed
                </div>
              </div>
            )}
          </F>
        </div>

        {/* Section 4 — Billing */}
        <div className="bg-white rounded-2xl border border-gray-100 shadow-sm p-7">
          <Sec icon="💰" title="Billing & Renewal" color="text-green-700" />
          <div className="grid grid-cols-2 gap-5">
            <F label="Billing Amount">
              <input type="number" min="0" value={form.billingAmount} onChange={e => setF('billingAmount', e.target.value)} className={ic} placeholder="0" />
            </F>
            <F label="Currency">
              <select value={form.currency} onChange={e => setF('currency', e.target.value)} className={ic}>
                {CURRENCIES.map(c => <option key={c}>{c}</option>)}
              </select>
            </F>
            <F label="Billing Frequency">
              <select value={form.billingFrequency} onChange={e => setF('billingFrequency', e.target.value)} className={ic}>
                {BILLING_FREQ.map(f => <option key={f}>{f}</option>)}
              </select>
            </F>
            <F label="Payment Terms">
              <select value={form.paymentTerms} onChange={e => setF('paymentTerms', e.target.value)} className={ic}>
                {PAYMENT_TERMS.map(p => <option key={p}>{p}</option>)}
              </select>
            </F>
            <div className="flex items-center gap-3 col-span-2">
              <input type="checkbox" id="autoRenewal" checked={form.autoRenewal} onChange={e => setF('autoRenewal', e.target.checked)} className="accent-green-600 w-4 h-4" />
              <label htmlFor="autoRenewal" className="text-sm font-medium text-gray-700">Auto renewal</label>
              {form.autoRenewal && (
                <div className="flex items-center gap-2 ml-4">
                  <span className="text-sm text-gray-600">Notice period:</span>
                  <input type="number" min="0" value={form.renewalNoticeDays} onChange={e => setF('renewalNoticeDays', parseInt(e.target.value))}
                    className="w-20 border border-gray-300 rounded-lg px-3 py-1.5 text-sm text-center focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  <span className="text-sm text-gray-600">days</span>
                </div>
              )}
            </div>
          </div>
          <div className="mt-5">
            <F label="Notes">
              <textarea value={form.notes} onChange={e => setF('notes', e.target.value)} rows={3} className={`${ic} resize-none`} placeholder="Additional contract notes..." />
            </F>
          </div>
        </div>
      </div>

      <div className="fixed bottom-0 left-0 right-0 bg-white border-t border-gray-200 px-8 py-4 flex justify-between items-center z-30">
        <button onClick={() => navigate('/contracts')} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-50 font-medium">Cancel</button>
        <button onClick={handleSave} disabled={saving} className="flex items-center gap-2 px-7 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-semibold disabled:opacity-60 transition-colors shadow-sm">
          💾 {saving ? 'Saving...' : 'Save Contract'}
        </button>
      </div>
    </div>
  );
}
