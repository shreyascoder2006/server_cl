export class ApiError extends Error {
  constructor(public status: number, message: string, public details?: any, public code?: string) { super(message); }
}

export async function api<T = any>(path: string, opts: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
  const res = await fetch(`/api${path}`, {
    method: opts.method ?? (opts.body !== undefined ? 'POST' : 'GET'),
    headers: { ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
    body: opts.body !== undefined ? JSON.stringify(opts.body) : undefined,
    credentials: 'same-origin',
  });
  const text = await res.text();
  let data: any = null;
  try { data = text ? JSON.parse(text) : null; } catch { data = { error: text }; }
  if (!res.ok) throw new ApiError(res.status, data?.error ?? `Request failed (${res.status})`, data?.details, data?.code);
  return data as T;
}

export const newKey = () => (crypto.randomUUID?.() ?? `${Date.now()}-${Math.random().toString(36).slice(2)}`).replace(/[^A-Za-z0-9_-]/g, '');

/* ------- shared types (mirror of server responses) ------- */
export interface User { id: string; email: string; name: string; role: 'customer' | 'admin'; tenantId: string }
export interface PriceTier { key: string; label: string; monthly_price_cents: number }
export interface Product {
  code: string; category: 'fresh' | 'prewarmed' | 'server'; name: string; tagline: string; description: string; features: string[]; platform: string;
  enabled: boolean; featured: boolean; badge: string | null; unit: 'mailbox' | 'tenant' | 'server'; mailboxesPerUnit: number | null; monthlyPriceCents: number;
  annualDiscountPct: number; setupFeeCents: number; billingTerms: ('monthly' | 'annual')[]; minQty: number; maxQty: number; qtyPresets: number[];
  allowedRatios: number[]; defaultRatio: number; needsDomains: boolean; needsPersonas: boolean; priceTiers: PriceTier[] | null;
}
export interface Catalog {
  products: Product[];
  pricing: { annualDiscountPct: number; domainPriceCents: number; domainRenewalCents: number; prewarmedDomainFeeCents: number; taxPct: number; maxDomainsPerOrder: number };
  environment: { mode: 'mock' | 'live'; paymentGateway: 'mock' | 'stripe' };
}
export interface QuoteLine { key: string; label: string; detail: string; quantity: number; unitCents: number; amountCents: number; cadence: string }
export interface Quote {
  productCode: string; term: 'monthly' | 'annual'; lines: QuoteLine[]; subtotalCents: number; taxPct: number; taxCents: number; dueTodayCents: number;
  recurring: { label: string; amountCents: number; cadence: string }[]; mailboxCount: number; unitCount: number; domainCount: number; notes: string[]; expiresAt?: string;
}
export interface Persona { id: string; firstName: string; lastName: string; domains: 'all' | string[] }
export interface Contact { firstName: string; lastName: string; company?: string; email: string; phone: string; address1: string; address2?: string; city: string; state: string; postalCode: string; country: string }
export interface Issue { step: string; field: string; message: string }
export interface Order {
  id: string; journey: 'fresh' | 'prewarmed'; status: string; step: string; productCode: string | null; productName: string | null;
  config: any; mailboxes: { address: string; firstName: string; lastName: string; domain: string }[]; quote: Quote | null; totalDueCents: number | null;
  createdAt: string; updatedAt: string;
  progress: { key: string; label: string; status: string; error?: string; provider?: string; operation?: string; externalRef?: string; mode?: string }[];
  events: { from_status: string | null; to_status: string; note: string | null; created_at: string; actor?: string }[];
}
