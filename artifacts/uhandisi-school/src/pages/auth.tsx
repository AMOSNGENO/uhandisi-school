import { type FormEvent, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowRight, ShieldCheck } from 'lucide-react';
import { useAuthActions } from '@/lib/auth';

/** The ?next= page to return to after signing in, if it's one of ours. */
function nextParam() {
  const next = new URLSearchParams(window.location.search).get('next');
  return next && next.startsWith('/') && !next.startsWith('//') ? next : null;
}
const nextPath = () => nextParam() ?? '/';

/** Link to the login page that brings the visitor back to `returnTo` afterwards. */
export const loginHref = (returnTo: string, mode: 'login' | 'register' = 'login') => `/${mode}?next=${encodeURIComponent(returnTo)}`;

const input = 'mt-2 h-11 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 text-sm outline-none transition focus:border-[hsl(var(--primary))]';

export default function AuthPage({ mode }: { mode: 'login' | 'register' }) {
  const { login, register } = useAuthActions();
  const [, navigate] = useLocation();
  const [form, setForm] = useState({ name: '', email: '', phone: '', password: '' });
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const set = (key: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm({ ...form, [key]: e.target.value });

  const submit = async (e: FormEvent) => {
    e.preventDefault();
    setError('');
    setBusy(true);
    try {
      const user = mode === 'login'
        ? await login(form.email, form.password)
        : await register({ name: form.name, email: form.email, phone: form.phone || undefined, password: form.password });
      // Admins land on their dashboard unless they were heading somewhere specific.
      navigate(nextParam() ?? (user.role === 'admin' ? '/admin' : '/'));
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Something went wrong. Try again.');
    } finally {
      setBusy(false);
    }
  };

  const isLogin = mode === 'login';
  return <div className="grain grid min-h-[100dvh] bg-[hsl(var(--background))] lg:grid-cols-[1fr_1.1fr]">
    <section className="relative hidden overflow-hidden bg-[hsl(var(--sidebar))] p-12 text-[hsl(var(--sidebar-foreground))] lg:flex lg:flex-col lg:justify-between">
      <div className="absolute -right-24 -top-24 size-96 rounded-full border-[48px] border-[hsl(var(--accent)/.1)]" />
      <div className="absolute -bottom-32 left-16 size-72 rounded-full border-[28px] border-[hsl(var(--accent)/.08)]" />
      <img src="/images/uhandisi-logo.png" alt="Uhandisi School" className="relative h-12 w-[178px] object-contain object-left" />
      <div className="relative max-w-md">
        <p className="mb-4 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">Lipa Pole Pole</p>
        <h1 className="font-display text-5xl font-bold leading-[1.05] tracking-tight">Learn a skill.<br /><span className="text-[hsl(var(--accent))]">Pay as you grow.</span></h1>
        <p className="mt-5 text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.65)]">Practical courses you unlock one module at a time, from as little as KSh100 a day.</p>
      </div>
      <p className="relative flex items-center gap-2 text-xs text-[hsl(var(--sidebar-foreground)/.5)]"><ShieldCheck size={14} /> Your account and payments are kept private.</p>
    </section>
    <main className="flex items-center justify-center px-5 py-12 sm:px-10">
      <div className="w-full max-w-sm">
        <img src="/images/uhandisi-logo.png" alt="Uhandisi School" className="mb-10 h-12 w-[178px] object-contain object-left lg:hidden" />
        <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-[hsl(var(--primary))]">{isLogin ? 'Welcome back' : 'Join the school'}</p>
        <h2 className="font-display text-3xl font-bold tracking-tight">{isLogin ? 'Log in to continue' : 'Create your account'}</h2>
        <form onSubmit={submit} className="mt-8 space-y-4">
          {!isLogin && <label className="block text-xs font-bold">Full name<input required autoComplete="name" value={form.name} onChange={set('name')} className={input} data-testid="input-name" /></label>}
          <label className="block text-xs font-bold">Email<input required type="email" autoComplete="email" value={form.email} onChange={set('email')} className={input} data-testid="input-email" /></label>
          {!isLogin && <label className="block text-xs font-bold">Phone number <span className="font-normal text-[hsl(var(--muted-foreground))]">(optional)</span><input type="tel" autoComplete="tel" placeholder="07xx xxx xxx" value={form.phone} onChange={set('phone')} className={input} data-testid="input-phone" /></label>}
          <label className="block text-xs font-bold">Password<input required type="password" minLength={isLogin ? 1 : 8} autoComplete={isLogin ? 'current-password' : 'new-password'} value={form.password} onChange={set('password')} className={input} data-testid="input-password" />
            {!isLogin && <span className="mt-1.5 block font-normal text-[hsl(var(--muted-foreground))]">At least 8 characters.</span>}
          </label>
          {error && <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert" data-testid="status-auth-error">{error}</p>}
          <button disabled={busy} className="flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60" data-testid="button-submit-auth">
            {busy ? (isLogin ? 'Logging in…' : 'Creating account…') : <>{isLogin ? 'Log in' : 'Create account'} <ArrowRight size={16} /></>}
          </button>
        </form>
        <p className="mt-6 text-center text-xs text-[hsl(var(--muted-foreground))]">
          {isLogin ? 'New to Uhandisi? ' : 'Already have an account? '}
          <Link href={loginHref(nextPath(), isLogin ? 'register' : 'login')} className="font-bold text-[hsl(var(--primary))] hover:underline" data-testid="link-switch-auth">{isLogin ? 'Create an account' : 'Log in'}</Link>
        </p>
        <p className="mt-3 text-center text-xs"><Link href="/courses" className="text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="link-browse-guest">← Keep browsing courses</Link></p>
      </div>
    </main>
  </div>;
}
