import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check } from 'lucide-react';
import { api } from '@/lib/auth';
import { type SiteSettings, SITE_SETTINGS_KEY, useSiteSettings } from '@/lib/site';
import { AdminLayout, card, ErrorNote, ImageUpload, Loading } from './ui';

export default function AdminSettingsPage() {
  const client = useQueryClient();
  const settings = useSiteSettings();
  // Each change saves straight away; there's nothing else on the form to wait for.
  const save = useMutation({
    mutationFn: (body: Partial<SiteSettings>) => api<SiteSettings>('/admin/site-settings', { method: 'PATCH', body }),
    onSuccess: data => client.setQueryData(SITE_SETTINGS_KEY, data),
  });

  return <AdminLayout title="Site settings" description="How the site looks to your students.">
    {settings.isLoading ? <Loading /> : <section className={`${card} p-5`} data-testid="settings-hero">
      <h2 className="font-bold">Homepage hero image</h2>
      <p className="mb-4 mt-1 text-sm text-[hsl(var(--muted-foreground))]">The photo behind the welcome banner students see when they log in. A wide landscape photo works best (at least 1600 × 600 pixels). The left side is darkened so the welcome text stays readable, so keep the main subject on the right.</p>
      <ImageUpload title="Image" testId="input-hero-image" previewClass="aspect-[8/3] w-full sm:w-96"
        value={settings.data?.heroImageUrl ?? ''} onChange={heroImageUrl => save.mutate({ heroImageUrl })}
        note="PNG, JPEG or WebP, up to 10 MB. Saved as soon as it's uploaded." />
      <div className="mt-3 min-h-5 text-xs">
        {save.isPending ? <span className="text-[hsl(var(--muted-foreground))]">Saving…</span>
          : save.isSuccess && <span className="inline-flex items-center gap-1.5 font-bold text-[hsl(145_55%_28%)]" role="status" data-testid="status-settings-saved"><Check size={14} /> Saved. {save.data?.heroImageUrl ? 'Students see it on their homepage now.' : 'The homepage is back to the plain banner.'}</span>}
      </div>
      <ErrorNote error={save.error || settings.error} />
    </section>}
  </AdminLayout>;
}
