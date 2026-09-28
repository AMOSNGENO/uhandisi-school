import { type FormEvent, useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowDown, ArrowUp, CircleDot, ListChecks, Plus, Save, ToggleLeft, Trash2, X } from 'lucide-react';
import { api } from '@/lib/auth';
import type { AdminActivity } from './types';
import { Badge, EditorField, ErrorNote, field, ghostBtn, hint, iconBtn, label, Loading, Modal, primaryBtn, shortDate, td, th } from './ui';

type Settings = {
  passMark: number; timeLimitMinutes: number | null; maxAttempts: number | null; shuffle: boolean;
  showAnswers: 'after_submit' | 'after_pass' | 'never'; requiredForCertificate: boolean;
};
type EditOption = { key: string; id?: number; text: string; correct: boolean };
type EditQuestion = { key: string; id?: number; type: 'single' | 'multiple'; text: string; points: number; explanation: string; options: EditOption[] };

const defaults: Settings = { passMark: 50, timeLimitMinutes: null, maxAttempts: null, shuffle: false, showAnswers: 'after_submit', requiredForCertificate: true };
let seq = 0;
const k = () => `k${++seq}`;
const blankQuestion = (type: 'single' | 'multiple' | 'truefalse'): EditQuestion => type === 'truefalse'
  ? { key: k(), type: 'single', text: '', points: 1, explanation: '', options: [{ key: k(), text: 'True', correct: true }, { key: k(), text: 'False', correct: false }] }
  : { key: k(), type, text: '', points: 1, explanation: '', options: [1, 2, 3, 4].map(() => ({ key: k(), text: '', correct: false })) };

/** Same checks as the server, so mistakes are pointed out before saving. */
function problems(questions: EditQuestion[]) {
  for (const [i, q] of questions.entries()) {
    const n = `Question ${i + 1}`;
    const opts = q.options.filter(o => o.text.trim());
    if (!q.text.trim()) return `${n}: type the question.`;
    if (opts.length < 2) return `${n}: add at least two answer options.`;
    const right = opts.filter(o => o.correct).length;
    if (q.type === 'single' && right !== 1) return `${n}: mark exactly one correct answer.`;
    if (q.type === 'multiple' && right < 1) return `${n}: mark at least one correct answer.`;
  }
  return '';
}

export function QuizEditor({ moduleId, activity, onDone, onClose }: {
  moduleId: number; activity?: AdminActivity; onDone: (list: AdminActivity[]) => void; onClose: () => void;
}) {
  const client = useQueryClient();
  const [id, setId] = useState<number | undefined>(activity?.id);
  const existing = useQuery({ queryKey: ['admin', 'quiz', activity?.id], queryFn: () => api<{ settings: Settings; questions: Array<Omit<EditQuestion, 'key' | 'options' | 'explanation'> & { explanation: string | null; options: Array<{ id: number; text: string; correct: boolean }> }> }>(`/admin/lessons/${activity!.id}/quiz`), enabled: !!activity });
  const [title, setTitle] = useState(activity?.title ?? '');
  const [intro, setIntro] = useState(activity?.contentHtml ?? '');
  const [settings, setSettings] = useState<Settings>(defaults);
  const [questions, setQuestions] = useState<EditQuestion[]>(activity ? [] : [blankQuestion('single')]);
  const [error, setError] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!existing.data) return;
    setSettings(existing.data.settings);
    setQuestions(existing.data.questions.map(q => ({ ...q, key: k(), explanation: q.explanation ?? '', options: q.options.map(o => ({ ...o, key: k() })) })));
  }, [existing.data]);

  const setQ = (key: string, change: (q: EditQuestion) => EditQuestion) => setQuestions(qs => qs.map(q => (q.key === key ? change(q) : q)));
  const move = (i: number, d: number) => setQuestions(qs => { const a = [...qs]; const [x] = a.splice(i, 1); a.splice(i + d, 0, x!); return a; });
  const setS = <K extends keyof Settings>(key: K, value: Settings[K]) => setSettings(s => ({ ...s, [key]: value }));
  const totalPoints = questions.reduce((n, q) => n + (Number(q.points) || 0), 0);

  const save = async (e: FormEvent) => {
    e.preventDefault();
    const problem = problems(questions);
    if (problem) { setError(new Error(problem)); return; }
    setBusy(true);
    setError(null);
    try {
      let list = id
        ? await api<AdminActivity[]>(`/admin/lessons/${id}`, { method: 'PATCH', body: { title, kind: 'quiz', contentHtml: intro } })
        : await api<AdminActivity[]>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body: { title, kind: 'quiz', contentHtml: intro } });
      const lessonId = id ?? Math.max(...list.map(l => l.id));
      setId(lessonId);
      await api(`/admin/lessons/${lessonId}/quiz`, {
        method: 'PUT',
        body: { settings, questions: questions.map(q => ({ id: q.id, type: q.type, text: q.text, points: Number(q.points) || 1, explanation: q.explanation || null, options: q.options.filter(o => o.text.trim()).map(o => ({ id: o.id, text: o.text, correct: o.correct })) })) },
      });
      list = await api<AdminActivity[]>(`/admin/modules/${moduleId}/lessons`);
      client.invalidateQueries({ queryKey: ['admin', 'quiz', lessonId] });
      onDone(list);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={activity ? `Edit exam: ${activity.title}` : 'Add an exam'} onClose={() => !busy && onClose()} wide>
    {activity && existing.isLoading ? <Loading /> : <form onSubmit={save} className="space-y-6" data-testid="form-quiz">
      <div className="grid gap-4 sm:grid-cols-[1fr_auto]">
        <label className={label}>Exam name<input required autoFocus value={title} onChange={e => setTitle(e.target.value)} className={field} placeholder="e.g. Final exam" data-testid="input-quiz-title" /></label>
        <div className="flex items-end gap-2 pb-0.5"><Badge tone="info">{questions.length} questions</Badge><Badge>{totalPoints} points</Badge></div>
      </div>
      <div className={label}><p className="mb-1.5">Instructions <span className={hint}>(optional, shown before students start)</span></p><EditorField value={intro} onChange={setIntro} height={160} /></div>

      <fieldset className="grid gap-4 rounded-lg border border-[hsl(var(--border))] p-4 sm:grid-cols-3" data-testid="quiz-settings">
        <legend className="px-1 text-sm font-bold">Settings</legend>
        <label className={label}>Pass mark (%)<input type="number" min={0} max={100} required value={settings.passMark} onChange={e => setS('passMark', Number(e.target.value))} className={field} data-testid="input-pass-mark" /></label>
        <label className={label}>Time limit (minutes)<input type="number" min={1} max={600} value={settings.timeLimitMinutes ?? ''} onChange={e => setS('timeLimitMinutes', e.target.value ? Number(e.target.value) : null)} placeholder="No limit" className={field} data-testid="input-time-limit" /></label>
        <label className={label}>Attempts allowed<input type="number" min={1} max={100} value={settings.maxAttempts ?? ''} onChange={e => setS('maxAttempts', e.target.value ? Number(e.target.value) : null)} placeholder="Unlimited" className={field} data-testid="input-max-attempts" /></label>
        <label className={label}>Show correct answers
          <select value={settings.showAnswers} onChange={e => setS('showAnswers', e.target.value as Settings['showAnswers'])} className={field}>
            <option value="after_submit">After each attempt</option><option value="after_pass">Only once passed</option><option value="never">Never</option>
          </select></label>
        <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" checked={settings.shuffle} onChange={e => setS('shuffle', e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" /> Shuffle questions and answers</label>
        <label className="flex items-center gap-2 text-sm sm:mt-6"><input type="checkbox" checked={settings.requiredForCertificate} onChange={e => setS('requiredForCertificate', e.target.checked)} className="size-4 accent-[hsl(var(--primary))]" data-testid="checkbox-counts-certificate" /> Counts towards the certificate</label>
      </fieldset>

      <div className="space-y-4">
        {questions.map((q, i) => <section key={q.key} className="rounded-lg border border-[hsl(var(--border))] p-4" data-testid={`edit-question-${i + 1}`}>
          <div className="mb-3 flex flex-wrap items-center gap-2">
            <span className="text-sm font-bold">Question {i + 1}</span>
            <select value={q.type} onChange={e => { const type = e.target.value as EditQuestion['type']; setQ(q.key, x => ({ ...x, type, options: type === 'single' ? x.options.map((o, j) => ({ ...o, correct: o.correct && j === x.options.findIndex(p => p.correct) })) : x.options })); }}
              className="h-8 rounded-md border border-[hsl(var(--input))] bg-[hsl(var(--card))] px-2 text-xs font-bold" aria-label="Question type">
              <option value="single">One correct answer</option><option value="multiple">Several correct answers</option>
            </select>
            <label className="flex items-center gap-1.5 text-xs font-bold">Points<input type="number" min={1} max={100} value={q.points} onChange={e => setQ(q.key, x => ({ ...x, points: Number(e.target.value) }))} className="h-8 w-16 rounded-md border border-[hsl(var(--input))] px-2 text-sm font-normal" /></label>
            <span className="ml-auto flex">
              <button type="button" disabled={i === 0} onClick={() => move(i, -1)} className={iconBtn} aria-label="Move question up"><ArrowUp size={15} /></button>
              <button type="button" disabled={i === questions.length - 1} onClick={() => move(i, 1)} className={iconBtn} aria-label="Move question down"><ArrowDown size={15} /></button>
              <button type="button" onClick={() => setQuestions(qs => qs.filter(x => x.key !== q.key))} className={`${iconBtn} hover:text-[hsl(var(--destructive))]`} aria-label="Delete question"><Trash2 size={15} /></button>
            </span>
          </div>
          <textarea required value={q.text} onChange={e => setQ(q.key, x => ({ ...x, text: e.target.value }))} rows={2} placeholder="Type the question" className={`${field} mt-0 h-auto py-2`} aria-label={`Question ${i + 1} text`} data-testid={`input-question-${i + 1}`} />
          <p className="mb-2 mt-3 text-xs text-[hsl(var(--muted-foreground))]">{q.type === 'single' ? 'Answers: select the one correct answer.' : 'Answers: tick every correct answer. Students get partial marks.'}</p>
          <ul className="space-y-2">
            {q.options.map((o, j) => <li key={o.key} className="flex items-center gap-2">
              <input type={q.type === 'single' ? 'radio' : 'checkbox'} name={`correct-${q.key}`} checked={o.correct}
                onChange={() => setQ(q.key, x => ({ ...x, options: x.options.map(p => (q.type === 'single' ? { ...p, correct: p.key === o.key } : p.key === o.key ? { ...p, correct: !p.correct } : p)) }))}
                className="size-4 shrink-0 accent-[hsl(145_55%_35%)]" aria-label={`Answer ${j + 1} is correct`} data-testid={`correct-${i + 1}-${j + 1}`} />
              <input value={o.text} onChange={e => setQ(q.key, x => ({ ...x, options: x.options.map(p => (p.key === o.key ? { ...p, text: e.target.value } : p)) }))}
                placeholder={`Answer ${j + 1}`} className={`${field} mt-0 h-9 ${o.correct ? 'border-[hsl(145_55%_40%/.6)] bg-[hsl(145_55%_40%/.05)]' : ''}`} aria-label={`Answer ${j + 1}`} data-testid={`option-${i + 1}-${j + 1}`} />
              <button type="button" disabled={q.options.length <= 2} onClick={() => setQ(q.key, x => ({ ...x, options: x.options.filter(p => p.key !== o.key) }))} className={iconBtn} aria-label={`Remove answer ${j + 1}`}><X size={14} /></button>
            </li>)}
          </ul>
          <div className="mt-2 flex flex-wrap items-center justify-between gap-2">
            <button type="button" disabled={q.options.length >= 10} onClick={() => setQ(q.key, x => ({ ...x, options: [...x.options, { key: k(), text: '', correct: false }] }))} className="text-xs font-bold text-[hsl(var(--link))] hover:underline disabled:opacity-40"><Plus size={12} className="mr-1 inline" />Add answer</button>
          </div>
          <details className="mt-3" open={!!q.explanation}>
            <summary className="cursor-pointer text-xs font-bold text-[hsl(var(--muted-foreground))]">Explanation shown after answering (optional)</summary>
            <textarea value={q.explanation} onChange={e => setQ(q.key, x => ({ ...x, explanation: e.target.value }))} rows={2} className={`${field} h-auto py-2`} aria-label="Explanation" />
          </details>
        </section>)}
        {questions.length === 0 && <p className="rounded-lg border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No questions yet. Add one below.</p>}
        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => setQuestions(qs => [...qs, blankQuestion('single')])} className={ghostBtn} data-testid="add-single"><CircleDot size={14} /> Single answer</button>
          <button type="button" onClick={() => setQuestions(qs => [...qs, blankQuestion('multiple')])} className={ghostBtn} data-testid="add-multiple"><ListChecks size={14} /> Multiple answers</button>
          <button type="button" onClick={() => setQuestions(qs => [...qs, blankQuestion('truefalse')])} className={ghostBtn} data-testid="add-truefalse"><ToggleLeft size={14} /> True / False</button>
        </div>
      </div>

      <ErrorNote error={error} />
      <div className="sticky bottom-0 -mx-5 -mb-5 flex justify-end gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--card))] px-5 py-4">
        <button type="button" disabled={busy} onClick={onClose} className={ghostBtn}>Cancel</button>
        <button disabled={busy} className={primaryBtn} data-testid="button-save-quiz"><Save size={14} /> {busy ? 'Saving…' : 'Save exam'}</button>
      </div>
    </form>}
  </Modal>;
}

type AttemptRow = { id: number; name: string; email: string; submittedAt: string; percent: number | null; passed: boolean; score: number | null; maxScore: number | null };

export function QuizAttempts({ lessonId, title, onClose }: { lessonId: number; title: string; onClose: () => void }) {
  const attempts = useQuery({ queryKey: ['admin', 'attempts', lessonId], queryFn: () => api<AttemptRow[]>(`/admin/lessons/${lessonId}/attempts`) });
  const list = attempts.data || [];
  return <Modal title={`Results: ${title}`} onClose={onClose} wide>
    <ErrorNote error={attempts.error} />
    {attempts.isLoading ? <Loading /> : list.length === 0 ? <p className="p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">Nobody has taken this exam yet.</p>
      : <div className="overflow-x-auto"><table className="w-full min-w-[560px] text-sm" data-testid="quiz-attempts">
        <thead className="border-b border-[hsl(var(--border))]"><tr><th className={th}>Student</th><th className={th}>Submitted</th><th className={`${th} text-right`}>Score</th><th className={th}>Result</th></tr></thead>
        <tbody>{list.map(a => <tr key={a.id} className="border-b border-[hsl(var(--border))] last:border-0">
          <td className={td}><p className="font-semibold">{a.name}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{a.email}</p></td>
          <td className={`${td} whitespace-nowrap text-xs`}>{shortDate(a.submittedAt)}</td>
          <td className={`${td} text-right font-mono-ui`}>{a.percent}% <span className="text-xs text-[hsl(var(--muted-foreground))]">({a.score}/{a.maxScore})</span></td>
          <td className={td}>{a.passed ? <Badge tone="good">Passed</Badge> : <Badge tone="bad">Not passed</Badge>}</td>
        </tr>)}</tbody>
      </table></div>}
  </Modal>;
}
