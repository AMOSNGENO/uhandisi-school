import { type FormEvent, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Link } from 'wouter';
import { api } from '@/lib/auth';
import type { Category } from './types';
import { AdminLayout, card, ErrorNote, field, ghostBtn, label, Loading, Modal, primaryBtn, td, th } from './ui';

export default function AdminCategoriesPage() {
  const categories = useQuery({ queryKey: ['admin', 'categories'], queryFn: () => api<Category[]>('/admin/categories') });
  const [renaming, setRenaming] = useState<Category | null>(null);
  const list = categories.data || [];
  return <AdminLayout title="Categories" description="Course categories group courses on the course list. Create one by typing a new name in a course’s settings; rename or merge them here.">
    <ErrorNote error={categories.error} />
    {categories.isLoading ? <Loading /> : list.length === 0
      ? <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>No categories yet. They appear when you create courses.</p>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[520px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Category</th><th className={`${th} text-right`}>Courses</th><th className={`${th} text-right`}>Published</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list.map(c => <tr key={c.name} className="border-b border-[hsl(var(--border))] last:border-0" data-testid={`row-category-${c.name}`}>
              <td className={`${td} font-bold`}>{c.name}</td>
              <td className={`${td} text-right font-mono-ui`}>{c.courses}</td>
              <td className={`${td} text-right font-mono-ui`}>{c.published}</td>
              <td className={`${td} text-right`}><div className="flex justify-end gap-2"><Link href="/admin/courses" className={ghostBtn}>Courses</Link><button onClick={() => setRenaming(c)} className={ghostBtn} data-testid={`button-rename-${c.name}`}>Rename</button></div></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {renaming && <Rename category={renaming} others={list.filter(c => c.name !== renaming.name).map(c => c.name)} onClose={() => setRenaming(null)} />}
  </AdminLayout>;
}

function Rename({ category, others, onClose }: { category: Category; others: string[]; onClose: () => void }) {
  const client = useQueryClient();
  const [to, setTo] = useState(category.name);
  const merging = others.includes(to.trim());
  const save = useMutation({
    mutationFn: () => api('/admin/categories', { method: 'PATCH', body: { from: category.name, to } }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['admin'] }); client.invalidateQueries({ predicate: q => q.queryKey[0] !== 'admin' && q.queryKey[0] !== 'auth' }); onClose(); },
  });
  return <Modal title={`Rename “${category.name}”`} onClose={onClose}>
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="space-y-4">
      <label className={label}>New name<input required autoFocus list="other-categories" value={to} onChange={e => setTo(e.target.value)} className={field} data-testid="input-category-name" /><datalist id="other-categories">{others.map(o => <option key={o} value={o} />)}</datalist></label>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">{merging ? `“${to.trim()}” already exists, so its courses and these ${category.courses} will be merged into one category.` : `All ${category.courses} course(s) in this category move to the new name.`}</p>
      <ErrorNote error={save.error} />
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={ghostBtn}>Cancel</button><button disabled={save.isPending || !to.trim() || to.trim() === category.name} className={primaryBtn} data-testid="button-save-category">{merging ? 'Merge' : 'Rename'}</button></div>
    </form>
  </Modal>;
}
