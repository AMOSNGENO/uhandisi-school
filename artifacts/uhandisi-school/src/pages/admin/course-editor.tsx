import { type FormEvent, type ReactNode, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation, useParams } from 'wouter';
import { Check, ExternalLink, Eye, EyeOff, Save, Trash2 } from 'lucide-react';
import { api } from '@/lib/auth';
import type { AdminCourse, CourseFields } from './types';
import CourseContent from './content';
import Participants from './participants';
import CourseResults from './results';
import { AdminLayout, Badge, card, dangerBtn, EditorField, ErrorNote, field, ghostBtn, hint, ImageUpload, label, Loading, primaryBtn, Tabs } from './ui';

const blank: CourseFields = {
  title: '', category: '', description: '', price: 0, paymentModel: 'lipa_pole_pole', accent: '#0B2D5C', imageUrl: '',
  instructor: '', instructorRole: '', planName: 'Flex', planAmountPerDay: 100, planDescription: '', published: false, overviewHtml: '', certificateTemplateId: null,
};

/** /admin/courses/new, /admin/courses/:id, /admin/courses/:id/content, /admin/courses/:id/participants */
export default function CourseEditorPage() {
  const params = useParams<{ id: string; tab?: string }>();
  const isNew = params.id === 'new';
  const courseId = Number(params.id);
  const tab = params.tab ?? 'settings';
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: () => api<AdminCourse[]>('/admin/courses'), enabled: !isNew });
  const course = courses.data?.find(c => c.id === courseId);
  const crumb = <><Link href="/admin/courses" className="hover:text-[hsl(var(--link))]">Courses</Link> <span className="mx-1">/</span> {isNew ? 'New course' : course?.title ?? '…'}</>;

  if (isNew) return <AdminLayout title="New course" breadcrumb={crumb} description="Start with the basics. You can add sections, activities and participants once it's created.">
    <SettingsForm initial={blank} />
  </AdminLayout>;
  if (courses.isLoading) return <AdminLayout title="Course" breadcrumb={crumb}><Loading height={300} /></AdminLayout>;
  if (!course) return <AdminLayout title="Course not found" breadcrumb={crumb}><ErrorNote error={courses.error ?? new Error('That course does not exist or was deleted.')} /></AdminLayout>;

  const base = `/admin/courses/${course.id}`;
  return <AdminLayout title={course.title} breadcrumb={crumb}
    description={`${course.category} · ${course.modules.length} ${course.modules.length === 1 ? 'section' : 'sections'} · ${course.enrolledCount ?? 0} ${course.enrolledCount === 1 ? 'learner' : 'learners'}`}
    actions={<>{course.published ? <Badge tone="good">Published</Badge> : <Badge>Hidden from students</Badge>}<Link href={`/courses/${course.id}`} className={ghostBtn}><ExternalLink size={13} /> View as student</Link></>}>
    <Tabs tabs={[
      { href: base, label: 'Settings' },
      { href: `${base}/content`, label: 'Content', count: course.modules.length },
      { href: `${base}/participants`, label: 'Participants', count: course.enrolledCount ?? 0 },
      { href: `${base}/results`, label: 'Results' },
    ]} />
    {tab === 'content' ? <CourseContent course={course} />
      : tab === 'participants' ? <Participants courseId={course.id} />
      : tab === 'results' ? <CourseResults courseId={course.id} />
        : <SettingsForm key={course.id} initial={course} courseId={course.id} />}
  </AdminLayout>;
}

function Section({ title, description, children }: { title: string; description?: string; children: ReactNode }) {
  return <section className="grid gap-4 border-b border-[hsl(var(--border))] py-6 first:pt-0 last:border-0 lg:grid-cols-[220px_1fr] lg:gap-8">
    <div><h2 className="text-sm font-bold">{title}</h2>{description && <p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{description}</p>}</div>
    <div className="min-w-0 space-y-4">{children}</div>
  </section>;
}

function SettingsForm({ initial, courseId }: { initial: CourseFields; courseId?: number }) {
  const client = useQueryClient();
  const [, navigate] = useLocation();
  const [form, setForm] = useState<CourseFields>({ ...blank, ...initial });
  const categories = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api<Array<{ name: string }>>('/admin/categories') });
  const designs = useQuery({ queryKey: ['admin', 'cert-templates'], queryFn: () => api<Array<{ id: number; name: string; isDefault: boolean }>>('/admin/certificate-templates') });
  const defaultDesign = designs.data?.find(d => d.isDefault);
  const refresh = () => {
    client.invalidateQueries({ queryKey: ['admin'] });
    client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'admin' && q.queryKey[0] !== 'auth' });
  };
  const save = useMutation({
    mutationFn: () => {
      const { title, category, description, price, paymentModel, accent, imageUrl, instructor, instructorRole, planName, planAmountPerDay, planDescription, published, overviewHtml, certificateTemplateId } = form;
      const body = { title, category, description, price: Number(price), paymentModel, accent, imageUrl, instructor, instructorRole, planName, planAmountPerDay: Number(planAmountPerDay), planDescription, published, overviewHtml, certificateTemplateId: certificateTemplateId ?? null };
      return courseId ? api<AdminCourse>(`/admin/courses/${courseId}`, { method: 'PATCH', body }) : api<AdminCourse>('/admin/courses', { method: 'POST', body });
    },
    onSuccess: c => { refresh(); if (!courseId) navigate(`/admin/courses/${c.id}/content`); },
  });
  const remove = useMutation({
    mutationFn: () => api(`/admin/courses/${courseId}`, { method: 'DELETE' }),
    onSuccess: () => { refresh(); navigate('/admin/courses'); },
  });
  const set = <K extends keyof CourseFields>(key: K) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement | HTMLSelectElement>) =>
    setForm(f => ({ ...f, [key]: e.target.type === 'number' ? Number(e.target.value) : e.target.value }));
  const submit = (e: FormEvent) => { e.preventDefault(); save.mutate(); };
  const free = form.paymentModel === 'free';

  return <form onSubmit={submit} className={`${card} p-5 sm:p-7`} data-testid="form-course-settings">
    <Section title="General" description="What students see first.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Course name<input required value={form.title} onChange={set('title')} className={field} data-testid="input-course-title" /></label>
        <label className={label}>Category<input required list="category-options" value={form.category} onChange={set('category')} className={field} placeholder="Pick or type a new one" data-testid="input-course-category" />
          <datalist id="category-options">{categories.data?.map(c => <option key={c.name} value={c.name} />)}</datalist></label>
      </div>
      <label className={label}>Short summary <span className={hint}>(shown on course cards)</span><textarea required rows={2} value={form.description} onChange={set('description')} className={`${field} h-auto py-2`} data-testid="input-course-summary" /></label>
      <div className="flex items-center justify-between gap-4 rounded-md border border-[hsl(var(--border))] p-3">
        <div><p className="text-sm font-bold">{form.published ? 'Visible to students' : 'Hidden from students'}</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{form.published ? 'Shown on the course list.' : 'Only admins can see it. Publish when it’s ready.'}</p></div>
        <button type="button" role="switch" aria-checked={form.published} onClick={() => setForm(f => ({ ...f, published: !f.published }))} className={`${ghostBtn} ${form.published ? 'border-[hsl(145_55%_40%/.5)] text-[hsl(145_55%_28%)]' : ''}`} data-testid="button-toggle-published">
          {form.published ? <><Eye size={14} /> Published</> : <><EyeOff size={14} /> Hidden</>}
        </button>
      </div>
    </Section>
    <Section title="Description" description="The “About this course” text on the course page. Type, paste from Word, or use the <> button for HTML.">
      <EditorField value={form.overviewHtml} onChange={overviewHtml => setForm(f => ({ ...f, overviewHtml }))} height={320} />
    </Section>
    <Section title="Course image" description="Shown on course cards and the course page.">
      <ImageUpload value={form.imageUrl} onChange={imageUrl => setForm(f => ({ ...f, imageUrl }))} />
      <label className={`${label} w-40`}>Fallback colour <span className={hint}>(when there’s no image)</span><input type="color" value={form.accent} onChange={set('accent')} className={`${field} p-1`} /></label>
    </Section>
    <Section title="Price & payment" description="Free courses open every section. Paid sections unlock as a student’s confirmed payments reach each section’s unlock amount.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Payment type<select value={form.paymentModel} onChange={set('paymentModel')} className={field} data-testid="select-payment-model"><option value="lipa_pole_pole">Lipa Pole Pole (pay as you go)</option><option value="paid">Paid</option><option value="free">Free</option></select></label>
        <label className={label}>Full price (KSh)<input type="number" min={0} value={free ? 0 : form.price} onChange={set('price')} disabled={free} className={field} data-testid="input-course-price" /></label>
      </div>
      {!free && <div className="grid gap-4 sm:grid-cols-3">
        <label className={label}>Plan name<input value={form.planName} onChange={set('planName')} className={field} /></label>
        <label className={label}>Suggested KSh / day<input type="number" min={0} value={form.planAmountPerDay} onChange={set('planAmountPerDay')} className={field} /></label>
        <label className={label}>Plan description<input value={form.planDescription} onChange={set('planDescription')} className={field} /></label>
      </div>}
    </Section>
    <Section title="Certificate" description="The design used for this course’s certificates. Manage designs under Admin → Certificates.">
      <label className={label}>Certificate design
        <select value={form.certificateTemplateId ?? ''} onChange={e => setForm(f => ({ ...f, certificateTemplateId: e.target.value ? Number(e.target.value) : null }))} className={field} data-testid="select-certificate-design">
          <option value="">Default ({defaultDesign ? defaultDesign.name : 'built-in Uhandisi design'})</option>
          {designs.data?.filter(d => !d.isDefault).map(d => <option key={d.id} value={d.id}>{d.name}</option>)}
        </select></label>
    </Section>
    <Section title="Teacher" description="Shown in the course header.">
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Instructor name<input value={form.instructor} onChange={set('instructor')} className={field} /></label>
        <label className={label}>Instructor role<input value={form.instructorRole} onChange={set('instructorRole')} className={field} placeholder="e.g. Data analyst & educator" /></label>
      </div>
    </Section>
    <ErrorNote error={save.error || remove.error} />
    <div className="sticky bottom-[76px] z-10 -mx-5 -mb-5 mt-2 flex flex-wrap items-center gap-2 border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-5 py-4 backdrop-blur sm:-mx-7 sm:-mb-7 sm:px-7 lg:bottom-0">
      <button disabled={save.isPending} className={primaryBtn} data-testid="button-save-course"><Save size={14} /> {save.isPending ? 'Saving…' : courseId ? 'Save changes' : 'Create course'}</button>
      {save.isSuccess && courseId && <span className="flex items-center gap-1 text-xs font-bold text-[hsl(145_55%_28%)]" data-testid="status-saved"><Check size={13} /> Saved</span>}
      {!courseId && <Link href="/admin/courses" className={ghostBtn}>Cancel</Link>}
      {courseId && <button type="button" disabled={remove.isPending} onClick={() => { if (confirm(`Delete "${form.title}" with all its sections, activities and uploaded files? This can't be undone.`)) remove.mutate(); }} className={`${dangerBtn} ml-auto`} data-testid="button-delete-course"><Trash2 size={14} /> Delete course</button>}
    </div>
  </form>;
}
