import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { shiftsApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { Plus, Pencil, Clock, Trash2 } from 'lucide-react';
import toast from 'react-hot-toast';

const TIMEZONES = [
  'Asia/Kolkata','UTC','America/New_York','America/Chicago','America/Los_Angeles',
  'Europe/London','Europe/Berlin','Asia/Tokyo','Australia/Sydney','Asia/Dubai',
  'America/Toronto','Asia/Singapore','Asia/Shanghai',
];

const defaultForm = {
  name: '', startTime: '09:00', endTime: '18:00',
  timezone: 'Asia/Kolkata', breakMinutes: 45,
  status: 'active',
  channels: { phone: true, email: true, chat: false },
};

function crossesMidnight(start: string, end: string) {
  if (!start || !end) return false;
  return end <= start;
}

function calcBillable(start: string, end: string, breakMin: number) {
  if (!start || !end) return '—';
  const [sh, sm] = start.split(':').map(Number);
  const [eh, em] = end.split(':').map(Number);
  let totalMin = (eh * 60 + em) - (sh * 60 + sm);
  if (totalMin <= 0) totalMin += 24 * 60;
  const billable = (totalMin - breakMin) / 60;
  return billable > 0 ? billable.toFixed(1) + 'h' : '—';
}

export default function ShiftsPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';
  const [showModal, setModal] = useState(false);
  const [editId, setEditId] = useState<string | null>(null);
  const [form, setForm] = useState<any>({ ...defaultForm });
  const [saving, setSaving] = useState(false);

  const { data, isLoading } = useQuery({
    queryKey: ['shifts'],
    queryFn: () => shiftsApi.list().then(r => r.data.shifts || []),
  });
  const shifts = data || [];

  const setF = (k: string, v: any) => setForm((f: any) => ({ ...f, [k]: v }));
  const toggleChannel = (ch: string) =>
    setF('channels', { ...form.channels, [ch]: !form.channels[ch] });

  const handleOpen = (s?: any) => {
    if (s) {
      setForm({
        name: s.name, startTime: s.startTime, endTime: s.endTime,
        timezone: s.timezone || 'Asia/Kolkata',
        breakMinutes: s.breakMinutes ?? 45,
        status: s.status || 'active',
        channels: s.metadata?.channels || { phone: true, email: true, chat: false },
      });
      setEditId(s.id);
    } else {
      setForm({ ...defaultForm });
      setEditId(null);
    }
    setModal(true);
  };

  const handleSave = async () => {
    if (!form.name.trim()) { toast.error('Shift name required'); return; }
    if (!form.startTime || !form.endTime) { toast.error('Start and end time required'); return; }
    setSaving(true);
    try {
      const payload = {
        name: form.name, startTime: form.startTime, endTime: form.endTime,
        timezone: form.timezone, breakMinutes: Number(form.breakMinutes),
        status: form.status,
        metadata: { channels: form.channels },
      };
      if (editId) {
        await shiftsApi.update(editId, payload);
        toast.success('Shift updated');
      } else {
        await shiftsApi.create(payload);
        toast.success('Shift created');
      }
      qc.invalidateQueries({ queryKey: ['shifts'] });
      setModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSaving(false); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Shift Master</h1>
          <p className="text-sm text-gray-500">Define daily support time windows (start time, end time, timezone). Work days are configured in Support Types.</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => handleOpen()}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium">
            <Plus className="w-4 h-4" /> Add Shift
          </button>
        )}
      </div>

      <div className="bg-indigo-50 border-l-4 border-indigo-500 rounded-lg px-4 py-3 text-sm text-indigo-800">
        <strong>Design note:</strong> A shift defines <em>when</em> support happens each day (e.g. 09:00–18:00 IST). 
        Which <em>days</em> of the week support runs is defined by the Support Type. Multiple shifts can be assigned to a contract for global coverage.
      </div>

      <div className="bg-white rounded-xl shadow-sm border border-gray-100 overflow-hidden">
        <table className="w-full text-sm">
          <thead>
            <tr className="bg-indigo-900 text-white">
              {['Shift Name','Start','End','Crosses Midnight','Billable Hrs','Break','Timezone','Channels','Status',''].map(h => (
                <th key={h} className="text-left px-4 py-3 font-medium text-xs">{h}</th>
              ))}
            </tr>
          </thead>
          <tbody className="divide-y divide-gray-100">
            {isLoading ? (
              <tr><td colSpan={10} className="text-center py-10 text-gray-400">Loading...</td></tr>
            ) : shifts.length === 0 ? (
              <tr><td colSpan={10} className="text-center py-12 text-gray-400">
                <Clock className="w-10 h-10 mx-auto mb-2 opacity-20" />
                No shifts defined yet.
              </td></tr>
            ) : shifts.map((s: any) => {
              const midnight = crossesMidnight(s.startTime, s.endTime);
              const billable = calcBillable(s.startTime, s.endTime, s.breakMinutes ?? 45);
              const ch = s.metadata?.channels || {};
              return (
                <tr key={s.id} className="hover:bg-gray-50">
                  <td className="px-4 py-3 font-semibold text-gray-900">{s.name}</td>
                  <td className="px-4 py-3 font-mono text-green-700 font-semibold">{s.startTime}</td>
                  <td className="px-4 py-3 font-mono text-green-700 font-semibold">{s.endTime}</td>
                  <td className="px-4 py-3">
                    {midnight
                      ? <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-orange-100 text-orange-700">Yes</span>
                      : <span className="text-xs font-bold px-2 py-0.5 rounded-full bg-green-100 text-green-700">No</span>}
                  </td>
                  <td className="px-4 py-3 font-bold text-gray-900">{billable}</td>
                  <td className="px-4 py-3 text-gray-600">{s.breakMinutes ?? 45} min</td>
                  <td className="px-4 py-3 text-gray-600 text-xs">{s.timezone}</td>
                  <td className="px-4 py-3">
                    <div className="flex gap-1.5">
                      {[['phone','📞'],['email','📧'],['chat','💬']].map(([k, icon]) => (
                        <span key={k} className={`text-xs ${ch[k] ? 'opacity-100' : 'opacity-20'}`}>{icon}</span>
                      ))}
                    </div>
                  </td>
                  <td className="px-4 py-3">
                    <span className={`text-xs font-semibold px-2 py-0.5 rounded-full ${s.status === 'active' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-500'}`}>
                      {s.status}
                    </span>
                  </td>
                  <td className="px-4 py-3">
                    {isSuperAdmin && (
                      <button onClick={() => handleOpen(s)} className="text-blue-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50">
                        <Pencil className="w-4 h-4" />
                      </button>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {showModal && (
        <div className="fixed inset-0 bg-black/50 flex items-start justify-center z-50 p-4 overflow-y-auto">
          <div className="bg-white rounded-2xl w-full max-w-lg my-6 shadow-2xl">
            <div className="flex items-center justify-between px-7 py-5 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl">
              <div className="flex items-center gap-3">
                <Clock className="w-5 h-5 text-blue-300" />
                <h2 className="text-lg font-bold text-white">{editId ? 'Edit Shift' : 'New Shift'}</h2>
              </div>
              <button onClick={() => setModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>

            <div className="p-7 space-y-5">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">Shift Name <span className="text-red-500">*</span></label>
                <input value={form.name} onChange={e => setF('name', e.target.value)}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="e.g. India Business Hours" />
              </div>

              <div className="grid grid-cols-3 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Start Time <span className="text-red-500">*</span></label>
                  <input type="time" value={form.startTime} onChange={e => setF('startTime', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">End Time <span className="text-red-500">*</span></label>
                  <input type="time" value={form.endTime} onChange={e => setF('endTime', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Timezone</label>
                  <select value={form.timezone} onChange={e => setF('timezone', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {TIMEZONES.map(tz => <option key={tz} value={tz}>{tz}</option>)}
                  </select>
                </div>
              </div>

              {crossesMidnight(form.startTime, form.endTime) && (
                <div className="bg-orange-50 border border-orange-200 rounded-xl px-4 py-2.5 text-sm text-orange-700">
                  ⚠️ This shift crosses midnight — end time is on the following day.
                </div>
              )}

              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Break Duration (min)</label>
                  <input type="number" min="0" max="120" value={form.breakMinutes} onChange={e => setF('breakMinutes', parseInt(e.target.value) || 0)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                  <p className="text-xs text-gray-400 mt-1">Billable: {calcBillable(form.startTime, form.endTime, form.breakMinutes)}</p>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Status</label>
                  <select value={form.status} onChange={e => setF('status', e.target.value)}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    <option value="active">Active</option>
                    <option value="inactive">Inactive</option>
                  </select>
                </div>
              </div>

              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-2">Support Channels</label>
                <div className="flex gap-3">
                  {[['phone','📞 Phone'],['email','📧 Email'],['chat','💬 Chat']].map(([key, label]) => (
                    <label key={key} className={`flex items-center gap-2 border-2 rounded-xl px-4 py-2.5 cursor-pointer transition-all text-sm ${form.channels[key] ? 'border-blue-500 bg-blue-50 text-blue-700' : 'border-gray-200 text-gray-500'}`}>
                      <input type="checkbox" checked={!!form.channels[key]} onChange={() => toggleChannel(key)} className="accent-blue-600" />
                      {label}
                    </label>
                  ))}
                </div>
              </div>

              <div className="bg-indigo-50 border border-indigo-200 rounded-xl px-4 py-3 text-sm text-indigo-800">
                <strong>Note:</strong> Work days (Mon–Fri, Sun–Thu etc.) are configured in <strong>Support Type Master</strong>, not here. This shift defines only the daily time window.
              </div>
            </div>

            <div className="flex justify-end gap-3 px-7 py-4 bg-gray-50 rounded-b-2xl border-t border-gray-100">
              <button onClick={() => setModal(false)} className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">Cancel</button>
              <button onClick={handleSave} disabled={saving}
                className="flex items-center gap-2 px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                💾 {saving ? 'Saving...' : editId ? 'Update' : 'Save'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
