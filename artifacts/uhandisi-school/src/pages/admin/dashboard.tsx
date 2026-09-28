import { useQuery } from '@tanstack/react-query';
import { Link } from 'wouter';
import { BookOpen, Clock3, CreditCard, Plus, Upload, UserPlus, Users } from 'lucide-react';
import { api } from '@/lib/auth';
import type { Stats } from './types';
import { PaymentsTable } from './payments';
import { AdminLayout, card, ErrorNote, Loading, money } from './ui';

export default function AdminDashboardPage() {
  const stats = useQuery({ queryKey: ['admin', 'stats'], queryFn: () => api<Stats>('/admin/stats') });
  const s = stats.data;
  const quick = [
    { href: '/admin/courses?upload=1', label: 'Upload PDF or IMS zip', icon: Upload },
    { href: '/admin/courses/new', label: 'Add a new course', icon: Plus },
    { href: '/admin/users?add=1', label: 'Add a new user', icon: UserPlus },
    { href: '/admin/payments', label: 'Review payments', icon: CreditCard },
  ];
  return <AdminLayout title="Dashboard" description="Learners, courses and money at a glance.">
    {stats.isLoading ? <Loading /> : !s ? <ErrorNote error={stats.error} /> : <div className="space-y-8">
      <section className="grid gap-4 sm:grid-cols-2 xl:grid-cols-4">
        {[
          { label: 'Confirmed revenue', value: money(s.payments.revenue), sub: `${s.payments.completed} payments`, icon: CreditCard, href: '/admin/payments' },
          { label: 'Awaiting confirmation', value: String(s.payments.pending), sub: 'pending payments', icon: Clock3, href: '/admin/payments' },
          { label: 'Users', value: String(s.users.total), sub: `${s.users.students} students · ${s.users.admins} admins`, icon: Users, href: '/admin/users' },
          { label: 'Courses', value: String(s.courses.total), sub: `${s.courses.published} published · ${s.enrollments} enrolments`, icon: BookOpen, href: '/admin/courses' },
        ].map(({ label, value, sub, icon: Icon, href }) => <Link key={label} href={href} className={`${card} block p-5 transition hover:border-[hsl(var(--primary)/.35)]`}>
          <div className="flex items-start justify-between"><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</p><span className="grid size-9 place-items-center rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon size={16} /></span></div>
          <p className="mt-2 font-mono-ui text-2xl font-medium">{value}</p><p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">{sub}</p>
        </Link>)}
      </section>
      <section>
        <h2 className="mb-3 font-display text-lg font-bold">Quick actions</h2>
        <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
          {quick.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`${card} flex items-center gap-3 p-4 text-sm font-bold transition hover:border-[hsl(var(--link)/.5)] hover:text-[hsl(var(--link))]`} data-testid={`quick-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={17} />{label}</Link>)}
        </div>
      </section>
      <section>
        <div className="mb-3 flex items-end justify-between"><h2 className="font-display text-lg font-bold">Latest payments</h2><Link href="/admin/payments" className="text-xs font-bold text-[hsl(var(--link))] hover:underline">All payments</Link></div>
        <PaymentsTable payments={s.recentPayments} />
      </section>
    </div>}
  </AdminLayout>;
}
