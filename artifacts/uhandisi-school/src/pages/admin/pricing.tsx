import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Calculator, LockKeyhole, RotateCcw, Save, Unlock } from 'lucide-react';
import { api } from '@/lib/auth';
import { Badge, card, ErrorNote, field, ghostBtn, iconBtn, Loading, money, primaryBtn, td, th } from './ui';

type PricedLesson = {
  id: number; moduleId: number; title: string; kind: string; price: number; auto: boolean;
  priceOverride: number | null; startsAt: number; endsAt: number; opensAt: number;
};
type Pricing = {
  coursePrice: number; paymentModel: string; openStep: number; total: number; overridesTotal: number;
  modules: Array<{ id: number; title: string }>; lessons: PricedLesson[];
};

const kindLabel: Record<string, string> = { page: 'Page', file: 'File', url: 'Link', package: 'IMS/SCORM', quiz: 'Exam' };

/** Each lesson's price and when it opens, for a pay-as-you-go course. */
export default function CoursePricing({ courseId }: { courseId: number }) {
  const client = useQueryClient();
  const pricing = useQuery({ queryKey: ['admin', 'pricing', courseId], queryFn: () => api<Pricing>(`/admin/courses/${courseId}/pricing`) });
  // Edits not saved yet: lesson id → price text ('' = back to automatic).
  const [edits, setEdits] = useState<Record<number, string>>({});
  const [tryPaid, setTryPaid] = useState('100');
  useEffect(() => { setEdits({}); }, [pricing.data]);
  const save = useMutation({
    mutationFn: () => api<Pricing>(`/admin/courses/${courseId}/pricing`, {
      method: 'PUT',
      body: { prices: Object.entries(edits).map(([id, v]) => ({ lessonId: Number(id), priceOverride: v.trim() === '' ? null : Math.max(0, Math.round(Number(v))) })) },
    }),
    onSuccess: data => { client.setQueryData(['admin', 'pricing', courseId], data); client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'admin' && q.queryKey[0] !== 'auth' }); },
  });

  const data = pricing.data;
  const paid = Math.max(0, Number(tryPaid) || 0);
  const opened = useMemo(() => data?.lessons.filter(l => paid >= l.opensAt) ?? [], [data, paid]);
  if (pricing.isLoading) return <Loading height={300} />;
  if (!data) return <ErrorNote error={pricing.error} />;
  const dirty = Object.keys(edits).length > 0;
  const over = data.overridesTotal > data.coursePrice;

  return <div className="space-y-6" data-testid="course-pricing">
    <section className={`${card} grid gap-4 p-5 sm:grid-cols-3`}>
      <div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Course price</p><p className="mt-1 font-mono-ui text-xl">{money(data.coursePrice)}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Lessons add up to</p><p className={`mt-1 font-mono-ui text-xl ${data.total !== data.coursePrice ? 'text-[hsl(var(--destructive))]' : ''}`} data-testid="pricing-total">{money(data.total)}</p></div>
      <div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">Opening step</p><p className="mt-1 font-mono-ui text-xl">{money(data.openStep)}</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">The smallest daily plan. Paying this towards a lesson opens it.</p></div>
    </section>
    <p className="text-sm leading-6 text-[hsl(var(--muted-foreground))]">Lessons open in course order. Each opens once the ones before it are paid for, plus {money(data.openStep)} towards it (or straight away if it’s priced at 0, handy for a free first lesson). Leave a price empty to use the automatic share; type one to fix it, and the automatic lessons share what’s left of the course price.</p>
    {over && <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">The prices you’ve set add up to more than the course price, so students pay {money(data.total)} in total. Lower some prices or raise the course price in Settings.</p>}
    {data.lessons.length === 0
      ? <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>This course has no lessons yet. Add them on the Content tab, then set prices here.</p>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Lesson</th><th className={th}>Price (KSh)</th><th className={`${th} text-right`}>Opens when paid reaches</th><th className={th}><span className="sr-only">Reset</span></th></tr></thead>
          {data.modules.map(m => {
            const lessons = data.lessons.filter(l => l.moduleId === m.id);
            if (!lessons.length) return null;
            return <tbody key={m.id}>
              <tr className="bg-[hsl(var(--muted)/.4)]"><td colSpan={4} className="px-4 py-2 text-xs font-bold">{m.title}</td></tr>
              {lessons.map(l => {
                const edited = edits[l.id];
                const value = edited ?? (l.auto ? '' : String(l.price));
                const custom = edited !== undefined ? edited.trim() !== '' : !l.auto;
                return <tr key={l.id} className="border-b border-[hsl(var(--border))] last:border-0" data-testid={`price-row-${l.id}`}>
                  <td className={td}><span className="font-semibold">{l.title}</span> <span className="ml-1 text-[11px] text-[hsl(var(--muted-foreground))]">{kindLabel[l.kind] ?? l.kind}</span></td>
                  <td className={td}><div className="flex items-center gap-2">
                    <div className="w-32"><input type="number" min={0} value={value} placeholder={String(l.price)} onChange={e => setEdits(x => ({ ...x, [l.id]: e.target.value }))}
                      className={`${field} mt-0 font-mono-ui`} aria-label={`Price of ${l.title}`} data-testid={`input-price-${l.id}`} /></div>
                    {custom ? <Badge tone="info">Set</Badge> : <Badge>Auto</Badge>}
                  </div></td>
                  <td className={`${td} text-right font-mono-ui`}>{l.opensAt === 0 ? <span className="text-[hsl(145_55%_28%)]">Free</span> : money(l.opensAt)}</td>
                  <td className={`${td} text-right`}>{custom && <button type="button" onClick={() => setEdits(x => ({ ...x, [l.id]: '' }))} className={iconBtn} title="Back to the automatic share" aria-label={`Use the automatic price for ${l.title}`}><RotateCcw size={14} /></button>}</td>
                </tr>;
              })}
            </tbody>;
          })}
        </table>
      </div>}
    {dirty && <div className="sticky bottom-20 z-10 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--primary)/.3)] bg-[hsl(var(--card))] p-3 shadow-lift lg:bottom-4">
      <p className="text-sm">You have unsaved price changes. Opening points are recalculated when you save.</p>
      <div className="flex gap-2"><button type="button" onClick={() => setEdits({})} className={ghostBtn}>Discard</button><button type="button" disabled={save.isPending} onClick={() => save.mutate()} className={primaryBtn} data-testid="button-save-pricing"><Save size={14} /> {save.isPending ? 'Saving…' : 'Save prices'}</button></div>
    </div>}
    <ErrorNote error={save.error} />
    {data.lessons.length > 0 && <section className={`${card} p-5`} data-testid="pricing-calculator">
      <h2 className="flex items-center gap-2 font-bold"><Calculator size={16} /> What does a payment open?</h2>
      <div className="mt-3 flex flex-wrap items-center gap-3 text-sm">
        <label className="flex items-center gap-2">A student who has paid <span className="font-mono-ui">KSh</span><span className="inline-block w-32"><input type="number" min={0} value={tryPaid} onChange={e => setTryPaid(e.target.value)} className={`${field} mt-0 font-mono-ui`} data-testid="input-try-paid" /></span></label>
        <span>has <b data-testid="try-opened">{opened.length} of {data.lessons.length}</b> lessons open.</span>
      </div>
      <ul className="mt-3 space-y-1 text-sm">
        {data.lessons.slice(0, Math.min(data.lessons.length, opened.length + 2)).map(l => <li key={l.id} className="flex items-center gap-2">
          {paid >= l.opensAt ? <Unlock size={13} className="text-[hsl(145_55%_35%)]" /> : <LockKeyhole size={13} className="text-[hsl(var(--muted-foreground))]" />}
          <span className={paid >= l.opensAt ? '' : 'text-[hsl(var(--muted-foreground))]'}>{l.title}</span>
          {paid < l.opensAt && <span className="font-mono-ui text-xs text-[hsl(var(--muted-foreground))]">{money(l.opensAt - paid)} more</span>}
        </li>)}
      </ul>
    </section>}
  </div>;
}
