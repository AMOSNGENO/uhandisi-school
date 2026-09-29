import { type FormEvent, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, KeyRound, MailCheck, UserRound } from 'lucide-react';
import { api, type CurrentUser, ME_KEY, useAuthActions, useCurrentUser } from '@/lib/auth';
import { AuthError, AuthFrame, authButton, authInput } from '@/pages/auth';

const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

export function ForgotPasswordPage() {
  const [email, setEmail] = useState('');
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setBusy(true);
    setError('');
    try {
      await api('/auth/forgot-password', { method: 'POST', body: { email } });
      setSent(true);
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };

  if (sent) return <AuthFrame eyebrow="Check your email" title="Reset link on its way">
    <div className="mt-8 space-y-4 text-sm leading-6" data-testid="status-reset-sent">
      <p className="flex gap-3 rounded-md bg-[hsl(var(--secondary)/.6)] p-4"><MailCheck size={18} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" />
        <span>If <b>{email}</b> has an Uhandisi account, we’ve emailed it a link to choose a new password. It works for one hour.</span></p>
      <p className="text-xs text-[hsl(var(--muted-foreground))]">Nothing after a few minutes? Check your spam folder, or ask the school to send you a reset link.</p>
      <Link href="/login" className={authButton} data-testid="link-back-login">Back to log in</Link>
    </div>
  </AuthFrame>;

  return <AuthFrame eyebrow="Forgot password" title="Reset your password">
    <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Enter the email you signed up with and we’ll send you a link to choose a new password.</p>
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block text-xs font-bold">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={authInput} data-testid="input-email" /></label>
      {error && <AuthError>{error}</AuthError>}
      <button disabled={busy} className={authButton} data-testid="button-send-reset">{busy ? 'Sending…' : <>Send reset link <ArrowRight size={16} /></>}</button>
    </form>
    <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">Remembered it? <Link href="/login" className="font-bold text-[hsl(var(--primary))] hover:underline">Log in</Link></p>
  </AuthFrame>;
}

export function ResetPasswordPage() {
  const token = new URLSearchParams(window.location.search).get('token') ?? '';
  const [, navigate] = useLocation();
  const { resetPassword } = useAuthActions();
  const link = useQuery({ queryKey: ['reset-link', token], queryFn: () => api<{ email: string }>(`/auth/reset-password/${encodeURIComponent(token)}`), retry: false, enabled: !!token });
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (password !== confirm) return setError('The two passwords don’t match.');
    setBusy(true);
    setError('');
    try {
      const user = await resetPassword(token, password);
      navigate(user.role === 'admin' ? '/admin' : '/');
    } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };

  if (!token || link.isError) return <AuthFrame eyebrow="Reset password" title="This link doesn’t work">
    <div className="mt-8 space-y-4" data-testid="status-reset-invalid">
      <AuthError>{link.error ? message(link.error) : 'The reset link is incomplete. Open it straight from the email.'}</AuthError>
      <Link href="/forgot-password" className={authButton}>Get a new link</Link>
    </div>
  </AuthFrame>;

  return <AuthFrame eyebrow="Reset password" title="Choose a new password">
    <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">{link.data ? <>For the account <b>{link.data.email}</b>.</> : 'Checking your link…'}</p>
    <form onSubmit={submit} className="mt-8 space-y-4">
      <label className="block text-xs font-bold">New password<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={authInput} data-testid="input-new-password" />
        <span className="mt-1.5 block font-normal text-[hsl(var(--muted-foreground))]">At least 8 characters.</span></label>
      <label className="block text-xs font-bold">Type it again<input required type="password" minLength={8} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={authInput} data-testid="input-confirm-password" /></label>
      {error && <AuthError>{error}</AuthError>}
      <button disabled={busy || !link.data} className={authButton} data-testid="button-reset-password">{busy ? 'Saving…' : <>Save and log in <ArrowRight size={16} /></>}</button>
    </form>
  </AuthFrame>;
}

const card = 'rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-soft';
const field = 'mt-1.5 h-11 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm font-normal outline-none transition focus:border-[hsl(var(--primary))]';
const saveBtn = 'inline-flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60';
const Saved = ({ children, testId }: { children: string; testId: string }) =>
  <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[hsl(145_55%_25%)]" role="status" data-testid={testId}><Check size={14} /> {children}</span>;
const FormError = ({ children }: { children: string }) => <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">{children}</p>;

/** Name and phone, editable by the student. */
export function AccountDetails() {
  const user = useCurrentUser().data;
  const client = useQueryClient();
  const [form, setForm] = useState({ name: user?.name ?? '', phone: user?.phone ?? '' });
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setState('busy');
    setError('');
    try {
      client.setQueryData(ME_KEY, await api<CurrentUser>('/auth/me', { method: 'PATCH', body: { name: form.name, phone: form.phone || null } }));
      setState('saved');
    } catch (err) { setError(message(err)); setState('idle'); }
  };
  const edit = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [key]: e.target.value }); setState('idle'); };
  return <form onSubmit={submit} className={card} data-testid="form-account-details">
    <h2 className="flex items-center gap-2 font-display text-xl font-bold"><UserRound size={18} /> Your details</h2>
    <div className="mt-5 space-y-4">
      <label className="block text-xs font-bold">Full name <span className="font-normal text-[hsl(var(--muted-foreground))]">(as it appears on certificates)</span><input required minLength={2} value={form.name} onChange={edit('name')} className={field} data-testid="input-profile-name" /></label>
      <label className="block text-xs font-bold">Phone number<input type="tel" placeholder="07xx xxx xxx" value={form.phone} onChange={edit('phone')} className={field} data-testid="input-profile-phone" /></label>
      <div className="block text-xs font-bold">Email<p className="mt-1.5 text-sm font-normal">{user?.email}</p><p className="mt-1 font-normal text-[hsl(var(--muted-foreground))]">This is how you log in. Ask the school to change it.</p></div>
      {error && <FormError>{error}</FormError>}
      <div className="flex items-center gap-3">
        <button disabled={state === 'busy'} className={saveBtn} data-testid="button-save-profile">{state === 'busy' ? 'Saving…' : 'Save details'}</button>
        {state === 'saved' && <Saved testId="status-profile-saved">Saved</Saved>}
      </div>
    </div>
  </form>;
}

export function ChangePassword() {
  const empty = { currentPassword: '', newPassword: '', confirm: '' };
  const [form, setForm] = useState(empty);
  const [state, setState] = useState<'idle' | 'busy' | 'saved'>('idle');
  const [error, setError] = useState('');
  const submit = async (e: FormEvent) => {
    e.preventDefault();
    if (form.newPassword !== form.confirm) return setError('The two new passwords don’t match.');
    setState('busy');
    setError('');
    try {
      await api('/auth/password', { method: 'POST', body: { currentPassword: form.currentPassword, newPassword: form.newPassword } });
      setForm(empty);
      setState('saved');
    } catch (err) { setError(message(err)); setState('idle'); }
  };
  const edit = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => { setForm({ ...form, [key]: e.target.value }); setState('idle'); };
  return <form onSubmit={submit} className={card} data-testid="form-change-password">
    <h2 className="flex items-center gap-2 font-display text-xl font-bold"><KeyRound size={18} /> Change password</h2>
    <p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">You stay logged in here; other phones and computers are logged out.</p>
    <div className="mt-5 space-y-4">
      <label className="block text-xs font-bold">Current password<input required type="password" autoComplete="current-password" value={form.currentPassword} onChange={edit('currentPassword')} className={field} data-testid="input-current-password" /></label>
      <div className="grid gap-4 sm:grid-cols-2">
        <label className="block text-xs font-bold">New password<input required type="password" minLength={8} autoComplete="new-password" value={form.newPassword} onChange={edit('newPassword')} className={field} data-testid="input-new-password" /></label>
        <label className="block text-xs font-bold">Type it again<input required type="password" minLength={8} autoComplete="new-password" value={form.confirm} onChange={edit('confirm')} className={field} data-testid="input-confirm-password" /></label>
      </div>
      <p className="-mt-2 text-xs text-[hsl(var(--muted-foreground))]">At least 8 characters.</p>
      {error && <FormError>{error}</FormError>}
      <div className="flex items-center gap-3">
        <button disabled={state === 'busy'} className={saveBtn} data-testid="button-change-password">{state === 'busy' ? 'Saving…' : 'Change password'}</button>
        {state === 'saved' && <Saved testId="status-password-changed">Password changed</Saved>}
      </div>
    </div>
  </form>;
}
