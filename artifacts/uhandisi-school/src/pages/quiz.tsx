// Taking an exam: rules → answering (autosaved, timed) → result with review and certificate.
import { useCallback, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { Award, Check, CheckCircle2, Clock3, Download, RotateCcw, XCircle } from 'lucide-react';
import { api } from '@/lib/auth';

type Overview = {
  title: string; questionCount: number; totalPoints: number;
  settings: { passMark: number; timeLimitMinutes: number | null; maxAttempts: number | null; showAnswers: string; requiredForCertificate: boolean };
  attemptsUsed: number; attemptsLeft: number | null; best: number | null; passed: boolean; openAttemptId: number | null;
  attempts: Array<{ id: number; submittedAt: string; percent: number | null; passed: boolean }>;
  certificate: { code: string } | null;
};
type Attempt = {
  id: number; deadline: string | null; serverNow: string; answers: Record<string, number[]>;
  questions: Array<{ id: number; type: 'single' | 'multiple'; text: string; points: number; options: Array<{ id: number; text: string }> }>;
};
type Result = {
  id: number; percent: number; passed: boolean; score: number; maxScore: number; passMark: number; submittedAt: string;
  review: Array<{ questionId: number; type: string; text: string; points: number; earned: number; explanation: string | null; chosen: number[]; options: Array<{ id: number; text: string; correct: boolean }> }> | null;
  reviewHidden: string | null; certificate: { code: string } | null;
};

const btn = 'inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-5 py-3 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60';
const ghost = 'inline-flex items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 py-2.5 text-sm font-bold transition hover:bg-[hsl(var(--secondary))]';

export default function QuizActivity({ lessonId, intro }: { lessonId: number; intro: React.ReactNode }) {
  const client = useQueryClient();
  const overview = useQuery({ queryKey: ['quiz', lessonId], queryFn: () => api<Overview>(`/quizzes/${lessonId}`) });
  const [attempt, setAttempt] = useState<Attempt | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState('');
  const [starting, setStarting] = useState(false);

  const start = async () => {
    setStarting(true);
    setError('');
    try { setResult(null); setAttempt(await api<Attempt>(`/quizzes/${lessonId}/attempts`, { method: 'POST' })); window.scrollTo({ top: 0 }); }
    catch (e) { setError(e instanceof Error ? e.message : 'Could not start the exam.'); }
    finally { setStarting(false); }
  };
  const finished = (r: Result) => {
    setAttempt(null);
    setResult(r);
    client.invalidateQueries({ queryKey: ['quiz', lessonId] });
    client.invalidateQueries({ queryKey: ['certificates'] });
    client.invalidateQueries({ queryKey: ['module'] });
    window.scrollTo({ top: 0 });
  };
  const openResult = async (id: number) => { try { setResult(await api<Result>(`/attempts/${id}`)); } catch (e) { setError(e instanceof Error ? e.message : 'Could not load that result.'); } };

  if (overview.isLoading) return <div className="skeleton h-48 rounded-lg bg-[hsl(var(--muted))]" />;
  if (overview.error || !overview.data) return <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-4 text-sm text-[hsl(var(--destructive))]" role="alert">{(overview.error as Error)?.message ?? 'This exam could not be opened.'}</p>;
  const o = overview.data;

  if (attempt) return <TakeExam attempt={attempt} onDone={finished} />;
  if (result) return <ResultView result={result} canRetry={o.attemptsLeft !== 0} onRetry={start} onBack={() => setResult(null)} />;

  const canStart = o.questionCount > 0 && (o.attemptsLeft === null || o.attemptsLeft > 0 || !!o.openAttemptId);
  return <div data-testid="quiz-overview">
    {intro}
    {o.certificate && <CertificateBanner code={o.certificate.code} />}
    <dl className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
      {[
        ['Questions', `${o.questionCount} (${o.totalPoints} points)`],
        ['Pass mark', `${o.settings.passMark}%`],
        ['Time limit', o.settings.timeLimitMinutes ? `${o.settings.timeLimitMinutes} minutes` : 'None'],
        ['Attempts', o.settings.maxAttempts ? `${o.attemptsUsed} of ${o.settings.maxAttempts} used` : `${o.attemptsUsed} used · unlimited`],
      ].map(([k, v]) => <div key={k} className="rounded-lg border border-[hsl(var(--border))] p-4"><dt className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{k}</dt><dd className="mt-1 font-bold">{v}</dd></div>)}
    </dl>
    {o.best !== null && <p className="mt-4 flex items-center gap-2 text-sm">{o.passed ? <CheckCircle2 size={17} className="text-[hsl(145_55%_35%)]" /> : <XCircle size={17} className="text-[hsl(var(--destructive))]" />}Your best score: <strong>{o.best}%</strong> {o.passed ? '(passed)' : `(pass mark ${o.settings.passMark}%)`}</p>}
    {o.settings.requiredForCertificate && !o.certificate && <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]"><Award size={13} className="mr-1 inline" />Passing this exam counts towards the course certificate.</p>}
    {error && <p className="mt-4 rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>}
    <div className="mt-6 flex flex-wrap items-center gap-3">
      {o.questionCount === 0 ? <p className="text-sm text-[hsl(var(--muted-foreground))]">This exam has no questions yet.</p>
        : canStart ? <button onClick={start} disabled={starting} className={btn} data-testid="button-start-exam">{starting ? 'Opening…' : o.openAttemptId ? 'Continue exam' : o.attemptsUsed ? 'Try again' : 'Start exam'}</button>
          : <p className="text-sm font-bold text-[hsl(var(--muted-foreground))]">You have used all your attempts.</p>}
      {o.settings.timeLimitMinutes && canStart && !o.openAttemptId && <p className="flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><Clock3 size={13} />The timer starts when you press Start and doesn’t stop if you leave.</p>}
    </div>
    {o.attempts.length > 0 && <div className="mt-8">
      <h3 className="mb-2 text-sm font-bold">Your attempts</h3>
      <ul className="divide-y divide-[hsl(var(--border))] rounded-lg border border-[hsl(var(--border))] text-sm">
        {o.attempts.map((a, i) => <li key={a.id} className="flex items-center justify-between gap-3 px-4 py-2.5">
          <span>Attempt {o.attempts.length - i} · {new Date(a.submittedAt).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })}</span>
          <span className="flex items-center gap-3"><strong className={a.passed ? 'text-[hsl(145_55%_30%)]' : 'text-[hsl(var(--destructive))]'}>{a.percent}%</strong><button onClick={() => openResult(a.id)} className="text-xs font-bold text-[hsl(var(--link))] hover:underline">Review</button></span>
        </li>)}
      </ul>
    </div>}
  </div>;
}

function CertificateBanner({ code }: { code: string }) {
  return <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-[hsl(38_70%_55%/.5)] bg-[hsl(42_90%_60%/.12)] p-4" data-testid="certificate-banner">
    <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[hsl(42_90%_55%/.25)] text-[hsl(30_80%_32%)]"><Award size={22} /></span>
    <div className="min-w-0 flex-1"><p className="font-bold">You’ve earned your certificate!</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Certificate code {code}</p></div>
    <a href={`/api/certificates/${code}/pdf`} className={btn} data-testid="link-download-certificate"><Download size={15} /> Download PDF</a>
    <Link href="/certificates" className={ghost}>All certificates</Link>
  </div>;
}

function TakeExam({ attempt, onDone }: { attempt: Attempt; onDone: (r: Result) => void }) {
  const [answers, setAnswers] = useState<Record<string, number[]>>(attempt.answers);
  const [saving, setSaving] = useState<'idle' | 'saving' | 'saved' | 'offline'>('idle');
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  // Server time minus local time, so the countdown is right even if this computer's clock is off.
  const skew = useRef(new Date(attempt.serverNow).getTime() - Date.now());
  const deadline = attempt.deadline ? new Date(attempt.deadline).getTime() : null;
  const [left, setLeft] = useState(() => (deadline ? deadline - (Date.now() + skew.current) : null));
  const answersRef = useRef(answers);
  answersRef.current = answers;

  const submit = useCallback(async (auto = false) => {
    if (submitting) return;
    setSubmitting(true);
    setError('');
    try { onDone(await api<Result>(`/attempts/${attempt.id}/submit`, { method: 'POST', body: { answers: answersRef.current } })); }
    catch (e) { setError(`${auto ? 'Time is up, but ' : ''}${e instanceof Error ? e.message : 'the exam could not be submitted.'} Try again.`); setSubmitting(false); }
  }, [attempt.id, onDone, submitting]);

  // Autosave shortly after each change.
  useEffect(() => {
    if (answers === attempt.answers) return;
    setSaving('saving');
    const t = setTimeout(() => {
      api(`/attempts/${attempt.id}`, { method: 'PATCH', body: { answers } }).then(() => setSaving('saved')).catch(() => setSaving('offline'));
    }, 700);
    return () => clearTimeout(t);
  }, [answers, attempt.id, attempt.answers]);

  // Countdown; submits by itself when time runs out.
  useEffect(() => {
    if (deadline === null) return;
    const tick = setInterval(() => {
      const remaining = deadline - (Date.now() + skew.current);
      setLeft(remaining);
      if (remaining <= 0) { clearInterval(tick); submit(true); }
    }, 500);
    return () => clearInterval(tick);
  }, [deadline, submit]);

  const choose = (qid: number, optId: number, multiple: boolean) => setAnswers(a => {
    const cur = a[qid] ?? [];
    return { ...a, [qid]: multiple ? (cur.includes(optId) ? cur.filter(x => x !== optId) : [...cur, optId]) : [optId] };
  });
  const answered = attempt.questions.filter(q => (answers[q.id] ?? []).length > 0).length;
  const finish = () => {
    const missing = attempt.questions.length - answered;
    if (missing > 0 && !confirm(`You haven't answered ${missing} question${missing === 1 ? '' : 's'}. Submit anyway?`)) return;
    submit();
  };
  const mm = left === null ? '' : `${Math.floor(Math.max(0, left) / 60000)}:${String(Math.floor((Math.max(0, left) % 60000) / 1000)).padStart(2, '0')}`;
  const urgent = left !== null && left < 60_000;

  return <div data-testid="exam-taking">
    <div className="sticky top-[76px] z-10 -mx-2 mb-6 flex flex-wrap items-center justify-between gap-3 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card)/.97)] px-4 py-3 shadow-soft backdrop-blur">
      <span className="text-sm font-bold">Answered {answered} of {attempt.questions.length}</span>
      <span className="text-xs text-[hsl(var(--muted-foreground))]" aria-live="polite">{saving === 'saving' ? 'Saving…' : saving === 'saved' ? 'All answers saved' : saving === 'offline' ? 'Not saved: check your connection' : ''}</span>
      {left !== null && <span className={`flex items-center gap-1.5 rounded-full px-3 py-1 font-mono-ui text-sm font-bold ${urgent ? 'bg-[hsl(var(--destructive)/.12)] text-[hsl(var(--destructive))]' : 'bg-[hsl(var(--secondary))]'}`} data-testid="exam-timer" aria-label="Time left"><Clock3 size={14} />{mm}</span>}
    </div>
    <ol className="space-y-5">
      {attempt.questions.map((q, i) => {
        const picked = answers[q.id] ?? [];
        const multiple = q.type === 'multiple';
        return <li key={q.id} className="rounded-lg border border-[hsl(var(--border))] p-5" data-testid={`question-${i + 1}`}>
          <fieldset>
            <legend className="mb-1 flex w-full items-start justify-between gap-3">
              <span className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--link))]">Question {i + 1}</span>
              <span className="text-xs text-[hsl(var(--muted-foreground))]">{q.points} {q.points === 1 ? 'point' : 'points'}</span>
            </legend>
            <p className="mb-1 whitespace-pre-wrap text-base font-semibold">{q.text}</p>
            <p className="mb-3 text-xs text-[hsl(var(--muted-foreground))]">{multiple ? 'Choose all that apply.' : 'Choose one answer.'}</p>
            <div className="space-y-2">
              {q.options.map(o => {
                const on = picked.includes(o.id);
                return <label key={o.id} className={`flex cursor-pointer items-start gap-3 rounded-md border p-3 transition ${on ? 'border-[hsl(var(--link))] bg-[hsl(var(--link)/.06)]' : 'border-[hsl(var(--border))] hover:bg-[hsl(var(--secondary))]'}`}>
                  <input type={multiple ? 'checkbox' : 'radio'} name={`q${q.id}`} checked={on} onChange={() => choose(q.id, o.id, multiple)} className="mt-0.5 size-4 shrink-0 accent-[hsl(var(--link))]" />
                  <span className="whitespace-pre-wrap text-sm">{o.text}</span>
                </label>;
              })}
            </div>
          </fieldset>
        </li>;
      })}
    </ol>
    {error && <p className="mt-4 rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-sm text-[hsl(var(--destructive))]" role="alert">{error}</p>}
    <div className="mt-6 flex justify-end"><button onClick={finish} disabled={submitting} className={btn} data-testid="button-submit-exam">{submitting ? 'Submitting…' : 'Submit exam'}</button></div>
  </div>;
}

function ResultView({ result, canRetry, onRetry, onBack }: { result: Result; canRetry: boolean; onRetry: () => void; onBack: () => void }) {
  return <div data-testid="exam-result">
    <div className={`mb-6 rounded-lg p-6 text-center ${result.passed ? 'bg-[hsl(145_55%_40%/.1)]' : 'bg-[hsl(var(--destructive)/.07)]'}`}>
      {result.passed ? <CheckCircle2 size={38} className="mx-auto text-[hsl(145_55%_35%)]" /> : <XCircle size={38} className="mx-auto text-[hsl(var(--destructive))]" />}
      <p className="mt-2 font-display text-4xl font-bold" data-testid="result-percent">{result.percent}%</p>
      <p className="mt-1 text-sm">{result.passed ? 'Well done, you passed!' : `Not passed this time. The pass mark is ${result.passMark}%.`}</p>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{result.score} of {result.maxScore} points</p>
    </div>
    {result.certificate && <CertificateBanner code={result.certificate.code} />}
    <div className="mb-6 flex flex-wrap justify-center gap-3">
      <button onClick={onBack} className={ghost}>Back to exam</button>
      {!result.passed && canRetry && <button onClick={onRetry} className={btn} data-testid="button-retry-exam"><RotateCcw size={15} /> Try again</button>}
    </div>
    {result.reviewHidden && <p className="text-center text-sm text-[hsl(var(--muted-foreground))]">{result.reviewHidden}</p>}
    {result.review && <ol className="space-y-4" data-testid="exam-review">
      {result.review.map((q, i) => {
        const full = q.earned >= q.points;
        return <li key={q.questionId} className="rounded-lg border border-[hsl(var(--border))] p-5">
          <div className="mb-1 flex items-start justify-between gap-3">
            <span className="text-xs font-bold uppercase tracking-[.12em] text-[hsl(var(--link))]">Question {i + 1}</span>
            <span className={`text-xs font-bold ${full ? 'text-[hsl(145_55%_30%)]' : q.earned > 0 ? 'text-[hsl(30_80%_35%)]' : 'text-[hsl(var(--destructive))]'}`}>{q.earned} / {q.points}</span>
          </div>
          <p className="mb-3 whitespace-pre-wrap font-semibold">{q.text}</p>
          <ul className="space-y-1.5">
            {q.options.map(o => {
              const picked = q.chosen.includes(o.id);
              return <li key={o.id} className={`flex items-start gap-2.5 rounded-md border p-2.5 text-sm ${o.correct ? 'border-[hsl(145_55%_40%/.5)] bg-[hsl(145_55%_40%/.08)]' : picked ? 'border-[hsl(var(--destructive)/.4)] bg-[hsl(var(--destructive)/.05)]' : 'border-[hsl(var(--border))]'}`}>
                <span className="mt-0.5 shrink-0">{o.correct ? <Check size={15} className="text-[hsl(145_55%_32%)]" /> : picked ? <XCircle size={15} className="text-[hsl(var(--destructive))]" /> : <span className="inline-block size-[15px]" />}</span>
                <span className="flex-1 whitespace-pre-wrap">{o.text}</span>
                {picked && <span className="text-[11px] font-bold text-[hsl(var(--muted-foreground))]">Your answer</span>}
              </li>;
            })}
          </ul>
          {q.explanation && <p className="mt-3 rounded-md bg-[hsl(var(--secondary))] p-3 text-sm"><strong>Explanation: </strong>{q.explanation}</p>}
        </li>;
      })}
    </ol>}
  </div>;
}
