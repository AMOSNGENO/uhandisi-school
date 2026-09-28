// Place text on an uploaded certificate design by dragging, with a live sample preview.
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useParams } from 'wouter';
import { AlignCenter, AlignLeft, AlignRight, Eye, EyeOff, FileText, Plus, Save, Star, Trash2 } from 'lucide-react';
import { api } from '@/lib/auth';
import { type CertTemplate, type TemplateField, useTemplateBackground } from './certificates';
import { AdminLayout, Badge, card, ErrorNote, field, ghostBtn, iconBtn, label, Loading, primaryBtn } from './ui';

const SAMPLE: Record<string, string> = {
  name: 'Wanjiru Kamau', course: 'Data Analytics', date: new Date().toLocaleDateString('en-GB', { day: 'numeric', month: 'long', year: 'numeric' }),
  score: '86', code: 'UHS-SAMPLE01', verify_url: `${window.location.origin}/verify/UHS-SAMPLE01`,
};
const PLACEHOLDERS = ['name', 'course', 'date', 'score', 'code', 'verify_url'];
const fill = (text: string) => text.replace(/\{(\w+)\}/g, (m, k: string) => SAMPLE[k] ?? m);

// Close on-screen matches for the PDF's built-in fonts.
const cssFont: Record<TemplateField['font'], React.CSSProperties> = {
  helvetica: { fontFamily: 'Arial, Helvetica, sans-serif' },
  'helvetica-bold': { fontFamily: 'Arial, Helvetica, sans-serif', fontWeight: 700 },
  times: { fontFamily: '"Times New Roman", Times, serif' },
  'times-bold': { fontFamily: '"Times New Roman", Times, serif', fontWeight: 700 },
  'times-italic': { fontFamily: '"Times New Roman", Times, serif', fontStyle: 'italic' },
  courier: { fontFamily: '"Courier New", Courier, monospace' },
};
const fontNames: Record<TemplateField['font'], string> = {
  helvetica: 'Sans', 'helvetica-bold': 'Sans bold', times: 'Serif', 'times-bold': 'Serif bold', 'times-italic': 'Serif italic', courier: 'Typewriter',
};

export default function CertificateEditorPage() {
  const { id } = useParams<{ id: string }>();
  const client = useQueryClient();
  const tpl = useQuery({ queryKey: ['admin', 'cert-template', id], queryFn: () => api<CertTemplate>(`/admin/certificate-templates/${id}`) });
  const bg = useTemplateBackground(tpl.data);
  const [fields, setFields] = useState<TemplateField[]>([]);
  const [name, setName] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);
  const [error, setError] = useState<unknown>(null);
  const stage = useRef<HTMLDivElement>(null);
  const [stageW, setStageW] = useState(800);
  const drag = useRef<{ id: string; dx: number; dy: number } | null>(null);

  useEffect(() => { if (tpl.data) { setFields(tpl.data.fields); setName(tpl.data.name); } }, [tpl.data]);
  useEffect(() => {
    const el = stage.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setStageW(e!.contentRect.width));
    ro.observe(el);
    return () => ro.disconnect();
  }, [tpl.data]);

  const t = tpl.data;
  const scale = t ? stageW / t.pageWidth : 1;
  const stageH = t ? stageW * (t.pageHeight / t.pageWidth) : 0;
  const sel = fields.find(f => f.id === selected) ?? null;
  const update = (fid: string, change: Partial<TemplateField>) => { setSaved(false); setFields(fs => fs.map(f => (f.id === fid ? { ...f, ...change } : f))); };
  const clamp = (v: number) => Math.min(1, Math.max(0, v));

  // Arrow keys nudge the selected box (Shift = bigger steps).
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (!sel || (e.target as HTMLElement).closest('input, textarea, select')) return;
      const step = e.shiftKey ? 0.01 : 0.002;
      const d = { ArrowLeft: [-step, 0], ArrowRight: [step, 0], ArrowUp: [0, -step], ArrowDown: [0, step] }[e.key];
      if (!d) return;
      e.preventDefault();
      update(sel.id, { x: clamp(sel.x + d[0]!), y: clamp(sel.y + d[1]!) });
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  });

  const onPointerDown = (e: React.PointerEvent, f: TemplateField) => {
    e.preventDefault();
    setSelected(f.id);
    const rect = stage.current!.getBoundingClientRect();
    drag.current = { id: f.id, dx: (e.clientX - rect.left) / rect.width - f.x, dy: (e.clientY - rect.top) / rect.height - f.y };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return;
    const rect = stage.current!.getBoundingClientRect();
    update(drag.current.id, { x: clamp((e.clientX - rect.left) / rect.width - drag.current.dx), y: clamp((e.clientY - rect.top) / rect.height - drag.current.dy) });
  };
  const onPointerUp = () => { drag.current = null; };

  const save = async (then?: () => void) => {
    setSaving(true);
    setError(null);
    try {
      await api(`/admin/certificate-templates/${id}`, { method: 'PATCH', body: { name, fields } });
      client.invalidateQueries({ queryKey: ['admin'] });
      setSaved(true);
      then?.();
    } catch (e) { setError(e); } finally { setSaving(false); }
  };
  const addBox = () => {
    const nid = `custom${Date.now().toString(36)}`;
    setFields(fs => [...fs, { id: nid, label: 'Custom text', text: 'Your text', x: 0.5, y: 0.5, size: Math.round((t?.pageWidth ?? 842) * 0.018), font: 'helvetica', color: '#0B2D5C', align: 'center', visible: true }]);
    setSelected(nid);
    setSaved(false);
  };

  const crumb = <><Link href="/admin/certificates" className="hover:text-[hsl(var(--link))]">Certificates</Link> <span className="mx-1">/</span> {t?.name ?? '…'}</>;
  if (tpl.isLoading) return <AdminLayout title="Certificate design" breadcrumb={crumb}><Loading height={400} /></AdminLayout>;
  if (!t) return <AdminLayout title="Design not found" breadcrumb={crumb}><ErrorNote error={tpl.error ?? new Error('This design was deleted.')} /></AdminLayout>;

  return <AdminLayout title={`Place fields: ${t.name}`} breadcrumb={crumb}
    description="Drag the text boxes onto your design. Values shown are samples; each certificate gets the student’s real details."
    actions={<>
      {t.isDefault ? <Badge tone="good"><Star size={11} /> Default design</Badge> : null}
      <button onClick={() => save(() => window.open(`/api/admin/certificate-templates/${id}/preview`, '_blank'))} disabled={saving} className={ghostBtn} data-testid="button-preview-template"><FileText size={14} /> Preview PDF</button>
      <button onClick={() => save()} disabled={saving} className={primaryBtn} data-testid="button-save-template"><Save size={14} /> {saving ? 'Saving…' : saved ? 'Saved' : 'Save'}</button>
    </>}>
    <ErrorNote error={error} />
    <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_320px]">
      <div>
        <div ref={stage} onPointerMove={onPointerMove} onPointerUp={onPointerUp} onPointerDown={e => { if (e.target === e.currentTarget || (e.target as HTMLElement).tagName === 'IMG') setSelected(null); }}
          className="relative w-full touch-none select-none overflow-hidden rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--muted))] shadow-soft" style={{ height: stageH }} data-testid="template-stage">
          {bg ? <img src={bg} alt="Certificate design" draggable={false} className="absolute inset-0 size-full" /> : <p className="grid h-full place-items-center text-sm text-[hsl(var(--muted-foreground))]">Loading your design…</p>}
          {fields.map(f => {
            const shift = f.align === 'center' ? '-50%' : f.align === 'right' ? '-100%' : '0';
            return <div key={f.id} onPointerDown={e => onPointerDown(e, f)} data-testid={`box-${f.id}`}
              className={`absolute cursor-move whitespace-nowrap px-0.5 leading-none ${selected === f.id ? 'outline outline-2 outline-[hsl(var(--link))]' : 'outline-dashed outline-1 outline-[hsl(var(--link)/.45)] hover:outline-[hsl(var(--link))]'} ${f.visible ? '' : 'opacity-35'}`}
              style={{ left: f.x * stageW, top: f.y * stageH, transform: `translate(${shift}, -80%)`, fontSize: f.size * scale, color: f.color, ...cssFont[f.font] }}>
              {fill(f.text) || '(empty)'}
            </div>;
          })}
        </div>
        <p className="mt-2 text-xs text-[hsl(var(--muted-foreground))]">Tip: click a box, then use the arrow keys to nudge it (hold Shift for bigger steps). Boxes that use {'{score}'} are left out of certificates issued by hand.</p>
      </div>

      <aside className="space-y-4">
        <label className={label}>Design name<input value={name} onChange={e => { setName(e.target.value); setSaved(false); }} className={field} /></label>
        <div className={card}>
          <div className="flex items-center justify-between border-b border-[hsl(var(--border))] px-3 py-2"><p className="text-sm font-bold">Text boxes</p><button onClick={addBox} className={ghostBtn} data-testid="button-add-box"><Plus size={13} /> Add text box</button></div>
          <ul className="max-h-56 overflow-y-auto p-1">
            {fields.map(f => <li key={f.id}><button onClick={() => setSelected(f.id)} className={`flex w-full items-center gap-2 rounded px-2 py-1.5 text-left text-sm ${selected === f.id ? 'bg-[hsl(var(--secondary))] font-bold' : 'hover:bg-[hsl(var(--secondary)/.6)]'}`}>
              {f.visible ? <Eye size={13} className="shrink-0 text-[hsl(var(--muted-foreground))]" /> : <EyeOff size={13} className="shrink-0 text-[hsl(var(--muted-foreground))]" />}
              <span className="min-w-0 flex-1 truncate">{f.label}</span>
            </button></li>)}
          </ul>
        </div>
        {sel ? <div className={`${card} space-y-3 p-3`} data-testid="box-settings">
          <div className="flex items-center justify-between"><p className="text-sm font-bold">{sel.label}</p>
            <button onClick={() => { setFields(fs => fs.filter(f => f.id !== sel.id)); setSelected(null); setSaved(false); }} className={`${iconBtn} hover:text-[hsl(var(--destructive))]`} aria-label="Delete this text box"><Trash2 size={14} /></button></div>
          <label className={label}>Label<input value={sel.label} onChange={e => update(sel.id, { label: e.target.value })} className={field} /></label>
          <label className={label}>Text<input value={sel.text} onChange={e => update(sel.id, { text: e.target.value })} className={field} data-testid="input-box-text" /></label>
          <div className="flex flex-wrap gap-1">{PLACEHOLDERS.map(p => <button key={p} type="button" onClick={() => update(sel.id, { text: `${sel.text}${sel.text && !sel.text.endsWith(' ') ? ' ' : ''}{${p}}` })} className="rounded bg-[hsl(var(--secondary))] px-1.5 py-0.5 font-mono-ui text-[11px] hover:bg-[hsl(var(--link)/.12)]">{`{${p}}`}</button>)}</div>
          <div className="grid grid-cols-2 gap-2">
            <label className={label}>Font<select value={sel.font} onChange={e => update(sel.id, { font: e.target.value as TemplateField['font'] })} className={field}>{Object.entries(fontNames).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</select></label>
            <label className={label}>Size<input type="number" min={4} max={200} step={0.5} value={sel.size} onChange={e => update(sel.id, { size: Number(e.target.value) || 12 })} className={field} data-testid="input-box-size" /></label>
          </div>
          <div className="flex items-end gap-3">
            <label className={label}>Colour<input type="color" value={sel.color} onChange={e => update(sel.id, { color: e.target.value })} className="mt-1.5 block h-10 w-16 rounded-md border border-[hsl(var(--input))] p-1" /></label>
            <div className="flex rounded-md border border-[hsl(var(--input))] p-0.5" role="group" aria-label="Alignment">
              {([['left', AlignLeft], ['center', AlignCenter], ['right', AlignRight]] as const).map(([a, Icon]) => <button key={a} type="button" onClick={() => update(sel.id, { align: a })} aria-pressed={sel.align === a} aria-label={`Align ${a}`} className={`grid size-8 place-items-center rounded ${sel.align === a ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : ''}`}><Icon size={15} /></button>)}
            </div>
          </div>
          <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={sel.visible} onChange={e => update(sel.id, { visible: e.target.checked })} className="size-4 accent-[hsl(var(--primary))]" /> Show on certificates</label>
        </div> : <p className="text-sm text-[hsl(var(--muted-foreground))]">Click a text box on the design to change its wording, font, size or colour.</p>}
      </aside>
    </div>
  </AdminLayout>;
}
