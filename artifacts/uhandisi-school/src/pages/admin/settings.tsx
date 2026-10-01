import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Plus, Trash2 } from 'lucide-react';
import { api } from '@/lib/auth';
import { type PaymentPlan, type SiteSettings, SITE_SETTINGS_KEY, useSiteSettings } from '@/lib/site';
import { AdminLayout, card, ErrorNote, field, ghostBtn, iconBtn, ImageUpload, Loading, primaryBtn } from './ui';

export default function AdminSettingsPage() {
  const client = useQueryClient();
  const settings = useSiteSettings();
  // Each change saves straight away; there's nothing else on the form to wait for.
  const save = useMutation({
    mutationFn: (body: Partial<SiteSettings>) => api<SiteSettings>('/admin/site-settings', { method: 'PATCH', body }),
    // Show the change at once; put it back if saving fails.
    onMutate: body => {
      const previous = client.getQueryData<SiteSettings>(SITE_SETTINGS_KEY);
      if (previous) client.setQueryData(SITE_SETTINGS_KEY, { ...previous, ...body });
      return { previous };
    },
    onError: (_e, _body, context) => { if (context?.previous) client.setQueryData(SITE_SETTINGS_KEY, context.previous); },
    onSuccess: data => client.setQueryData(SITE_SETTINGS_KEY, data),
  });

  return <AdminLayout title="Site settings" description="How the site looks to your students, and the daily payment plans they choose from.">
    {settings.isLoading ? <Loading /> : <section className={`${card} p-5`} data-testid="settings-hero">
      <h2 className="font-bold">Homepage hero image</h2>
      <p className="mb-4 mt-1 text-sm text-[hsl(var(--muted-foreground))]">The photo behind the welcome banner students see when they log in. A wide landscape photo works best (at least 1600 × 600 pixels). The left side is darkened so the welcome text stays readable, so keep the main subject on the right.</p>
      <ImageUpload title="Image" testId="input-hero-image" previewClass="aspect-[8/3] w-full sm:w-96"
        value={settings.data?.heroImageUrl ?? ''} onChange={heroImageUrl => save.mutate({ heroImageUrl })}
        note="PNG, JPEG or WebP, up to 10 MB. Saved as soon as it's uploaded." />
      {settings.data?.heroImageUrl && <label className="mt-4 flex w-fit cursor-pointer items-start gap-2.5 text-sm">
        <input type="checkbox" checked={settings.data.heroImageFlip} onChange={e => save.mutate({ heroImageFlip: e.target.checked })} className="mt-0.5 size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-hero-flip" />
        <span><b>Mirror the photo</b><span className="block text-xs text-[hsl(var(--muted-foreground))]">Use this when the people in the photo are on the left, where the welcome text goes.</span></span>
      </label>}
      <div className="mt-3 min-h-5 text-xs">
        {save.isPending ? <span className="text-[hsl(var(--muted-foreground))]">Saving…</span>
          : save.isSuccess && <span className="inline-flex items-center gap-1.5 font-bold text-[hsl(145_55%_28%)]" role="status" data-testid="status-settings-saved"><Check size={14} /> Saved. {save.data?.heroImageUrl ? 'Students see the change on their homepage now.' : 'The homepage is back to the plain banner.'}</span>}
      </div>
      <ErrorNote error={save.error || settings.error} />
    </section>}
    {settings.data && <PlansEditor key={JSON.stringify(settings.data.paymentPlans)} plans={settings.data.paymentPlans} />}
  </AdminLayout>;
}

/** The daily plans students choose on Lipa Pole Pole courses. They set the pace only; the price is the same. */
function PlansEditor({ plans }: { plans: PaymentPlan[] }) {
  const client = useQueryClient();
  const [rows, setRows] = useState(plans.map(p => ({ ...p, amount: String(p.amountPerDay) })));
  const save = useMutation({
    mutationFn: () => api<SiteSettings>('/admin/site-settings', {
      method: 'PATCH',
      body: { paymentPlans: rows.map(r => ({ id: r.id, name: r.name.trim(), amountPerDay: Math.round(Number(r.amount)) })) },
    }),
    onSuccess: data => { client.setQueryData(SITE_SETTINGS_KEY, data); client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'site-settings' }); },
  });
  const changed = JSON.stringify(rows.map(r => [r.id, r.name, r.amount])) !== JSON.stringify(plans.map(p => [p.id, p.name, String(p.amountPerDay)]));
  // New plans get an id from their name; existing ones keep theirs, so students' chosen plans stay linked.
  const add = () => {
    const taken = new Set(rows.map(r => r.id));
    let id = 'plan';
    for (let n = rows.length + 1; taken.has(id); n++) id = `plan-${n}`;
    setRows(r => [...r, { id, name: '', amountPerDay: 0, amount: '' }]);
  };
  return <section className={`${card} mt-6 p-5`} data-testid="settings-plans">
    <h2 className="font-bold">Daily payment plans</h2>
    <p className="mb-4 mt-1 text-sm text-[hsl(var(--muted-foreground))]">Students on Lipa Pole Pole courses pick one of these. A plan only sets their pace: everyone pays the same course price, and higher plans finish paying sooner. The smallest plan is also how much a student must pay towards a lesson to open it.</p>
    <div className="space-y-2">
      {rows.map((r, i) => <div key={r.id} className="flex flex-wrap items-center gap-2">
        <div className="w-44"><input value={r.name} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, name: e.target.value } : y))} placeholder="Plan name" className={`${field} mt-0`} aria-label="Plan name" data-testid={`input-plan-name-${i}`} /></div>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">KSh</span>
        <div className="w-28"><input type="number" min={100} value={r.amount} onChange={e => setRows(x => x.map((y, j) => j === i ? { ...y, amount: e.target.value } : y))} className={`${field} mt-0 font-mono-ui`} aria-label={`${r.name || 'Plan'} amount per day`} data-testid={`input-plan-amount-${i}`} /></div>
        <span className="text-sm text-[hsl(var(--muted-foreground))]">a day</span>
        {rows.length > 1 && <button type="button" onClick={() => setRows(x => x.filter((_, j) => j !== i))} className={iconBtn} aria-label={`Remove ${r.name || 'plan'}`}><Trash2 size={14} /></button>}
      </div>)}
    </div>
    <div className="mt-4 flex flex-wrap items-center gap-2">
      {rows.length < 6 && <button type="button" onClick={add} className={ghostBtn}><Plus size={13} /> Add a plan</button>}
      <button type="button" disabled={!changed || save.isPending} onClick={() => save.mutate()} className={primaryBtn} data-testid="button-save-plans">{save.isPending ? 'Saving…' : 'Save plans'}</button>
      {save.isSuccess && !changed && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[hsl(145_55%_28%)]" role="status"><Check size={14} /> Saved</span>}
    </div>
    <ErrorNote error={save.error} />
  </section>;
}
