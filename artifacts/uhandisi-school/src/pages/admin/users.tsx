import { type FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { KeyRound, Link2, Search, Trash2, UserPlus } from 'lucide-react';
import { api, useCurrentUser, type Role } from '@/lib/auth';
import type { AdminUser } from './types';
import { AdminLayout, Badge, card, dangerBtn, ErrorNote, field, ghostBtn, hint, label, Loading, Modal, primaryBtn, shortDate, td, th } from './ui';

const roleTone: Record<Role, 'info' | 'warn' | 'muted'> = { admin: 'warn', instructor: 'info', student: 'muted' };
const newPassword = () => {
  const chars = 'abcdefghjkmnpqrstuvwxyzABCDEFGHJKMNPQRSTUVWXYZ23456789';
  const bytes = crypto.getRandomValues(new Uint8Array(12));
  return Array.from(bytes, b => chars[b % chars.length]).join('');
};

export default function AdminUsersPage() {
  const me = useCurrentUser().data;
  const [search, setSearch] = useState('');
  const [query, setQuery] = useState('');
  const [role, setRole] = useState('');
  const [adding, setAdding] = useState(() => new URLSearchParams(window.location.search).has('add'));
  const [editing, setEditing] = useState<AdminUser | null>(null);
  useEffect(() => { const t = setTimeout(() => setQuery(search), 250); return () => clearTimeout(t); }, [search]);
  const users = useQuery({
    queryKey: ['admin', 'users', query, role],
    queryFn: () => api<AdminUser[]>(`/admin/users?search=${encodeURIComponent(query)}${role ? `&role=${role}` : ''}`),
  });
  const list = users.data || [];

  return <AdminLayout title="Users" description="Everyone with an account. Add people yourself, change roles, reset passwords and suspend accounts."
    actions={<button onClick={() => setAdding(true)} className={primaryBtn} data-testid="button-add-user"><UserPlus size={15} /> Add a new user</button>}>
    <div className="mb-4 flex flex-col gap-2 sm:flex-row">
      <div className="relative flex-1"><Search className="absolute left-3 top-[1.3rem] text-[hsl(var(--muted-foreground))]" size={15} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search by name, email or phone" className={`${field} pl-9`} aria-label="Search users" data-testid="input-user-search" /></div>
      <select value={role} onChange={e => setRole(e.target.value)} className={`${field} sm:w-44`} aria-label="Role"><option value="">All roles</option><option value="student">Students</option><option value="instructor">Instructors</option><option value="admin">Admins</option></select>
    </div>
    <ErrorNote error={users.error} />
    {users.isLoading ? <Loading /> : list.length === 0
      ? <p className={`${card} p-8 text-center text-sm text-[hsl(var(--muted-foreground))]`}>No users match.</p>
      : <div className={`${card} overflow-x-auto`}>
        <table className="w-full min-w-[720px] text-sm">
          <thead className="border-b border-[hsl(var(--border))] bg-[hsl(var(--secondary)/.6)]"><tr><th className={th}>Name</th><th className={th}>Role</th><th className={th}>Status</th><th className={`${th} text-right`}>Courses</th><th className={th}>Joined</th><th className={th}><span className="sr-only">Actions</span></th></tr></thead>
          <tbody>
            {list.map(u => <tr key={u.id} className="border-b border-[hsl(var(--border))] last:border-0 hover:bg-[hsl(var(--secondary)/.4)]" data-testid={`row-user-${u.id}`}>
              <td className={td}><button onClick={() => setEditing(u)} className="text-left"><span className="block font-bold text-[hsl(var(--link))] hover:underline">{u.name}{u.id === me?.id && <span className="ml-2 text-xs font-normal text-[hsl(var(--muted-foreground))]">(you)</span>}</span><span className="block text-xs text-[hsl(var(--muted-foreground))]">{u.email}{u.phone ? ` · ${u.phone}` : ''}</span></button></td>
              <td className={td}><Badge tone={roleTone[u.role]}><span className="capitalize">{u.role}</span></Badge></td>
              <td className={td}>{u.active ? <Badge tone="good">Active</Badge> : <Badge tone="bad">Suspended</Badge>}</td>
              <td className={`${td} text-right font-mono-ui`}>{u.enrolments}</td>
              <td className={`${td} whitespace-nowrap text-xs text-[hsl(var(--muted-foreground))]`}>{shortDate(u.createdAt)}</td>
              <td className={`${td} text-right`}><button onClick={() => setEditing(u)} className={ghostBtn} data-testid={`button-edit-user-${u.id}`}>Edit</button></td>
            </tr>)}
          </tbody>
        </table>
      </div>}
    {adding && <AddUser onClose={() => setAdding(false)} />}
    {editing && <EditUser user={editing} self={editing.id === me?.id} onClose={() => setEditing(null)} />}
  </AdminLayout>;
}

function AddUser({ onClose }: { onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ name: '', email: '', phone: '', role: 'student' as Role, password: newPassword() });
  const [created, setCreated] = useState<{ email: string; password: string } | null>(null);
  const save = useMutation({
    mutationFn: () => api<AdminUser>('/admin/users', { method: 'POST', body: { ...form, phone: form.phone || undefined } }),
    onSuccess: () => { client.invalidateQueries({ queryKey: ['admin'] }); setCreated({ email: form.email, password: form.password }); },
  });
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));
  if (created) return <Modal title="User added" onClose={onClose}>
    <div className="space-y-4" data-testid="user-created">
      <p className="text-sm">Share these sign-in details with them. The password won’t be shown again.</p>
      <div className="rounded-md bg-[hsl(var(--secondary))] p-4 font-mono-ui text-sm"><p>Email: {created.email}</p><p>Password: {created.password}</p></div>
      <div className="flex justify-end gap-2"><button onClick={() => navigator.clipboard?.writeText(`Email: ${created.email}\nPassword: ${created.password}`)} className={ghostBtn}>Copy</button><button onClick={onClose} className={primaryBtn}>Done</button></div>
    </div>
  </Modal>;
  return <Modal title="Add a new user" onClose={onClose}>
    <form onSubmit={(e: FormEvent) => { e.preventDefault(); save.mutate(); }} className="space-y-4" data-testid="form-add-user">
      <label className={label}>Full name<input required autoFocus value={form.name} onChange={set('name')} className={field} data-testid="input-new-name" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Email<input required type="email" value={form.email} onChange={set('email')} className={field} data-testid="input-new-email" /></label>
        <label className={label}>Phone <span className={hint}>(optional)</span><input value={form.phone} onChange={set('phone')} className={field} placeholder="07xx xxx xxx" /></label>
      </div>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className={label}>Role<select value={form.role} onChange={set('role')} className={field} data-testid="select-new-role"><option value="student">Student</option><option value="instructor">Instructor</option><option value="admin">Admin</option></select></label>
        <label className={label}>Password<div className="flex gap-2"><input required minLength={8} value={form.password} onChange={set('password')} className={`${field} font-mono-ui`} data-testid="input-new-password" /><button type="button" onClick={() => setForm(f => ({ ...f, password: newPassword() }))} className={`${ghostBtn} mt-1.5`} title="Generate a new password">New</button></div></label>
      </div>
      {form.role === 'admin' && <p className="rounded-md bg-[hsl(38_90%_50%/.1)] p-3 text-xs">Admins can change everything on the site, including payments and other admins.</p>}
      <ErrorNote error={save.error} />
      <div className="flex justify-end gap-2"><button type="button" onClick={onClose} className={ghostBtn}>Cancel</button><button disabled={save.isPending} className={primaryBtn} data-testid="button-create-user">Add user</button></div>
    </form>
  </Modal>;
}

function EditUser({ user, self, onClose }: { user: AdminUser; self: boolean; onClose: () => void }) {
  const client = useQueryClient();
  const [form, setForm] = useState({ name: user.name, email: user.email, phone: user.phone ?? '', role: user.role, active: user.active });
  const [password, setPassword] = useState('');
  const [notice, setNotice] = useState('');
  const refresh = () => client.invalidateQueries({ queryKey: ['admin'] });
  const save = useMutation({
    mutationFn: () => api(`/admin/users/${user.id}`, { method: 'PATCH', body: { ...form, phone: form.phone || null } }),
    onSuccess: () => { refresh(); onClose(); },
  });
  const reset = useMutation({
    mutationFn: () => api(`/admin/users/${user.id}/password`, { method: 'POST', body: { password } }),
    onSuccess: () => { setNotice(`Password changed. ${self ? '' : 'They have been signed out everywhere; '}share the new one with them: ${password}`); setPassword(''); },
  });
  const resetLink = useMutation({ mutationFn: () => api<{ url: string; emailed: boolean; emailConfigured: boolean; emailError?: string }>(`/admin/users/${user.id}/reset-link`, { method: 'POST' }) });
  const remove = useMutation({ mutationFn: () => api(`/admin/users/${user.id}`, { method: 'DELETE' }), onSuccess: () => { refresh(); onClose(); } });
  const set = (k: 'name' | 'email' | 'phone' | 'role') => (e: React.ChangeEvent<HTMLInputElement | HTMLSelectElement>) => setForm(f => ({ ...f, [k]: e.target.value }));

  return <Modal title={`Edit ${user.name}`} onClose={onClose}>
    <div className="space-y-6" data-testid="form-edit-user">
      <form onSubmit={e => { e.preventDefault(); save.mutate(); }} className="space-y-4">
        <label className={label}>Full name<input required value={form.name} onChange={set('name')} className={field} /></label>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Email<input required type="email" value={form.email} onChange={set('email')} className={field} /></label>
          <label className={label}>Phone<input value={form.phone} onChange={set('phone')} className={field} /></label>
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className={label}>Role<select disabled={self} value={form.role} onChange={set('role')} className={field} data-testid="select-edit-role"><option value="student">Student</option><option value="instructor">Instructor</option><option value="admin">Admin</option></select></label>
          <label className={label}>Status<select disabled={self} value={form.active ? 'active' : 'suspended'} onChange={e => setForm(f => ({ ...f, active: e.target.value === 'active' }))} className={field} data-testid="select-edit-status"><option value="active">Active</option><option value="suspended">Suspended (can’t sign in)</option></select></label>
        </div>
        {self && <p className={`${hint} text-xs`}>You can’t change your own role or suspend yourself.</p>}
        <ErrorNote error={save.error} />
        <div className="flex justify-end"><button disabled={save.isPending} className={primaryBtn} data-testid="button-save-user">Save changes</button></div>
      </form>
      {!self && user.active && <div className="space-y-3 border-t border-[hsl(var(--border))] pt-5">
        <div className="flex items-center justify-between gap-3">
          <div><h3 className="flex items-center gap-2 text-sm font-bold"><Link2 size={15} /> Password reset link</h3><p className={`${hint} mt-1 text-xs`}>Lets them choose their own password. Works once, for one hour.</p></div>
          <button type="button" disabled={resetLink.isPending} onClick={() => resetLink.mutate()} className={ghostBtn} data-testid="button-reset-link">{resetLink.isPending ? 'Creating…' : 'Create link'}</button>
        </div>
        {resetLink.data && <div className="space-y-2 rounded-md bg-[hsl(var(--secondary))] p-3 text-xs" role="status" data-testid="reset-link">
          <p>{resetLink.data.emailed ? <>Emailed to <b>{user.email}</b>. You can also send them this link:</> : resetLink.data.emailConfigured ? <>The email couldn’t be sent{resetLink.data.emailError ? <>. The mail server said: <b className="break-all" data-testid="reset-email-error">{resetLink.data.emailError}</b></> : ''}. Send them this link on WhatsApp or SMS meanwhile:</> : <>Email isn’t set up yet, so send them this link on WhatsApp or SMS:</>}</p>
          <div className="flex gap-2"><input readOnly value={resetLink.data.url} onFocus={e => e.target.select()} className={`${field} mt-0 font-mono-ui text-xs`} aria-label="Reset link" /><button type="button" onClick={() => navigator.clipboard?.writeText(resetLink.data!.url)} className={ghostBtn}>Copy</button></div>
        </div>}
        <ErrorNote error={resetLink.error} />
      </div>}
      <form onSubmit={e => { e.preventDefault(); reset.mutate(); }} className="space-y-3 border-t border-[hsl(var(--border))] pt-5">
        <h3 className="flex items-center gap-2 text-sm font-bold"><KeyRound size={15} /> Set a new password</h3>
        <div className="flex gap-2"><input required minLength={8} value={password} onChange={e => setPassword(e.target.value)} className={`${field} mt-0 font-mono-ui`} placeholder="At least 8 characters" aria-label="New password" data-testid="input-reset-password" /><button type="button" onClick={() => setPassword(newPassword())} className={ghostBtn}>Generate</button><button disabled={reset.isPending} className={primaryBtn} data-testid="button-reset-password">Set</button></div>
        {notice && <p className="rounded-md bg-[hsl(145_55%_40%/.1)] p-3 text-xs text-[hsl(145_55%_25%)]" role="status">{notice}</p>}
        <ErrorNote error={reset.error} />
      </form>
      {!self && <div className="flex items-center justify-between gap-3 border-t border-[hsl(var(--border))] pt-5">
        <p className="text-xs text-[hsl(var(--muted-foreground))]">Deleting removes their enrolments. People who have paid can only be suspended.</p>
        <button disabled={remove.isPending} onClick={() => { if (confirm(`Delete ${user.name}'s account? This can't be undone.`)) remove.mutate(); }} className={dangerBtn} data-testid="button-delete-user"><Trash2 size={14} /> Delete</button>
      </div>}
      <ErrorNote error={remove.error} />
    </div>
  </Modal>;
}
