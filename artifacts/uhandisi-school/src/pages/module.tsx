import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { ArrowLeft, ArrowRight, BookOpen, ChevronRight, Clock3, FileText, LockKeyhole } from 'lucide-react';
import { api, ApiError } from '@/lib/auth';
import RichContent from '@/components/rich-content';

type ModuleView = {
  course: { id: number; title: string; accent: string };
  module: { id: number; title: string; description: string; duration: string; lessonCount: number };
  modules: Array<{ id: number; title: string; unlocked: boolean }>;
  lessons: Array<{ id: number; title: string; contentHtml: string }>;
};

/** A module's lessons, one at a time, with the lesson list alongside. */
export default function ModulePage() {
  const { id, moduleId } = useParams<{ id: string; moduleId: string }>();
  const view = useQuery({
    queryKey: ['module', id, moduleId],
    queryFn: () => api<ModuleView>(`/courses/${id}/modules/${moduleId}`),
    retry: false,
  });
  const [active, setActive] = useState(0);
  useEffect(() => { setActive(0); }, [moduleId]);
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
  const lesson = lessons[active];
  const position = modules.findIndex(m => m.id === module.id);
  const nextModule = modules[position + 1];

  return <>
    {back}
    <header className="mb-8 rounded-xl bg-[hsl(var(--sidebar))] p-7 text-[hsl(var(--sidebar-foreground))] sm:p-9">
      <p className="mb-3 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Module {position + 1} of {modules.length}</p>
      <h1 className="font-display text-3xl font-bold leading-tight sm:text-4xl">{module.title}</h1>
      {module.description && <p className="mt-3 max-w-2xl text-sm leading-6 text-white/70">{module.description}</p>}
      <p className="mt-5 flex flex-wrap items-center gap-4 text-xs text-white/65"><span className="flex items-center gap-1.5"><FileText size={14} /> {lessons.length} {lessons.length === 1 ? "lesson" : "lessons"}</span>{module.duration && <span className="flex items-center gap-1.5"><Clock3 size={14} /> {module.duration}</span>}</p>
    </header>

    {lessons.length === 0
      ? <div className="rounded-lg border border-dashed border-[hsl(var(--border))] p-10 text-center" data-testid="state-no-lessons"><BookOpen className="mx-auto mb-3 text-[hsl(var(--accent))]" size={28} /><h2 className="font-display text-lg font-bold">Lessons are on their way</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">The instructor hasn't published lessons for this module yet. Check back soon.</p></div>
      : <div className="grid gap-8 lg:grid-cols-[260px_1fr]">
        <nav aria-label="Lessons in this module" className="h-fit rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2 lg:sticky lg:top-24">
          {lessons.map((l, i) => <button key={l.id} onClick={() => setActive(i)} aria-current={i === active ? 'step' : undefined}
            className={`flex w-full items-start gap-3 rounded-md px-3 py-2.5 text-left text-sm transition ${i === active ? 'bg-[hsl(var(--secondary))] font-bold' : 'hover:bg-[hsl(var(--secondary)/.6)]'}`} data-testid={`button-lesson-${l.id}`}>
            <span className={`mt-0.5 grid size-5 shrink-0 place-items-center rounded-full text-[10px] font-bold ${i === active ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]'}`}>{i + 1}</span>
            <span className="min-w-0">{l.title}</span>
          </button>)}
        </nav>
        <article className="min-w-0 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 sm:p-9" data-testid="lesson-content">
          <p className="text-[10px] font-bold uppercase tracking-[.18em] text-[hsl(var(--link))]">Lesson {active + 1} of {lessons.length}</p>
          <h2 className="mt-2 font-display text-2xl font-bold sm:text-3xl">{lesson!.title}</h2>
          <div className="mt-6 border-t border-[hsl(var(--border))] pt-6">
            {lesson!.contentHtml.trim() ? <RichContent html={lesson!.contentHtml} /> : <p className="text-sm text-[hsl(var(--muted-foreground))]">This lesson has no content yet.</p>}
          </div>
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
