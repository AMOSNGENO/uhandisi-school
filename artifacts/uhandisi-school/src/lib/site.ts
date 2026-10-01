import { useQuery } from '@tanstack/react-query';
import { api } from '@/lib/auth';

/** Settings an admin controls from Admin → Site settings. */
export type PaymentPlan = { id: string; name: string; amountPerDay: number };
export type SiteSettings = { heroImageUrl: string; heroImageFlip: boolean; paymentPlans: PaymentPlan[] };
export const SITE_SETTINGS_KEY = ['site-settings'];

export const useSiteSettings = () =>
  useQuery({ queryKey: SITE_SETTINGS_KEY, queryFn: () => api<SiteSettings>('/site-settings'), staleTime: 5 * 60 * 1000 });
