import { type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3 } from 'lucide-react';
import { api } from '@/lib/auth';
import type { AdminPayment } from './types';
import { AdminLayout, Badge, card, ErrorNote, ghostBtn, Loading, money, primaryBtn, td, th } from './ui';

const tone: Record<string, 'good' | 'warn' | 'bad' | 'muted'> = { completed: 'good', pending: 'warn', failed: 'bad', cancelled: 'muted', refunded: 'muted' };
export const StatusPill = ({ status }: { status: string }) => <Badge tone={tone[status] ?? 'muted'}><span className="capitalize">{status}</span></Badge>;

export function PaymentsTable({ payments, actions }: { payments: AdminPayment[]; actions?: (p: AdminPayment) => ReactNode }) {
  if (payments.length === 0) return <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>No payments yet.</p>;
  return <div className={`${card} overflow-x-auto`}>
    <table className="w-full min-w-[640px] text-sm">
      <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Student</th><th className={th}>Course</th><th className={th}>Date</th><th className={`${th} text-right`}>Amount</th><th className={th}>Status</th>{actions && <th className={th}><span className="sr-only">Actions</span></th>}</tr></thead>
      <tbody>
        {payments.map(p => <tr key={p.id} className="border-b border-[hsl(var(--border))] last:border-0" data-testid={`row-admin-payment-${p.id}`}>
          <td className={td}><p className="font-semibold">{p.studentName ?? `User #${p.userId}`}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{p.phoneNumber}{p.receipt ? ` · ${p.receipt}` : ''}</p></td>
          <td className={td}>{p.courseTitle}</td>
          <td className={`${td} whitespace-nowrap text-xs text-[hsl(var(--muted-foreground))]`}>{new Date(p.date).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</td>
          <td className={`${td} whitespace-nowrap text-right font-mono-ui`}>{money(p.amount)}</td>
          <td className={td}><StatusPill status={p.status} /></td>
          {actions && <td className={`${td} text-right`}>{actions(p)}</td>}
        </tr>)}
      </tbody>
    </table>
  </div>;
}

export default function AdminPaymentsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState('');
  const payments = useQuery({ queryKey: ['admin', 'payments', status], queryFn: () => api<AdminPayment[]>(`/admin/payments${status ? `?status=${status}` : ''}`) });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; status: string; receipt?: string }) => api(`/admin/payments/${id}`, { method: 'PATCH', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
  const mpesa = useQuery({ queryKey: ['admin', 'mpesa'], queryFn: () => api<{ configured: boolean; environment: string; missing: string[] }>('/admin/mpesa') });
  const check = useMutation({
    mutationFn: (id: number) => api<{ status: string; message: string }>(`/admin/payments/${id}/check`, { method: 'POST' }),
    onSuccess: r => { alert(`M-Pesa says: ${r.message || r.status}`); client.invalidateQueries({ queryKey: ['admin'] }); },
  });
  const confirmPayment = (p: AdminPayment) => {
    const receipt = prompt(`Confirm ${money(p.amount)} from ${p.studentName}.\n\nM-Pesa receipt code (optional):`, p.receipt ?? '');
    if (receipt !== null) update.mutate({ id: p.id, status: 'completed', receipt });
  };
  return <AdminLayout title="Payments" description="Every M-Pesa payment. Confirm one by hand if Safaricom's confirmation never arrived; confirmed money unlocks modules straight away.">
    {mpesa.data && (mpesa.data.configured
      ? <p className="mb-5 flex items-center gap-2 rounded-md bg-[hsl(var(--link)/.08)] p-3 text-xs text-[hsl(var(--link))]" data-testid="status-mpesa"><Check size={14} /> M-Pesa connected ({mpesa.data.environment}). Payments confirm automatically.</p>
      : <p className="mb-5 rounded-md border border-[hsl(38_90%_50%/.4)] bg-[hsl(38_90%_50%/.08)] p-3 text-xs leading-5" data-testid="status-mpesa"><strong>M-Pesa isn't connected yet.</strong> Payments are recorded as pending for you to confirm here. To connect, fill in <code className="rounded bg-[hsl(var(--muted))] px-1">{mpesa.data.missing.join(', ')}</code> in <code className="rounded bg-[hsl(var(--muted))] px-1">artifacts/api-server/.env</code> and restart the server.</p>)}
    <div className="mb-4 flex gap-1 overflow-x-auto">
      {['', 'pending', 'completed', 'failed', 'cancelled', 'refunded'].map(s => <button key={s || 'all'} onClick={() => setStatus(s)} aria-pressed={status === s}
        className={`whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold capitalize transition ${status === s ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:bg-[hsl(var(--secondary))]'}`}>{s || 'All'}</button>)}
    </div>
    <ErrorNote error={update.error || check.error || payments.error} />
    {payments.isLoading ? <Loading /> : <PaymentsTable payments={payments.data || []} actions={p => p.status === 'pending'
      ? <div className="flex justify-end gap-2">
        {mpesa.data?.configured && p.checkoutRequestId && !p.checkoutRequestId.startsWith('manual_') && <button disabled={check.isPending} onClick={() => check.mutate(p.id)} className={ghostBtn} data-testid={`button-check-payment-${p.id}`}><Clock3 size={14} /> Check</button>}
        <button disabled={update.isPending} onClick={() => confirmPayment(p)} className={primaryBtn} data-testid={`button-confirm-payment-${p.id}`}><Check size={14} /> Confirm</button>
        <button disabled={update.isPending} onClick={() => { if (confirm('Mark this payment as failed?')) update.mutate({ id: p.id, status: 'failed' }); }} className={ghostBtn}>Failed</button>
      </div>
      : p.status === 'completed'
        ? <button disabled={update.isPending} onClick={() => { if (confirm(`Refund ${money(p.amount)}? The student loses the access this payment unlocked.`)) update.mutate({ id: p.id, status: 'refunded' }); }} className={ghostBtn}>Refund</button>
        : null} />}
  </AdminLayout>;
}
