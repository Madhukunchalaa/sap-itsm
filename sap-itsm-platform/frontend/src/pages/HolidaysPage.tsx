import React, { useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { holidaysApi } from '../api/services';
import { useAuthStore } from '../store/auth.store';
import { getErrorMessage } from '../api/client';
import { Plus, Pencil, Trash2, Calendar, ChevronDown, ChevronRight } from 'lucide-react';
import { format } from 'date-fns';
import toast from 'react-hot-toast';

const COUNTRIES = ['India','USA','UK','UAE','Singapore','Germany','Australia','Other'];
function dayName(dateStr: string) {
  try { return new Date(dateStr + 'T12:00:00').toLocaleDateString('en-GB', { weekday: 'long' }); }
  catch { return ''; }
}

export default function HolidaysPage() {
  const { user } = useAuthStore();
  const qc = useQueryClient();
  const isSuperAdmin = user?.role === 'SUPER_ADMIN';

  // Calendar modal state
  const [showCalModal, setCalModal] = useState(false);
  const [calForm, setCalForm] = useState({ name: '', country: 'India', year: new Date().getFullYear() });
  const [savingCal, setSavingCal] = useState(false);

  // Holiday date modal state
  const [showDateModal, setDateModal] = useState(false);
  const [dateCalendarId, setDateCalendarId] = useState('');
  const [editDateId, setEditDateId] = useState<string | null>(null);
  const [dateForm, setDateForm] = useState({ name: '', date: '' });
  const [savingDate, setSavingDate] = useState(false);

  // Expanded calendars
  const [expanded, setExpanded] = useState<Record<string, boolean>>({});

  const { data, isLoading } = useQuery({
    queryKey: ['holidays'],
    queryFn: () => holidaysApi.list().then(r => r.data.calendars || []),
  });
  const calendars = data || [];

  // ── Calendar CRUD ────────────────────────────────────────────
  const handleSaveCalendar = async () => {
    if (!calForm.name.trim()) { toast.error('Calendar name required'); return; }
    setSavingCal(true);
    try {
      await holidaysApi.create({ ...calForm, year: Number(calForm.year) });
      toast.success('Holiday calendar created');
      qc.invalidateQueries({ queryKey: ['holidays'] });
      setCalModal(false);
      setCalForm({ name: '', country: 'India', year: new Date().getFullYear() });
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSavingCal(false); }
  };

  // ── Holiday Date CRUD ────────────────────────────────────────
  const openAddDate = (calendarId: string) => {
    setDateCalendarId(calendarId);
    setEditDateId(null);
    setDateForm({ name: '', date: '' });
    setDateModal(true);
  };

  const openEditDate = (calendarId: string, hd: any) => {
    setDateCalendarId(calendarId);
    setEditDateId(hd.id);
    setDateForm({
      name: hd.name,
      date: hd.date ? hd.date.split('T')[0] : '',
      
    });
    setDateModal(true);
  };

  const handleSaveDate = async () => {
    if (!dateForm.name.trim() || !dateForm.date) { toast.error('Name and date required'); return; }
    setSavingDate(true);
    try {
      const payload = {
        name: dateForm.name,
        date: new Date(dateForm.date).toISOString(),
        supportType: 'NONE',
      };
      if (editDateId) {
        await holidaysApi.updateDate(dateCalendarId, editDateId, payload);
        toast.success('Holiday updated');
      } else {
        await holidaysApi.createDate(dateCalendarId, payload);
        toast.success('Holiday added');
      }
      qc.invalidateQueries({ queryKey: ['holidays'] });
      setDateModal(false);
    } catch (e) { toast.error(getErrorMessage(e)); }
    finally { setSavingDate(false); }
  };

  const handleDeleteDate = async (calendarId: string, dateId: string, name: string) => {
    if (!confirm(`Remove "${name}" from the calendar?`)) return;
    try {
      await holidaysApi.deleteDate(calendarId, dateId);
      toast.success('Holiday removed');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  const toggleExpand = (id: string) =>
    setExpanded(prev => ({ ...prev, [id]: !prev[id] }));

  const handleToggleActive = async (cal: any) => {
    try {
      await holidaysApi.update(cal.id, { isActive: !cal.isActive });
      toast.success(cal.isActive ? 'Calendar deactivated' : 'Calendar activated');
      qc.invalidateQueries({ queryKey: ['holidays'] });
    } catch (e) { toast.error(getErrorMessage(e)); }
  };

  return (
    <div className="p-6 max-w-screen-xl mx-auto space-y-5">
      {/* Header */}
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-xl font-bold text-gray-900">Holiday Calendars</h1>
          <p className="text-sm text-gray-500">Manage public holidays and their SLA impact</p>
        </div>
        {isSuperAdmin && (
          <button onClick={() => setCalModal(true)}
            className="flex items-center gap-2 bg-blue-600 hover:bg-blue-700 text-white px-4 py-2 rounded-lg text-sm font-medium transition-colors">
            <Plus className="w-4 h-4" /> Add Calendar
          </button>
        )}
      </div>

      {/* Info box */}
      <div className="bg-blue-50 border-l-4 border-blue-500 rounded-lg px-4 py-3 text-sm text-blue-800">
        <strong>Note:</strong> Holiday SLA behavior (pause / full support / on-call) is configured in the <strong>Support Type</strong> assigned to each customer's contract — not per holiday date.
      </div>

      {/* Loading */}
      {isLoading && (
        <div className="text-center py-16 text-gray-400">
          <Calendar className="w-10 h-10 mx-auto mb-2 opacity-20" />
          Loading calendars...
        </div>
      )}

      {/* Calendars */}
      {!isLoading && calendars.length === 0 && (
        <div className="text-center py-16 text-gray-400 bg-white rounded-xl border border-gray-100">
          <Calendar className="w-12 h-12 mx-auto mb-3 opacity-20" />
          <p className="font-medium">No holiday calendars yet</p>
          <p className="text-sm mt-1">Create a calendar to start adding holidays</p>
        </div>
      )}

      {calendars.map((cal: any) => {
        const isOpen = expanded[cal.id] !== false; // default open
        const dates = (cal.dates || []).sort((a: any, b: any) =>
          new Date(a.date).getTime() - new Date(b.date).getTime()
        );
        return (
          <div key={cal.id} className={`bg-white rounded-xl shadow-sm border overflow-hidden transition-all ${cal.isActive === false ? 'border-gray-200 opacity-60' : 'border-gray-100'}`}>
            {/* Calendar header */}
            <div className={`flex items-center justify-between px-5 py-4 border-b border-gray-100 ${cal.isActive === false ? 'bg-gray-50' : 'bg-gradient-to-r from-slate-50 to-blue-50'}`}>
              <button onClick={() => toggleExpand(cal.id)}
                className="flex items-center gap-3 text-left flex-1">
                {isOpen
                  ? <ChevronDown className="w-4 h-4 text-gray-400" />
                  : <ChevronRight className="w-4 h-4 text-gray-400" />}
                <Calendar className={`w-5 h-5 ${cal.isActive === false ? 'text-gray-400' : 'text-blue-500'}`} />
                <div>
                  <div className="flex items-center gap-2">
                    <p className="font-semibold text-gray-900">{cal.name}</p>
                    {cal.isActive === false && (
                      <span className="text-xs bg-gray-200 text-gray-500 px-2 py-0.5 rounded-full font-medium">Inactive</span>
                    )}
                  </div>
                  <p className="text-xs text-gray-500">{cal.country} · {cal.year} · {dates.length} holidays</p>
                </div>
              </button>
              <div className="flex items-center gap-3">
                {/* Active / Inactive toggle */}
                {isSuperAdmin && (
                  <div className="flex items-center gap-2" onClick={e => e.stopPropagation()}>
                    <span className={`text-xs font-semibold ${cal.isActive === false ? 'text-gray-400' : 'text-green-600'}`}>
                      {cal.isActive === false ? 'Inactive' : 'Active'}
                    </span>
                    <div
                      onClick={() => handleToggleActive(cal)}
                      className={`w-10 h-5 rounded-full flex items-center px-0.5 transition-colors cursor-pointer ${cal.isActive === false ? 'bg-gray-300' : 'bg-green-500'}`}>
                      <div className={`w-4 h-4 bg-white rounded-full shadow transition-transform duration-200 ${cal.isActive === false ? 'translate-x-0' : 'translate-x-5'}`} />
                    </div>
                  </div>
                )}
                {isSuperAdmin && (
                  <button onClick={() => openAddDate(cal.id)}
                    className="flex items-center gap-1.5 text-sm text-blue-600 hover:text-blue-800 font-medium px-3 py-1.5 rounded-lg hover:bg-blue-50 transition-colors">
                    <Plus className="w-3.5 h-3.5" /> Add Holiday
                  </button>
                )}
              </div>
            </div>

            {/* Holiday dates table */}
            {isOpen && (
              <table className="w-full text-sm">
                <thead>
                  <tr className="bg-gray-50 border-b border-gray-100">
                    <th className="text-left px-5 py-2.5 font-semibold text-gray-600 text-xs">Holiday Name</th>
                    <th className="text-left px-5 py-2.5 font-semibold text-gray-600 text-xs">Date</th>
                    <th className="text-left px-5 py-2.5 font-semibold text-gray-600 text-xs">Day</th>
                    {isSuperAdmin && <th className="px-5 py-2.5 text-xs font-semibold text-gray-600">Actions</th>}
                  </tr>
                </thead>
                <tbody className="divide-y divide-gray-50">
                  {dates.length === 0 ? (
                    <tr>
                      <td colSpan={4} className="text-center py-8 text-gray-400 text-sm">
                        No holidays added yet — click "Add Holiday" above
                      </td>
                    </tr>
                  ) : dates.map((hd: any) => {
                    const dateStr = hd.date ? hd.date.split('T')[0] : '';
                    return (
                      <tr key={hd.id} className="hover:bg-gray-50">
                        <td className="px-5 py-3 font-medium text-gray-900">{hd.name}</td>
                        <td className="px-5 py-3 font-mono text-gray-700">
                          {dateStr}
                        </td>
                        <td className="px-5 py-3 text-gray-500">{dayName(dateStr)}</td>
                        {isSuperAdmin && (
                          <td className="px-5 py-3">
                            <div className="flex items-center gap-1.5">
                              <button onClick={() => openEditDate(cal.id, hd)}
                                className="text-blue-400 hover:text-blue-600 p-1.5 rounded hover:bg-blue-50">
                                <Pencil className="w-3.5 h-3.5" />
                              </button>
                              <button onClick={() => handleDeleteDate(cal.id, hd.id, hd.name)}
                                className="text-red-400 hover:text-red-600 p-1.5 rounded hover:bg-red-50">
                                <Trash2 className="w-3.5 h-3.5" />
                              </button>
                            </div>
                          </td>
                        )}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            )}
          </div>
        );
      })}

      {/* ── Add Calendar Modal ─────────────────────────────── */}
      {showCalModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl">
              <h2 className="text-lg font-bold text-white">New Holiday Calendar</h2>
              <button onClick={() => setCalModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Calendar Name <span className="text-red-500">*</span>
                </label>
                <input value={calForm.name} onChange={e => setCalForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="India Public Holidays 2026" />
              </div>
              <div className="grid grid-cols-2 gap-4">
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Country</label>
                  <select value={calForm.country} onChange={e => setCalForm(f => ({ ...f, country: e.target.value }))}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none">
                    {COUNTRIES.map(c => <option key={c}>{c}</option>)}
                  </select>
                </div>
                <div>
                  <label className="block text-sm font-semibold text-gray-700 mb-1.5">Year</label>
                  <input type="number" min="2024" max="2030" value={calForm.year}
                    onChange={e => setCalForm(f => ({ ...f, year: parseInt(e.target.value) }))}
                    className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                </div>
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-2xl border-t border-gray-100">
              <button onClick={() => setCalModal(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">
                Cancel
              </button>
              <button onClick={handleSaveCalendar} disabled={savingCal}
                className="px-5 py-2.5 bg-blue-600 hover:bg-blue-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                💾 {savingCal ? 'Creating...' : 'Create Calendar'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* ── Add/Edit Holiday Date Modal ───────────────────── */}
      {showDateModal && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4">
          <div className="bg-white rounded-2xl w-full max-w-md shadow-2xl">
            <div className="flex items-center justify-between px-6 py-4 bg-gradient-to-r from-indigo-800 to-violet-900 rounded-t-2xl">
              <h2 className="text-lg font-bold text-white">{editDateId ? 'Edit Holiday' : 'Add Holiday'}</h2>
              <button onClick={() => setDateModal(false)} className="text-white/60 hover:text-white text-2xl leading-none">×</button>
            </div>
            <div className="p-6 space-y-4">
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Holiday Name <span className="text-red-500">*</span>
                </label>
                <input value={dateForm.name} onChange={e => setDateForm(f => ({ ...f, name: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none"
                  placeholder="Republic Day" />
              </div>
              <div>
                <label className="block text-sm font-semibold text-gray-700 mb-1.5">
                  Date <span className="text-red-500">*</span>
                </label>
                <input type="date" value={dateForm.date} onChange={e => setDateForm(f => ({ ...f, date: e.target.value }))}
                  className="w-full border border-gray-300 rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-blue-500 focus:outline-none" />
                {dateForm.date && (
                  <p className="text-xs text-gray-400 mt-1">{dayName(dateForm.date)}</p>
                )}
              </div>
            </div>
            <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 rounded-b-2xl border-t border-gray-100">
              <button onClick={() => setDateModal(false)}
                className="px-5 py-2.5 border border-gray-300 rounded-xl text-sm text-gray-600 hover:bg-gray-100 font-medium">
                Cancel
              </button>
              <button onClick={handleSaveDate} disabled={savingDate}
                className="px-5 py-2.5 bg-green-600 hover:bg-green-700 text-white rounded-xl text-sm font-medium disabled:opacity-60">
                💾 {savingDate ? 'Saving...' : editDateId ? 'Update Holiday' : 'Add Holiday'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
