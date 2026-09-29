import { type FormEvent, type ReactNode, useState } from 'react';
import { QueryClient, QueryClientProvider, useQueryClient } from '@tanstack/react-query';
import { Link, Redirect, Route, Switch, useLocation, useParams } from 'wouter';
import {
  ArrowRight, BarChart3, BookOpen, Check, ChevronRight, Clock3,
  CreditCard, ExternalLink, Flame, GraduationCap, LayoutDashboard, LockKeyhole,
  Award, LogOut, Menu, Play, ReceiptText, Search, ShieldCheck, Sparkles, UserRound,
  WalletCards, X, Zap,
} from 'lucide-react';
import * as ApiClient from '@workspace/api-client-react';
import { ErrorBoundary } from '@/components/error-boundary';
import { Toaster } from '@/components/ui/toaster';
import { TooltipProvider } from '@/components/ui/tooltip';
import { api, initials, useAuthActions, useCurrentUser } from '@/lib/auth';
import AuthPage, { loginHref } from '@/pages/auth';
import AdminDashboardPage from '@/pages/admin/dashboard';
import AdminCoursesPage from '@/pages/admin/courses';
import CourseEditorPage from '@/pages/admin/course-editor';
import AdminCategoriesPage from '@/pages/admin/categories';
import AdminUsersPage from '@/pages/admin/users';
import AdminPaymentsPage from '@/pages/admin/payments';
import AdminMoodlePage from '@/pages/admin/moodle';
import AdminCertificatesPage from '@/pages/admin/certificates';
import CertificateEditorPage from '@/pages/admin/certificate-editor';
import AdminSettingsPage from '@/pages/admin/settings';
import { useSiteSettings } from '@/lib/site';
import NotFound from '@/pages/not-found';
import ModulePage from '@/pages/module';
import { CertificatesPage, VerifyPage } from '@/pages/certificates';
import { AccountDetails, ChangePassword, ForgotPasswordPage, ResetPasswordPage } from '@/pages/password';
import RichContent from '@/components/rich-content';
import '@/index.css';

const queryClient = new QueryClient();
const {
  getGetCourseQueryKey, getGetStudentDashboardQueryKey, getListStudentPaymentsQueryKey,
  useCreateStkPush, useGetCourse, useGetStudentDashboard, useListCourses,
  useListStudentPayments,
} = ApiClient as any;

type CourseSummary = {
  id: number; title: string; category: string; description: string; price: number;
  paymentModel: string; lessonCount: number; enrolledCount: number; accent: string; imageUrl: string;
};
type CourseProgress = {
  coursePrice: number; totalPaid: number; remaining: number; percentagePaid: number;
  unlockedModules: number; totalModules: number; nextModule?: string | null; amountToUnlock?: number | null;
};
type Completion = { done: number; total: number; percent: number; complete: boolean };
type EnrolledCourse = CourseSummary & { progress: CourseProgress; completion?: Completion };
type StudentDashboard = {
  studentName: string; streakDays: number; enrolledCourses: EnrolledCourse[]; featuredCourses: CourseSummary[];
  totalPaid: number; activeCourseCount: number; completedCourseCount: number;
};
type Module = {
  id: number; title: string; description: string; order: number; unlockAmount: number;
  unlocked: boolean; lessonCount: number; duration: string; status?: string;
};
type CourseDetail = CourseSummary & {
  instructor: string; instructorRole: string; paymentPlan: { name: string; amountPerDay: number; description: string };
  progress: CourseProgress; modules: Module[]; overviewHtml?: string;
  completion?: Completion; certificate?: { code: string } | null; certificateRule?: 'completion' | 'exams' | 'manual';
};
type Payment = {
  id: number; courseTitle: string; amount: number; status: string; date: string;
  phoneNumber: string; receipt?: string | null; checkoutRequestId?: string | null;
};

const money = (value = 0) => `KSh ${value.toLocaleString('en-KE')}`;
const shortMoney = (value = 0) => `KSh ${value.toLocaleString('en-KE')}`;

const navItems = [
  { href: '/', label: 'Overview', icon: LayoutDashboard },
  { href: '/courses', label: 'Explore courses', icon: BookOpen },
  { href: '/learning', label: 'My learning', icon: GraduationCap },
  { href: '/payments', label: 'Payments', icon: WalletCards },
  { href: '/certificates', label: 'Certificates', icon: Award },
];
// The admin pages have their own tabs, so the main bar only needs one entry point.
const adminNavItem = { href: '/admin', label: 'Admin', icon: ShieldCheck };

function Mark() {
  return (
    <Link href="/" className="flex shrink-0 items-center" data-testid="link-brand">
      <img src="/images/uhandisi-logo.png" alt="Uhandisi School" className="h-12 max-h-[60px] w-auto max-w-[220px] object-contain object-left" />
    </Link>
  );
}

function TopNavLink({ href, label, icon: Icon, active }: (typeof navItems)[number] & { active: boolean }) {
  return <Link href={href} data-testid={`link-nav-${label.toLowerCase().replaceAll(' ', '-')}`} aria-current={active ? 'page' : undefined}
    className={`flex items-center gap-2 whitespace-nowrap rounded-md px-3 py-2 text-[15px] font-bold leading-tight text-[hsl(var(--foreground))] transition hover:-translate-y-px hover:bg-white/70 ${active ? 'bg-white/[.78] shadow-[inset_0_-2px_0_hsl(var(--link))]' : ''}`}>
    <Icon size={16} strokeWidth={active ? 2.4 : 1.8} /><span>{label}</span>
  </Link>;
}

function Shell({ children }: { children: ReactNode }) {
  const [location, navigate] = useLocation();
  const [mobileOpen, setMobileOpen] = useState(false);
  const user = useCurrentUser().data;
  const { logout } = useAuthActions();
  const isAdmin = user?.role === 'admin';
  // Guests can only browse courses; everything else needs an account.
  const visibleNav = user ? navItems : navItems.filter(i => i.href === '/courses');
  const allNav = isAdmin ? [...visibleNav, adminNavItem] : visibleNav;
  const isActive = (href: string) => href === '/' ? location === href : location.startsWith(href);
  const signOut = async () => { await logout(); navigate('/courses'); };
  const loginLink = loginHref(location);
  return (
    <div className="grain min-h-[100dvh] bg-[hsl(var(--background))]">
      <header className="sticky top-0 z-30 border-b border-[hsl(var(--nav-border))] bg-[hsl(var(--nav))] text-[hsl(var(--foreground))] shadow-[0_1px_5px_rgba(0,0,0,0.08)]">
        <div className="mx-auto flex h-[68px] max-w-[1320px] items-center gap-6 px-5 sm:px-8 lg:px-10">
          <Mark />
          <nav className="hidden min-w-0 flex-1 items-center gap-1 overflow-x-auto lg:flex" aria-label="Primary navigation">
            {allNav.map(item => <TopNavLink key={item.href} {...item} active={isActive(item.href)} />)}
          </nav>
          <div className="ml-auto flex items-center gap-2 sm:gap-3">
            {user ? <>
              <Link href="/profile" className="flex items-center gap-2.5 rounded-md py-1 pl-1 pr-2 transition hover:bg-white/70" data-testid="link-profile-header">
                <span className="grid size-9 shrink-0 place-items-center rounded-full bg-[hsl(var(--primary))] text-xs font-bold text-[hsl(var(--primary-foreground))]">{initials(user.name)}</span>
                <span className="hidden max-w-[140px] xl:block"><span className="block truncate text-sm font-bold leading-tight">{user.name}</span><span className="text-[11px] capitalize text-[hsl(var(--foreground)/.7)]">{user.role}</span></span>
              </Link>
              <button onClick={signOut} className="hidden size-9 place-items-center rounded-md text-[hsl(var(--foreground)/.75)] transition hover:bg-white/70 hover:text-[hsl(var(--foreground))] lg:grid" aria-label="Log out" title="Log out" data-testid="button-logout"><LogOut size={17} /></button>
            </> : <>
              <Link href={loginLink} className="whitespace-nowrap rounded-md px-3 py-2 text-[15px] font-bold hover:bg-white/70" data-testid="link-header-login">Log in</Link>
              <Link href={loginHref(location, 'register')} className="hidden rounded-md bg-[hsl(var(--primary))] px-4 py-2 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] sm:block" data-testid="link-header-register">Sign up free</Link>
            </>}
            <button onClick={() => setMobileOpen(!mobileOpen)} className="grid size-11 place-items-center rounded-md border border-[hsl(var(--primary)/.12)] bg-white/90 shadow-[0_2px_8px_rgba(0,0,0,0.12)] lg:hidden" aria-label={mobileOpen ? 'Close navigation' : 'Open navigation'} aria-expanded={mobileOpen} data-testid="button-mobile-menu">{mobileOpen ? <X size={19} /> : <Menu size={19} />}</button>
          </div>
        </div>
      </header>
      <div>
        {mobileOpen && <div className="fixed inset-x-0 top-[68px] z-20 border-b border-[hsl(var(--border))] bg-[hsl(var(--card))] p-4 shadow-lg lg:hidden">
          <nav className="grid gap-1">{allNav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} onClick={() => setMobileOpen(false)} className={`flex items-center gap-3 rounded-md px-4 py-3 text-sm font-semibold ${isActive(href) ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]' : ''}`} data-testid={`link-mobile-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={18} />{label}</Link>)}
            {user
              ? <button onClick={signOut} className="flex items-center gap-3 rounded-md px-4 py-3 text-left text-sm font-semibold text-[hsl(var(--muted-foreground))]" data-testid="button-logout-mobile"><LogOut size={18} />Log out</button>
              : <Link href={loginHref(location, 'register')} onClick={() => setMobileOpen(false)} className="flex items-center gap-3 rounded-md px-4 py-3 text-sm font-semibold text-[hsl(var(--primary))]" data-testid="link-mobile-register"><UserRound size={18} />Create free account</Link>}
          </nav>
        </div>}
        <main className="mx-auto max-w-[1320px] px-5 py-7 pb-28 sm:px-8 sm:py-10 lg:px-10 lg:pb-12">{children}</main>
      </div>
      <nav className="fixed inset-x-0 bottom-0 z-30 flex h-[68px] items-center justify-around border-t border-[hsl(var(--border))] bg-[hsl(var(--card)/.96)] px-2 backdrop-blur-xl lg:hidden">
        {allNav.map(({ href, label, icon: Icon }) => <Link key={href} href={href} className={`flex min-w-[56px] flex-col items-center gap-1 py-2 text-[10px] font-bold ${location === href || (href !== '/' && location.startsWith(href)) ? 'text-[hsl(var(--primary))]' : 'text-[hsl(var(--muted-foreground))]'}`} data-testid={`link-bottom-${label.toLowerCase().replaceAll(' ', '-')}`}><Icon size={19} /><span>{label.split(' ')[0]}</span></Link>)}
      </nav>
    </div>
  );
}

function PageTitle({ eyebrow, title, copy, action }: { eyebrow?: string; title: string; copy?: string; action?: ReactNode }) {
  return <div className="mb-8 flex flex-col justify-between gap-4 sm:flex-row sm:items-end">
    <div>{eyebrow && <p className="mb-2 text-[10px] font-extrabold uppercase tracking-[.2em] text-[hsl(var(--primary))]">{eyebrow}</p>}<h1 className="font-display text-3xl font-bold tracking-tight text-[hsl(var(--foreground))] sm:text-4xl">{title}</h1>{copy && <p className="mt-2 max-w-xl text-sm leading-6 text-[hsl(var(--muted-foreground))]">{copy}</p>}</div>
    {action}
  </div>;
}

function LoadingState({ rows = 3 }: { rows?: number }) {
  return <div className="space-y-4" data-testid="state-loading">{Array.from({ length: rows }).map((_, i) => <div key={i} className="skeleton h-24 rounded-lg bg-[hsl(var(--muted))]" />)}</div>;
}
function ErrorState({ onRetry }: { onRetry?: () => void }) {
  return <div className="rounded-lg border border-[hsl(var(--destructive)/.2)] bg-[hsl(var(--destructive)/.06)] p-8 text-center" data-testid="state-error"><ShieldCheck className="mx-auto mb-3 text-[hsl(var(--destructive))]" size={28} /><h2 className="font-display text-lg font-bold">We could not load this just now</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Check your connection and try again.</p>{onRetry && <button onClick={onRetry} className="mt-4 rounded-md bg-[hsl(var(--destructive))] px-4 py-2 text-xs font-bold text-white" data-testid="button-retry">Try again</button>}</div>;
}
function EmptyState({ title, copy, action }: { title: string; copy: string; action?: ReactNode }) {
  return <div className="rounded-lg border border-dashed border-[hsl(var(--border))] bg-[hsl(var(--card)/.6)] p-10 text-center" data-testid="state-empty"><BookOpen className="mx-auto mb-3 text-[hsl(var(--accent))]" size={28} /><h2 className="font-display text-lg font-bold">{title}</h2><p className="mx-auto mt-1 max-w-sm text-sm text-[hsl(var(--muted-foreground))]">{copy}</p>{action && <div className="mt-5">{action}</div>}</div>;
}

function CourseArt({ course, className = '' }: { course: CourseSummary | EnrolledCourse; className?: string }) {
  return <div className={`relative overflow-hidden rounded-[inherit] ${className}`} style={{ background: course.accent || 'hsl(var(--primary))' }}>
    {course.imageUrl ? <img src={course.imageUrl} alt="" className="absolute inset-0 size-full object-cover mix-blend-luminosity opacity-45" /> : null}
    <div className="absolute -right-5 -top-10 size-36 rounded-full border-[18px] border-white/10" /><div className="absolute -bottom-10 -left-8 size-32 rounded-full border-[13px] border-black/10" />
    <div className="absolute inset-0 bg-gradient-to-br from-black/5 via-transparent to-black/30" />
    <div className="relative z-10 flex h-full flex-col justify-between p-5 text-white"><span className="w-fit rounded-full bg-black/15 px-2.5 py-1 text-[9px] font-bold uppercase tracking-[.15em] backdrop-blur-sm">{course.category}</span><div className="flex items-end justify-between"><span className="max-w-[75%] font-display text-xl font-bold leading-tight">{course.title}</span><Sparkles size={18} className="opacity-70" /></div></div>
  </div>;
}

function ProgressBar({ value, light = false }: { value: number; light?: boolean }) {
  return <div className={`h-2 overflow-hidden rounded-full ${light ? 'bg-white/20' : 'bg-[hsl(var(--muted))]'}`}><div className="h-full rounded-full bg-[hsl(var(--accent))] transition-all duration-700" style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div>;
}

function HomePage() {
  const dashboard = useGetStudentDashboard();
  const heroImage = useSiteSettings().data?.heroImageUrl;
  const data = dashboard.data as StudentDashboard | undefined;
  if (dashboard.isLoading) return <><PageTitle eyebrow="Your learning space" title="Good things take practice." /><LoadingState rows={4} /></>;
  if (dashboard.isError || !data) return <><PageTitle eyebrow="Your learning space" title="Good things take practice." /><ErrorState onRetry={() => dashboard.refetch()} /></>;
  const current = data.enrolledCourses?.[0];
  return <div className="space-y-10">
    <section className={`animate-rise relative overflow-hidden rounded-xl bg-[hsl(var(--sidebar))] px-6 py-8 text-[hsl(var(--sidebar-foreground))] sm:px-10 sm:py-10 ${heroImage ? 'pt-52 sm:min-h-[340px] sm:pt-10' : ''}`} data-testid="section-hero">
      {/* Phones: the photo is a strip across the top that fades into the banner. Wider screens: it fills the banner, darkened on the left behind the text. */}
      {heroImage
        ? <><img src={heroImage} alt="" className="absolute inset-x-0 top-0 h-52 w-full object-cover sm:inset-0 sm:h-full" data-testid="img-hero" />
          <div className="absolute inset-x-0 top-0 h-52 bg-gradient-to-b from-transparent via-transparent to-[hsl(var(--sidebar))] sm:inset-0 sm:h-full sm:bg-gradient-to-r sm:from-[hsl(var(--sidebar)/.97)] sm:via-[hsl(var(--sidebar)/.8)] sm:to-[hsl(var(--sidebar)/.05)]" /></>
        : <><div className="absolute -right-20 -top-28 size-80 rounded-full border-[40px] border-[hsl(var(--accent)/.1)]" /><div className="absolute -bottom-28 right-24 size-48 rounded-full border-[20px] border-[hsl(var(--accent)/.08)]" /></>}
      <div className="relative max-w-2xl"><p className="mb-4 flex items-center gap-2 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]"><span className="size-1.5 rounded-full bg-[hsl(var(--accent))]" /> Student overview</p><h1 className="font-display text-4xl font-bold tracking-tight sm:text-5xl">Hi, {data.studentName.split(' ')[0]}.<br /><span className="text-[hsl(var(--accent))]">Build something real.</span></h1><p className="mt-5 max-w-md text-sm leading-6 text-[hsl(var(--sidebar-foreground)/.68)]">Small, consistent steps are adding up. Pick up where you left off or find a skill for your next chapter.</p><Link href={current ? `/courses/${current.id}` : '/courses'} className="mt-7 inline-flex items-center gap-2 rounded-md bg-[hsl(var(--accent))] px-4 py-3 text-xs font-extrabold text-[hsl(var(--accent-foreground))] transition hover:-translate-y-0.5" data-testid="link-hero-continue">{current ? 'Continue learning' : 'Explore the school'} <ArrowRight size={15} /></Link></div>
      <div className={`relative mt-9 flex gap-6 border-t border-white/10 pt-5 sm:absolute sm:bottom-8 sm:right-10 sm:mt-0 sm:border-0 sm:pt-0 ${heroImage ? 'sm:rounded-lg sm:bg-black/45 sm:px-5 sm:py-3 sm:backdrop-blur-sm' : ''}`}><div><p className="font-mono-ui text-2xl font-medium text-[hsl(var(--accent))]">{data.streakDays}</p><p className="mt-1 text-[10px] text-white/55">day streak</p></div><div><p className="font-mono-ui text-2xl font-medium">{data.activeCourseCount}</p><p className="mt-1 text-[10px] text-white/55">active courses</p></div></div>
    </section>
    <section className="animate-rise-2 grid gap-4 sm:grid-cols-3">
      {[{ label: 'Paid towards learning', value: money(data.totalPaid), icon: CreditCard, tint: 'text-[hsl(var(--primary))]' }, { label: 'Active courses', value: String(data.activeCourseCount).padStart(2, '0'), icon: BarChart3, tint: 'text-[hsl(var(--accent-foreground))]' }, { label: 'Courses completed', value: String(data.completedCourseCount).padStart(2, '0'), icon: Check, tint: 'text-[hsl(var(--link))]' }].map(({ label, value, icon: Icon, tint }) => <div className="flex items-center justify-between rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft" key={label}><div><p className="text-[10px] font-bold uppercase tracking-[.12em] text-[hsl(var(--muted-foreground))]">{label}</p><p className={`mt-2 font-mono-ui text-xl font-medium ${tint}`}>{value}</p></div><div className="grid size-10 place-items-center rounded-md bg-[hsl(var(--secondary))]"><Icon size={18} /></div></div>)}
    </section>
    <section className="animate-rise-3"><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">In progress</p><h2 className="mt-1 font-display text-2xl font-bold">Your learning path</h2></div><Link href="/learning" className="text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-view-learning">View all <ArrowRight className="ml-1 inline" size={13} /></Link></div>
      {current ? <ContinueCard course={current} /> : <EmptyState title="Your path starts here" copy="Choose a practical course and start building at your own pace." action={<Link href="/courses" className="inline-flex rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-empty-courses">Browse courses</Link>} />}
    </section>
    <section><div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">Worth a look</p><h2 className="mt-1 font-display text-2xl font-bold">Courses for your next move</h2></div><Link href="/courses" className="text-xs font-bold text-[hsl(var(--primary))]" data-testid="link-view-courses">All courses <ArrowRight className="ml-1 inline" size={13} /></Link></div><div className="grid gap-4 md:grid-cols-3">{data.featuredCourses?.slice(0, 3).map(course => <CourseCard key={course.id} course={course} />)}</div></section>
  </div>;
}

function ContinueCard({ course }: { course: EnrolledCourse }) {
  const p = course.progress;
  const c = course.completion;
  return <div className="grid overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft md:grid-cols-[220px_1fr]"><CourseArt course={course} className="min-h-[170px] rounded-none" /><div className="flex flex-col justify-between p-5 sm:p-6"><div><div className="flex items-start justify-between gap-4"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--muted-foreground))]">{course.category}</p><h3 className="mt-1 font-display text-xl font-bold">{course.title}</h3></div><span className="rounded-full bg-[hsl(var(--secondary))] px-2.5 py-1 text-[10px] font-bold text-[hsl(var(--primary))]">{c?.complete ? 'Completed' : `${c?.percent ?? 0}% complete`}</span></div><div className="mt-5"><div className="mb-2 flex justify-between text-xs"><span className="text-[hsl(var(--muted-foreground))]">{c ? `${c.done} of ${c.total} activities done` : `${p.unlockedModules} of ${p.totalModules} modules open`}</span>{course.paymentModel !== 'free' && <span className="font-mono-ui text-[hsl(var(--primary))]">{money(p.totalPaid)} paid</span>}</div><ProgressBar value={c?.percent ?? 0} /></div></div><div className="mt-5 flex items-center justify-between border-t border-[hsl(var(--border))] pt-4"><span className="flex items-center gap-2 text-xs text-[hsl(var(--muted-foreground))]"><Play size={13} fill="currentColor" /> {p.nextModule || 'Course complete'}</span><Link href={`/courses/${course.id}`} className="rounded-md bg-[hsl(var(--primary))] px-3 py-2 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid={`link-continue-course-${course.id}`}>Open course</Link></div></div></div>;
}

function CourseCard({ course }: { course: CourseSummary }) {
  return <Link href={`/courses/${course.id}`} className="group overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft transition duration-150 hover:shadow-lift" data-testid={`card-course-${course.id}`}><CourseArt course={course} className="h-40 rounded-none" /><div className="p-4"><div className="flex items-center justify-between text-[10px] font-bold text-[hsl(var(--muted-foreground))]"><span>{course.lessonCount} lessons</span>{course.paymentModel === 'free' ? <span className="rounded bg-[hsl(var(--link)/.1)] px-2 py-0.5 text-[hsl(var(--link))]">Free</span> : <span>{money(course.price)}</span>}</div><p className="mt-2 line-clamp-2 text-lg font-semibold leading-snug text-[hsl(var(--link))] group-hover:underline">{course.title}</p><div className="mt-4 flex items-center justify-between text-xs"><span className="text-[hsl(var(--muted-foreground))]">{course.enrolledCount.toLocaleString()} learners</span><span className="grid size-7 place-items-center rounded-full bg-[hsl(var(--secondary))] text-[hsl(var(--primary))] transition group-hover:bg-[hsl(var(--accent))]"><ArrowRight size={14} /></span></div></div></Link>;
}

function CoursesPage() {
  const courses = useListCourses();
  const [category, setCategory] = useState('All');
  const [search, setSearch] = useState('');
  const [price, setPrice] = useState<'all' | 'free' | 'paid'>('all');
  const items = (courses.data as CourseSummary[] | undefined) || [];
  const categories = ['All', ...Array.from(new Set(items.map(c => c.category)))];
  const isFree = (c: CourseSummary) => c.paymentModel === 'free';
  const filtered = items.filter(c => (category === 'All' || c.category === category) && (price === 'all' || (price === 'free') === isFree(c)) && `${c.title} ${c.description}`.toLowerCase().includes(search.toLowerCase()));
  return <><PageTitle eyebrow="The course shelf" title="Learn a skill. Use it." copy="Practical lessons for the work, ideas and opportunities you are building towards." action={<Link href="/learning" className="hidden items-center gap-2 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] px-3 py-2.5 text-xs font-bold sm:flex" data-testid="link-courses-learning"><GraduationCap size={15} /> My learning</Link>} />
    <div className="mb-7 flex flex-col gap-3 sm:flex-row"><div className="relative flex-1"><Search className="absolute left-3.5 top-3.5 text-[hsl(var(--muted-foreground))]" size={16} /><input value={search} onChange={e => setSearch(e.target.value)} placeholder="Search practical skills" className="h-11 w-full rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] pl-10 pr-4 text-sm outline-none transition focus:border-[hsl(var(--primary))]" data-testid="input-course-search" /></div><div className="flex shrink-0 rounded-md border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-1" role="group" aria-label="Price">{(['all', 'free', 'paid'] as const).map(p => <button key={p} onClick={() => setPrice(p)} aria-pressed={price === p} className={`rounded px-3 py-1.5 text-xs font-bold capitalize transition ${price === p ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--foreground))]'}`} data-testid={`button-price-${p}`}>{p === 'all' ? 'All prices' : p}</button>)}</div><div className="flex gap-2 overflow-x-auto pb-1">{categories.map(item => <button key={item} onClick={() => setCategory(item)} className={`whitespace-nowrap rounded-md px-3.5 py-2 text-xs font-bold transition ${category === item ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : 'border border-[hsl(var(--border))] bg-[hsl(var(--card))] text-[hsl(var(--muted-foreground))]'}`} data-testid={`button-category-${item.toLowerCase().replaceAll(' ', '-')}`}>{item}</button>)}</div></div>
    {courses.isLoading ? <LoadingState rows={5} /> : courses.isError ? <ErrorState onRetry={() => courses.refetch()} /> : filtered.length === 0 ? <EmptyState title="No courses match that search" copy="Try a broader search or explore another category." action={<button onClick={() => { setSearch(''); setCategory('All'); setPrice('all'); }} className="text-xs font-bold text-[hsl(var(--primary))]" data-testid="button-reset-course-filter">Reset filters</button>} /> : <div className="grid gap-5 sm:grid-cols-2 xl:grid-cols-3">{filtered.map(c => <CourseCard key={c.id} course={c} />)}</div>}
  </>;
}

function PaymentModal({ course, onClose }: { course: CourseDetail; onClose: () => void }) {
  const mutation = useCreateStkPush();
  const client = useQueryClient();
  const [amount, setAmount] = useState(String(course.progress.amountToUnlock || course.paymentPlan.amountPerDay));
  const [phone, setPhone] = useState('');
  const [submitted, setSubmitted] = useState(false);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    mutation.mutate({ data: { courseId: course.id, amount: Number(amount), phoneNumber: phone } }, { onSuccess: () => { setSubmitted(true); client.invalidateQueries({ queryKey: getListStudentPaymentsQueryKey() }); client.invalidateQueries({ queryKey: getGetCourseQueryKey(course.id) }); client.invalidateQueries({ queryKey: getGetStudentDashboardQueryKey() }); } });
  };
  return <div className="fixed inset-0 z-50 flex items-end justify-center bg-[hsl(var(--foreground)/.4)] p-0 backdrop-blur-sm sm:items-center sm:p-5"><div className="w-full max-w-md rounded-t-xl bg-[hsl(var(--card))] p-6 shadow-lift sm:rounded-xl" role="dialog" aria-modal="true" data-testid="dialog-payment"><div className="mb-6 flex items-center justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.15em] text-[hsl(var(--primary))]">Lipa Pole Pole</p><h2 className="mt-1 font-display text-2xl font-bold">Keep your access growing</h2></div><button onClick={onClose} className="grid size-9 place-items-center rounded-full bg-[hsl(var(--muted))]" aria-label="Close payment" data-testid="button-close-payment"><X size={17} /></button></div>{submitted ? <div className="py-5 text-center"><div className="mx-auto grid size-14 place-items-center rounded-full bg-[hsl(var(--accent)/.2)] text-[hsl(var(--primary))]"><Clock3 size={26} /></div><h3 className="mt-4 font-display text-xl font-bold">Payment request sent</h3><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{(mutation.data as { message?: string } | undefined)?.message || 'Check your phone for the M-Pesa prompt.'} Your next module will unlock only after payment is confirmed.</p><button onClick={onClose} className="mt-6 w-full rounded-md bg-[hsl(var(--primary))] py-3 text-sm font-bold text-[hsl(var(--primary-foreground))]" data-testid="button-done-payment">View payment status</button></div> : <form onSubmit={submit} className="space-y-4"><div className="rounded-lg bg-[hsl(var(--secondary)/.55)] p-4"><div className="flex justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">Amount to unlock</span><span className="font-mono-ui font-medium text-[hsl(var(--primary))]">{money(course.progress.amountToUnlock || course.paymentPlan.amountPerDay)}</span></div><p className="mt-2 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{course.paymentPlan.description}</p></div><label className="block text-xs font-bold">Amount<input type="number" min="100" value={amount} onChange={e => setAmount(e.target.value)} className="mt-2 h-11 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-payment-amount" /></label><label className="block text-xs font-bold">M-Pesa number<input required value={phone} onChange={e => setPhone(e.target.value)} placeholder="07xx xxx xxx" className="mt-2 h-11 w-full rounded-md border border-[hsl(var(--border))] bg-transparent px-3 text-sm outline-none focus:border-[hsl(var(--primary))]" data-testid="input-payment-phone" /></label>{mutation.isError && <p className="rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" data-testid="status-payment-error">We could not send that request. Check the number and try again.</p>}<button disabled={mutation.isPending} className="flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60" data-testid="button-submit-payment">{mutation.isPending ? 'Sending request…' : <>Send M-Pesa request <ArrowRight size={16} /></>}</button><p className="flex items-center justify-center gap-1.5 text-center text-[10px] text-[hsl(var(--muted-foreground))]"><ShieldCheck size={12} /> Securely processed. You only pay for the next step.</p></form>}</div></div>;
}

function DetailPage() {
  const { id } = useParams<{ id: string }>();
  const courseId = Number(id);
  const course = useGetCourse(courseId, { query: { queryKey: getGetCourseQueryKey(courseId) } });
  const [paying, setPaying] = useState(false);
  const user = useCurrentUser().data;
  const data = course.data as CourseDetail | undefined;
  if (course.isLoading) return <LoadingState rows={4} />;
  if (course.isError || !data) return <ErrorState onRetry={() => course.refetch()} />;
  const p = data.progress;
  return <><Link href="/courses" className="mb-6 inline-flex items-center gap-2 text-xs font-bold text-[hsl(var(--muted-foreground))] hover:text-[hsl(var(--primary))]" data-testid="link-back-courses"><ChevronRight size={14} className="rotate-180" /> All courses</Link><section className="grid overflow-hidden rounded-xl bg-[hsl(var(--sidebar))] text-[hsl(var(--sidebar-foreground))] lg:grid-cols-[1.1fr_.9fr]"><div className="p-7 sm:p-10"><p className="mb-4 text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--accent))]">{data.category} · {data.lessonCount} lessons</p><h1 className="max-w-2xl font-display text-4xl font-bold leading-[1.08] sm:text-5xl">{data.title}</h1><p className="mt-5 max-w-xl text-sm leading-7 text-white/65">{data.description}</p><div className="mt-7 flex flex-wrap items-center gap-4 text-xs text-white/65"><span className="flex items-center gap-2"><UserRound size={15} /> {data.instructor}</span><span className="h-1 w-1 rounded-full bg-white/30" /><span>{data.instructorRole}</span></div></div><div className="relative min-h-[260px] overflow-hidden p-7 sm:p-10" style={{ background: data.accent || 'hsl(var(--primary))' }}><div className="absolute -right-20 -top-16 size-64 rounded-full border-[38px] border-white/10" /><div className="relative flex h-full flex-col justify-between"><span className="w-fit rounded-full bg-black/15 px-3 py-1.5 text-[10px] font-bold uppercase tracking-[.15em]">Your progress</span><div><div className="mb-2 flex items-end justify-between"><span className="font-mono-ui text-4xl font-medium">{Math.round(p.percentagePaid)}<small className="text-xl">%</small></span><span className="text-xs text-white/70">{money(p.totalPaid)} of {money(p.coursePrice)}</span></div><ProgressBar value={p.percentagePaid} light /><p className="mt-3 text-xs text-white/70">{p.unlockedModules} of {p.totalModules} {p.totalModules === 1 ? 'module' : 'modules'} unlocked</p></div></div></div></section><div className="mt-8 grid gap-8 lg:grid-cols-[1fr_340px]"><section>{user && data.completion && data.completion.total > 0 ? <CourseProgressCard data={data} /> : null}{data.overviewHtml?.trim() ? <div className="mb-10" data-testid="course-overview"><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">About this course</p><RichContent html={data.overviewHtml} className="mt-3" /></div> : null}<div className="mb-4 flex items-end justify-between"><div><p className="text-[10px] font-bold uppercase tracking-[.2em] text-[hsl(var(--primary))]">The curriculum</p><h2 className="mt-1 font-display text-2xl font-bold">Learn in clear steps</h2></div><span className="text-xs text-[hsl(var(--muted-foreground))]">{data.modules.length} {data.modules.length === 1 ? 'module' : 'modules'}</span></div><div className="space-y-3">{data.modules.map((module, i) => <ModuleRow key={module.id} module={module} index={i} courseId={data.id} />)}</div></section>{data.paymentModel === 'free' ? <FreeCoursePanel course={data} /> : <aside className="h-fit rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft lg:sticky lg:top-24"><div className="flex items-center gap-2 text-[hsl(var(--primary))]"><Zap size={17} fill="currentColor" /><span className="text-xs font-bold uppercase tracking-[.12em]">Lipa Pole Pole</span></div><h3 className="mt-4 font-display text-2xl font-bold">Pay as you grow</h3><p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">{data.paymentPlan.description}</p><div className="my-5 border-y border-[hsl(var(--border))] py-4"><div className="flex justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">Next unlock</span><span className="font-mono-ui font-medium">{p.amountToUnlock ? money(p.amountToUnlock) : 'Complete'}</span></div><div className="mt-2 flex justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">Daily plan</span><span className="font-mono-ui font-medium">{money(data.paymentPlan.amountPerDay)}</span></div></div>{user
      ? <button onClick={() => setPaying(true)} disabled={!p.amountToUnlock} className="flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--accent))] py-3.5 text-sm font-bold text-[hsl(var(--accent-foreground))] transition hover:-translate-y-0.5 disabled:cursor-not-allowed disabled:opacity-50" data-testid="button-lipa-pole-pole">{p.amountToUnlock ? 'Make a payment' : 'Course fully unlocked'} <ArrowRight size={16} /></button>
      : <Link href={loginHref(`/courses/${data.id}`)} className="flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--accent))] py-3.5 text-sm font-bold text-[hsl(var(--accent-foreground))] transition hover:-translate-y-0.5" data-testid="link-login-to-enroll">Log in to enroll <ArrowRight size={16} /></Link>}<p className="mt-3 text-center text-[10px] text-[hsl(var(--muted-foreground))]">No subscription. No hidden fees.</p></aside>}</div>{paying && <PaymentModal course={data} onClose={() => setPaying(false)} />}</>;
}

function FreeCoursePanel({ course }: { course: CourseDetail }) {
  const user = useCurrentUser().data;
  const client = useQueryClient();
  const dashboard = useGetStudentDashboard({ query: { queryKey: getGetStudentDashboardQueryKey(), enabled: !!user } });
  const enrolled = (dashboard.data as StudentDashboard | undefined)?.enrolledCourses?.some(c => c.id === course.id);
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const join = async () => {
    setBusy(true);
    setError('');
    try {
      await api(`/courses/${course.id}/enroll`, { method: 'POST' });
      await client.invalidateQueries({ queryKey: getGetStudentDashboardQueryKey() });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not enroll. Try again.');
    } finally {
      setBusy(false);
    }
  };
  const cta = 'flex w-full items-center justify-center gap-2 rounded-md bg-[hsl(var(--primary))] py-3.5 text-sm font-bold text-[hsl(var(--primary-foreground))] transition hover:bg-[hsl(var(--primary)/.9)] disabled:opacity-60';
  return <aside className="h-fit rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft lg:sticky lg:top-24" data-testid="panel-free-course">
    <div className="flex items-center gap-2 text-[hsl(var(--link))]"><Sparkles size={17} /><span className="text-xs font-bold uppercase tracking-[.12em]">Free course</span></div>
    <h3 className="mt-4 font-display text-2xl font-bold">Learn at no cost</h3>
    <p className="mt-2 text-sm leading-6 text-[hsl(var(--muted-foreground))]">Every module is open. No payment, no M-Pesa, no catch.</p>
    <div className="my-5 border-y border-[hsl(var(--border))] py-4"><div className="flex justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">Price</span><span className="font-mono-ui font-medium">Free</span></div><div className="mt-2 flex justify-between text-sm"><span className="text-[hsl(var(--muted-foreground))]">Modules</span><span className="font-mono-ui font-medium">{course.modules.length} {course.modules.length === 1 ? 'module' : 'modules'}</span></div></div>
    {!user
      ? <Link href={loginHref(`/courses/${course.id}`, 'register')} className={cta} data-testid="link-signup-free-course">Sign up to start free <ArrowRight size={16} /></Link>
      : enrolled
        ? <><p className="flex items-center justify-center gap-2 rounded-md bg-[hsl(var(--secondary))] py-3 text-sm font-bold" data-testid="status-enrolled"><Check size={16} /> You're enrolled</p><Link href="/learning" className="mt-3 block text-center text-xs font-bold text-[hsl(var(--link))] hover:underline">Go to My learning</Link></>
        : <button onClick={join} disabled={busy || dashboard.isLoading} className={cta} data-testid="button-enroll-free">{busy ? 'Enrolling…' : <>Start learning for free <ArrowRight size={16} /></>}</button>}
    {error && <p className="mt-3 rounded-md bg-[hsl(var(--destructive)/.08)] p-3 text-xs text-[hsl(var(--destructive))]" role="alert">{error}</p>}
    {!user && <p className="mt-3 text-center text-[10px] text-[hsl(var(--muted-foreground))]">Already have an account? <Link href={loginHref(`/courses/${course.id}`)} className="font-bold text-[hsl(var(--link))]">Log in</Link></p>}
  </aside>;
}

/** The student's progress through a course, how the certificate is earned, and the certificate once it is. */
function CourseProgressCard({ data }: { data: CourseDetail }) {
  const c = data.completion!;
  const how = data.certificateRule === 'exams' ? 'Pass the exams in this course to earn your certificate.'
    : data.certificateRule === 'manual' ? 'Certificates for this course are issued by the school.'
      : 'Open every lesson and pass the exams to earn your certificate.';
  if (data.certificate) return <div className="mb-8 flex flex-wrap items-center gap-4 rounded-lg border border-[hsl(38_70%_55%/.5)] bg-[hsl(42_90%_60%/.12)] p-5" data-testid="course-certificate">
    <span className="grid size-12 shrink-0 place-items-center rounded-full bg-[hsl(42_90%_55%/.25)] text-[hsl(30_80%_32%)]"><Award size={24} /></span>
    <div className="min-w-0 flex-1"><p className="font-bold">You’ve completed this course and earned your certificate.</p><p className="text-xs text-[hsl(var(--muted-foreground))]">Certificate code {data.certificate.code}</p></div>
    <a href={`/api/certificates/${data.certificate.code}/pdf`} className="rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]">Download certificate</a>
  </div>;
  return <div className="mb-8 rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-5 shadow-soft" data-testid="course-progress-card">
    <div className="mb-2 flex items-end justify-between gap-3"><p className="text-sm font-bold">Your progress</p><p className="text-xs text-[hsl(var(--muted-foreground))]">{c.done} of {c.total} activities · <strong className="text-[hsl(var(--foreground))]">{c.percent}%</strong></p></div>
    <ProgressBar value={c.percent} />
    <p className="mt-3 flex items-center gap-1.5 text-xs text-[hsl(var(--muted-foreground))]"><Award size={13} /> {how}</p>
  </div>;
}

function ModuleRow({ module, index, courseId }: { module: Module; index: number; courseId: number }) {
  const open = module.unlocked || module.status === 'complete' || module.status === 'unlocked';
  const row = <div className={`flex items-center gap-4 rounded-lg border p-4 transition ${open ? 'border-[hsl(var(--border))] bg-[hsl(var(--card))] hover:border-[hsl(var(--primary)/.35)]' : 'border-transparent bg-[hsl(var(--muted)/.55)]'}`} data-testid={`module-row-${module.id}`}><div className={`grid size-10 shrink-0 place-items-center rounded-md text-sm font-bold ${module.status === 'complete' ? 'bg-[hsl(var(--primary))] text-[hsl(var(--primary-foreground))]' : open ? 'bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]' : 'bg-[hsl(var(--border))] text-[hsl(var(--muted-foreground))]'}`}>{module.status === 'complete' ? <Check size={17} /> : open ? String(index + 1).padStart(2, '0') : <LockKeyhole size={16} />}</div><div className="min-w-0 flex-1"><h3 className={`truncate text-sm font-bold ${!open ? 'text-[hsl(var(--muted-foreground))]' : ''}`}>{module.title}</h3><p className="mt-1 truncate text-xs text-[hsl(var(--muted-foreground))]">{module.description}</p></div><div className="hidden items-center gap-1.5 text-[10px] text-[hsl(var(--muted-foreground))] sm:flex"><Clock3 size={13} />{module.duration}</div>{!open && <span className="font-mono-ui text-[10px] text-[hsl(var(--muted-foreground))]">{money(module.unlockAmount)}</span>}{open && <ChevronRight size={16} className="text-[hsl(var(--muted-foreground))]" />}</div>;
  return open ? <Link href={`/courses/${courseId}/modules/${module.id}`} className="block" data-testid={`link-module-${module.id}`}>{row}</Link> : row;
}

function LearningPage() {
  const dashboard = useGetStudentDashboard();
  const data = dashboard.data as StudentDashboard | undefined;
  return <><PageTitle eyebrow="Your progress" title="My learning" copy="Everything you have started, in one calm place." action={<Link href="/courses" className="flex items-center gap-2 rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-learning-explore"><BookOpen size={15} /> Find another course</Link>} />{dashboard.isLoading ? <LoadingState rows={4} /> : dashboard.isError || !data ? <ErrorState onRetry={() => dashboard.refetch()} /> : data.enrolledCourses?.length ? <div className="grid gap-5">{data.enrolledCourses.map(course => <ContinueCard key={course.id} course={course} />)}</div> : <EmptyState title="No courses yet" copy="Your next useful skill is waiting on the course shelf." action={<Link href="/courses" className="inline-flex rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-learning-empty">Browse courses</Link>} />}</>;
}

function PaymentsPage() {
  const payments = useListStudentPayments();
  const list = (payments.data as Payment[] | undefined) || [];
  const pending = list.filter(p => p.status === 'pending');
  const total = list.filter(p => p.status === 'completed').reduce((sum, p) => sum + p.amount, 0);
  return <><PageTitle eyebrow="Your money trail" title="Payments" copy="Clear records of every step you have funded." action={<div className="rounded-md bg-[hsl(var(--secondary))] px-4 py-2.5 text-right"><p className="text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--muted-foreground))]">Confirmed total</p><p className="font-mono-ui text-sm font-medium text-[hsl(var(--primary))]">{money(total)}</p></div>} />{payments.isLoading ? <LoadingState rows={5} /> : payments.isError ? <ErrorState onRetry={() => payments.refetch()} /> : list.length === 0 ? <EmptyState title="No payments yet" copy="When you make your first Lipa Pole Pole payment, it will appear here." action={<Link href="/courses" className="inline-flex rounded-md bg-[hsl(var(--primary))] px-4 py-2.5 text-xs font-bold text-[hsl(var(--primary-foreground))]" data-testid="link-payments-empty">Explore courses</Link>} /> : <div className="space-y-5">{pending.length > 0 && <div className="rounded-lg border border-[hsl(var(--accent)/.55)] bg-[hsl(var(--accent)/.1)] p-4 text-sm"><div className="flex items-start gap-3"><Clock3 size={18} className="mt-0.5 text-[hsl(var(--accent-foreground))]" /><div><p className="font-bold">Waiting for M-Pesa confirmation</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{pending.length} payment request{pending.length > 1 ? 's are' : ' is'} still pending. Your access will update after Safaricom confirms.</p></div></div></div>}<div className="overflow-hidden rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] shadow-soft"><div className="hidden grid-cols-[1.3fr_1fr_.8fr_.7fr] gap-4 border-b border-[hsl(var(--border))] px-5 py-3 text-[10px] font-bold uppercase tracking-[.13em] text-[hsl(var(--muted-foreground))] sm:grid"><span>Course</span><span>Date</span><span>Amount</span><span>Status</span></div>{list.map(payment => <PaymentRow payment={payment} key={payment.id} />)}</div></div>}</>;
}
function PaymentRow({ payment }: { payment: Payment }) {
  const statusStyles: Record<string, string> = { completed: 'bg-[hsl(var(--primary)/.1)] text-[hsl(var(--primary))]', pending: 'bg-[hsl(var(--accent)/.2)] text-[hsl(var(--accent-foreground))]', failed: 'bg-[hsl(var(--destructive)/.1)] text-[hsl(var(--destructive))]' };
  return <div className="grid gap-2 border-b border-[hsl(var(--border))] px-5 py-4 last:border-0 sm:grid-cols-[1.3fr_1fr_.8fr_.7fr] sm:items-center sm:gap-4" data-testid={`row-payment-${payment.id}`}><div className="flex items-center gap-3"><span className="grid size-9 place-items-center rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><ReceiptText size={16} /></span><div><p className="text-sm font-bold">{payment.courseTitle}</p><p className="mt-0.5 text-[10px] text-[hsl(var(--muted-foreground))]">{payment.phoneNumber}</p></div></div><span className="pl-12 text-xs text-[hsl(var(--muted-foreground))] sm:pl-0">{new Date(payment.date).toLocaleDateString('en-KE', { day: 'numeric', month: 'short', year: 'numeric' })}</span><span className="pl-12 font-mono-ui text-sm sm:pl-0">{money(payment.amount)}</span><span className={`ml-12 w-fit rounded-full px-2.5 py-1 text-[10px] font-bold capitalize sm:ml-0 ${statusStyles[payment.status] || statusStyles.pending}`} data-testid={`status-payment-${payment.id}`}>{payment.status}</span></div>;
}

 function ProfilePage() {
  const [reminders, setReminders] = useState(true);
  const [digest, setDigest] = useState(false);
  return <><PageTitle eyebrow="Your account" title="Profile & preferences" copy="Keep your details up to date and your account secure." />
    <div className="grid gap-6 lg:grid-cols-2"><AccountDetails /><ChangePassword /></div>
    <div className="mt-6"><section className="rounded-lg border border-[hsl(var(--border))] bg-[hsl(var(--card))] p-6 shadow-soft"><h2 className="font-display text-xl font-bold">Learning preferences</h2><p className="mt-1 text-sm text-[hsl(var(--muted-foreground))]">Helpful nudges, never noise.</p><div className="mt-6 divide-y divide-[hsl(var(--border))]"><PreferenceRow icon={Flame} title="Keep my streak alive" copy="A gentle reminder when you have not learned today." enabled={reminders} onChange={() => setReminders(!reminders)} testId="switch-streak" /><PreferenceRow icon={ReceiptText} title="Payment confirmations" copy="Get a message when your payment is confirmed." enabled={true} onChange={() => {}} disabled testId="switch-payments" /><PreferenceRow icon={BookOpen} title="Weekly learning digest" copy="A simple look at what you have achieved." enabled={digest} onChange={() => setDigest(!digest)} testId="switch-digest" /></div><div className="mt-6 flex items-start gap-3 rounded-md bg-[hsl(var(--secondary)/.6)] p-4"><ShieldCheck size={17} className="mt-0.5 shrink-0 text-[hsl(var(--primary))]" /><p className="text-xs leading-5 text-[hsl(var(--muted-foreground))]">Your account and payment information are kept private and secure.</p></div></section></div>
  </>;
}
function PreferenceRow({ icon: Icon, title, copy, enabled, onChange, disabled, testId }: { icon: typeof Flame; title: string; copy: string; enabled: boolean; onChange: () => void; disabled?: boolean; testId: string }) {
  return <div className="flex items-center gap-3 py-5"><span className="grid size-9 shrink-0 place-items-center rounded-md bg-[hsl(var(--secondary))] text-[hsl(var(--primary))]"><Icon size={16} /></span><div className="min-w-0 flex-1"><p className="text-sm font-bold">{title}</p><p className="mt-1 text-xs leading-5 text-[hsl(var(--muted-foreground))]">{copy}</p></div><button onClick={onChange} disabled={disabled} className={`relative h-6 w-11 shrink-0 rounded-full transition ${enabled ? 'bg-[hsl(var(--primary))]' : 'bg-[hsl(var(--muted))]'} disabled:opacity-50`} aria-label={title} data-testid={testId}><span className={`absolute top-1 size-4 rounded-full bg-[hsl(var(--card))] transition-all ${enabled ? 'left-6' : 'left-1'}`} /></button></div>;
}

/** Admin pages; anyone else is sent home. A stable component so pages keep their state across re-renders. */
function AdminOnly({ children }: { children: ReactNode }) {
  const user = useCurrentUser().data;
  return user?.role === 'admin' ? <>{children}</> : <Redirect to="/" />;
}

function AppRouter() {
  const me = useCurrentUser();
  const [location] = useLocation();
  if (me.isLoading) return <div className="grid min-h-[100dvh] place-items-center bg-[hsl(var(--background))]"><div className="skeleton h-12 w-48 rounded-md bg-[hsl(var(--muted))]" data-testid="state-auth-loading" /></div>;
  if (me.isError) return <div className="mx-auto max-w-md p-10"><ErrorState onRetry={() => me.refetch()} /></div>;

  const user = me.data;
  if (!user) {
    // Guests may browse the catalogue; anything personal sends them to log in and back again.
    return <Switch>
      <Route path="/login">{() => <AuthPage mode="login" />}</Route>
      <Route path="/register">{() => <AuthPage mode="register" />}</Route>
      <Route path="/forgot-password" component={ForgotPasswordPage} />
      <Route path="/reset-password" component={ResetPasswordPage} />
      <Route path="/"><Redirect to="/courses" /></Route>
      <Route path="/courses"><Shell><ErrorBoundary><CoursesPage /></ErrorBoundary></Shell></Route>
      <Route path="/courses/:id"><Shell><ErrorBoundary><DetailPage /></ErrorBoundary></Shell></Route>
      <Route path="/verify/:code?"><Shell><ErrorBoundary><VerifyPage /></ErrorBoundary></Shell></Route>
      <Route><Redirect to={loginHref(location)} /></Route>
    </Switch>;
  }
  if (location === '/login' || location === '/register') return <Redirect to={user.role === 'admin' ? '/admin' : '/'} />;
  if (location === '/forgot-password') return <Redirect to="/profile" />;
  if (location === '/reset-password') return <ResetPasswordPage />;

  return <Shell><ErrorBoundary><Switch>
    <Route path="/" component={HomePage} /><Route path="/courses" component={CoursesPage} /><Route path="/courses/:id/modules/:moduleId" component={ModulePage} /><Route path="/courses/:id" component={DetailPage} />
    <Route path="/learning" component={LearningPage} /><Route path="/payments" component={PaymentsPage} /><Route path="/profile" component={ProfilePage} />
    <Route path="/certificates" component={CertificatesPage} /><Route path="/verify/:code?" component={VerifyPage} />
    <Route path="/admin">{() => <AdminOnly><AdminDashboardPage /></AdminOnly>}</Route>
    <Route path="/admin/courses">{() => <AdminOnly><AdminCoursesPage /></AdminOnly>}</Route>
    <Route path="/admin/courses/:id/:tab?">{() => <AdminOnly><CourseEditorPage /></AdminOnly>}</Route>
    <Route path="/admin/categories">{() => <AdminOnly><AdminCategoriesPage /></AdminOnly>}</Route>
    <Route path="/admin/users">{() => <AdminOnly><AdminUsersPage /></AdminOnly>}</Route>
    <Route path="/admin/payments">{() => <AdminOnly><AdminPaymentsPage /></AdminOnly>}</Route>
    <Route path="/admin/moodle">{() => <AdminOnly><AdminMoodlePage /></AdminOnly>}</Route>
    <Route path="/admin/certificates">{() => <AdminOnly><AdminCertificatesPage /></AdminOnly>}</Route>
    <Route path="/admin/certificates/:id">{() => <AdminOnly><CertificateEditorPage /></AdminOnly>}</Route>
    <Route path="/admin/settings">{() => <AdminOnly><AdminSettingsPage /></AdminOnly>}</Route>
    <Route component={NotFound} />
  </Switch></ErrorBoundary></Shell>;
}
function App() {
  return <QueryClientProvider client={queryClient}><TooltipProvider><AppRouter /><Toaster /></TooltipProvider></QueryClientProvider>;
}
export default App;