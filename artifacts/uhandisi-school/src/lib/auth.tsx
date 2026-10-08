import { useQuery, useQueryClient } from '@tanstack/react-query';

export type Role = 'student' | 'instructor' | 'admin';
export type CurrentUser = { id: number; name: string; email: string; phone: string | null; role: Role };

export class ApiError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

/** JSON fetch against our own /api with the session cookie. Throws ApiError with the server's message. */
export async function api<T = unknown>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: init.method ?? 'GET',
    credentials: 'same-origin',
    headers: init.body === undefined ? undefined : { 'Content-Type': 'application/json' },
    body: init.body === undefined ? undefined : JSON.stringify(init.body),
  });
  if (res.status === 204) return undefined as T;
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new ApiError(res.status, (data as { error?: string }).error || 'Something went wrong. Try again.');
  return data as T;
}

export const ME_KEY = ['auth', 'me'];

export function useCurrentUser() {
  return useQuery({
    queryKey: ME_KEY,
    queryFn: async () => {
      try {
        return await api<CurrentUser>('/auth/me');
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null;
        throw e;
      }
    },
    staleTime: 5 * 60 * 1000,
    retry: false,
  });
}

export function useAuthActions() {
  const client = useQueryClient();
  // Drop everything cached for the previous user, then store the new one.
  const signedIn = (user: CurrentUser) => {
    client.clear();
    client.setQueryData(ME_KEY, user);
    return user;
  };
  return {
    login: async (email: string, password: string) => signedIn(await api<CurrentUser>('/auth/login', { method: 'POST', body: { email, password } })),
    register: async (body: { name: string; email: string; phone?: string; password: string }) =>
      signedIn(await api<CurrentUser>('/auth/register', { method: 'POST', body })),
    // A successful reset signs the person straight in.
    resetPassword: async (email: string, code: string, password: string) =>
      signedIn(await api<CurrentUser>('/auth/reset-password', { method: 'POST', body: { email, code, password } })),
    logout: async () => {
      await api('/auth/logout', { method: 'POST' });
      client.clear();
      client.setQueryData(ME_KEY, null);
    },
  };
}

export const initials = (name = '') => name.split(/\s+/).filter(Boolean).slice(0, 2).map(p => p[0]!.toUpperCase()).join('') || '?';
