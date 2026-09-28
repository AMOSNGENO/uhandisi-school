import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { UserPlus } from 'lucide-react';
import { api } from '@/lib/auth';
import type { Participant } from './types';
import { Badge, card, dangerBtn, ErrorNote, field, ghostBtn, Loading, money, primaryBtn, shortDate, td, th } from './ui';

export default function Participants({ courseId }: { courseId: number }) {
  const client = useQueryClient();
  const key = ['admin', 'participants', courseId];
  const people = useQuery({ queryKey: key, queryFn: () => api<Participant[]>(`/admin/courses/${courseId}/participants`) });
  const [email, setEmail] = useState('');
  const [fullAccess, setFullAccess] = useState(false);
  const [notice, setNotice] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });
  const enrol = useMutation({
    mutationFn: () => api<{ alreadyEnrolled: boolean }>(`/admin/courses/${courseId}/participants`, { method: 'POST', body: { email, fullAccess } }),
    onSuccess: r => { setNotice(r.alreadyEnrolled ? `${email} was already enrolled; their access was updated.` : `${email} is now enrolled.`); setEmail(''); setFullAccess(false); refresh(); },
  });
  const toggle = useMutation({
    mutationFn: (p: Participant) => api(`/admin/courses/${courseId}/participants/${p.userId}`, { method: 'PATCH', body: { fullAccess: !p.fullAccess } }),
    onSuccess: refresh,
  });
  const unenrol = useMutation({
    mutationFn: (p: Participant) => api(`/admin/courses/${courseId}/participants/${p.userId}`, { method: 'DELETE' }),
    onSuccess: refresh,
  });
  const submit = (e: FormEvent) => { e.preventDefault(); setNotice(''); enrol.mutate(); };
  const list = people.data || [];

  return <div className="space-y-5" data-testid="participants">
    <form onSubmit={submit} className={`${card} space-y-3 p-4 sm:p-5`}>
      <h2 className="flex items-center gap-2 text-sm font-bold"><UserPlus size={16} /> Enrol a user</h2>
      <div className="flex flex-col gap-3 sm:flex-row sm:items-end">
        <label className="block flex-1 text-xs font-bold">Their account email<input required type="email" value={email} onChange={e => setEmail(e.target.value)} className={field} placeholder="student@example.com" data-testid="input-enrol-email" /></label>
        <label className="flex items-center gap-2 pb-2.5 text-sm"><input type="checkbox" checked={fullAccess} onChange={e => setFullAccess(e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-full-access" /> Give full access without payment</label>
        <button disabled={enrol.isPending} className={primaryBtn} data-testid="button-enrol">Enrol</button>
      </div>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Full access unlocks every section (for scholarships, staff or sponsored learners). Without it, sections unlock as the student pays.</p>
      {notice && <p className="rounded-md bg-[hsl(145_55%_40%/.1)] p-3 text-xs text-[hsl(145_55%_25%)]" role="status">{notice}</p>}
      <ErrorNote error={enrol.error} />
    </form>
    <ErrorNote error={people.error || toggle.error || unenrol.error} />
    {people.isLoading ? <Loading /> : list.length === 0
      ? <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>Nobody is enrolled yet.</p>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[680px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Name</th><th className={th}>Access</th><th className={`${th} text-right`}>Paid</th><th className={th}>Enrolled</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list.map(p => <tr key={p.userId} className="border-b border-[hsl(var(--border))] last:border-0" data-testid={`row-participant-${p.userId}`}>
              <td className={td}><p className="font-semibold">{p.name} {!p.active && <Badge tone="bad">Suspended</Badge>}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{p.email}</p></td>
              <td className={td}>{p.fullAccess ? <Badge tone="good">Full access</Badge> : <Badge>By payment</Badge>}</td>
              <td className={`${td} text-right font-mono-ui`}>{money(p.paid)}</td>
              <td className={`${td} whitespace-nowrap text-xs text-[hsl(var(--muted-foreground))]`}>{shortDate(p.enrolledAt)}</td>
              <td className={`${td} text-right`}><div className="flex justify-end gap-2">
                <button disabled={toggle.isPending} onClick={() => toggle.mutate(p)} className={ghostBtn}>{p.fullAccess ? 'Remove full access' : 'Give full access'}</button>
                <button disabled={unenrol.isPending} onClick={() => { if (confirm(`Unenrol ${p.name}? Their payment records are kept.`)) unenrol.mutate(p); }} className={dangerBtn}>Unenrol</button>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
  </div>;
}
