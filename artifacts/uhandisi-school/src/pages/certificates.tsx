import { type FormEvent, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { Award, BadgeCheck, Download, ExternalLink, SearchCheck, ShieldX } from 'lucide-react';
import { api } from '@/lib/auth';

type MyCertificate = { code: string; courseId: number; courseTitle: string; percent: number | null; issuedAt: string };
type Verification = { valid: boolean; revoked?: boolean; code?: string; studentName?: string; courseTitle?: string; percent?: number | null; issuedAt?: string };

const longDate = (iso: string) => new Date(iso).toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' });

export function CertificatesPage() {
  const certs = useQuery({ queryKey: ['certificates', 'mine'], queryFn: () => api<MyCertificate[]>('/certificates/mine') });
  const list = certs.data || [];
  return <>
    <div className="mb-8"><p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-[hsl(var(--primary))]">Your achievements</p><h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">Certificates</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">Pass a course’s exams to earn its certificate. Each one has a code anyone can check.</p></div>
    {certs.isLoading ? <div className="skeleton h-40 rounded-lg bg-[hsl(var(--muted))]" />
      : list.length === 0 ? <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="state-no-certificates"><Award className="mx-auto mb-3 text-[hsl(var(--accent))]" size={30} /><h2 className="font-display text-lg font-bold">No certificates yet</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">Finish a course and pass its exams to earn one.</p><Link href="/learning" className="mt-5 inline-flex rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">Go to my learning</Link></div>
        : <div className="grid gap-4 md:grid-cols-2" data-testid="certificate-list">
          {list.map(c => <article key={c.code} className="flex flex-col rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft">
            <div className="flex items-start gap-4">
              <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[hsl(42_90%_55%/.2)] text-[hsl(30_80%_32%)]"><Award size={24} /></span>
              <div className="min-w-0"><h2 className="font-display text-lg font-bold leading-snug">{c.courseTitle}</h2><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Issued {longDate(c.issuedAt)}{c.percent !== null ? ` · score ${Math.round(c.percent)}%` : ''}</p><p className="mt-1 font-mono-ui text-xs">{c.code}</p></div>
            </div>
            <div className="mt-5 flex flex-wrap gap-2">
              <a href={`/api/certificates/${c.code}/pdf`} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid={`download-${c.code}`}><Download size={14} /> Download PDF</a>
              <a href={`/api/certificates/${c.code}/pdf?inline`} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-bold hover:bg-[hsl(var(--secondary))]"><ExternalLink size={14} /> View</a>
              <Link href={`/verify/${c.code}`} className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-bold hover:bg-[hsl(var(--secondary))]"><BadgeCheck size={14} /> Verification page</Link>
            </div>
          </article>)}
        </div>}
  </>;
}

/** Public: anyone can check a certificate code (e.g. an employer). */
export function VerifyPage() {
  const params = useParams<{ code?: string }>();
  const [, navigate] = useLocation();
  const code = (params.code ?? '').toUpperCase();
  const [input, setInput] = useState(code);
  const check = useQuery({ queryKey: ['verify', code], queryFn: () => api<Verification>(`/certificates/verify/${encodeURIComponent(code)}`), enabled: !!code });
  const submit = (e: FormEvent) => { e.preventDefault(); if (input.trim()) navigate(`/verify/${input.trim().toUpperCase()}`); };
  const v = check.data;

  return <div className="mx-auto max-w-2xl" data-testid="verify-page">
    <div className="mb-8 text-center"><SearchCheck className="mx-auto mb-3 text-[hsl(var(--link))]" size={34} /><h1 className="font-display text-3xl font-bold tracking-tight">Verify a certificate</h1><p className="mt-2 text-sm text-[hsl(var(--muted-foreground))]">Enter the code printed at the bottom of an Uhandisi School certificate.</p></div>
    <form onSubmit={submit} className="mb-8 flex gap-2">
      <input value={input} onChange={e => setInput(e.target.value)} placeholder="UHS-XXXXXXXX" aria-label="Certificate code" className="h-12 flex-1 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-4 font-mono-ui text-sm uppercase outline-none focus:border-[hsl(var(--link))]" data-testid="input-verify-code" />
      <button className="rounded-md bg-[hsl(var(--primary))] px-5 text-sm font-bold text-[hsl(var(--primary-foreground))]">Check</button>
    </form>
    {code && (check.isLoading ? <div className="skeleton h-40 rounded-lg bg-[hsl(var(--muted))]" />
      : v?.valid ? <div className="rounded-xl border-2 border-[hsl(145_55%_40%/.5)] bg-[hsl(145_55%_40%/.06)] p-7 text-center" data-testid="verify-valid">
        <BadgeCheck className="mx-auto text-[hsl(145_55%_33%)]" size={40} />
        <p className="mt-2 text-sm font-bold uppercase tracking-[.15em] text-[hsl(145_55%_28%)]">Valid certificate</p>
        <p className="mt-4 font-display text-3xl font-bold">{v.studentName}</p>
        <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">completed</p>
        <p className="mt-1 text-xl font-bold">{v.courseTitle}</p>
        <p className="mt-4 text-sm">Issued {longDate(v.issuedAt!)}{v.percent !== null && v.percent !== undefined ? ` · final score ${Math.round(v.percent)}%` : ''}</p>
        <p className="mt-1 font-mono-ui text-xs text-[hsl(var(--muted-foreground))]">{v.code}</p>
      </div>
        : <div className="rounded-xl border-2 border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.05)] p-7 text-center" data-testid="verify-invalid">
          <ShieldX className="mx-auto text-[hsl(var(--destructive))]" size={40} />
          <p className="mt-2 font-bold">{v?.revoked ? 'This certificate has been revoked.' : 'No certificate has this code.'}</p>
          {v?.revoked && <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">It was issued to {v.studentName} for {v.courseTitle} but is no longer valid.</p>}
          {!v?.revoked && <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Check the code for typing mistakes. Codes look like UHS-ABCD2345.</p>}
        </div>)}
  </div>;
}
