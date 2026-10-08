import { type FormEvent, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Link, useLocation } from 'wouter';
import { ArrowRight, Check, KeyRound, MailCheck, UserRound } from 'lucide-react';
import { api, type CurrentUser, ME_KEY, useAuthActions, useCurrentUser } from '@/lib/auth';
import { AuthError, AuthFrame, authButton, authInput } from '@/pages/auth';

const message = (e: unknown) => e instanceof Error ? e.message : 'Something went wrong. Try again.';

/** Forgot password: email → 6-digit code by email → code + new password, then straight in. */
export function ForgotPasswordPage() {
  const [, navigate] = useLocation();
  const { resetPassword } = useAuthActions();
  // Admins can pass on a code by WhatsApp; ?email= fills in the address for the student.
  const [email, setEmail] = useState(() => new URLSearchParams(window.location.search).get('email') ?? '');
  const [step, setStep] = useState<'email' | 'code'>('email');
  const [minutes, setMinutes] = useState(15);
  const [code, setCode] = useState('');
  const [password, setPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [resent, setResent] = useState(false);

  const sendCode = async () => {
    const r = await api<{ minutes?: number }>('/auth/forgot-password', { method: 'POST', body: { email } });
    if (r?.minutes) setMinutes(r.minutes);
  };
  const run = (fn: () => Promise<void>) => async (e?: FormEvent) => {
    e?.preventDefault();
    setBusy(true);
    setError('');
    try { await fn(); } catch (err) { setError(message(err)); } finally { setBusy(false); }
  };
  const requestCode = run(async () => { await sendCode(); setStep('code'); setResent(false); });
  const resend = run(async () => { await sendCode(); setCode(''); setResent(true); });
  const save = run(async () => {
    if (password !== confirm) throw new Error('The two passwords don’t match.');
    const user = await resetPassword(email, code, password);
    navigate(user.role === 'admin' ? '/admin' : '/');
  });

  if (step === 'code') return <AuthFrame eyebrow="Check your email" title="Enter your reset code">
    <p className="mt-3 flex gap-3 rounded-md bg-[hsl(var(--secondary)/.6)] p-4 text-sm leading-6" data-testid="status-reset-sent"><MailCheck size={18} className="mt-1 shrink-0 text-[hsl(var(--primary))]" />
      <span>If <b>{email}</b> has an Uhandisi account, we’ve emailed it a 6-digit code. It works for {minutes} minutes.</span></p>
    <form onSubmit={save} className="mt-6 space-y-4">
      <label className="block text-xs font-bold">6-digit code
        <input required autoFocus inputMode="numeric" autoComplete="one-time-code" pattern="\d{6}" maxLength={6} value={code}
          onChange={e => setCode(e.target.value.replace(/\D/g, '').slice(0, 6))}
          className={`${authInput} text-center font-mono-ui text-2xl tracking-[.5em]`} placeholder="••••••" data-testid="input-reset-code" /></label>
      <label className="block text-xs font-bold">New password<input required type="password" minLength={8} autoComplete="new-password" value={password} onChange={e => setPassword(e.target.value)} className={authInput} data-testid="input-new-password" />
        <span className="mt-1.5 block font-normal text-[hsl(var(--muted-foreground))]">At least 8 characters.</span></label>
      <label className="block text-xs font-bold">Type it again<input required type="password" minLength={8} autoComplete="new-password" value={confirm} onChange={e => setConfirm(e.target.value)} className={authInput} data-testid="input-confirm-password" /></label>
      {error && <AuthError>{error}</AuthError>}
      <button disabled={busy || code.length !== 6} className={authButton} data-testid="button-reset-password">{busy ? 'Saving…' : <>Save and log in <ArrowRight size={16} /></>}</button>
    </form>
    <div className="mt-6 space-y-2 text-center text-xs text-[hsl(var(--muted-foreground))]">
      <p>No email after a few minutes? Check your spam folder, or ask the school for a code.</p>
      <p>{resent ? <span className="font-bold text-[hsl(145_55%_25%)]">A new code is on its way; only the newest one works.</span>
        : <button type="button" disabled={busy} onClick={() => resend()} className="font-bold text-[hsl(var(--primary))] hover:underline" data-testid="button-resend-code">Send a new code</button>}
        {' · '}<button type="button" onClick={() => { setStep('email'); setError(''); }} className="font-bold text-[hsl(var(--primary))] hover:underline">Use another email</button></p>
    </div>
  </AuthFrame>;

  return <AuthFrame eyebrow="Forgot password" title="Reset your password">
    <p className="mt-3 text-sm text-[hsl(var(--muted-foreground))]">Enter the email you signed up with and we’ll email you a 6-digit code to choose a new password.</p>
    <form onSubmit={requestCode} className="mt-8 space-y-4">
      <label className="block text-xs font-bold">Email<input required type="email" autoComplete="email" value={email} onChange={e => setEmail(e.target.value)} className={authInput} data-testid="input-email" /></label>
      {error && <AuthError>{error}</AuthError>}
      <button disabled={busy} className={authButton} data-testid="button-send-reset">{busy ? 'Sending…' : <>Send code <ArrowRight size={16} /></>}</button>
    </form>
    <p className="mt-4 text-center text-xs text-[hsl(var(--muted-foreground))]">Already have a code? <button type="button" onClick={() => email ? setStep('code') : setError('Enter your email first.')} className="font-bold text-[hsl(var(--primary))] hover:underline" data-testid="button-have-code">Enter it</button></p>
    <p className="mt-2 text-center text-xs text-[hsl(var(--muted-foreground))]">Remembered it? <Link href="/login" className="font-bold text-[hsl(var(--primary))] hover:underline">Log in</Link></p>
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
