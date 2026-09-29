import { useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { Award, Download, Pencil, Star, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/auth';
import { AdminLayout, Badge, card, dangerBtn, ErrorNote, field, FileDrop, ghostBtn, label, Loading, primaryBtn, shortDate, td, th } from './ui';

export type TemplateField = {
  id: string; label: string; text: string; x: number; y: number; size: number;
  font: 'helvetica' | 'helvetica-bold' | 'times' | 'times-bold' | 'times-italic' | 'times-bold-italic' | 'courier';
  color: string; align: 'left' | 'center' | 'right'; visible: boolean;
  /** qr: x/y is the centre and size the width in points; text is what it encodes. */
  type?: 'text' | 'qr';
};
export type CertTemplate = { id: number; name: string; kind: 'pdf' | 'image'; pageWidth: number; pageHeight: number; fields: TemplateField[]; isDefault: boolean; createdAt: string; courses: number };
type Issued = { id: number; code: string; studentName: string; courseTitle: string; courseId: number; percent: number | null; issuedBy: string; issuedAt: string; revoked: boolean };

/** The uploaded design as an image URL (PDF designs are drawn with PDF.js). */
export function useTemplateBackground(t: Pick<CertTemplate, 'id' | 'kind'> | undefined, width = 1400) {
  const [src, setSrc] = useState<string | null>(null);
  useEffect(() => {
    if (!t) return;
    const url = `/api/admin/certificate-templates/${t.id}/background`;
    if (t.kind !== 'pdf') { setSrc(url); return; }
    let cancelled = false;
    (async () => {
      const pdfjs = await import('pdfjs-dist/legacy/build/pdf.mjs');
      const worker = await import('pdfjs-dist/legacy/build/pdf.worker.min.mjs?url');
      pdfjs.GlobalWorkerOptions.workerSrc = worker.default;
      const doc = await pdfjs.getDocument({ url, withCredentials: true }).promise;
      const page = await doc.getPage(1);
      const base = page.getViewport({ scale: 1 });
      const viewport = page.getViewport({ scale: width / base.width });
      const canvas = document.createElement('canvas');
      canvas.width = viewport.width;
      canvas.height = viewport.height;
      await page.render({ canvasContext: canvas.getContext('2d')!, viewport }).promise;
      if (!cancelled) setSrc(canvas.toDataURL('image/png'));
    })().catch(() => !cancelled && setSrc(''));
    return () => { cancelled = true; };
  }, [t?.id, t?.kind, width]);
  return src;
}

function Thumb({ t }: { t: CertTemplate }) {
  const src = useTemplateBackground(t, 520);
  return <div className="grid place-items-center overflow-hidden rounded-t-lg bg-[hsl(var(--muted))]" style={{ aspectRatio: `${t.pageWidth} / ${t.pageHeight}` }}>
    {src ? <img src={src} alt="" className="size-full object-contain" /> : <span className="text-xs text-[hsl(var(--muted-foreground))]">Loading…</span>}
  </div>;
}

export default function AdminCertificatesPage() {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const templates = useQuery({ queryKey: ['admin', 'cert-templates'], queryFn: () => api<CertTemplate[]>('/admin/certificate-templates') });
  const issued = useQuery({ queryKey: ['admin', 'certificates'], queryFn: () => api<Issued[]>('/admin/certificates') });
  const [name, setName] = useState('');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });
  const makeDefault = useMutation({ mutationFn: (id: number) => api(`/admin/certificate-templates/${id}`, { method: 'PATCH', body: { isDefault: true } }), onSuccess: refresh });
  const remove = useMutation({ mutationFn: (id: number) => api(`/admin/certificate-templates/${id}`, { method: 'DELETE' }), onSuccess: refresh });

  const upload = async () => {
    if (!file) return;
    setBusy(true);
    setError(null);
    try {
      const xhrName = name.trim() || file.name.replace(/\.[^.]+$/, '');
      // The design goes up as the raw body; its file name and the template name travel in headers.
      const res = await new Promise<CertTemplate>((resolve, reject) => {
        const xhr = new XMLHttpRequest();
        xhr.open('POST', '/api/admin/certificate-templates');
        xhr.withCredentials = true;
        xhr.setRequestHeader('Content-Type', 'application/octet-stream');
        xhr.setRequestHeader('X-File-Name', encodeURIComponent(file.name));
        xhr.setRequestHeader('X-Template-Name', encodeURIComponent(xhrName));
        xhr.upload.onprogress = e => e.lengthComputable && setProgress(Math.round((e.loaded / e.total) * 100));
        xhr.onload = () => { const d = (() => { try { return JSON.parse(xhr.responseText); } catch { return {}; } })(); if (xhr.status < 300) resolve(d); else reject(new Error(d.error || 'Upload failed.')); };
        xhr.onerror = () => reject(new Error('Upload failed: check your connection.'));
        xhr.send(file);
      });
      setFile(null);
      setName('');
      refresh();
      navigate(`/admin/certificates/${res.id}`);
    } catch (e) { setError(e); } finally { setBusy(false); }
  };
  const list = templates.data || [];

  return <AdminLayout title="Certificates" description="Upload your own certificate design and place the student’s name, course, date and code on it. Certificates are drawn with it whenever they’re downloaded.">
    <section className={`${card} mb-8 p-5`} data-testid="upload-template">
      <h2 className="mb-1 flex items-center gap-2 font-bold"><Upload size={16} /> Upload a certificate design</h2>
      <p className="mb-4 text-sm text-[hsl(var(--muted-foreground))]">A PDF (its first page is used) or a PNG/JPEG image, e.g. made in Canva or Word. Leave the spaces for the name and details empty; you’ll place them next.</p>
      <div className="grid gap-4 md:grid-cols-[1fr_260px]">
        <FileDrop accept=".pdf,.png,.jpg,.jpeg,application/pdf,image/png,image/jpeg" busy={busy} progress={progress} onFile={f => { setFile(f); setError(null); }} hintText="PDF, PNG or JPEG, up to 20 MB" testId="input-template-file">
          {file && !busy && <p className="mb-3 text-sm font-bold">{file.name}</p>}
        </FileDrop>
        <div className="space-y-3">
          <label className={label}>Name<input value={name} onChange={e => setName(e.target.value)} placeholder="e.g. Gold certificate" className={field} data-testid="input-template-name" /></label>
          <button disabled={!file || busy} onClick={upload} className={`${primaryBtn} w-full`} data-testid="button-upload-template"><Upload size={14} /> {busy ? 'Uploading…' : 'Upload and place fields'}</button>
        </div>
      </div>
      <ErrorNote error={error} />
    </section>

    <h2 className="mb-3 font-display text-lg font-bold">Your designs</h2>
    <ErrorNote error={templates.error || makeDefault.error || remove.error} />
    {templates.isLoading ? <Loading /> : list.length === 0
      ? <p className={`${card} mb-8 p-6 text-sm text-[hsl(var(--muted-foreground))]`}>No designs yet, so certificates use the built-in Uhandisi design. Upload one above to use your own.</p>
      : <div className="mb-8 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {list.map(t => <article key={t.id} className={`${card} overflow-hidden`} data-testid={`template-${t.id}`}>
          <Thumb t={t} />
          <div className="space-y-3 p-4">
            <div className="flex flex-wrap items-center gap-2"><h3 className="font-bold">{t.name}</h3>{t.isDefault && <Badge tone="good"><Star size={11} /> Default</Badge>}</div>
            <p className="text-xs text-[hsl(var(--muted-foreground))]">{t.kind === 'pdf' ? 'PDF' : 'Image'} · {t.fields.filter(f => f.visible).length} text boxes · {t.isDefault ? 'used by every course without its own design' : t.courses ? `chosen by ${t.courses} course(s)` : 'not used by any course yet'}</p>
            <div className="flex flex-wrap gap-2">
              <Link href={`/admin/certificates/${t.id}`} className={primaryBtn} data-testid={`edit-template-${t.id}`}><Pencil size={13} /> Place fields</Link>
              {!t.isDefault && <button onClick={() => makeDefault.mutate(t.id)} className={ghostBtn}><Star size={13} /> Make default</button>}
              <button onClick={() => { if (confirm(`Delete “${t.name}”? Courses using it switch to the default design.`)) remove.mutate(t.id); }} className={dangerBtn} aria-label={`Delete ${t.name}`}><Trash2 size={13} /></button>
            </div>
          </div>
        </article>)}
      </div>}

    <h2 className="mb-3 font-display text-lg font-bold">Issued certificates</h2>
    {issued.isLoading ? <Loading /> : !issued.data?.length ? <p className={`${card} p-6 text-sm text-[hsl(var(--muted-foreground))]`}>None yet. They’re issued when students pass a course’s exams, or by hand from a course’s Results tab.</p>
      : <div className={`${card} overflow-x-auto`}><table className="w-full min-w-[680px] text-sm">
        <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Student</th><th className={th}>Course</th><th className={th}>Issued</th><th className={th}>Code</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
        <tbody>{issued.data.map(c => <tr key={c.id} className="border-b border-[hsl(var(--border))] last:border-0">
          <td className={`${td} font-semibold`}>{c.studentName}</td>
          <td className={td}><Link href={`/admin/courses/${c.courseId}/results`} className="text-[hsl(var(--link))] hover:underline">{c.courseTitle}</Link></td>
          <td className={`${td} whitespace-nowrap text-xs`}>{shortDate(c.issuedAt)} · {c.issuedBy === 'admin' ? 'by hand' : c.percent !== null ? `${Math.round(c.percent)}%` : 'earned'}</td>
          <td className={td}><span className="font-mono-ui text-xs">{c.code}</span> {c.revoked && <Badge tone="bad">Revoked</Badge>}</td>
          <td className={`${td} text-right`}>{!c.revoked && <a href={`/api/certificates/${c.code}/pdf`} className={ghostBtn} title="Download"><Download size={13} /></a>}</td>
        </tr>)}</tbody>
      </table></div>}
    <p className="mt-3 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><Award size={13} /> Anyone can check a certificate at <Link href="/verify" className="font-bold text-[hsl(var(--link))] hover:underline">/verify</Link>.</p>
  </AdminLayout>;
}
