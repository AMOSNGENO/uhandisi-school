import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ExternalLink, Plus, Search, Upload } from 'lucide-react';
import { api } from '@/lib/auth';
import type { AdminCourse } from './types';
import { AdminLayout, Badge, card, ErrorNote, field, ghostBtn, label, Loading, Modal, money, primaryBtn, td, th } from './ui';

export const priceLabel = (c: Pick<AdminCourse, 'paymentModel' | 'price'>) =>
  c.paymentModel === 'free' ? 'Free' : c.paymentModel === 'lipa_pole_pole' ? `${money(c.price)} · pay as you go` : money(c.price);

export default function AdminCoursesPage() {
  const courses = useQuery({ queryKey: ['admin', 'courses'], queryFn: () => api<AdminCourse[]>('/admin/courses') });
  const [search, setSearch] = useState('');
  const [category, setCategory] = useState('');
  const [status, setStatus] = useState<'' | 'published' | 'hidden'>('');
  const [picking, setPicking] = useState(() => new URLSearchParams(window.location.search).has('upload'));
  const [, navigate] = useLocation();
  const list = courses.data || [];
  const categories = Array.from(new Set(list.map(c => c.category))).sort();
  const shown = list.filter(c =>
    (!category || c.category === category) &&
    (!status || (status === 'published') === c.published) &&
    `${c.title} ${c.category} ${c.instructor}`.toLowerCase().includes(search.toLowerCase()));

  return <AdminLayout title="Courses" description="Every course in the school. Open one to edit its settings, content and participants."
    actions={<>
      <button onClick={() => setPicking(true)} className={primaryBtn} data-testid="button-upload-content"><Upload size={15} /> Upload PDF or IMS zip</button>
      <Link href="/admin/courses/new" className={ghostBtn} data-testid="button-new-course"><Plus size={15} /> New course</Link>
    </>}>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-[1.3rem] text-[hsl(var(--muted-foreground))]" size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search courses" className={`${field} pl-9`} aria-label="Search courses" data-testid="input-course-search" /></div>
      <select value={category} onChange={e => setCategory(e.target.value)} className={`${field} sm:w-52`} aria-label="Category"><option value="">All categories</option>{categories.map(c => <option key={c}>{c}</option>)}</select>
      <select value={status} onChange={e => setStatus(e.target.value as typeof status)} className={`${field} sm:w-40`} aria-label="Visibility"><option value="">Any visibility</option><option value="published">Published</option><option value="hidden">Hidden</option></select>
    </div>
    <ErrorNote error={courses.error} />
    {courses.isLoading ? <Loading /> : shown.length === 0
      ? <div className={`${card} p-10 text-center`}><p className="font-bold">{list.length ? 'No courses match those filters.' : 'No courses yet.'}</p>{!list.length && <Link href="/admin/courses/new" className={`${primaryBtn} mt-4`}><Plus size={15} /> Create the first course</Link>}</div>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[760px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Course</th><th className={th}>Category</th><th className={th}>Price</th><th className={`${th} text-right`}>Sections</th><th className={`${th} text-right`}>Learners</th><th className={th}>Visibility</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {shown.map(c => <tr key={c.id} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-course-${c.id}`}>
              <td className={td}><Link href={`/admin/courses/${c.id}`} className="flex items-center gap-3" data-testid={`link-edit-course-${c.id}`}>
                <span className="grid h-10 w-16 shrink-0 place-items-center overflow-hidden rounded bg-[hsl(var(--muted))]" style={{ background: c.imageUrl ? undefined : c.accent }}>{c.imageUrl && <img src={c.imageUrl} alt="" className="size-full object-cover" />}</span>
                <span className="min-w-0"><span className="block truncate font-bold text-[hsl(var(--link))] hover:underline">{c.title}</span><span className="block truncate text-xs text-[hsl(var(--muted-foreground))]">{c.instructor || 'No instructor set'}</span></span>
              </Link></td>
              <td className={td}>{c.category}</td>
              <td className={`${td} whitespace-nowrap`}>{priceLabel(c)}</td>
              <td className={`${td} text-right font-mono-ui`}>{c.modules.length}</td>
              <td className={`${td} text-right font-mono-ui`}>{c.enrolledCount ?? 0}</td>
              <td className={td}>{c.published ? <Badge tone="good">Published</Badge> : <Badge>Hidden</Badge>}</td>
              <td className={`${td} text-right`}><div className="flex justify-end gap-2">
                <Link href={`/admin/courses/${c.id}/content?upload=1`} className={ghostBtn} title="Upload a PDF or IMS/SCORM zip to this course" data-testid={`button-upload-${c.id}`}><Upload size={13} /> Upload</Link>
                <Link href={`/admin/courses/${c.id}`} className={ghostBtn}>Edit</Link>
                <Link href={`/courses/${c.id}`} className={ghostBtn} title="View as a student"><ExternalLink size={13} /></Link>
              </div></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {picking && !courses.isLoading && <PickCourse courses={list} onPick={id => navigate(`/admin/courses/${id}/content?upload=1`)} onClose={() => setPicking(false)} />}
  </AdminLayout>;
}

/** Upload starts from a course: choose it (or create one first). */
function PickCourse({ courses, onPick, onClose }: { courses: AdminCourse[]; onPick: (id: number) => void; onClose: () => void }) {
  const [picked, setId] = useState<number | null>(null);
  // Default to the first course until the admin picks one.
  const id = picked ?? courses[0]?.id ?? 0;
  return <Modal title="Upload a PDF or IMS/SCORM zip" onClose={onClose}>
    {courses.length === 0
      ? <div className="space-y-4 text-sm"><p>Uploads go into a course, and there are no courses yet.</p><Link href="/admin/courses/new" className={primaryBtn}><Plus size={15} /> Create a course first</Link></div>
      : <form onSubmit={e => { e.preventDefault(); onPick(id); }} className="space-y-4" data-testid="form-pick-course">
        <label className={label}>Which course is it for?<select autoFocus value={id} onChange={e => setId(Number(e.target.value))} className={field} data-testid="select-upload-course">{courses.map(c => <option key={c.id} value={c.id}>{c.title}</option>)}</select></label>
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Next you'll choose the file and the section it goes in. For a brand-new course, <Link href="/admin/courses/new" className="font-bold text-[hsl(var(--link))] hover:underline">create it first</Link>.</p>
        <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={ghostBtn}>Cancel</button><button className={primaryBtn} data-testid="button-pick-course"><Upload size={14} /> Continue</button></div>
      </form>}
  </Modal>;
}
