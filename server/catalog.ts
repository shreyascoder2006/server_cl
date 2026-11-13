import type { DB } from './db.ts';
import { json } from './db.ts';

export type Term = 'monthly' | 'annual';
export type Unit = 'mailbox' | 'tenant' | 'server';
export type Category = 'fresh' | 'prewarmed' | 'server';

export interface PriceTier { key: string; label: string; monthly_price_cents: number }

export interface Product {
  code: string;
  category: Category;
  name: string;
  tagline: string;
  description: string;
  features: string[];
  platform: string;
  providerId: string;
  enabled: boolean;
  featured: boolean;
  badge: string | null;
  unit: Unit;
  mailboxesPerUnit: number | null;
  monthlyPriceCents: number;
  annualDiscountPct: number | null;
  setupFeeCents: number;
  costCents: number | null;
  billingTerms: Term[];
  minQty: number;
  maxQty: number;
  qtyPresets: number[];
  allowedRatios: number[];
  defaultRatio: number;
  needsDomains: boolean;
  needsPersonas: boolean;
  allowExistingDomain: boolean;
  priceTiers: PriceTier[] | null;
  sortOrder: number;
  updatedAt: string;
}

export function rowToProduct(r: any): Product {
  return {
    code: r.code,
    category: r.category,
    name: r.name,
    tagline: r.tagline,
    description: r.description,
    features: json.parse(r.features, []),
    platform: r.platform,
    providerId: r.provider_id,
    enabled: !!r.enabled,
    featured: !!r.featured,
    badge: r.badge,
    unit: r.unit,
    mailboxesPerUnit: r.mailboxes_per_unit,
    monthlyPriceCents: r.monthly_price_cents,
    annualDiscountPct: r.annual_discount_pct,
    setupFeeCents: r.setup_fee_cents,
    costCents: r.cost_cents,
    billingTerms: json.parse(r.billing_terms, ['monthly', 'annual']),
    minQty: r.min_qty,
    maxQty: r.max_qty,
    qtyPresets: json.parse(r.qty_presets, []),
    allowedRatios: json.parse(r.allowed_ratios, [1]),
    defaultRatio: r.default_ratio,
    needsDomains: !!r.needs_domains,
    needsPersonas: !!r.needs_personas,
    allowExistingDomain: !!r.allow_existing_domain,
    priceTiers: json.parse(r.price_tiers, null),
    sortOrder: r.sort_order,
    updatedAt: r.updated_at,
  };
}

export function listProducts(db: DB, opts: { includeDisabled?: boolean } = {}): Product[] {
  const rows = db.prepare(`SELECT p.* FROM products p JOIN providers v ON v.id = p.provider_id
    ${opts.includeDisabled ? '' : 'WHERE p.enabled = 1 AND v.enabled = 1'} ORDER BY p.sort_order, p.code`).all();
  return rows.map(rowToProduct);
}

export function getProduct(db: DB, code: string, opts: { includeDisabled?: boolean } = {}): Product | null {
  const r = db.prepare(`SELECT p.*, v.enabled AS provider_enabled FROM products p JOIN providers v ON v.id = p.provider_id WHERE p.code = ?`).get(code) as any;
  if (!r) return null;
  if (!opts.includeDisabled && (!r.enabled || !r.provider_enabled)) return null;
  return rowToProduct(r);
}

/** What customers may see: no vendor ids, no costs. */
export function publicProduct(p: Product, settings: Settings) {
  const { providerId: _p, costCents: _c, ...rest } = p;
  return { ...rest, annualDiscountPct: effectiveDiscount(p, settings) };
}

export type Settings = Record<string, any>;

export function getSettings(db: DB): Settings {
  const out: Settings = {};
  for (const r of db.prepare('SELECT key, value FROM settings').all() as any[]) out[r.key] = json.parse(r.value, null);
  return out;
}

export function effectiveDiscount(p: Product, settings: Settings): number {
  return p.annualDiscountPct ?? Number(settings.annual_discount_pct ?? 0);
}
