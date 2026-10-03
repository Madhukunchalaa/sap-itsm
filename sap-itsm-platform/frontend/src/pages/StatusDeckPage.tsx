import React, { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { format } from 'date-fns';
import { Download, FileText } from 'lucide-react';
import toast from 'react-hot-toast';
import { statusDecksApi, plantsApi, StatusDeckParams } from '../api/services';
import { getErrorMessage } from '../api/client';
import { PageHeader, Button, Select, Input } from '../components/ui/Forms';

const today = () => format(new Date(), 'yyyy-MM-dd');

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

function Stat({ label, value, previous }: { label: string; value: number; previous: number }) {
  return (
    <div className="border border-gray-200 rounded-lg px-4 py-3 bg-white">
      <div className="text-2xl font-bold text-gray-900">{value}</div>
      <div className="text-xs font-medium text-gray-500 uppercase tracking-wide mt-0.5">{label}</div>
      <div className="text-xs text-gray-400 mt-1">before: {previous}</div>
    </div>
  );
}

export default function StatusDeckPage() {
  const [period, setPeriod] = useState<'weekly' | 'monthly'>('weekly');
  const [customerId, setCustomerId] = useState('');
  const [plant, setPlant] = useState('');
  const [date, setDate] = useState(today());
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

  const params: StatusDeckParams | null = customerId
    ? { period, customerId, plant: plant || undefined, date: date || undefined }
    : null;

  const { data: preview, isFetching: previewing, error: previewError } = useQuery({
    queryKey: ['status-deck-preview', params],
    queryFn: () => statusDecksApi.preview(params!).then((r) => r.data.data),
    enabled: !!params,
    retry: false,
  });

  const handleDownload = async () => {
    if (!params) return;
    setDownloading(true);
    try {
      const res = await statusDecksApi.download(params);
      const disposition: string = res.headers['content-disposition'] || '';
      const name = /filename="?([^";]+)"?/i.exec(disposition)?.[1] || preview?.fileName || 'status-report.pptx';
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

  const previousWord = period === 'weekly' ? 'last week' : 'last month';

  return (
    <div className="max-w-4xl">
      <PageHeader
        title="Status Report (PowerPoint)"
        subtitle="Generate the weekly or monthly SAP support ticket status deck as an editable .pptx"
      />

      <div className="bg-white border border-gray-200 rounded-xl p-5 mb-5">
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
          <Select
            label="Report type"
            value={period}
            onChange={(e) => setPeriod(e.target.value as 'weekly' | 'monthly')}
            options={[
              { value: 'weekly', label: 'Weekly (compare with last week)' },
              { value: 'monthly', label: 'Monthly (compare with last month)' },
            ]}
          />
          <Input
            label="Report date"
            type="date"
            value={date}
            max={today()}
            onChange={(e) => setDate(e.target.value)}
          />
          <Select
            label="Client"
            value={customerId}
            disabled={loadingCustomers}
            onChange={(e) => { setCustomerId(e.target.value); setPlant(''); }}
            options={[{ value: '', label: loadingCustomers ? 'Loading…' : 'Select a client' }, ...customers.map((c) => ({ value: c.id, label: c.companyName }))]}
          />
          <Select
            label="Plant"
            value={plant}
            disabled={!customerId}
            onChange={(e) => setPlant(e.target.value)}
            options={[{ value: '', label: 'All plants (consolidated deck)' }, ...plants.map((p: any) => ({ value: p.name, label: p.name }))]}
          />
        </div>
      </div>

      {!customerId && (
        <p className="text-sm text-gray-500">Select a client to preview the report.</p>
      )}

      {customerId && previewError && (
        <p className="text-sm text-red-600">{getErrorMessage(previewError)}</p>
      )}

      {customerId && preview && (
        <div className="bg-gray-50 border border-gray-200 rounded-xl p-5">
          <div className="flex items-center gap-2 text-sm font-medium text-gray-700 mb-3">
            <FileText className="w-4 h-4 text-gray-500" />
            {preview.fileName}
            {previewing && <span className="text-xs text-gray-400">updating…</span>}
          </div>
          <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
            <Stat label="Total issues" value={preview.current.total} previous={preview.previous.total} />
            <Stat label="Resolved & closed" value={preview.current.closed} previous={preview.previous.closed} />
            <Stat label="Open" value={preview.current.open} previous={preview.previous.open} />
            <Stat label="In UAT" value={preview.current.uat} previous={preview.previous.uat} />
            <Stat label="Awaiting & hold" value={preview.current.awaitingHold} previous={preview.previous.awaitingHold} />
          </div>
          {preview.mode === 'consolidated' && (
            <div className="mt-3 overflow-x-auto">
              <table className="text-xs text-gray-700 border border-gray-200 bg-white">
                <thead>
                  <tr className="bg-gray-100 text-gray-500">
                    <th className="px-3 py-1.5 text-left font-medium">Plant</th>
                    <th className="px-3 py-1.5 font-medium">Total</th>
                    <th className="px-3 py-1.5 font-medium">Open</th>
                    <th className="px-3 py-1.5 font-medium">In UAT</th>
                    <th className="px-3 py-1.5 font-medium">Awaiting &amp; hold</th>
                  </tr>
                </thead>
                <tbody>
                  {preview.plants.map((p: any) => (
                    <tr key={p.label} className="border-t border-gray-100 text-center">
                      <td className="px-3 py-1.5 text-left font-medium">{p.label}</td>
                      <td className="px-3 py-1.5">{p.current.total}</td>
                      <td className="px-3 py-1.5">{p.openTickets}</td>
                      <td className="px-3 py-1.5">{p.uatTickets}</td>
                      <td className="px-3 py-1.5">{p.awaitingHoldTickets}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          <p className="text-xs text-gray-500 mt-3">
            "before" is the status {previousWord} ({format(new Date(preview.previousAsOf), 'dd-MM-yyyy')}).{' '}
            {preview.mode === 'consolidated'
              ? 'Consolidated deck: executive summary, plant-wise comparison, then a section per plant.'
              : `Slides: ${preview.openTickets} open ticket(s), ${preview.uatTickets} in UAT, ${preview.awaitingHoldTickets} awaiting/hold.`}{' '}
            The Remarks columns are left blank for you to fill in PowerPoint.
          </p>
          <div className="mt-4">
            <Button onClick={handleDownload} loading={downloading}>
              <Download className="w-4 h-4" /> Download PowerPoint (.pptx)
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
