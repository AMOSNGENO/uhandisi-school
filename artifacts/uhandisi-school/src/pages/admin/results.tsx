import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Award, Download } from 'lucide-react';
import { api } from '@/lib/auth';
import { Badge, card, dangerBtn, ErrorNote, ghostBtn, Loading, td, th } from './ui';

type Results = {
  quizzes: Array<{ id: number; title: string; countsForCertificate: boolean }>;
  students: Array<{
    id: number; name: string; email: string;
    results: Record<string, { best: number; passed: boolean; attempts: number } | null>;
    certificate: { id: number; code: string; issuedBy: string; issuedAt: string } | null;
  }>;
};

/** Gradebook for one course: best exam results per learner, and their certificate. */
export default function CourseResults({ courseId }: { courseId: number }) {
  const client = useQueryClient();
  const key = ['admin', 'results', courseId];
  const results = useQuery({ queryKey: key, queryFn: () => api<Results>(`/admin/courses/${courseId}/results`) });
  const refresh = () => client.invalidateQueries({ queryKey: key });
  const issue = useMutation({ mutationFn: (userId: number) => api(`/admin/courses/${courseId}/certificates`, { method: 'POST', body: { userId } }), onSuccess: refresh });
  const revoke = useMutation({ mutationFn: (id: number) => api(`/admin/certificates/${id}`, { method: 'DELETE' }), onSuccess: refresh });
  const r = results.data;

  return <div className="space-y-4" data-testid="course-results">
    <p className="max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">
      {r && r.quizzes.length === 0
        ? 'This course has no exams yet. Add one from the Content tab (“Add an activity or resource” → Exam). You can still issue certificates by hand.'
        : 'Each learner’s best score per exam. A certificate is issued automatically when a learner passes every exam that counts towards it; you can also issue or revoke one by hand.'}
    </p>
    <ErrorNote error={results.error || issue.error || revoke.error} />
    {results.isLoading ? <Loading /> : !r || r.students.length === 0
      ? <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>No learners yet.</p>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full text-sm" style={{ minWidth: 480 + r.quizzes.length * 130 }}>
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr>
            <th className={th}>Learner</th>
            {r.quizzes.map(q => <th key={q.id} className={`${th} text-center`} title={q.countsForCertificate ? 'Counts towards the certificate' : 'Practice: does not count'}>{q.title}{q.countsForCertificate && <Award size={11} className="ml-1 inline" />}</th>)}
            <th className={th}>Certificate</th>
          </tr></thead>
          <tbody>{r.students.map(s => <tr key={s.id} className="border-b border-[hsl(var(--border))] last:border-0" data-testid={`result-row-${s.id}`}>
            <td className={td}><p className="font-semibold">{s.name}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{s.email}</p></td>
            {r.quizzes.map(q => {
              const x = s.results[q.id];
              return <td key={q.id} className={`${td} text-center`}>{x
                ? <><p className={`font-mono-ui font-bold ${x.passed ? 'text-[hsl(145_55%_30%)]' : 'text-[hsl(var(--destructive))]'}`}>{x.best}%</p><p className="text-[11px] text-[hsl(var(--muted-foreground))]">{x.passed ? 'passed' : 'not passed'} · {x.attempts} {x.attempts === 1 ? 'try' : 'tries'}</p></>
                : <span className="text-xs text-[hsl(var(--muted-foreground))]">—</span>}</td>;
            })}
            <td className={td}>{s.certificate
              ? <div className="flex flex-wrap items-center gap-2">
                <Badge tone="good"><Award size={11} /> {s.certificate.code}</Badge>
                <a href={`/api/certificates/${s.certificate.code}/pdf`} className={ghostBtn} title="Download PDF"><Download size={13} /></a>
                <button disabled={revoke.isPending} onClick={() => { if (confirm(`Revoke ${s.name}'s certificate? The verification page will then show it as revoked.`)) revoke.mutate(s.certificate!.id); }} className={dangerBtn}>Revoke</button>
              </div>
              : <button disabled={issue.isPending} onClick={() => { if (confirm(`Issue a certificate to ${s.name} now?`)) issue.mutate(s.id); }} className={ghostBtn} data-testid={`issue-${s.id}`}><Award size={13} /> Issue</button>}
            </td>
          </tr>)}</tbody>
        </table>
      </div>}
  </div>;
}
