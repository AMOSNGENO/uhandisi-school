import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { ArrowDown, ArrowUp, BarChart3, BookOpen, ClipboardCheck, Eye, FileText, Link2, Package, Paperclip, Pencil, Plus, Save, Trash2, Upload } from 'lucide-react';
import { api } from '@/lib/auth';
import type { ActivityKind, AdminActivity, AdminCourse, AdminModule } from './types';
import { QuizAttempts, QuizEditor } from './quiz-editor';
import {
  Badge, card, EditorField, ErrorNote, field, FileDrop, fileSizeLabel, ghostBtn, hint, iconBtn, label, Modal, money, primaryBtn, uploadWithProgress,
} from './ui';

export const kinds: Record<ActivityKind, { name: string; icon: typeof FileText; blurb: string; tone: string }> = {
  page: { name: 'Page', icon: FileText, tone: 'bg-[hsl(218_85%_43%/.1)] text-[hsl(218_85%_40%)]', blurb: 'Write or paste content: text, headings, images, YouTube videos and tables, like a Word document.' },
  file: { name: 'File', icon: Paperclip, tone: 'bg-[hsl(28_85%_50%/.12)] text-[hsl(24_80%_36%)]', blurb: 'Upload a PDF, Word, PowerPoint, Excel, audio or video file. PDFs open for students as a book to read (no download).' },
  url: { name: 'URL', icon: Link2, tone: 'bg-[hsl(170_60%_36%/.12)] text-[hsl(170_65%_26%)]', blurb: 'Link to a website, article, form or other online resource.' },
  quiz: { name: 'Exam / Quiz', icon: ClipboardCheck, tone: 'bg-[hsl(145_55%_40%/.12)] text-[hsl(145_60%_26%)]', blurb: 'Multiple-choice questions (one or several right answers, true/false), marked automatically. Passing the exams earns the course certificate.' },
  package: { name: 'IMS content package / SCORM', icon: Package, tone: 'bg-[hsl(275_45%_48%/.12)] text-[hsl(275_45%_38%)]', blurb: 'Upload a .zip exported from an authoring tool (Articulate, iSpring, Adapt, Moodle…). Students read it page by page, like a book.' },
};

const FILE_ACCEPT = '.pdf,.doc,.docx,.ppt,.pptx,.xls,.xlsx,.odt,.odp,.ods,.txt,.csv,.zip,.mp4,.webm,.mp3,.m4a,.wav,.png,.jpg,.jpeg,.gif,.webp';

function useRefresh() {
  const client = useQueryClient();
  return () => {
    client.invalidateQueries({ queryKey: ['admin'] });
    client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'admin' && q.queryKey[0] !== 'auth' });
  };
}

function reorder<T extends { id: number }>(list: T[], index: number, delta: number) {
  const ids = list.map(x => x.id);
  const [id] = ids.splice(index, 1);
  ids.splice(index + delta, 0, id!);
  return ids;
}

export default function CourseContent({ course }: { course: AdminCourse }) {
  const refresh = useRefresh();
  const [editingSection, setEditingSection] = useState<AdminModule | 'new' | null>(null);
  const [quickUpload, setQuickUpload] = useState(() => new URLSearchParams(window.location.search).has('upload'));
  const move = useMutation({
    mutationFn: (moduleIds: number[]) => api(`/admin/courses/${course.id}/module-order`, { method: 'PUT', body: { moduleIds } }),
    onSuccess: refresh,
  });
  return <div className="space-y-4" data-testid="course-content">
    <div className="flex flex-wrap items-center justify-between gap-3">
      <p className="max-w-xl text-sm text-[hsl(var(--muted-foreground))]">{course.paymentModel === 'free'
        ? 'This course is free, so every section is open to enrolled students.'
        : 'Each section unlocks once a student’s confirmed payments reach its unlock amount.'}</p>
      <div className="flex flex-wrap gap-2">
        <button onClick={() => setQuickUpload(true)} className={primaryBtn} data-testid="button-quick-upload"><Upload size={15} /> Upload PDF or IMS/SCORM zip</button>
        <button onClick={() => setEditingSection('new')} className={ghostBtn} data-testid="button-add-section"><Plus size={15} /> Add section</button>
      </div>
    </div>
    <ErrorNote error={move.error} />
    {course.modules.length === 0 && <div className={`${card} p-10 text-center`}><p className="font-bold">No sections yet</p><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Sections group the activities students work through, like “Week 1” or “Introduction”.</p></div>}
    {course.modules.map((m, i) => <SectionCard key={m.id} course={course} module={m} index={i}
      onEdit={() => setEditingSection(m)}
      onMove={d => move.mutate(reorder(course.modules, i, d))} moving={move.isPending} last={i === course.modules.length - 1} />)}
    {editingSection && <SectionForm course={course} module={editingSection === 'new' ? undefined : editingSection} onClose={() => setEditingSection(null)} />}
    {quickUpload && <QuickUpload course={course} onClose={() => setQuickUpload(false)} />}
  </div>;
}

/** One-step upload: a PDF (read as a book) or an IMS/SCORM zip, into an existing or new section. */
function QuickUpload({ course, onClose }: { course: AdminCourse; onClose: () => void }) {
  const refresh = useRefresh();
  const [file, setFile] = useState<File | null>(null);
  const [title, setTitle] = useState('');
  const [section, setSection] = useState<string>(course.modules[0] ? String(course.modules[0].id) : 'new');
  const [newSection, setNewSection] = useState(course.modules.length ? '' : 'Course content');
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const ext = file?.name.split('.').pop()?.toLowerCase();
  const kind: ActivityKind | null = ext === 'pdf' ? 'file' : ext === 'zip' ? 'package' : null;

  const pick = (f: File) => {
    setFile(f);
    setError(null);
    // Name it after the file until the admin types something else.
    if (!title) setTitle(f.name.replace(/\.[^.]+$/, '').replace(/[_-]+/g, ' ').trim());
  };

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (!file || !kind) { setError(new Error('Choose a .pdf or .zip file.')); return; }
    setBusy(true);
    setError(null);
    try {
      let moduleId = Number(section);
      if (section === 'new') {
        const updated = await api<AdminCourse>(`/admin/courses/${course.id}/modules`, { method: 'POST', body: { title: newSection.trim() || 'Course content', unlockAmount: 0 } });
        moduleId = Math.max(...updated.modules.map(m => m.id));
      }
      const list = await api<AdminActivity[]>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body: { title: title.trim() || file.name, kind } });
      const activityId = Math.max(...list.map(l => l.id));
      await uploadWithProgress(`/api/admin/lessons/${activityId}/${kind === 'package' ? 'package' : 'file'}`, file, setProgress);
      refresh();
      onClose();
    } catch (err) {
      setError(err);
      refresh();
    } finally {
      setBusy(false);
    }
  };

  return <Modal title="Upload course content" onClose={() => !busy && onClose()}>
    <form onSubmit={submit} className="space-y-4" data-testid="form-quick-upload">
      <FileDrop accept=".pdf,.zip,application/pdf,application/zip" busy={busy} progress={progress} onFile={pick} testId="input-quick-upload"
        hintText="a PDF (up to 200 MB) or an IMS / SCORM .zip (up to 300 MB)">
        {file && !busy && <p className="mb-3 flex items-center justify-center gap-2 text-sm font-bold">{kind === 'package' ? <Package size={16} /> : <BookOpen size={16} />}{file.name}</p>}
      </FileDrop>
      {file && !kind && <p className="text-xs text-[hsl(var(--destructive))]">Only .pdf and .zip files can be uploaded here. Use “Add an activity or resource” for other files.</p>}
      {kind && <p className="rounded-md bg-[hsl(var(--secondary))] p-3 text-xs leading-5">{kind === 'file'
        ? 'Students will read this PDF as a book, already open, with page turning and no download button.'
        : 'The zip is unpacked and students read it page by page. It must contain an imsmanifest.xml (IMS and SCORM packages do).'}</p>}
      <label className={label}>Name students will see<input required value={title} onChange={e => setTitle(e.target.value)} className={field} placeholder="e.g. Chapter 1: Introduction" data-testid="input-quick-title" /></label>
      <label className={label}>Put it in
        <select value={section} onChange={e => setSection(e.target.value)} className={field} data-testid="select-quick-section">
          {course.modules.map((m, i) => <option key={m.id} value={m.id}>Section {i + 1}: {m.title}</option>)}
          <option value="new">+ A new section…</option>
        </select>
      </label>
      {section === 'new' && <label className={label}>New section name<input required value={newSection} onChange={e => setNewSection(e.target.value)} className={field} data-testid="input-quick-section-name" /><span className={`${hint} mt-1 block`}>{course.paymentModel === 'free' ? 'Open to every enrolled student.' : 'Open without payment. Set an unlock amount afterwards with the section’s edit button.'}</span></label>}
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className={ghostBtn}>Cancel</button><button disabled={busy || !kind} className={primaryBtn} data-testid="button-quick-save"><Upload size={14} /> {busy ? 'Uploading…' : 'Upload'}</button></div>
    </form>
  </Modal>;
}


function SectionCard({ course, module, index, last, onEdit, onMove, moving }: {
  course: AdminCourse; module: AdminModule; index: number; last: boolean; onEdit: () => void; onMove: (d: number) => void; moving: boolean;
}) {
  const refresh = useRefresh();
  const client = useQueryClient();
  const key = ['admin', 'lessons', module.id];
  const activities = useQuery({ queryKey: key, queryFn: () => api<AdminActivity[]>(`/admin/modules/${module.id}/lessons`) });
  const [chooser, setChooser] = useState(false);
  const [editing, setEditing] = useState<{ kind: ActivityKind; activity?: AdminActivity } | null>(null);
  const [resultsFor, setResultsFor] = useState<AdminActivity | null>(null);
  const list = activities.data || [];
  const after = (l: AdminActivity[]) => { client.setQueryData(key, l); refresh(); };
  const remove = useMutation({ mutationFn: () => api(`/admin/modules/${module.id}`, { method: 'DELETE' }), onSuccess: refresh });
  const moveActivity = useMutation({
    mutationFn: (lessonIds: number[]) => api<AdminActivity[]>(`/admin/modules/${module.id}/lesson-order`, { method: 'PUT', body: { lessonIds } }),
    onSuccess: after,
  });
  const removeActivity = useMutation({ mutationFn: (id: number) => api<AdminActivity[]>(`/admin/lessons/${id}`, { method: 'DELETE' }), onSuccess: after });

  return <section className={card} data-testid={`section-${module.id}`}>
    <header className="flex flex-wrap items-center gap-3 border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.5)] px-4 py-3">
      <div className="hidden sm:flex">
        <button disabled={index === 0 || moving} onClick={() => onMove(-1)} className={iconBtn} aria-label="Move section up"><ArrowUp size={15} /></button>
        <button disabled={last || moving} onClick={() => onMove(1)} className={iconBtn} aria-label="Move section down"><ArrowDown size={15} /></button>
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="truncate font-display text-base font-bold"><span className="mr-2 text-[hsl(var(--muted-foreground))]">{index + 1}.</span>{module.title}</h3>
        <div className="mt-1 flex flex-wrap gap-1.5">
          {course.paymentModel === 'free' ? <Badge tone="good">Open</Badge> : module.unlockAmount > 0 ? <Badge tone="warn">Unlocks at {money(module.unlockAmount)}</Badge> : <Badge tone="good">Open without payment</Badge>}
          {module.duration && <Badge>{module.duration}</Badge>}
          <Badge tone="info">{list.length} {list.length === 1 ? 'activity' : 'activities'}</Badge>
        </div>
      </div>
      <div className="flex gap-1">
        <Link href={`/courses/${course.id}/modules/${module.id}`} className={iconBtn} title="Preview as a student" aria-label="Preview section"><Eye size={15} /></Link>
        <button onClick={onEdit} className={iconBtn} aria-label="Edit section" data-testid={`button-edit-section-${module.id}`}><Pencil size={15} /></button>
        <button disabled={remove.isPending} onClick={() => { if (confirm(`Delete section "${module.title}" with its ${list.length} activities and their files?`)) remove.mutate(); }} className={`${iconBtn} hover:text-[hsl(var(--destructive))]`} aria-label="Delete section"><Trash2 size={15} /></button>
      </div>
    </header>
    <div className="p-2 sm:p-3">
      <ErrorNote error={activities.error || moveActivity.error || removeActivity.error || remove.error} />
      {activities.isLoading && <p className="p-3 text-xs text-[hsl(var(--muted-foreground))]">Loading…</p>}
      {list.map((a, i) => {
        const k = kinds[a.kind] ?? kinds.page;
        const Icon = k.icon;
        const meta = a.kind === 'file' ? (a.fileName ? `${a.fileName} · ${fileSizeLabel(a.fileSize)}` : 'No file uploaded yet')
          : a.kind === 'url' ? (a.externalUrl || 'No link set')
            : a.kind === 'package' ? (a.hasUpload ? `${a.fileType === 'scorm' ? 'SCORM' : 'IMS'} package · ${a.packageItems} items · ${a.fileName ?? ''}` : 'No package uploaded yet')
              : a.kind === 'quiz' ? 'Exam: marked automatically'
                : k.name;
        const missing = (a.kind === 'file' || a.kind === 'package') && !a.hasUpload;
        return <div key={a.id} className="group flex items-center gap-3 rounded-md px-2 py-2 hover:bg-[hsl(var(--secondary)/.6)]" data-testid={`activity-${a.id}`}>
          <div className="hidden opacity-60 group-hover:opacity-100 sm:flex">
            <button disabled={i === 0 || moveActivity.isPending} onClick={() => moveActivity.mutate(reorder(list, i, -1))} className={iconBtn} aria-label="Move up"><ArrowUp size={13} /></button>
            <button disabled={i === list.length - 1 || moveActivity.isPending} onClick={() => moveActivity.mutate(reorder(list, i, 1))} className={iconBtn} aria-label="Move down"><ArrowDown size={13} /></button>
          </div>
          <span className={`grid size-9 shrink-0 place-items-center rounded-md ${k.tone}`}><Icon size={17} /></span>
          <button onClick={() => setEditing({ kind: a.kind, activity: a })} className="min-w-0 flex-1 text-left">
            <span className="block truncate text-sm font-bold text-[hsl(var(--link))] hover:underline">{a.title}</span>
            <span className={`block truncate text-xs ${missing ? 'text-[hsl(var(--destructive))]' : 'text-[hsl(var(--muted-foreground))]'}`}>{meta}</span>
          </button>
          {a.kind === 'quiz' && <button onClick={() => setResultsFor(a)} className={iconBtn} aria-label={`Results for ${a.title}`} title="Results" data-testid={`button-quiz-results-${a.id}`}><BarChart3 size={14} /></button>}
          <button onClick={() => setEditing({ kind: a.kind, activity: a })} className={iconBtn} aria-label={`Edit ${a.title}`} data-testid={`button-edit-activity-${a.id}`}><Pencil size={14} /></button>
          <button disabled={removeActivity.isPending} onClick={() => { if (confirm(`Delete "${a.title}"${a.hasUpload ? ' and its uploaded file' : ''}?`)) removeActivity.mutate(a.id); }} className={`${iconBtn} hover:text-[hsl(var(--destructive))]`} aria-label={`Delete ${a.title}`}><Trash2 size={14} /></button>
        </div>;
      })}
      {!activities.isLoading && list.length === 0 && <p className="px-3 py-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Nothing in this section yet.</p>}
      <button onClick={() => setChooser(true)} className="mt-1 flex w-full items-center justify-center gap-2 rounded-md border border-dashed border-[hsl(var(--input))] px-3 py-2.5 text-xs font-bold text-[hsl(var(--link))] transition hover:border-[hsl(var(--link))] hover:bg-[hsl(var(--link)/.04)]" data-testid={`button-add-activity-${module.id}`}><Plus size={14} /> Add an activity or resource</button>
    </div>
    {chooser && <Modal title="Add an activity or resource" onClose={() => setChooser(false)}>
      <div className="grid gap-2" data-testid="activity-chooser">
        {(Object.keys(kinds) as ActivityKind[]).map(kind => {
          const k = kinds[kind];
          const Icon = k.icon;
          return <button key={kind} onClick={() => { setChooser(false); setEditing({ kind }); }} className="flex items-start gap-4 rounded-lg border border-[hsl(var(--border))] p-4 text-left transition hover:border-[hsl(var(--link))] hover:bg-[hsl(var(--link)/.03)]" data-testid={`choose-${kind}`}>
            <span className={`grid size-11 shrink-0 place-items-center rounded-lg ${k.tone}`}><Icon size={20} /></span>
            <span><span className="block text-sm font-bold">{k.name}</span><span className="mt-0.5 block text-xs leading-5 text-[hsl(var(--muted-foreground))]">{k.blurb}</span></span>
          </button>;
        })}
      </div>
    </Modal>}
    {editing && (editing.kind === 'quiz'
      ? <QuizEditor moduleId={module.id} activity={editing.activity} onDone={after} onClose={() => setEditing(null)} />
      : <ActivityForm moduleId={module.id} kind={editing.kind} activity={editing.activity} onDone={after} onClose={() => setEditing(null)} />)}
    {resultsFor && <QuizAttempts lessonId={resultsFor.id} title={resultsFor.title} onClose={() => setResultsFor(null)} />}
  </section>;
}

function SectionForm({ course, module, onClose }: { course: AdminCourse; module?: AdminModule; onClose: () => void }) {
  const refresh = useRefresh();
  const [form, setForm] = useState({
    title: module?.title ?? '', description: module?.description ?? '', unlockAmount: module?.unlockAmount ?? 0, duration: module?.duration ?? '',
  });
  const save = useMutation({
    mutationFn: () => {
      const body = { ...form, unlockAmount: Number(form.unlockAmount) };
      return module ? api(`/admin/modules/${module.id}`, { method: 'PATCH', body }) : api(`/admin/courses/${course.id}/modules`, { method: 'POST', body });
    },
    onSuccess: () => { refresh(); onClose(); },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  return <Modal title={module ? 'Edit section' : 'Add section'} onClose={onClose}>
    <form onSubmit={e => { e.preventDefault(); save.mutate(); }} className="space-y-4" data-testid="form-section">
      <label className={label}>Section name<input required autoFocus value={form.title} onChange={set('title')} className={field} placeholder="e.g. Week 1: Getting started" data-testid="input-section-title" /></label>
      <label className={label}>Short description <span className={hint}>(optional)</span><input value={form.description} onChange={set('description')} className={field} /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        {course.paymentModel !== 'free' && <label className={label}>Unlocks at (KSh paid)<input type="number" min={0} value={form.unlockAmount} onChange={set('unlockAmount')} className={field} /><span className={`${hint} mt-1 block`}>0 = open to every enrolled student.</span></label>}
        <label className={label}>Duration <span className={hint}>(optional)</span><input value={form.duration} onChange={set('duration')} placeholder="e.g. 2h 30m" className={field} /></label>
      </div>
      <ErrorNote error={save.error} />
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={ghostBtn}>Cancel</button><button disabled={save.isPending} className={primaryBtn} data-testid="button-save-section"><Save size={14} /> {module ? 'Save section' : 'Add section'}</button></div>
    </form>
  </Modal>;
}

function ActivityForm({ moduleId, kind, activity, onDone, onClose }: {
  moduleId: number; kind: ActivityKind; activity?: AdminActivity; onDone: (list: AdminActivity[]) => void; onClose: () => void;
}) {
  const client = useQueryClient();
  const [id, setId] = useState<number | undefined>(activity?.id);
  const [title, setTitle] = useState(activity?.title ?? '');
  const [html, setHtml] = useState(activity?.contentHtml ?? '');
  const [url, setUrl] = useState(activity?.externalUrl ?? '');
  const [file, setFile] = useState<File | null>(null);
  const [progress, setProgress] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const [result, setResult] = useState('');
  const k = kinds[kind];
  const needsUpload = kind === 'file' || kind === 'package';
  const hasUpload = !!activity?.hasUpload;

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (needsUpload && !file && !hasUpload && !id) { setError(new Error(kind === 'package' ? 'Choose the .zip package to upload.' : 'Choose the file to upload.')); return; }
    setBusy(true);
    setError(null);
    try {
      const body = { title, kind, contentHtml: html, externalUrl: kind === 'url' ? url.trim() : null };
      let list = id
        ? await api<AdminActivity[]>(`/admin/lessons/${id}`, { method: 'PATCH', body })
        : await api<AdminActivity[]>(`/admin/modules/${moduleId}/lessons`, { method: 'POST', body });
      const savedId = id ?? Math.max(...list.map(l => l.id));
      setId(savedId);
      if (file) {
        setProgress(0);
        const r = await uploadWithProgress(`/api/admin/lessons/${savedId}/${kind === 'package' ? 'package' : 'file'}`, file, setProgress) as { title?: string; items?: number; scorm?: boolean };
        if (kind === 'package') setResult(`${r.scorm ? 'SCORM' : 'IMS'} package unpacked: ${r.items} items${r.title ? ` in “${r.title}”` : ''}.`);
        list = await client.fetchQuery({ queryKey: ['admin', 'lessons', moduleId], queryFn: () => api<AdminActivity[]>(`/admin/modules/${moduleId}/lessons`), staleTime: 0 });
      }
      onDone(list);
      onClose();
    } catch (err) {
      setError(err);
    } finally {
      setBusy(false);
    }
  };

  return <Modal title={`${activity ? 'Edit' : 'Add'} ${k.name}`} onClose={() => !busy && onClose()} wide={kind === 'page' || kind === 'file' || kind === 'url'}>
    <form onSubmit={submit} className="space-y-4" data-testid={`form-activity-${kind}`}>
      <label className={label}>Name<input required autoFocus value={title} onChange={e => setTitle(e.target.value)} className={field} placeholder={kind === 'package' ? 'e.g. Interactive safety module' : 'e.g. Introduction to spreadsheets'} data-testid="input-activity-title" /></label>

      {kind === 'url' && <label className={label}>Web address<input required type="url" value={url} onChange={e => setUrl(e.target.value)} className={field} placeholder="https://" data-testid="input-activity-url" /></label>}

      {needsUpload && <div className={label}>
        <p className="mb-1.5">{kind === 'package' ? 'Package (.zip)' : 'File'}</p>
        {hasUpload && !file && <p className="mb-2 rounded-md bg-[hsl(var(--secondary))] p-3 text-xs font-normal">Current: <strong>{activity?.fileName}</strong>{kind === 'package' ? ` · ${activity?.packageItems} items` : ` · ${fileSizeLabel(activity?.fileSize)}`}. Choose another to replace it.</p>}
        {file && !busy && <p className="mb-2 rounded-md bg-[hsl(var(--link)/.08)] p-3 text-xs font-normal">Ready to upload: <strong>{file.name}</strong> · {fileSizeLabel(file.size)}</p>}
        <FileDrop accept={kind === 'package' ? '.zip,application/zip' : FILE_ACCEPT} busy={busy && !!file} progress={progress} onFile={setFile}
          hintText={kind === 'package' ? 'IMS content package or SCORM 1.2 / 2004 zip, up to 300 MB' : 'PDF, Word, PowerPoint, Excel, text, audio, video or images, up to 200 MB'}
          testId={`input-${kind}-upload`} />
      </div>}

      {kind !== 'package' && <div className={label}>
        <p className="mb-1.5">{kind === 'page' ? 'Content' : 'Description'} {kind !== 'page' && <span className={hint}>(optional, shown above the {kind === 'url' ? 'link' : 'file'})</span>}</p>
        <EditorField value={html} onChange={setHtml} height={kind === 'page' ? 440 : 220} />
      </div>}

      {kind === 'package' && <p className="rounded-md bg-[hsl(var(--secondary))] p-3 text-xs leading-5 text-[hsl(var(--muted-foreground))]">
        The zip must contain an <code>imsmanifest.xml</code> (IMS content packages and SCORM packages do). SCORM content runs in the browser with a basic player: pages load and can talk to the SCORM API, but scores and completion are not recorded yet. Only upload packages from sources you trust.
      </p>}

      {result && <p className="rounded-md bg-[hsl(145_55%_40%/.1)] p-3 text-xs text-[hsl(145_55%_25%)]">{result}</p>}
      <ErrorNote error={error} />
      <div className="flex justify-end gap-2"><button type="button" disabled={busy} onClick={onClose} className={ghostBtn}>Cancel</button><button disabled={busy} className={primaryBtn} data-testid="button-save-activity"><Save size={14} /> {busy ? (file ? 'Uploading…' : 'Saving…') : activity || id ? 'Save changes' : `Add ${kind === 'package' ? 'package' : k.name.toLowerCase()}`}</button></div>
    </form>
  </Modal>;
}
