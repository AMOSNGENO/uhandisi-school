import { lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import {
  ArrowLeft, ArrowRight, Award, BookOpen, Check, ChevronLeft, ClipboardCheck, ChevronRight, Clock3, Download, ExternalLink, FileText, Link2, List, LockKeyhole, Maximize2, Minimize2, Paperclip,
} from 'lucide-react';
import { api, ApiError, useCurrentUser } from '@/lib/auth';
import RichContent from '@/components/rich-content';
import QuizActivity from '@/pages/quiz';

// PDF.js is large; load the book reader only when a student opens a PDF.
const BookReader = lazy(() => import('@/components/book-reader'));
const Opening = ({ title }: { title: string }) => <div className="grid h-[60vh] place-items-center rounded-xl bg-[#e9e4da] text-sm text-[hsl(var(--muted-foreground))]">Opening “{title}”…</div>;

type Kind = 'page' | 'file' | 'url' | 'package' | 'quiz';
type Lesson = {
  id: number; title: string; kind: Kind; done: boolean; contentHtml: string; externalUrl: string | null;
  /** Pay-as-you-go: a locked lesson comes without its content until payments reach it. */
  locked?: boolean; price?: number; paidTowards?: number; amountToOpen?: number;
  file: { name: string | null; type: string | null; size: number | null; url: string } | null;
  package: { scorm: boolean; entryUrl: string; toc: Array<{ title: string; depth: number; url: string | null }> } | null;
};
type ModuleView = {
  course: { id: number; title: string; accent: string };
  module: { id: number; title: string; description: string; duration: string; lessonCount: number };
  modules: Array<{ id: number; title: string; unlocked: boolean }>;
  lessons: Lesson[];
  completion: Completion;
};
type Completion = { done: number; total: number; percent: number; complete: boolean };

const kindIcon: Record<Kind, typeof FileText> = { page: FileText, file: Paperclip, url: Link2, package: BookOpen, quiz: ClipboardCheck };
const ksh = (value: number) => `KSh ${value.toLocaleString('en-KE')}`;
const sizeLabel = (b?: number | null) => (!b ? '' : b < 1048576 ? `${Math.max(1, Math.round(b / 1024))} KB` : `${(b / 1048576).toFixed(1)} MB`);

/** A module's activities, one at a time, with the list alongside. */
export default function ModulePage() {
  const { id, moduleId } = useParams<{ id: string; moduleId: string }>();
  const view = useQuery({
    queryKey: ['module', id, moduleId],
    queryFn: () => api<ModuleView>(`/courses/${id}/modules/${moduleId}`),
    retry: false,
  });
  const client = useQueryClient();
  const [active, setActive] = useState(0);
  const [doneNow, setDoneNow] = useState<Set<number>>(new Set());
  const [completion, setCompletion] = useState<Completion | null>(null);
  const [earned, setEarned] = useState<string | null>(null);
  const sent = useRef(new Set<number>());
  useEffect(() => { setActive(0); }, [moduleId]);
  // Fresh module data (e.g. after an exam) replaces the progress last reported by a lesson.
  useEffect(() => { setCompletion(null); }, [view.data]);
  // Opening a reading activity marks it done (exams are done once passed).
  const current = view.data?.lessons[Math.min(active, (view.data?.lessons.length ?? 1) - 1)];
  useEffect(() => {
    if (!current || current.locked || current.kind === 'quiz' || current.done || sent.current.has(current.id)) return;
    sent.current.add(current.id);
    api<{ done: boolean; completion: Completion; certificate: { code: string; new: boolean } | null }>(`/lessons/${current.id}/view`, { method: 'POST' })
      .then(r => {
        if (r.done) setDoneNow(s => new Set(s).add(current.id));
        setCompletion(r.completion);
        if (r.certificate?.new) { setEarned(r.certificate.code); client.invalidateQueries({ queryKey: ['certificates'] }); }
        client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'module' && q.queryKey[0] !== 'auth' && q.queryKey[0] !== 'quiz' });
      })
      .catch(() => sent.current.delete(current.id));
  }, [current, client]);
  useEffect(() => { window.scrollTo({ top: 0, behavior: 'smooth' }); }, [active]);

  const back = <Link href={`/courses/${id}`} className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="link-back-course"><ArrowLeft size={14} /> {view.data?.course.title ?? 'Back to course'}</Link>;

  if (view.isLoading) return <>{back}<div className="skeleton h-72 rounded-lg bg-[hsl(var(--muted))]" /></>;
  if (view.error) {
    const locked = view.error instanceof ApiError && view.error.status === 403;
    return <>{back}<div className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-10 text-center" data-testid={locked ? 'state-module-locked' : 'state-module-error'}>
      {locked ? <LockKeyhole className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" size={28} /> : <BookOpen className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" size={28} />}
      <h1 className="font-display text-xl font-bold">{locked ? 'This module is still locked' : 'We could not open this module'}</h1>
      <p className="mx-auto mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{view.error.message}</p>
      <Link href={`/courses/${id}`} className="mt-5 inline-flex rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">{locked ? 'Go to course to unlock' : 'Back to course'}</Link>
    </div></>;
  }

  const { course, module, modules, lessons } = view.data!;
  const isDone = (l: Lesson) => l.done || doneNow.has(l.id);
  const progress = completion ?? view.data!.completion;
  const lesson = lessons[Math.min(active, lessons.length - 1)];
  const position = modules.findIndex(m => m.id === module.id);
  const nextModule = modules[position + 1];

  return <>
    {back}
    <header className="mb-8 rounded-xl bg-[hsl(var(--sidebar))] p-7 text-[hsl(var(--sidebar-foreground))] sm:p-9">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Module {position + 1} of {modules.length}</p>
      <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{module.title}</h1>
      {module.description && <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{module.description}</p>}
      <p className="mt-5 flex flex-wrap items-center gap-4 text-xs text-white/65"><span className="flex items-center gap-1.5"><FileText size={14} /> {lessons.filter(isDone).length} of {lessons.length} done</span>{module.duration && <span className="flex items-center gap-1.5"><Clock3 size={14} /> {module.duration}</span>}</p>
      {progress.total > 0 && <div className="mt-5 max-w-md" data-testid="course-progress">
        <div className="mb-1.5 flex justify-between text-xs text-white/70"><span>Course progress</span><span>{progress.done} of {progress.total} activities · {progress.percent}%</span></div>
        <div className="h-2 overflow-hidden rounded-full bg-white/15"><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-700" style={{ width: `${progress.percent}%` }} /></div>
      </div>}
    </header>
    {earned && <div className="mb-6 flex flex-wrap items-center gap-4 rounded-lg border border-[hsl(38_70%_55%/.5)] bg-[hsl(42_90%_60%/.12)] p-4" data-testid="certificate-earned">
      <span className="grid size-11 shrink-0 place-items-center rounded-full bg-[hsl(42_90%_55%/.25)] text-[hsl(30_80%_32%)]"><Award size={22} /></span>
      <div className="min-w-0 flex-1"><p className="font-bold">Course complete: you’ve earned your certificate!</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Certificate code {earned}</p></div>
      <a href={`/api/certificates/${earned}/pdf`} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">Download PDF</a>
      <Link href="/certificates" className="inline-flex rounded-md border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-bold">All certificates</Link>
    </div>}

    {!lesson
      ? <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="state-no-lessons"><BookOpen className="mx-auto mb-3 text-[hsl(var(--accent))]" size={28} /><h2 className="font-display text-lg font-bold">Lessons are on their way</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">The instructor hasn't published lessons for this module yet. Check back soon.</p></div>
      : <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Lessons in this module" className="h-fit rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 lg:sticky lg:top-24">
          {lessons.map((l, i) => {
            const Icon = kindIcon[l.kind] ?? FileText;
            return <button key={l.id} onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}
              className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition ${i === active ? 'bg-[hsl(var(--secondary))] font-bold' : 'hover:bg-[hsl(var(--secondary)/.6)]'}`} data-testid={`button-lesson-${l.id}`}>
              <span className={`mt-0.5 grid size-6 shrink-0 place-items-center rounded-full ${l.locked ? 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]' : isDone(l) ? 'bg-[hsl(145_55%_38%)] text-white' : i === active ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`} title={l.locked ? 'Locked' : isDone(l) ? 'Done' : undefined}>{l.locked ? <LockKeyhole size={11} /> : isDone(l) ? <Check size={13} strokeWidth={3} /> : <Icon size={12} />}</span>
              <span className={`min-w-0 flex-1 ${l.locked ? 'text-[hsl(var(--muted-foreground))]' : ''}`}>{l.title}{l.locked && <span className="mt-0.5 block font-mono-ui text-[10px] font-normal" data-testid={`lesson-amount-${l.id}`}>{ksh(l.amountToOpen ?? 0)} more opens it</span>}</span>
            </button>;
          })}
        </nav>
        <article className="min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-9" data-testid="lesson-content">
          <p className="flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--link))]">Lesson {active + 1} of {lessons.length}{isDone(lesson) && <span className="inline-flex items-center gap-1 rounded-full bg-[hsl(145_55%_40%/.12)] px-2 py-0.5 normal-case tracking-normal text-[hsl(145_55%_28%)]" data-testid="lesson-done"><Check size={11} strokeWidth={3} /> Done</span>}</p>
          <h2 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{lesson.title}</h2>
          <div className="mt-6 border-t border-[hsl(var(--border))] pt-6">{lesson.locked
            ? <div className="rounded-lg bg-[hsl(var(--secondary)/.6)] p-8 text-center" data-testid="lesson-locked">
              <LockKeyhole className="mx-auto mb-3 text-[hsl(var(--muted-foreground))]" size={26} />
              <h3 className="font-display text-xl font-bold">This lesson opens with your next payment</h3>
              <p className="mx-auto mt-2 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">Pay {ksh(lesson.amountToOpen ?? 0)} more and it opens straight away. This lesson costs {ksh(lesson.price ?? 0)}{lesson.paidTowards ? <>; you’ve already covered {ksh(lesson.paidTowards)} of it</> : null}.</p>
              <Link href={`/courses/${course.id}`} className="mt-5 inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-pay-to-open">Make a payment <ArrowRight size={14} /></Link>
            </div>
            : <ActivityBody key={lesson.id} lesson={lesson} />}</div>
          <div className="mt-10 flex flex-wrap items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-5">
            <button disabled={active === 0} onClick={() => setActive(active - 1)} className="inline-flex items-center gap-2 rounded-md border border-[hsl(var(--border))] px-4 py-2.5 text-xs font-bold disabled:invisible" data-testid="button-prev-lesson"><ArrowLeft size={14} /> Previous</button>
            {active < lessons.length - 1
              ? <button onClick={() => setActive(active + 1)} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="button-next-lesson">Next lesson <ArrowRight size={14} /></button>
              : nextModule?.unlocked
                ? <Link href={`/courses/${course.id}/modules/${nextModule.id}`} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-next-module">Next module: {nextModule.title} <ChevronRight size={14} /></Link>
                : <Link href={`/courses/${course.id}`} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-module-done">{nextModule ? 'Unlock the next module' : 'Back to course'} <ChevronRight size={14} /></Link>}
          </div>
        </article>
      </div>}
  </>;
}

function ActivityBody({ lesson }: { lesson: Lesson }) {
  const description = lesson.contentHtml.trim() ? <RichContent html={lesson.contentHtml} className="mb-6" /> : null;
  if (lesson.kind === 'url') {
    const host = (() => { try { return new URL(lesson.externalUrl ?? '').host; } catch { return ''; } })();
    return <>{description}
      {lesson.externalUrl
        ? <a href={lesson.externalUrl} target="_blank" rel="noopener noreferrer" className="flex items-center gap-4 rounded-lg border border-[hsl(var(--border))] p-5 transition hover:border-[hsl(var(--link))]" data-testid="link-external">
          <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-[hsl(var(--link)/.1)] text-[hsl(var(--link))]"><Link2 size={20} /></span>
          <span className="min-w-0 flex-1"><span className="block font-bold text-[hsl(var(--link))]">Open link</span><span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{host || lesson.externalUrl}</span></span>
          <ExternalLink size={16} className="text-[hsl(var(--muted-foreground))]" />
        </a>
        : <p className="text-sm text-[hsl(var(--muted-foreground))]">This link hasn't been set up yet.</p>}
    </>;
  }
  if (lesson.kind === 'file') {
    const f = lesson.file;
    if (!f) return <>{description}<p className="text-sm text-[hsl(var(--muted-foreground))]">This file hasn't been uploaded yet.</p></>;
    const type = f.type ?? '';
    if (type === 'application/pdf') return <>{description}<Suspense fallback={<Opening title={lesson.title} />}><BookReader url={f.url} title={lesson.title} /></Suspense></>;
    const preview = type.startsWith('image/') ? <img src={f.url} alt={f.name ?? ''} className="max-h-[75vh] rounded-md" />
        : type.startsWith('video/') ? <video src={f.url} controls className="w-full rounded-md bg-black" />
          : type.startsWith('audio/') ? <audio src={f.url} controls className="w-full" />
            : null;
    return <>{description}
      {preview && <div className="mb-4">{preview}</div>}
      <div className="flex flex-wrap items-center gap-4 rounded-lg border border-[hsl(var(--border))] p-4" data-testid="file-card">
        <span className="grid size-11 shrink-0 place-items-center rounded-lg bg-[hsl(28_85%_50%/.12)] text-[hsl(24_80%_36%)]"><Paperclip size={20} /></span>
        <span className="min-w-0 flex-1"><span className="block truncate font-bold">{f.name}</span><span className="text-xs text-[hsl(var(--muted-foreground))]">{sizeLabel(f.size)}</span></span>
        <a href={`${f.url}?download`} className="inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-download"><Download size={14} /> Download</a>
      </div>
    </>;
  }
  if (lesson.kind === 'quiz') return <QuizActivity lessonId={lesson.id} intro={description} />;
  if (lesson.kind === 'package') return lesson.package ? <PackagePlayer pkg={lesson.package} /> : <p className="text-sm text-[hsl(var(--muted-foreground))]">This package hasn't been uploaded yet.</p>;
  return description ?? <p className="text-sm text-[hsl(var(--muted-foreground))]">This lesson has no content yet.</p>;
}

/**
 * Reads an IMS content package / SCORM package like a book: the first page is already open,
 * Previous / Next follow the package's own order, and its contents list sits behind a button.
 * SCORM content looks for window.API (1.2) or window.API_1484_11 (2004) in a parent window, so a
 * minimal runtime is installed while the reader is open. It answers every call so content runs;
 * nothing is stored yet (no scores or completion tracking).
 */
function PackagePlayer({ pkg }: { pkg: NonNullable<Lesson['package']> }) {
  const user = useCurrentUser().data;
  const pages = pkg.toc.filter(t => t.url) as Array<{ title: string; depth: number; url: string }>;
  const [index, setIndex] = useState(() => Math.max(0, pages.findIndex(p => p.url === pkg.entryUrl)));
  const [showContents, setShowContents] = useState(false);
  const [full, setFull] = useState(false);
  const box = useRef<HTMLDivElement>(null);
  const current = pages[index] ?? { title: '', depth: 0, url: pkg.entryUrl };

  useEffect(() => {
    const data: Record<string, string> = {
      'cmi.core.student_id': String(user?.id ?? ''), 'cmi.core.student_name': user?.name ?? '', 'cmi.core.lesson_status': 'not attempted',
      'cmi.core.entry': 'ab-initio', 'cmi.core.lesson_mode': 'normal', 'cmi.core.credit': 'credit',
      'cmi.learner_id': String(user?.id ?? ''), 'cmi.learner_name': user?.name ?? '', 'cmi.completion_status': 'unknown', 'cmi.mode': 'normal', 'cmi.entry': 'ab-initio',
    };
    const yes = () => 'true';
    const get = (k: string) => data[k] ?? '';
    const set = (k: string, v: unknown) => { data[k] = String(v); return 'true'; };
    const w = window as unknown as Record<string, unknown>;
    w.API = { LMSInitialize: yes, LMSFinish: yes, LMSGetValue: get, LMSSetValue: set, LMSCommit: yes, LMSGetLastError: () => '0', LMSGetErrorString: () => 'No error', LMSGetDiagnostic: () => '' };
    w.API_1484_11 = { Initialize: yes, Terminate: yes, GetValue: get, SetValue: set, Commit: yes, GetLastError: () => '0', GetErrorString: () => 'No error', GetDiagnostic: () => '' };
    return () => { delete w.API; delete w.API_1484_11; };
  }, [user?.id, user?.name]);

  useEffect(() => {
    const onChange = () => setFull(document.fullscreenElement === box.current);
    document.addEventListener('fullscreenchange', onChange);
    return () => document.removeEventListener('fullscreenchange', onChange);
  }, []);

  const btn = 'inline-flex items-center gap-1.5 rounded-full bg-white/90 px-4 py-2 text-xs font-bold shadow transition hover:bg-white disabled:opacity-30';
  return <div ref={box} className={`rounded-xl bg-[#e9e4da] ${full ? 'flex h-screen flex-col p-4' : 'p-3 sm:p-5'}`} data-testid="package-player">
    <div className="mb-3 flex items-center justify-between gap-2">
      {pages.length > 1
        ? <button onClick={() => setShowContents(v => !v)} aria-expanded={showContents} className={btn} data-testid="button-contents"><List size={14} /> Contents</button>
        : <span />}
      <p className="min-w-0 truncate text-center text-xs font-bold text-[hsl(var(--foreground)/.75)]">{current.title}</p>
      <button onClick={() => (full ? document.exitFullscreen() : box.current?.requestFullscreen?.())} className={btn} aria-label={full ? 'Exit full screen' : 'Full screen'}>{full ? <Minimize2 size={14} /> : <Maximize2 size={14} />}</button>
    </div>
    <div className={`relative ${full ? 'min-h-0 flex-1' : ''}`}>
      {showContents && <nav aria-label="Contents" className="absolute left-0 top-0 z-10 max-h-full w-72 max-w-[85%] overflow-y-auto rounded-lg bg-white p-2 text-sm shadow-xl" data-testid="package-toc">
        {pkg.toc.map((t, i) => t.url
          ? <button key={i} onClick={() => { setIndex(pages.findIndex(p => p.url === t.url)); setShowContents(false); }} aria-current={current.url === t.url ? 'page' : undefined} style={{ paddingLeft: 10 + t.depth * 14 }}
            className={`block w-full rounded px-2.5 py-2 text-left transition ${current.url === t.url ? 'bg-[hsl(var(--secondary))] font-bold' : 'hover:bg-[hsl(var(--secondary)/.6)]'}`}>{t.title}</button>
          : <p key={i} style={{ paddingLeft: 10 + t.depth * 14 }} className="px-2.5 py-2 text-xs font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">{t.title}</p>)}
      </nav>}
      <iframe key={current.url} src={current.url} title={current.title || 'Course reading'} allow="fullscreen; autoplay"
        className={`w-full rounded-sm bg-white shadow-[0_6px_24px_rgba(0,0,0,.18)] animate-[book-next_.35s_ease-out] ${full ? 'h-full' : 'h-[75vh]'}`} data-testid="package-frame" />
    </div>
    {pages.length > 1 && <div className="mt-3 flex items-center justify-center gap-3" data-testid="package-controls">
      <button onClick={() => setIndex(i => Math.max(0, i - 1))} disabled={index === 0} className={btn} data-testid="package-prev"><ChevronLeft size={15} /> Previous</button>
      <span className="rounded-full bg-white/90 px-3 py-2 text-xs font-bold shadow">Page {index + 1} <span className="font-normal text-[hsl(var(--muted-foreground))]">of {pages.length}</span></span>
      <button onClick={() => setIndex(i => Math.min(pages.length - 1, i + 1))} disabled={index >= pages.length - 1} className={btn} data-testid="package-next">Next <ChevronRight size={15} /></button>
    </div>}
  </div>;
}
