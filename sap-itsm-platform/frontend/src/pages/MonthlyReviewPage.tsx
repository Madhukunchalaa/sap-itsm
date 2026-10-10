import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { statusDecksApi, plantsApi, MonthlyReviewParams } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button, Select, Input } from '../components/ui/Forms';
import { MultiSelectDropdown } from '../components/ui/MultiSelectDropdown';

const thisMonth = () => format(new Date(), 'yyyy-MM');

// With responseType 'blob', error bodies arrive as a Blob too — unwrap the message.
async function downloadErrorMessage(err: any): Promise<string> {
  const data = err?.response?.data;
  if (data instanceof Blob) {
    try {
      const body = JSON.parse(await data.text());
      return body.error || body.message || 'Could not generate the report';
    } catch { /* fall through */ }
  }
  return getErrorMessage(err);
}

export default function MonthlyReviewPage() {
  const [customerId, setCustomerId] = useState('');
  const [plant, setPlant] = useState('');
  const [month, setMonth] = useState(thisMonth());
  const [unticked, setUnticked] = useState<Set<string>>(new Set()); // modules left out of the document
  const [downloading, setDownloading] = useState(false);

  const { data: customers = [], isLoading: loadingCustomers } = useQuery({
    queryKey: ['status-deck-customers'],
    queryFn: () => statusDecksApi.customers().then((r) => r.data.data as { id: string; companyName: string }[]),
  });

  // Pre-select when the manager only has one customer.
  useEffect(() => {
    if (!customerId && customers.length === 1) setCustomerId(customers[0].id);
  }, [customers, customerId]);

  const { data: plants = [] } = useQuery({
    queryKey: ['plants-by-customer', customerId],
    queryFn: () => plantsApi.byCustomer(customerId).then((r) => (r.data.data || []) as any[]),
    enabled: !!customerId,
  });

  const params: MonthlyReviewParams | null = customerId && month
    ? { customerId, plant: plant || undefined, month }
    : null;

  const { data: preview, isFetching: previewing, error: previewError } = useQuery({
    queryKey: ['monthly-review-preview', params],
    queryFn: () => statusDecksApi.monthlyPreview(params!).then((r) => r.data.data),
    enabled: !!params,
    retry: false,
  });

  const moduleList: any[] = preview?.modules || [];
  const selectedIds = moduleList.filter((m) => !unticked.has(m.id)).map((m) => m.id);
  const toggle = (id: string) => setUnticked((prev) => {
    const next = new Set(prev);
    if (next.has(id)) next.delete(id); else next.add(id);
    return next;
  });

  const handleDownload = async () => {
    if (!params || !selectedIds.length) return;
    setDownloading(true);
    try {
      // only send the list when some modules were left out
      const res = await statusDecksApi.monthlyDownload({
        ...params,
        modules: selectedIds.length === moduleList.length ? undefined : selectedIds.join(','),
      });
      const disposition: string = res.headers['content-disposition'] || '';
      const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || preview?.fileName || 'month-review.docx';
      const url = window.URL.createObjectURL(new Blob([res.data]));
      const a = document.createElement('a');
      a.href = url;
      a.download = name;
      document.body.appendChild(a);
      a.click();
      a.remove();
      window.URL.revokeObjectURL(url);
      toast.success('Report downloaded');
    } catch (err) {
      toast.error(await downloadErrorMessage(err));
    } finally {
      setDownloading(false);
    }
  };

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Monthly Review (Word)"
        subtitle="Module-wise monthly review report as an editable .docx — one page per module, with a section for HOD comments"
      />

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-4">
          <Select
            label="Client"
            value={customerId}
            disabled={loadingCustomers}
            onChange={(e) => { setCustomerId(e.target.value); setPlant(''); setUnticked(new Set()); }}
            options={[{ value: '', label: loadingCustomers ? 'Loading…' : 'Select a client' }, ...customers.map((c) => ({ value: c.id, label: c.companyName }))]}
          />
          <Select
            label="Plant"
            value={plant}
            disabled={!customerId}
            onChange={(e) => setPlant(e.target.value)}
            options={[{ value: '', label: 'All plants' }, ...plants.map((p: any) => ({ value: p.name, label: p.name }))]}
          />
          <div className="flex flex-col gap-1">
            <label className="text-sm font-medium text-gray-700">Module</label>
            <div className={customerId && moduleList.length ? '' : 'opacity-50 pointer-events-none'}>
              <MultiSelectDropdown
                options={moduleList.map((m) => ({ value: m.id, label: m.title }))}
                // empty = every module (same convention as the other filters)
                selected={selectedIds.length === moduleList.length ? [] : selectedIds}
                onChange={(ids) => setUnticked(ids.length ? new Set(moduleList.filter((m) => !ids.includes(m.id)).map((m) => m.id)) : new Set())}
                placeholder={moduleList.length && !selectedIds.length ? 'No module selected' : 'All modules'}
              />
            </div>
          </div>
          <Input
            label="Month"
            type="month"
            value={month}
            max={thisMonth()}
            onChange={(e) => setMonth(e.target.value)}
          />
        </div>
      </div>

      {!customerId && <p className="text-sm text-gray-500">Select a client to preview the report.</p>}
      {customerId && previewError && <p className="text-sm text-red-600">{getErrorMessage(previewError)}</p>}

      {customerId && preview && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
            <FileText className="w-4 h-4 text-gray-500" />
            {preview.fileName}
            {previewing && <span className="text-xs text-gray-400">updating…</span>}
          </div>
          <div className="overflow-x-auto">
            <table className="text-xs text-gray-700 border border-gray-200 bg-white w-full">
              <thead>
                <tr className="bg-gray-100 text-gray-500">
                  <th className="px-3 py-1.5 w-8">
                    <input
                      type="checkbox"
                      aria-label="Select all modules"
                      checked={selectedIds.length === moduleList.length}
                      onChange={(e) => setUnticked(e.target.checked ? new Set() : new Set(moduleList.map((m) => m.id)))}
                    />
                  </th>
                  <th className="px-3 py-1.5 text-left font-medium">Module (page)</th>
                  <th className="px-3 py-1.5 font-medium">Carry forward</th>
                  <th className="px-3 py-1.5 font-medium">New</th>
                  <th className="px-3 py-1.5 font-medium">Closed</th>
                  <th className="px-3 py-1.5 font-medium">Still open</th>
                  <th className="px-3 py-1.5 font-medium">High priority open</th>
                </tr>
              </thead>
              <tbody>
                {moduleList.map((m: any) => (
                  <tr key={m.id} className={`border-t border-gray-100 text-center ${unticked.has(m.id) ? 'opacity-50' : ''}`}>
                    <td className="px-3 py-1.5">
                      <input type="checkbox" aria-label={`Include ${m.title}`} checked={!unticked.has(m.id)} onChange={() => toggle(m.id)} />
                    </td>
                    <td className="px-3 py-1.5 text-left font-medium">{m.title}</td>
                    <td className="px-3 py-1.5">{m.carry}</td>
                    <td className="px-3 py-1.5">{m.newCount}</td>
                    <td className="px-3 py-1.5">{m.closed}</td>
                    <td className="px-3 py-1.5">{m.open}</td>
                    <td className="px-3 py-1.5">{m.highOpen}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <p className="text-xs text-gray-500 mt-3">
            Tick the modules to include — each ticked module becomes one page. Counts run up to {format(new Date(preview.asOf), 'dd-MM-yyyy')}. "High priority" means P1 and P2.
            Modules not listed above (e.g. Fiori, HR, PM) appear on an "Other modules" page. The SAP and Business contact lines and the
            Comments column are left blank to fill in Word.
          </p>
          <div className="mt-4">
            <Button onClick={handleDownload} loading={downloading} disabled={!selectedIds.length}>
              <Download className="w-4 h-4" /> Download Word (.docx)
              {selectedIds.length < moduleList.length ? ` — ${selectedIds.length} of ${moduleList.length} modules` : ''}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
