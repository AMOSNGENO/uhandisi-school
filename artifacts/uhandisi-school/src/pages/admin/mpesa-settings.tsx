import { useState } from 'react';
import { useMutation, useQueryClient } from '@tanstack/react-query';
import { Check, Send, Settings2 } from 'lucide-react';
import { api } from '@/lib/auth';
import { card, ErrorNote, field, ghostBtn, hint, label, primaryBtn } from './ui';

type Field = 'MPESA_ENV' | 'MPESA_TRANSACTION_TYPE' | 'MPESA_SHORTCODE' | 'MPESA_TILL_NUMBER' | 'MPESA_CONSUMER_KEY' | 'MPESA_CONSUMER_SECRET' | 'MPESA_PASSKEY' | 'MPESA_CALLBACK_URL';
export type MpesaInfo = {
  configured: boolean; environment: string; missing: string[]; callbackUrl: string | null;
  settings: Record<Field, { source: 'dashboard' | 'env' | null; value: string }>;
};
export const MPESA_KEY = ['admin', 'mpesa'];

const secrets: Array<{ name: Field; title: string }> = [
  { name: 'MPESA_CONSUMER_KEY', title: 'Consumer key' },
  { name: 'MPESA_CONSUMER_SECRET', title: 'Consumer secret' },
  { name: 'MPESA_PASSKEY', title: 'Passkey' },
];

/** Connect M-Pesa from the dashboard: till/paybill, Daraja keys, and a test prompt. */
export function MpesaSettings({ info }: { info: MpesaInfo }) {
  const [open, setOpen] = useState(!info.configured);
  const s = info.settings;
  if (!open) return <div className="mb-5 flex flex-wrap items-center justify-between gap-3 rounded-md bg-[hsl(var(--link)/.08)] p-3 text-xs text-[hsl(var(--link))]" data-testid="status-mpesa">
    <span className="flex items-center gap-2"><Check size={14} /> M-Pesa connected ({info.environment}{s.MPESA_TILL_NUMBER.value ? `, till ${s.MPESA_TILL_NUMBER.value}` : s.MPESA_SHORTCODE.value ? `, paybill ${s.MPESA_SHORTCODE.value}` : ''}). Payments confirm automatically.</span>
    <button onClick={() => setOpen(true)} className={ghostBtn} data-testid="button-edit-mpesa"><Settings2 size={13} /> M-Pesa settings</button>
  </div>;
  return <MpesaForm info={info} onClose={info.configured ? () => setOpen(false) : undefined} />;
}

function MpesaForm({ info, onClose }: { info: MpesaInfo; onClose?: () => void }) {
  const client = useQueryClient();
  const s = info.settings;
  const [form, setForm] = useState({
    MPESA_ENV: s.MPESA_ENV.value === 'production' ? 'production' : 'sandbox',
    MPESA_TRANSACTION_TYPE: s.MPESA_TRANSACTION_TYPE.value === 'CustomerPayBillOnline' ? 'CustomerPayBillOnline' : 'CustomerBuyGoodsOnline',
    MPESA_TILL_NUMBER: s.MPESA_TILL_NUMBER.value,
    MPESA_SHORTCODE: s.MPESA_SHORTCODE.value,
    MPESA_CALLBACK_URL: s.MPESA_CALLBACK_URL.value,
    MPESA_CONSUMER_KEY: '', MPESA_CONSUMER_SECRET: '', MPESA_PASSKEY: '',
  });
  const [phone, setPhone] = useState('');
  const set = (name: keyof typeof form) => (e: { target: { value: string } }) => setForm(f => ({ ...f, [name]: e.target.value }));
  const till = form.MPESA_TRANSACTION_TYPE === 'CustomerBuyGoodsOnline';
  const live = form.MPESA_ENV === 'production';

  const save = useMutation({
    // Secret fields left empty keep what's saved.
    mutationFn: () => api<MpesaInfo>('/admin/mpesa', {
      method: 'PUT',
      body: Object.fromEntries(Object.entries(form).filter(([k, v]) => !secrets.some(x => x.name === k) || v.trim())),
    }),
    onSuccess: data => {
      client.setQueryData(MPESA_KEY, data);
      setForm(f => ({ ...f, MPESA_CONSUMER_KEY: '', MPESA_CONSUMER_SECRET: '', MPESA_PASSKEY: '' }));
    },
  });
  const test = useMutation({
    mutationFn: () => api<{ ok: boolean; message: string }>('/admin/mpesa/test', { method: 'POST', body: phone.trim() ? { phone } : {} }),
  });
  const saved = save.data ?? info;

  return <section className={`${card} mb-6 p-5`} data-testid="settings-mpesa">
    <div className="flex flex-wrap items-start justify-between gap-3">
      <div>
        <h2 className="font-bold">M-Pesa connection</h2>
        <p className="mt-1 max-w-2xl text-sm text-[hsl(var(--muted-foreground))]">Students pay with a prompt on their phone (STK push). Fill in your till or paybill and the keys from your Safaricom Daraja app, save, then test. Until it's connected, payments wait for you to confirm them below.</p>
      </div>
      {onClose && <button onClick={onClose} className={ghostBtn}>Close</button>}
    </div>

    {saved.configured
      ? <p className="mt-4 flex items-center gap-2 rounded-md bg-[hsl(145_55%_40%/.1)] p-3 text-xs font-bold text-[hsl(145_55%_28%)]" data-testid="status-mpesa"><Check size={14} /> Connected ({saved.environment}). Use Test below to check it.</p>
      : <p className="mt-4 rounded-md border border-[hsl(38_90%_50%/.4)] bg-[hsl(38_90%_50%/.08)] p-3 text-xs leading-5" data-testid="status-mpesa"><strong>Not connected yet.</strong> Still needed: {saved.missing.map(m => m.replace('MPESA_', '').replace(/_/g, ' ').toLowerCase()).join(', ')}.</p>}

    <form className="mt-5 grid gap-4 sm:grid-cols-2" onSubmit={e => { e.preventDefault(); save.mutate(); }}>
      <label className={label}>Mode
        <select value={form.MPESA_ENV} onChange={set('MPESA_ENV')} className={field} data-testid="select-mpesa-env">
          <option value="production">Live (real money)</option>
          <option value="sandbox">Sandbox (Safaricom test system)</option>
        </select>
      </label>
      <label className={label}>Students pay to
        <select value={form.MPESA_TRANSACTION_TYPE} onChange={set('MPESA_TRANSACTION_TYPE')} className={field} data-testid="select-mpesa-type">
          <option value="CustomerBuyGoodsOnline">Till number (Buy Goods)</option>
          <option value="CustomerPayBillOnline">Paybill</option>
        </select>
      </label>
      {till && <label className={label}>Till number
        <input value={form.MPESA_TILL_NUMBER} onChange={set('MPESA_TILL_NUMBER')} inputMode="numeric" placeholder="e.g. 4789322" className={`${field} font-mono-ui`} data-testid="input-mpesa-till" />
        <span className={`${hint} mt-1 block`}>The number students see on the M-Pesa prompt and pay into.</span>
      </label>}
      <label className={label}>{till ? 'Store number (head office)' : 'Paybill number'}
        <input value={form.MPESA_SHORTCODE} onChange={set('MPESA_SHORTCODE')} inputMode="numeric" placeholder={till ? 'Same as till if left empty' : 'e.g. 123456'} className={`${field} font-mono-ui`} data-testid="input-mpesa-shortcode" />
        <span className={`${hint} mt-1 block`}>{till ? 'The shortcode your Daraja app went live with. Safaricom sends it with the passkey; for many tills it is the till number itself.' : 'The paybill your Daraja app went live with.'}</span>
      </label>
      {secrets.map(({ name, title }) => <label key={name} className={label}>{title}
        <input type="password" autoComplete="off" value={form[name]} onChange={set(name)}
          placeholder={saved.settings[name].value ? `Saved (${saved.settings[name].value}). Type to replace.` : live || name !== 'MPESA_PASSKEY' ? 'Paste here' : 'Empty uses the sandbox passkey'}
          className={`${field} font-mono-ui`} data-testid={`input-${name.toLowerCase().replace(/_/g, '-')}`} />
      </label>)}
      <label className={`${label} sm:col-span-2`}>Callback address <span className={hint}>(optional)</span>
        <input value={form.MPESA_CALLBACK_URL} onChange={set('MPESA_CALLBACK_URL')} placeholder={saved.callbackUrl ?? 'https://yourdomain/api/mpesa/callback'} className={`${field} font-mono-ui`} data-testid="input-mpesa-callback" />
        <span className={`${hint} mt-1 block`}>Where Safaricom reports each payment. Left empty, this site's own address is used. Payments still confirm without it: the app asks Safaricom while the student waits.</span>
      </label>
      <div className="flex flex-wrap items-center gap-2 sm:col-span-2">
        <button type="submit" disabled={save.isPending} className={primaryBtn} data-testid="button-save-mpesa">{save.isPending ? 'Saving…' : 'Save M-Pesa settings'}</button>
        {save.isSuccess && <span className="inline-flex items-center gap-1.5 text-xs font-bold text-[hsl(145_55%_28%)]" role="status"><Check size={14} /> Saved. New payments use these settings now.</span>}
      </div>
      <div className="sm:col-span-2"><ErrorNote error={save.error} /></div>
    </form>

    <div className="mt-5 border-t border-[hsl(var(--border))] pt-5">
      <h3 className="text-sm font-bold">Test</h3>
      <p className="mt-1 text-xs text-[hsl(var(--muted-foreground))]">Save first. With no number, this only checks the keys with Safaricom. With your number, it sends a real KSh 1 prompt to your phone (paid into your own till, not recorded as a student payment).</p>
      <div className="mt-3 flex flex-wrap items-center gap-2">
        <input value={phone} onChange={e => setPhone(e.target.value)} inputMode="tel" placeholder="0712 345 678 (optional)" className={`${field} mt-0 w-56`} aria-label="Phone number for a test prompt" data-testid="input-mpesa-test-phone" />
        <button type="button" disabled={test.isPending || !saved.configured} onClick={() => test.mutate()} className={ghostBtn} data-testid="button-test-mpesa"><Send size={13} /> {test.isPending ? 'Testing…' : phone.trim() ? 'Send test prompt' : 'Check keys'}</button>
      </div>
      {test.isSuccess && <p className="mt-3 flex items-center gap-2 text-xs font-bold text-[hsl(145_55%_28%)]" role="status"><Check size={14} /> {test.data.message}</p>}
      <div className="mt-3"><ErrorNote error={test.error} /></div>
    </div>
  </section>;
}
