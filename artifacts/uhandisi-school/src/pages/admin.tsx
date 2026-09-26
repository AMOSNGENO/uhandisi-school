import { type FormEvent, type ReactNode, lazy, Suspense, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import {
  ArrowDown, ArrowUp, BookOpen, FileText, ImagePlus, Check, Clock3, CreditCard, Eye, EyeOff, Plus, Save, Search, Trash2, Users, X,
} from 'lucide-react';
import { api, useCurrentUser, type Role } from '@/lib/auth';
import { ACCEPTED_IMAGES, uploadFile } from '@/lib/upload';

// The editor is large; load it only when an admin opens a form that needs it.
const RichEditor = lazy(() => import('@/components/rich-editor'));

type AdminModule = { id: number; courseId: number; title: string; description: string; order: number; unlockAmount: number; lessonCount: number; duration: string; lessonTotal?: number };
type AdminLesson = { id: number; moduleId: number; title: string; contentHtml: string; order: number };
type AdminCourse = {
  id: number; title: string; category: string; description: string; price: number; paymentModel: 'free' | 'paid' | 'lipa_pole_pole';
  accent: string; imageUrl: string; instructor: string; instructorRole: string; planName: string; planAmountPerDay: number;
  planDescription: string; published: boolean; overviewHtml: string; enrolledCount?: number; modules: AdminModule[];
};
type AdminUser = { id: number; name: string; email: string; phone: string | null; role: Role; active: boolean; createdAt: string };
type AdminPayment = {
  id: number; userId: number; courseTitle: string; amount: number; status: string; date: string; phoneNumber: string;
  receipt: string | null; checkoutRequestId: string | null; studentName?: string; studentEmail?: string;
};
type Stats = {
  users: { total: number; students: number; admins: number }; courses: { total: number; published: number };
  payments: { revenue: number; pending: number; completed: number }; enrollments: number; recentPayments: AdminPayment[];
};

const money = (value = 0) => `KSh ${value.toLocaleString('en-KE')}`;
const field = 'mt-1.5 h-10 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm font-normal outline-none transition focus:border-[hsl(var(--primary))]';
const card = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft';
const primaryBtn = 'inline-flex items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60';
const ghostBtn = 'inline-flex items-center justify-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2 text-xs font-bold transition hover:border-[hsl(var(--primary)/.4)] disabled:opacity-50';

const tabs = [
  { href: '/admin', label: 'Overview' },
  { href: '/admin/courses', label: 'Courses' },
  { href: '/admin/users', label: 'Users' },
  { href: '/admin/payments', label: 'Payments' },
];

const statusStyles: Record<string, string> = {
  completed: 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]',
  pending: 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent-foreground))]',
  failed: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]',
  cancelled: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
  refunded: 'bg-[hsl(var(--muted))] text-[hsl(var(--muted-foreground))]',
};
const StatusPill = ({ status }: { status: string }) =>
  <span className={`w-fit rounded-full px-2.5 py-1 text-[10px] font-bold capitalize ${statusStyles[status] || statusStyles.pending}`}>{status}</span>;

function ErrorNote({ error }: { error: unknown }) {
  if (!error) return null;
  return <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">{error instanceof Error ? error.message : 'Something went wrong.'}</p>;
}

function AdminFrame({ title, copy, action, children }: { title: string; copy: string; action?: ReactNode; children: ReactNode }) {
  const [location] = useLocation();
  return <>
    <div className="mb-6 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
      <div><p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-[hsl(var(--primary))]">Administration</p><h1 className="font-display text-3xl font-bold tracking-tight sm:text-4xl">{title}</h1><p className="mt-2 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{copy}</p></div>
      {action}
    </div>
    <nav className="mb-7 flex gap-1 overflow-x-auto rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1" aria-label="Admin sections">
      {tabs.map(t => {
        const active = t.href === '/admin' ? location === '/admin' : location.startsWith(t.href);
        return <Link key={t.href} href={t.href} className={`whitespace-nowrap rounded-lg px-4 py-2 text-xs font-bold transition ${active ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} data-testid={`tab-admin-${t.label.toLowerCase()}`}>{t.label}</Link>;
      })}
    </nav>
    {children}
  </>;
}

// ---------------------------------------------------------------------------
// Overview
// ---------------------------------------------------------------------------

export function AdminOverviewPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats') });
  const s = stats.data;
  return <AdminFrame title="School overview" copy="Learners, courses and money at a glance.">
    {stats.isLoading ? <div className="skeleton h-40 rounded-lg bg-[hsl(var(--muted))]" /> : !s ? <ErrorNote error={stats.error} /> : <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Confirmed revenue', value: money(s.payments.revenue), sub: `${s.payments.completed} payments`, icon: CreditCard },
          { label: 'Awaiting confirmation', value: String(s.payments.pending), sub: 'pending M-Pesa payments', icon: Clock3, href: '/admin/payments' },
          { label: 'Users', value: String(s.users.total), sub: `${s.users.students} students · ${s.users.admins} admins`, icon: Users, href: '/admin/users' },
          { label: 'Courses', value: String(s.courses.total), sub: `${s.courses.published} published · ${s.enrollments} enrolments`, icon: BookOpen, href: '/admin/courses' },
        ].map(({ label, value, sub, icon: Icon, href }) => {
          const body = <><div className="flex items-start justify-between"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</p><span className="grid size-9 place-items-center rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon size={16} /></span></div><p className="mt-2 font-mono-ui text-2xl font-medium">{value}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</p></>;
          return href ? <Link key={label} href={href} className={`${card} block p-5 transition hover:-translate-y-0.5`}>{body}</Link> : <div key={label} className={`${card} p-5`}>{body}</div>;
        })}
      </section>
      <section>
        <div className="mb-3 flex items-end justify-between"><h2 className="font-display text-xl font-bold">Latest payments</h2><Link href="/admin/payments" className="text-xs font-bold text-[hsl(var(--primary))]">All payments</Link></div>
        <PaymentsTable payments={s.recentPayments} />
      </section>
    </div>}
  </AdminFrame>;
}

// ---------------------------------------------------------------------------
// Courses
// ---------------------------------------------------------------------------

const blankCourse: Omit<AdminCourse, 'id' | 'modules'> = {
  title: '', category: '', description: '', price: 0, paymentModel: 'lipa_pole_pole', accent: '#1f6f5c', imageUrl: '',
  instructor: '', instructorRole: '', planName: 'Flex', planAmountPerDay: 100, planDescription: '', published: false, overviewHtml: '',
};

export function AdminCoursesPage() {
  const client = useQueryClient();
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: () => api<AdminCourse[]>('/admin/courses') });
  const [selected, setSelected] = useState<number | 'new' | null>(null);
  const list = courses.data || [];
  const current = selected === 'new' ? null : list.find(c => c.id === selected) ?? null;

  useEffect(() => {
    if (selected === null && list.length) setSelected(list[0]!.id);
  }, [list, selected]);

  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin'] });
    // Students' views of courses are cached separately.
    client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'admin' && q.queryKey[0] !== 'auth' });
  };

  return <AdminFrame title="Courses & modules" copy="Create courses, set prices and unlock amounts, and arrange modules in the order students take them."
    action={<button onClick={() => setSelected('new')} className={primaryBtn} data-testid="button-new-course"><Plus size={15} /> New course</button>}>
    {courses.isLoading ? <div className="skeleton h-60 rounded-lg bg-[hsl(var(--muted))]" /> : <div className="grid gap-6 lg:grid-cols-[280px_1fr]">
      <aside className="space-y-2">
        {list.map(c => <button key={c.id} onClick={() => setSelected(c.id)} className={`w-full rounded-md border p-3 text-left transition ${selected === c.id ? 'border-[hsl(var(--primary))] bg-[hsl(var(--secondary)/.6)]' : 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.4)]'}`} data-testid={`button-admin-course-${c.id}`}>
          <div className="flex items-center gap-2"><span className="size-2.5 shrink-0 rounded-full" style={{ background: c.accent }} /><span className="truncate text-sm font-bold">{c.title}</span>{!c.published && <EyeOff size={13} className="ml-auto shrink-0 text-[hsl(var(--muted-foreground))]" aria-label="Unpublished" />}</div>
          <p className="mt-1 pl-[18px] text-[11px] text-[hsl(var(--muted-foreground))]">{c.modules.length} modules · {c.paymentModel === 'free' ? 'Free' : money(c.price)} · {c.enrolledCount ?? 0} learners</p>
        </button>)}
        {list.length === 0 && <p className="text-sm text-[hsl(var(--muted-foreground))]">No courses yet.</p>}
      </aside>
      <div className="min-w-0 space-y-6">
        {selected === 'new' && <CourseForm key="new" initial={blankCourse} onSaved={c => { refresh(); setSelected(c.id); }} onCancel={() => setSelected(list[0]?.id ?? null)} />}
        {current && <>
          <CourseForm key={current.id} initial={current} courseId={current.id} onSaved={refresh} onDeleted={() => { refresh(); setSelected(null); }} />
          <ModulesEditor course={current} onChanged={refresh} />
        </>}
      </div>
    </div>}
  </AdminFrame>;
}

function CourseForm({ initial, courseId, onSaved, onCancel, onDeleted }: {
  initial: Omit<AdminCourse, 'id' | 'modules'>; courseId?: number; onSaved: (c: AdminCourse) => void; onCancel?: () => void; onDeleted?: () => void;
}) {
  const [form, setForm] = useState({ ...blankCourse, ...initial });
  const save = useMutation({
    mutationFn: () => {
      const { title, category, description, price, paymentModel, accent, imageUrl, instructor, instructorRole, planName, planAmountPerDay, planDescription, published, overviewHtml } = form;
      const body = { title, category, description, price: Number(price), paymentModel, accent, imageUrl, instructor, instructorRole, planName, planAmountPerDay: Number(planAmountPerDay), planDescription, published, overviewHtml };
      return courseId ? api<AdminCourse>(`/admin/courses/${courseId}`, { method: 'PATCH', body }) : api<AdminCourse>('/admin/courses', { method: 'POST', body });
    },
    onSuccess: onSaved,
  });
  const remove = useMutation({ mutationFn: () => api(`/admin/courses/${courseId}`, { method: 'DELETE' }), onSuccess: onDeleted });
  const set = <K extends keyof typeof form>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm({ ...form, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };

  return <form onSubmit={submit} className={`${card} space-y-4 p-5 sm:p-6`}>
    <div className="flex flex-wrap items-center justify-between gap-3">
      <h2 className="font-display text-xl font-bold">{courseId ? 'Course details' : 'New course'}</h2>
      <button type="button" onClick={() => setForm({ ...form, published: !form.published })} className={`${ghostBtn} ${form.published ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid="button-toggle-published">
        {form.published ? <><Eye size={14} /> Published</> : <><EyeOff size={14} /> Hidden from students</>}
      </button>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-bold">Title<input required value={form.title} onChange={set('title')} className={field} /></label>
      <label className="text-xs font-bold">Category<input required value={form.category} onChange={set('category')} className={field} /></label>
    </div>
    <label className="block text-xs font-bold">Short summary <span className="font-normal text-[hsl(var(--muted-foreground))]">(shown on course cards)</span><textarea required rows={2} value={form.description} onChange={set('description')} className={`${field} h-auto py-2`} /></label>
    <ImageUpload value={form.imageUrl} onChange={imageUrl => setForm(f => ({ ...f, imageUrl }))} />
    <div className="text-xs font-bold"><p className="mb-1.5">About this course <span className="font-normal text-[hsl(var(--muted-foreground))]">(shown on the course page. Type, paste from Word, or use the &lt;&gt; button for HTML)</span></p>
      <EditorField value={form.overviewHtml} onChange={overviewHtml => setForm(f => ({ ...f, overviewHtml }))} height={320} />
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-xs font-bold">Payment model<select value={form.paymentModel} onChange={set('paymentModel')} className={field}><option value="lipa_pole_pole">Lipa Pole Pole</option><option value="paid">Paid</option><option value="free">Free</option></select></label>
      <label className="text-xs font-bold">Full price (KSh)<input type="number" min={0} value={form.paymentModel === 'free' ? 0 : form.price} onChange={set('price')} disabled={form.paymentModel === 'free'} title={form.paymentModel === 'free' ? 'Free courses have no price' : undefined} className={`${field} disabled:bg-[hsl(var(--muted))] disabled:text-[hsl(var(--muted-foreground))]`} /></label>
      <label className="text-xs font-bold">Accent colour<input type="color" value={form.accent} onChange={set('accent')} className={`${field} p-1`} /></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-3">
      <label className="text-xs font-bold">Plan name<input value={form.planName} onChange={set('planName')} className={field} /></label>
      <label className="text-xs font-bold">Suggested KSh / day<input type="number" min={0} value={form.planAmountPerDay} onChange={set('planAmountPerDay')} className={field} /></label>
      <label className="text-xs font-bold">Plan description<input value={form.planDescription} onChange={set('planDescription')} className={field} /></label>
    </div>
    <div className="grid gap-4 sm:grid-cols-2">
      <label className="text-xs font-bold">Instructor<input value={form.instructor} onChange={set('instructor')} className={field} /></label>
      <label className="text-xs font-bold">Instructor role<input value={form.instructorRole} onChange={set('instructorRole')} className={field} /></label>
    </div>
    <ErrorNote error={save.error || remove.error} />
    <div className="flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] pt-4">
      <button disabled={save.isPending} className={primaryBtn} data-testid="button-save-course"><Save size={14} /> {save.isPending ? 'Saving…' : courseId ? 'Save changes' : 'Create course'}</button>
      {save.isSuccess && courseId && <span className="flex items-center gap-1 text-xs text-[hsl(var(--primary))]"><Check size={13} /> Saved</span>}
      {onCancel && <button type="button" onClick={onCancel} className={ghostBtn}>Cancel</button>}
      {courseId && <button type="button" disabled={remove.isPending} onClick={() => { if (confirm(`Delete "${form.title}" and all its modules? This can't be undone.`)) remove.mutate(); }} className={`${ghostBtn} ml-auto text-[hsl(var(--destructive))]`} data-testid="button-delete-course"><Trash2 size={14} /> Delete</button>}
    </div>
  </form>;
}

function ModulesEditor({ course, onChanged }: { course: AdminCourse; onChanged: () => void }) {
  const [adding, setAdding] = useState(false);
  const reorder = useMutation({
    mutationFn: (moduleIds: number[]) => api(`/admin/courses/${course.id}/module-order`, { method: 'PUT', body: { moduleIds } }),
    onSuccess: onChanged,
  });
  const move = (index: number, delta: number) => {
    const ids = course.modules.map(m => m.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    reorder.mutate(ids);
  };
  return <section className={`${card} p-5 sm:p-6`}>
    <div className="mb-1 flex items-center justify-between"><h2 className="font-display text-xl font-bold">Modules</h2>
      {!adding && <button onClick={() => setAdding(true)} className={ghostBtn} data-testid="button-add-module"><Plus size={14} /> Add module</button>}</div>
    <p className="mb-4 text-xs leading-5 text-[hsl(var(--muted-foreground))]">A module unlocks once a student's confirmed payments for this course reach its unlock amount.</p>
    <ErrorNote error={reorder.error} />
    <div className="space-y-2">
      {course.modules.map((m, i) => <ModuleRowEditor key={m.id} module={m} index={i} last={i === course.modules.length - 1} onMove={move} busy={reorder.isPending} onChanged={onChanged} />)}
      {course.modules.length === 0 && !adding && <p className="rounded-md border border-dashed border-[hsl(var(--border))] p-6 text-center text-sm text-[hsl(var(--muted-foreground))]">No modules yet.</p>}
      {adding && <ModuleForm courseId={course.id} onDone={() => { setAdding(false); onChanged(); }} onCancel={() => setAdding(false)} />}
    </div>
  </section>;
}

function ModuleRowEditor({ module, index, last, onMove, busy, onChanged }: {
  module: AdminModule; index: number; last: boolean; onMove: (i: number, d: number) => void; busy: boolean; onChanged: () => void;
}) {
  const [editing, setEditing] = useState(false);
  const [showLessons, setShowLessons] = useState(false);
  const remove = useMutation({ mutationFn: () => api(`/admin/modules/${module.id}`, { method: 'DELETE' }), onSuccess: onChanged });
  if (editing) return <ModuleForm courseId={module.courseId} module={module} onDone={() => { setEditing(false); onChanged(); }} onCancel={() => setEditing(false)} />;
  return <div className="rounded-md border border-[hsl(var(--border))]" data-testid={`admin-module-${module.id}`}><div className="flex items-center gap-3 p-3">
    <div className="flex flex-col">
      <button disabled={index === 0 || busy} onClick={() => onMove(index, -1)} className="rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30" aria-label="Move up"><ArrowUp size={14} /></button>
      <button disabled={last || busy} onClick={() => onMove(index, 1)} className="rounded p-0.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))] disabled:opacity-30" aria-label="Move down"><ArrowDown size={14} /></button>
    </div>
    <span className="grid size-8 shrink-0 place-items-center rounded-lg bg-[hsl(var(--secondary))] text-xs font-bold text-[hsl(var(--primary))]">{String(index + 1).padStart(2, '0')}</span>
    <button onClick={() => setEditing(true)} className="min-w-0 flex-1 text-left">
      <p className="truncate text-sm font-bold">{module.title}</p>
      <p className="mt-0.5 truncate text-xs text-[hsl(var(--muted-foreground))]">{module.lessonTotal ? `${module.lessonTotal} lessons written` : 'No lessons written yet'} · {module.duration || '—'} · unlocks at {money(module.unlockAmount)}</p>
    </button>
    <button onClick={() => setShowLessons(!showLessons)} aria-expanded={showLessons} className={`${ghostBtn} ${showLessons ? 'border-[hsl(var(--primary))]' : ''}`} data-testid={`button-lessons-${module.id}`}><FileText size={14} /> Lessons ({module.lessonTotal ?? 0})</button>
    <button onClick={() => setEditing(true)} className={ghostBtn}>Edit</button>
    <button disabled={remove.isPending} onClick={() => { if (confirm(`Delete module "${module.title}" and its lessons?`)) remove.mutate(); }} className="rounded-lg p-2 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" aria-label="Delete module"><Trash2 size={15} /></button>
  </div>
  {showLessons && <LessonsEditor module={module} onChanged={onChanged} />}
  </div>;
}

/** Lazy editor with a placeholder while its code loads. */
function EditorField(props: { value: string; onChange: (html: string) => void; height?: number }) {
  return <Suspense fallback={<div className="grid place-items-center rounded-md border border-[hsl(var(--border))] text-xs font-normal text-[hsl(var(--muted-foreground))]" style={{ height: props.height ?? 420 }}>Loading editor…</div>}>
    <RichEditor {...props} />
  </Suspense>;
}

function ImageUpload({ value, onChange }: { value: string; onChange: (url: string) => void }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const pick = async (file?: File) => {
    if (!file) return;
    setBusy(true);
    setError('');
    try { onChange(await uploadFile(file)); } catch (e) { setError(e instanceof Error ? e.message : 'Upload failed.'); } finally { setBusy(false); if (input.current) input.current.value = ''; }
  };
  return <div className="text-xs font-bold">
    <p className="mb-1.5">Course image</p>
    <div className="flex flex-wrap items-center gap-4" onDragOver={e => e.preventDefault()} onDrop={e => { e.preventDefault(); pick(e.dataTransfer.files[0]); }}>
      <div className="grid h-28 w-48 shrink-0 place-items-center overflow-hidden rounded-md border border-dashed border-[hsl(var(--input))] bg-[hsl(var(--secondary))]">
        {value ? <img src={value} alt="Course image preview" className="size-full object-cover" /> : <ImagePlus size={24} className="text-[hsl(var(--muted-foreground))]" />}
      </div>
      <div className="space-y-2">
        <input ref={input} type="file" accept={ACCEPTED_IMAGES} className="hidden" onChange={e => pick(e.target.files?.[0])} data-testid="input-course-image" />
        <button type="button" disabled={busy} onClick={() => input.current?.click()} className={primaryBtn} data-testid="button-upload-image"><ImagePlus size={14} /> {busy ? 'Uploading…' : value ? 'Replace image' : 'Upload image'}</button>
        {value && <button type="button" onClick={() => onChange('')} className={`${ghostBtn} ml-2`}>Remove</button>}
        <p className="font-normal text-[hsl(var(--muted-foreground))]">PNG, JPEG, GIF or WebP, up to 10 MB. You can also drop a file here.</p>
        {error && <p className="font-normal text-[hsl(var(--destructive))]" role="alert">{error}</p>}
      </div>
    </div>
  </div>;
}

function LessonsEditor({ module, onChanged }: { module: AdminModule; onChanged: () => void }) {
  const client = useQueryClient();
  const key = ['admin', 'lessons', module.id];
  const lessons = useQuery({ queryKey: key, queryFn: () => api<AdminLesson[]>(`/admin/modules/${module.id}/lessons`) });
  const [editing, setEditing] = useState<number | 'new' | null>(null);
  const after = (list: AdminLesson[]) => { client.setQueryData(key, list); onChanged(); };
  const reorder = useMutation({
    mutationFn: (lessonIds: number[]) => api<AdminLesson[]>(`/admin/modules/${module.id}/lesson-order`, { method: 'PUT', body: { lessonIds } }),
    onSuccess: after,
  });
  const remove = useMutation({ mutationFn: (id: number) => api<AdminLesson[]>(`/admin/lessons/${id}`, { method: 'DELETE' }), onSuccess: after });
  const list = lessons.data || [];
  const move = (index: number, delta: number) => {
    const ids = list.map(l => l.id);
    const [id] = ids.splice(index, 1);
    ids.splice(index + delta, 0, id!);
    reorder.mutate(ids);
  };
  return <div className="space-y-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.5)] p-3 sm:p-4" data-testid={`lessons-editor-${module.id}`}>
    <ErrorNote error={lessons.error || reorder.error || remove.error} />
    {lessons.isLoading && <p className="text-xs text-[hsl(var(--muted-foreground))]">Loading lessons…</p>}
    {list.map((lesson, i) => editing === lesson.id
      ? <LessonForm key={lesson.id} moduleId={module.id} lesson={lesson} onSaved={l => { after(l); setEditing(null); }} onCancel={() => setEditing(null)} />
      : <div key={lesson.id} className="flex items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-2.5">
        <div className="flex flex-col">
          <button disabled={i === 0 || reorder.isPending} onClick={() => move(i, -1)} className="rounded p-0.5 text-[hsl(var(--muted-foreground))] disabled:opacity-30" aria-label="Move lesson up"><ArrowUp size={13} /></button>
          <button disabled={i === list.length - 1 || reorder.isPending} onClick={() => move(i, 1)} className="rounded p-0.5 text-[hsl(var(--muted-foreground))] disabled:opacity-30" aria-label="Move lesson down"><ArrowDown size={13} /></button>
        </div>
        <FileText size={15} className="shrink-0 text-[hsl(var(--link))]" />
        <button onClick={() => setEditing(lesson.id)} className="min-w-0 flex-1 truncate text-left text-sm font-semibold">{i + 1}. {lesson.title}</button>
        <button onClick={() => setEditing(lesson.id)} className={ghostBtn} data-testid={`button-edit-lesson-${lesson.id}`}>Edit</button>
        <button disabled={remove.isPending} onClick={() => { if (confirm(`Delete lesson "${lesson.title}"?`)) remove.mutate(lesson.id); }} className="rounded p-1.5 text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--destructive))]" aria-label="Delete lesson"><Trash2 size={14} /></button>
      </div>)}
    {!lessons.isLoading && list.length === 0 && editing !== 'new' && <p className="py-2 text-center text-xs text-[hsl(var(--muted-foreground))]">No lessons in this module yet.</p>}
    {editing === 'new'
      ? <LessonForm moduleId={module.id} onSaved={l => { after(l); setEditing(null); }} onCancel={() => setEditing(null)} />
      : <button onClick={() => setEditing('new')} className={ghostBtn} data-testid={`button-add-lesson-${module.id}`}><Plus size={14} /> Add lesson</button>}
  </div>;
}

function LessonForm({ moduleId, lesson, onSaved, onCancel }: { moduleId: number; lesson?: AdminLesson; onSaved: (list: AdminLesson[]) => void; onCancel: () => void }) {
  const [title, setTitle] = useState(lesson?.title ?? '');
  const [html, setHtml] = useState(lesson?.contentHtml ?? '');
  const save = useMutation({
    mutationFn: () => lesson
      ? api<AdminLesson[]>(`/admin/lessons/${lesson.id}`, { method: 'PATCH', body: { title, contentHtml: html } })
      : api<AdminLesson[]>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body: { title, contentHtml: html } }),
    onSuccess: onSaved,
  });
  return <form onSubmit={e => { e.preventDefault(); save.mutate(); }} className="space-y-3 rounded-md border border-[hsl(var(--primary)/.4)] bg-[hsl(var(--card))] p-4" data-testid="form-lesson">
    <label className="block text-xs font-bold">Lesson title<input required value={title} onChange={e => setTitle(e.target.value)} className={field} data-testid="input-lesson-title" /></label>
    <div className="text-xs font-bold"><p className="mb-1.5">Lesson content <span className="font-normal text-[hsl(var(--muted-foreground))]">(type, paste from Word, add images and YouTube videos, or use the &lt;&gt; button to paste HTML)</span></p>
      <EditorField value={html} onChange={setHtml} />
    </div>
    <ErrorNote error={save.error} />
    <div className="flex gap-2"><button disabled={save.isPending} className={primaryBtn} data-testid="button-save-lesson"><Save size={14} /> {save.isPending ? 'Saving…' : lesson ? 'Save lesson' : 'Add lesson'}</button><button type="button" onClick={onCancel} className={ghostBtn}><X size={14} /> Cancel</button></div>
  </form>;
}

function ModuleForm({ courseId, module, onDone, onCancel }: { courseId: number; module?: AdminModule; onDone: () => void; onCancel: () => void }) {
  const [form, setForm] = useState({
    title: module?.title ?? '', description: module?.description ?? '', unlockAmount: module?.unlockAmount ?? 0,
    lessonCount: module?.lessonCount ?? 0, duration: module?.duration ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, unlockAmount: Number(form.unlockAmount), lessonCount: Number(form.lessonCount) };
      return module ? api(`/admin/modules/${module.id}`, { method: 'PATCH', body }) : api(`/admin/courses/${courseId}/modules`, { method: 'POST', body });
    },
    onSuccess: onDone,
  });
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value });
  return <form onSubmit={e => { e.preventDefault(); save.mutate(); }} className="space-y-3 rounded-md border border-[hsl(var(--primary)/.4)] bg-[hsl(var(--secondary)/.35)] p-4">
    <div className="grid gap-3 sm:grid-cols-2">
      <label className="text-xs font-bold">Module title<input required value={form.title} onChange={set('title')} className={field} /></label>
      <label className="text-xs font-bold">Description<input value={form.description} onChange={set('description')} className={field} /></label>
    </div>
    <div className="grid gap-3 sm:grid-cols-3">
      <label className="text-xs font-bold">Unlocks at (KSh paid)<input type="number" min={0} value={form.unlockAmount} onChange={set('unlockAmount')} className={field} /></label>
      <label className="text-xs font-bold">Lessons<input type="number" min={0} value={form.lessonCount} onChange={set('lessonCount')} className={field} /></label>
      <label className="text-xs font-bold">Duration<input value={form.duration} onChange={set('duration')} placeholder="2h 30m" className={field} /></label>
    </div>
    <ErrorNote error={save.error} />
    <div className="flex gap-2"><button disabled={save.isPending} className={primaryBtn}><Save size={14} /> {module ? 'Save module' : 'Add module'}</button><button type="button" onClick={onCancel} className={ghostBtn}><X size={14} /> Cancel</button></div>
  </form>;
}

// ---------------------------------------------------------------------------
// Users
// ---------------------------------------------------------------------------

export function AdminUsersPage() {
  const client = useQueryClient();
  const me = useCurrentUser().data;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  useEffect(() => { const t = setTimeout(() => setQuery(search), 250); return () => clearTimeout(t); }, [search]);
  const users = useQuery({ queryKey: ['admin', 'users', query], queryFn: () => api<AdminUser[]>(`/admin/users?search=${encodeURIComponent(query)}`) });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; role?: Role; active?: boolean }) => api(`/admin/users/${id}`, { method: 'PATCH', body }),
    onSuccess: () => client.invalidateQueries({ queryKey: ['admin'] }),
  });
  return <AdminFrame title="Users" copy="Find learners, change roles, and disable accounts that shouldn't have access.">
    <div className="relative mb-5"><Search className="absolute left-3.5 top-3 text-[hsl(var(--muted-foreground))]" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or phone" className={`${field} mt-0 pl-10`} data-testid="input-user-search" /></div>
    <ErrorNote error={update.error} />
    <div className={`${card} mt-3 overflow-hidden`}>
      <div className="hidden grid-cols-[1.4fr_1fr_.8fr_.7fr] gap-4 border-b border-[hsl(var(--border))] px-5 py-3 text-[10px] font-bold uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))] md:grid"><span>User</span><span>Joined</span><span>Role</span><span>Access</span></div>
      {users.isLoading && <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">Loading…</p>}
      {users.data?.length === 0 && <p className="p-5 text-sm text-[hsl(var(--muted-foreground))]">No users match that search.</p>}
      {users.data?.map(u => {
        const self = u.id === me?.id;
        return <div key={u.id} className="grid gap-3 border-b border-[hsl(var(--border))] px-5 py-4 last:border-0 md:grid-cols-[1.4fr_1fr_.8fr_.7fr] md:items-center md:gap-4" data-testid={`row-user-${u.id}`}>
          <div className="min-w-0"><p className="truncate text-sm font-bold">{u.name}{self && <span className="ml-2 text-[10px] font-normal text-[hsl(var(--muted-foreground))]">(you)</span>}</p><p className="truncate text-xs text-[hsl(var(--muted-foreground))]">{u.email}{u.phone ? ` · ${u.phone}` : ''}</p></div>
          <span className="text-xs text-[hsl(var(--muted-foreground))]">{new Date(u.createdAt).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</span>
          <select disabled={self || update.isPending} value={u.role} onChange={e => update.mutate({ id: u.id, role: e.target.value as Role })} className={`${field} mt-0 h-9 text-xs`} aria-label={`Role for ${u.name}`}>
            <option value="student">Student</option><option value="instructor">Instructor</option><option value="admin">Admin</option>
          </select>
          <button disabled={self || update.isPending} onClick={() => update.mutate({ id: u.id, active: !u.active })} className={`${ghostBtn} ${u.active ? '' : 'text-[hsl(var(--destructive))]'}`}>{u.active ? 'Active' : 'Disabled'}</button>
        </div>;
      })}
    </div>
  </AdminFrame>;
}

// ---------------------------------------------------------------------------
// Payments
// ---------------------------------------------------------------------------

function PaymentsTable({ payments, actions }: { payments: AdminPayment[]; actions?: (p: AdminPayment) => ReactNode }) {
  if (payments.length === 0) return <p className={`${card} p-6 text-center text-sm text-[hsl(var(--muted-foreground))]`}>No payments yet.</p>;
  return <div className={`${card} overflow-hidden`}>
    {payments.map(p => <div key={p.id} className="flex flex-wrap items-center gap-x-4 gap-y-2 border-b border-[hsl(var(--border))] px-5 py-4 last:border-0" data-testid={`row-admin-payment-${p.id}`}>
      <div className="min-w-[180px] flex-1"><p className="text-sm font-bold">{p.studentName ?? `User #${p.userId}`}<span className="font-normal text-[hsl(var(--muted-foreground))]"> · {p.courseTitle}</span></p><p className="mt-0.5 text-xs text-[hsl(var(--muted-foreground))]">{new Date(p.date).toLocaleString('en-KE', { dateStyle: 'medium', timeStyle: 'short' })} · {p.phoneNumber}{p.receipt ? ` · ${p.receipt}` : ''}</p></div>
      <span className="font-mono-ui text-sm">{money(p.amount)}</span>
      <StatusPill status={p.status} />
      {actions?.(p)}
    </div>)}
  </div>;
}

export function AdminPaymentsPage() {
  const client = useQueryClient();
  const [status, setStatus] = useState('');
  const payments = useQuery({ queryKey: ['admin', 'payments', status], queryFn: () => api<AdminPayment[]>(`/admin/payments${status ? `?status=${status}` : ''}`) });
  const update = useMutation({
    mutationFn: ({ id, ...body }: { id: number; status: string; receipt?: string }) => api(`/admin/payments/${id}`, { method: 'PATCH', body }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['admin'] }); },
  });
  const mpesa = useQuery({ queryKey: ['admin', 'mpesa'], queryFn: () => api<{ configured: boolean; environment: string; missing: string[] }>('/admin/mpesa') });
  const check = useMutation({
    mutationFn: (id: number) => api<{ status: string; message: string }>(`/admin/payments/${id}/check`, { method: 'POST' }),
    onSuccess: r => { alert(`M-Pesa says: ${r.message || r.status}`); client.invalidateQueries({ queryKey: ['admin'] }); },
  });
  const confirmPayment = (p: AdminPayment) => {
    const receipt = prompt(`Confirm ${money(p.amount)} from ${p.studentName}.\n\nM-Pesa receipt code (optional):`, p.receipt ?? '');
    if (receipt !== null) update.mutate({ id: p.id, status: 'completed', receipt });
  };
  return <AdminFrame title="Payments" copy="Every M-Pesa request. Confirm a payment by hand if Safaricom's callback never arrived; confirmed money unlocks modules straight away.">
    <div className="mb-5 flex gap-2 overflow-x-auto">
      {['', 'pending', 'completed', 'failed', 'cancelled', 'refunded'].map(s => <button key={s || 'all'} onClick={() => setStatus(s)} className={`whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold capitalize transition ${status === s ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`}>{s || 'All'}</button>)}
    </div>
    {mpesa.data && (mpesa.data.configured
      ? <p className="mb-5 flex items-center gap-2 rounded-md bg-[hsl(var(--primary)/.08)] p-3 text-xs text-[hsl(var(--primary))]" data-testid="status-mpesa"><Check size={14} /> M-Pesa connected ({mpesa.data.environment}). Payments confirm automatically when Safaricom calls back.</p>
      : <p className="mb-5 rounded-md border border-[hsl(var(--accent)/.55)] bg-[hsl(var(--accent)/.1)] p-3 text-xs leading-5" data-testid="status-mpesa"><strong>M-Pesa isn't connected yet.</strong> Students' payments are recorded as pending and you confirm them here by hand. To connect, fill in <code className="rounded bg-[hsl(var(--muted))] px-1">{mpesa.data.missing.join(', ')}</code> in <code className="rounded bg-[hsl(var(--muted))] px-1">artifacts/api-server/.env</code> and restart the server.</p>)}
    <ErrorNote error={update.error || check.error || payments.error} />
    {payments.isLoading ? <div className="skeleton h-40 rounded-lg bg-[hsl(var(--muted))]" /> : <PaymentsTable payments={payments.data || []} actions={p => p.status === 'pending' ? <div className="flex gap-2">
      {mpesa.data?.configured && p.checkoutRequestId && !p.checkoutRequestId.startsWith('manual_') && <button disabled={check.isPending} onClick={() => check.mutate(p.id)} className={ghostBtn} data-testid={`button-check-payment-${p.id}`}><Clock3 size={14} /> Check M-Pesa</button>}
      <button disabled={update.isPending} onClick={() => confirmPayment(p)} className={primaryBtn} data-testid={`button-confirm-payment-${p.id}`}><Check size={14} /> Confirm</button>
      <button disabled={update.isPending} onClick={() => { if (confirm('Mark this payment as failed?')) update.mutate({ id: p.id, status: 'failed' }); }} className={ghostBtn}>Mark failed</button>
    </div> : p.status === 'completed' ? <button disabled={update.isPending} onClick={() => { if (confirm(`Refund ${money(p.amount)}? The student will lose access this payment unlocked.`)) update.mutate({ id: p.id, status: 'refunded' }); }} className={ghostBtn}>Mark refunded</button> : null} />}
  </AdminFrame>;
}
