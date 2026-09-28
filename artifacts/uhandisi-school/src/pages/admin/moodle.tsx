import { useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { AlertTriangle, CheckCircle2, DownloadCloud, RefreshCw, Search } from 'lucide-react';
import { api } from '@/lib/auth';
import { AdminLayout, Badge, card, ErrorNote, field, ghostBtn, Loading, primaryBtn, td, th } from './ui';

type Status = { configured: boolean; connected: boolean; site?: string; release?: string; files: string | null; error: string | null };
type MoodleCourse = { moodleId: number; title: string; shortname: string; category: string; visible: boolean; importable: number; skipped: string[]; importedAs: number | null };
type Job = { id: string; status: 'running' | 'done' | 'failed'; log: string[]; courseIds: number[] };

const code = 'rounded bg-[hsl(var(--muted))] px-1.5 py-0.5 font-mono-ui text-[12px]';

export default function AdminMoodlePage() {
  const client = useQueryClient();
  const status = useQuery({ queryKey: ['admin', 'moodle', 'status'], queryFn: () => api<Status>('/admin/moodle/status') });
  const connected = !!status.data?.connected;
  const courses = useQuery({ queryKey: ['admin', 'moodle', 'courses'], queryFn: () => api<MoodleCourse[]>('/admin/moodle/courses'), enabled: connected });
  const [selected, setSelected] = useState<Set<number>>(new Set());
  const [search, setSearch] = useState('');
  const [jobId, setJobId] = useState<string | null>(null);
  const job = useQuery({
    queryKey: ['admin', 'moodle', 'job', jobId],
    queryFn: () => api<Job>(`/admin/moodle/jobs/${jobId}`),
    enabled: !!jobId,
    refetchInterval: q => (q.state.data?.status === 'running' ? 1000 : false),
  });
  const start = useMutation({
    mutationFn: () => api<{ jobId: string }>('/admin/moodle/import', { method: 'POST', body: { courseIds: [...selected] } }),
    onSuccess: r => setJobId(r.jobId),
  });
  const logBox = useRef<HTMLPreElement>(null);
  useEffect(() => { logBox.current?.scrollTo({ top: logBox.current.scrollHeight }); }, [job.data?.log.length]);
  const finished = job.data && job.data.status !== 'running';
  useEffect(() => {
    if (finished) client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'auth' });
  }, [finished, client]);

  const list = (courses.data || []).filter(c => `${c.title} ${c.shortname} ${c.category}`.toLowerCase().includes(search.toLowerCase()));
  const toggle = (id: number) => setSelected(s => { const n = new Set(s); if (n.has(id)) n.delete(id); else n.add(id); return n; });
  const allShown = list.length > 0 && list.every(c => selected.has(c.moodleId));
  const running = job.data?.status === 'running' || start.isPending;

  return <AdminLayout title="Import from Moodle" description="Bring courses you already built in Moodle into this school. Moodle is only read, never changed. Importing again updates what changed; prices and visibility you set here are kept.">
    {status.isLoading ? <Loading height={120} /> : <StatusCard status={status.data!} onRetry={() => { status.refetch(); courses.refetch(); }} />}

    {connected && <section className="mt-6 space-y-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center">
        <div className="relative flex-1"><Search className="absolute left-3 top-[1.3rem] text-[hsl(var(--muted-foreground))]" size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search Moodle courses" className={`${field} pl-9`} aria-label="Search Moodle courses" /></div>
        <button disabled={selected.size === 0 || running} onClick={() => start.mutate()} className={`${primaryBtn} sm:mt-1.5`} data-testid="button-start-import"><DownloadCloud size={15} /> {running ? 'Importing…' : `Import selected (${selected.size})`}</button>
      </div>
      <ErrorNote error={courses.error || start.error} />
      {courses.isLoading ? <Loading /> : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr>
            <th className={`${th} w-10`}><input type="checkbox" checked={allShown} onChange={() => setSelected(s => { const n = new Set(s); list.forEach(c => (allShown ? n.delete(c.moodleId) : n.add(c.moodleId))); return n; })} aria-label="Select all shown" className="size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-all" /></th>
            <th className={th}>Moodle course</th><th className={th}>Category</th><th className={`${th} text-right`}>Items to import</th><th className={th}>Not supported</th><th className={th}>Here</th>
          </tr></thead>
          <tbody>
            {list.map(c => <tr key={c.moodleId} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-moodle-${c.moodleId}`}>
              <td className={td}><input type="checkbox" checked={selected.has(c.moodleId)} onChange={() => toggle(c.moodleId)} aria-label={`Select ${c.title}`} className="size-4 accent-[hsl(var(--primary))]" data-testid={`checkbox-moodle-${c.moodleId}`} /></td>
              <td className={td}><p className="font-bold">{c.title}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{c.shortname}{!c.visible && ' · hidden in Moodle'}</p></td>
              <td className={td}>{c.category}</td>
              <td className={`${td} text-right font-mono-ui`}>{c.importable}</td>
              <td className={`${td} text-xs text-[hsl(var(--muted-foreground))]`}>{c.skipped.join(', ') || '—'}</td>
              <td className={td}>{c.importedAs ? <Link href={`/admin/courses/${c.importedAs}/content`} className="text-xs font-bold text-[hsl(var(--link))] hover:underline">Imported · open</Link> : <Badge>Not yet</Badge>}</td>
            </tr>)}
            {list.length === 0 && <tr><td colSpan={6} className="p-8 text-center text-sm text-[hsl(var(--muted-foreground))]">No Moodle courses {search ? 'match' : 'found'}.</td></tr>}
          </tbody>
        </table>
      </div>}
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Imported: pages, books (one page per chapter), labels, links, files (PDFs open as a book) and SCORM / IMS packages. Not yet: quizzes, assignments, forums, grades and users.</p>
    </section>}

    {jobId && <section className={`${card} mt-6 p-4`} data-testid="import-progress">
      <h2 className="mb-2 flex items-center gap-2 text-sm font-bold">{running ? <RefreshCw size={15} className="animate-spin" /> : <CheckCircle2 size={15} className="text-[hsl(145_55%_35%)]" />}{running ? 'Importing…' : job.data?.status === 'failed' ? 'Import stopped' : 'Import finished'}</h2>
      <pre ref={logBox} className="max-h-80 overflow-auto whitespace-pre-wrap rounded-md bg-[hsl(var(--foreground))] p-3 font-mono-ui text-[12px] leading-5 text-white/90" data-testid="import-log">{job.data?.log.join('\n') || 'Starting…'}</pre>
      {finished && !!job.data?.courseIds.length && <div className="mt-3 flex flex-wrap gap-2">{job.data.courseIds.map(id => <Link key={id} href={`/admin/courses/${id}/content`} className={ghostBtn}>Open imported course #{id}</Link>)}</div>}
    </section>}
  </AdminLayout>;
}

function StatusCard({ status, onRetry }: { status: Status; onRetry: () => void }) {
  if (!status.configured) return <section className={`${card} space-y-3 p-5 text-sm leading-6`} data-testid="moodle-setup">
    <h2 className="flex items-center gap-2 font-bold"><AlertTriangle size={16} className="text-[hsl(30_80%_40%)]" /> Connect your Moodle site</h2>
    <ol className="list-decimal space-y-2 pl-5">
      <li>Open <code className={code}>artifacts/api-server/.env</code> in Notepad or VS Code.</li>
      <li>Fill in <code className={code}>MOODLE_DB_URL</code> with your Moodle database, like <code className={code}>mysql://USER:PASSWORD@HOST:3306/DATABASE</code>. Your hosting panel lists these (cPanel → MySQL Databases); Moodle’s own <code className={code}>config.php</code> has them too. Allow this computer under cPanel → <em>Remote MySQL</em>.</li>
      <li>For files (PDFs, SCORM/IMS zips, images), also fill <code className={code}>MOODLE_URL</code> (e.g. <code className={code}>https://yoursite.com/moodle</code>) and <code className={code}>MOODLE_TOKEN</code>: in Moodle go to <em>Site administration → Server → Web services → Manage tokens → Create token</em>, choose your admin user and the “Moodle mobile web service”. (Web services and the mobile service must be enabled.)</li>
      <li>Save, then close the two minimized server windows and double-click <code className={code}>start-local.cmd</code> again.</li>
    </ol>
    <button onClick={onRetry} className={ghostBtn}><RefreshCw size={14} /> Check again</button>
  </section>;
  if (!status.connected) return <section className={`${card} space-y-3 border-[hsl(var(--destructive)/.35)] p-5 text-sm`} data-testid="moodle-error">
    <h2 className="flex items-center gap-2 font-bold text-[hsl(var(--destructive))]"><AlertTriangle size={16} /> Can’t connect to Moodle</h2>
    <p>{status.error}</p>
    <p className="text-xs text-[hsl(var(--muted-foreground))]">After changing <code className={code}>.env</code>, restart with <code className={code}>start-local.cmd</code>.</p>
    <button onClick={onRetry} className={ghostBtn}><RefreshCw size={14} /> Try again</button>
  </section>;
  return <section className={`${card} flex flex-wrap items-center gap-x-6 gap-y-2 p-5 text-sm`} data-testid="moodle-connected">
    <p className="flex items-center gap-2 font-bold"><CheckCircle2 size={17} className="text-[hsl(145_55%_35%)]" /> Connected to {status.site || 'Moodle'}</p>
    {status.release && <p className="text-xs text-[hsl(var(--muted-foreground))]">Moodle {status.release}</p>}
    {status.files
      ? <Badge tone="good">Files via {status.files}</Badge>
      : <Badge tone="warn">No file access: PDFs and packages will be skipped. Add MOODLE_URL + MOODLE_TOKEN.</Badge>}
  </section>;
}
