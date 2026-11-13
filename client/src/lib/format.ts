export const money = (cents: number | null | undefined, opts: { compact?: boolean } = {}) => {
  if (cents === null || cents === undefined) return '—';
  const v = cents / 100;
  if (opts.compact && Number.isInteger(v)) return `$${v.toLocaleString('en-US')}`;
  return `$${v.toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};

export const cadenceLabel: Record<string, string> = {
  monthly: 'per month', annual: 'per year', yearly: 'per year', one_time: 'one-time',
};

export const STATUS_LABEL: Record<string, { label: string; tone: string }> = {
  draft: { label: 'Draft', tone: 'grey' },
  awaiting_payment: { label: 'Awaiting payment', tone: 'warn' },
  payment_authorized: { label: 'Paid', tone: 'ok' },
  submitting: { label: 'Setting up', tone: '' },
  provider_pending: { label: 'Provisioning', tone: '' },
  submitted: { label: 'Submitted', tone: 'ok' },
  needs_review: { label: 'Under review', tone: 'warn' },
  failed: { label: 'Needs attention', tone: 'err' },
  cancelled: { label: 'Cancelled', tone: 'grey' },
};

export const unitWord = (unit: string, n: number) => {
  const w = unit === 'mailbox' ? 'mailbox' : unit === 'tenant' ? 'tenant' : 'server';
  return n === 1 ? w : unit === 'mailbox' ? 'mailboxes' : `${w}s`;
};

export const PLATFORM_ICON: Record<string, string> = { google: 'G', microsoft: '⊞', azure: 'A', smtp: '✉', smtp_server: '⚡' };

export const fmtDate = (s: string) => {
  const d = new Date(s.includes('T') ? s : `${s.replace(' ', 'T')}Z`);
  return d.toLocaleString(undefined, { dateStyle: 'medium', timeStyle: 'short' });
};
