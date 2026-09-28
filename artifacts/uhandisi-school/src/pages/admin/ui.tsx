// Shared pieces for the admin portal: layout, styles, dialogs, uploads.
import { type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Award, BarChart3, BookOpen, CreditCard, DownloadCloud, FolderTree, ImagePlus, UserRound, X } from 'lucide-react';
import { ApiError } from '@/lib/auth';
import { ACCEPTED_IMAGES, uploadFile } from '@/lib/upload';

export const money = (value = 0) => `KSh ${value.toLocaleString('en-KE')}`;
export const shortDate = (iso: string) => new Date(iso).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' });
export const fileSizeLabel = (bytes?: number | null) =>
  !bytes ? '' : bytes < 1024 * 1024 ? `${Math.max(1, Math.round(bytes / 1024))} KB` : `${(bytes / 1024 / 1024).toFixed(1)} MB`;

export const field = 'mt-1.5 h-10 w-full rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-3 text-sm font-normal outline-none transition focus:border-[hsl(var(--link))] focus:ring-2 focus:ring-[hsl(var(--link)/.15)] disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))]';
export const label = 'block text-xs font-bold';
export const hint = 'font-normal text-[hsl(var(--muted-foreground))]';
export const card = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))]';
export const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60';
export const ghostBtn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:border-[hsl(var(--primary)/.4)] hover:bg-[hsl(var(--secondary))] disabled:opacity-50';
export const dangerBtn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[hsl(var(--destructive)/.3)] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold text-[hsl(var(--destructive))] transition hover:bg-[hsl(var(--destructive)/.06)] disabled:opacity-50';
export const iconBtn = 'grid size-8 place-items-center rounded-md text-[hsl(var(--muted-foreground))] transition hover:bg-[hsl(var(--secondary))] hover:text-[hsl(var(--foreground))] disabled:opacity-30';
export const th = 'px-4 py-3 text-left text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]';
export const td = 'px-4 py-3 align-middle';

const sections = [
  { href: '/admin', label: 'Dashboard', icon: BarChart3 },
  { href: '/admin/courses', label: 'Courses', icon: BookOpen },
  { href: '/admin/categories', label: 'Categories', icon: FolderTree },
  { href: '/admin/users', label: 'Users', icon: UserRound },
  { href: '/admin/payments', label: 'Payments', icon: CreditCard },
  { href: '/admin/certificates', label: 'Certificates', icon: Award },
  { href: '/admin/moodle', label: 'Import from Moodle', icon: DownloadCloud },
];

/** Site administration layout: section sidebar on the left (a scrolling tab row on phones). */
export function AdminLayout({ title, description, actions, breadcrumb, children }: {
  title: string; description?: string; actions?: ReactNode; breadcrumb?: ReactNode; children: ReactNode;
}) {
  const [location] = useLocation();
  const active = (href: string) => (href === '/admin' ? location === '/admin' : location.startsWith(href));
  // minmax(0,1fr): lets the column shrink to the screen so the section tabs scroll instead of widening the page.
  return <div className="grid grid-cols-[minmax(0,1fr)] gap-6 lg:grid-cols-[210px_minmax(0,1fr)] lg:gap-10">
    <aside className="min-w-0 lg:sticky lg:top-24 lg:h-fit">
      <p className="mb-3 hidden px-3 text-[10px] font-extrabold uppercase tracking-[.2em] text-[hsl(var(--muted-foreground))] lg:block">Site administration</p>
      <nav aria-label="Administration" className="-mx-5 flex gap-1 overflow-x-auto [scrollbar-width:none] border-b border-[hsl(var(--border))] px-5 pb-3 lg:mx-0 lg:flex-col lg:border-0 lg:px-0 lg:pb-0">
        {sections.map(({ href, label: text, icon: Icon }) => <Link key={href} href={href} aria-current={active(href) ? 'page' : undefined}
          className={`flex shrink-0 items-center gap-2.5 whitespace-nowrap rounded-md px-3 py-2.5 text-sm font-semibold transition ${active(href) ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--foreground)/.8)] hover:bg-[hsl(var(--secondary))]'}`}
          data-testid={`admin-nav-${text.toLowerCase()}`}><Icon size={16} />{text}</Link>)}
      </nav>
    </aside>
    <div className="min-w-0">
      {breadcrumb && <div className="mb-3 text-xs font-semibold text-[hsl(var(--muted-foreground))]">{breadcrumb}</div>}
      <header className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
        <div className="min-w-0"><h1 className="font-display text-2xl font-bold tracking-tight sm:text-3xl">{title}</h1>{description && <p className="mt-1.5 max-w-2xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{description}</p>}</div>
        {actions && <div className="flex shrink-0 flex-wrap gap-2">{actions}</div>}
      </header>
      {children}
    </div>
  </div>;
}

export function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">{error instanceof Error ? error.message : 'Something went wrong.'}</p>;
}

export function Loading({ height = 160 }: { height?: number }) {
  return <div className="skeleton rounded-lg bg-[hsl(var(--muted))]" style={{ height }} data-testid="state-loading" />;
}

export function Badge({ children, tone = 'muted' }: { children: ReactNode; tone?: 'muted' | 'good' | 'warn' | 'bad' | 'info' }) {
  const tones = {
    muted: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
    good: 'bg-[hsl(145_55%_40%/.12)] text-[hsl(145_55%_28%)]',
    warn: 'bg-[hsl(38_90%_50%/.16)] text-[hsl(30_80%_30%)]',
    bad: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]',
    info: 'bg-[hsl(var(--link)/.1)] text-[hsl(var(--link))]',
  };
  return <span className={`inline-flex w-fit items-center gap-1 whitespace-nowrap rounded-full px-2.5 py-0.5 text-[11px] font-bold ${tones[tone]}`}>{children}</span>;
}

/** Centered dialog; closes on Escape or the backdrop. */
export function Modal({ title, onClose, children, wide = false }: { title: string; onClose: () => void; children: ReactNode; wide?: boolean }) {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onClose(); };
    document.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => { document.removeEventListener('keydown', onKey); document.body.style.overflow = ''; };
  }, [onClose]);
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.45)] p-0 backdrop-blur-sm sm:items-center sm:p-5" onMouseDown={e => { if (e.target === e.currentTarget) onClose(); }}>
    <div role="dialog" aria-modal="true" aria-label={title} className={`max-h-[92dvh] w-full overflow-y-auto rounded-t-xl bg-[hsl(var(--card))] shadow-lift sm:rounded-xl ${wide ? 'max-w-4xl' : 'max-w-lg'}`} data-testid="dialog">
      <div className="sticky top-0 z-10 flex items-center justify-between border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4">
        <h2 className="font-display text-lg font-bold">{title}</h2>
        <button onClick={onClose} className={iconBtn} aria-label="Close" data-testid="button-close-dialog"><X size={18} /></button>
      </div>
      <div className="p-5">{children}</div>
    </div>
  </div>;
}

// The editor is large; load it only when an admin opens a form that needs it.
const RichEditor = lazy(() => import('@/components/rich-editor'));
export function EditorField(props: { value: string; onChange: (html: string) => void; height?: number }) {
  return <Suspense fallback={<div className="grid place-items-center rounded-md border border-[hsl(var(--border))] text-xs font-normal text-[hsl(var(--muted-foreground))]" style={{ height: props.height ?? 420 }}>Loading editor…</div>}>
    <RichEditor {...props} />
  </Suspense>;
}

/** Sends a file as the raw request body with upload progress (large zips). */
export function uploadWithProgress(url: string, file: File, onProgress: (pct: number) => void): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('POST', url);
    xhr.withCredentials = true;
    xhr.setRequestHeader('Content-Type', 'application/octet-stream');
    xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
    xhr.upload.onprogress = e => { if (e.lengthComputable) onProgress(Math.round((e.loaded / e.total) * 100)); };
    xhr.onload = () => {
      const data = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })();
      if (xhr.status >= 200 && xhr.status < 300) resolve(data);
      else reject(new ApiError(xhr.status, data.error || 'Upload failed. Try again.'));
    };
    xhr.onerror = () => reject(new ApiError(0, 'Upload failed: check your connection.'));
    xhr.send(file);
  });
}

/** A drop zone + button for one file, with a progress bar. */
export function FileDrop({ accept, hintText, busy, progress, onFile, testId, children }: {
  accept: string; hintText: string; busy: boolean; progress: number; onFile: (f: File) => void; testId: string; children?: ReactNode;
}) {
  const input = useRef<HTMLInputElement>(null);
  const [over, setOver] = useState(false);
  return <div
    onDragOver={e => { e.preventDefault(); setOver(true); }} onDragLeave={() => setOver(false)}
    onDrop={e => { e.preventDefault(); setOver(false); const f = e.dataTransfer.files[0]; if (f && !busy) onFile(f); }}
    className={`rounded-lg border-2 border-dashed p-5 text-center transition ${over ? 'border-[hsl(var(--link))] bg-[hsl(var(--link)/.05)]' : 'border-[hsl(var(--input))] bg-[hsl(var(--secondary)/.5)]'}`}>
    <input ref={input} type="file" accept={accept} className="hidden" onChange={e => { const f = e.target.files?.[0]; if (f) onFile(f); e.target.value = ''; }} data-testid={testId} />
    {children}
    {busy
      ? <div className="mx-auto max-w-xs"><p className="mb-2 text-xs font-bold">{progress < 100 ? `Uploading… ${progress}%` : 'Processing…'}</p><div className="h-2 overflow-hidden rounded-full bg-[hsl(var(--muted))]"><div className="h-full rounded-full bg-[hsl(var(--link))] transition-all" style={{ width: `${progress}%` }} /></div></div>
      : <><button type="button" onClick={() => input.current?.click()} className={primaryBtn}>Choose file</button><p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">or drag it here · {hintText}</p></>}
  </div>;
}

export function ImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try { onChange(await uploadFile(file)); } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className={label}>
    <p className="mb-1.5">Course image</p>
    <div className="flex flex-wrap items-center gap-4" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
      <div className="grid h-28 w-48 shrink-0 place-items-center overflow-hidden rounded-md border border-dashed border-[hsl(var(--input))] bg-[hsl(var(--secondary))]">
        {value ? <img src={value} alt="Course image preview" className="size-full object-cover" /> : <ImagePlus size={24} className="text-[hsl(var(--muted-foreground))]" />}
      </div>
      <div className="space-y-2">
        <input ref={input} type="file" accept={ACCEPTED_IMAGES} className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="input-course-image" />
        <div className="flex flex-wrap gap-2">
          <button type="button" disabled={busy} onClick={() => input.current?.click()} className={primaryBtn} data-testid="button-upload-image"><ImagePlus size={14} /> {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}</button>
          {value && <button type="button" onClick={() => onChange('')} className={ghostBtn}>Remove</button>}
        </div>
        <p className={hint}>PNG, JPEG, GIF or WebP, up to 10 MB. You can also drop a file here.</p>
        {error && <p className="font-normal text-[hsl(var(--destructive))]" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}

/** Tabs rendered as links, so each tab has its own address. */
export function Tabs({ tabs }: { tabs: Array<{ href: string; label: string; count?: number }> }) {
  const [location] = useLocation();
  return <nav className="mb-6 flex gap-1 overflow-x-auto overflow-y-hidden shadow-[inset_0_-1px_0_hsl(var(--border))] [scrollbar-width:none]" aria-label="Sections">
    {tabs.map(t => {
      const active = location === t.href;
      return <Link key={t.href} href={t.href} aria-current={active ? 'page' : undefined}
        className={`flex items-center gap-2 whitespace-nowrap border-b-2 px-4 py-2.5 text-sm font-bold transition ${active ? 'border-[hsl(var(--link))] text-[hsl(var(--foreground))]' : 'border-transparent text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`}
        data-testid={`tab-${t.label.toLowerCase()}`}>{t.label}{t.count !== undefined && <span className="rounded-full bg-[hsl(var(--muted))] px-2 text-[11px]">{t.count}</span>}</Link>;
    })}
  </nav>;
}
