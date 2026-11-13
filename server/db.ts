import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { config } from './config.ts';

export type DB = DatabaseSync;

let instance: DatabaseSync | null = null;

const SCHEMA = `
CREATE TABLE IF NOT EXISTS tenants (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  email TEXT NOT NULL UNIQUE,
  name TEXT NOT NULL,
  role TEXT NOT NULL CHECK (role IN ('customer','admin')),
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id),
  expires_at TEXT NOT NULL
);
CREATE TABLE IF NOT EXISTS providers (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  purpose TEXT NOT NULL,
  enabled INTEGER NOT NULL DEFAULT 1,
  mode TEXT NOT NULL DEFAULT 'mock' CHECK (mode IN ('mock','live')),
  docs_url TEXT,
  notes TEXT
);
CREATE TABLE IF NOT EXISTS products (
  code TEXT PRIMARY KEY,
  category TEXT NOT NULL CHECK (category IN ('fresh','prewarmed','server')),
  name TEXT NOT NULL,
  tagline TEXT NOT NULL DEFAULT '',
  description TEXT NOT NULL DEFAULT '',
  features TEXT NOT NULL DEFAULT '[]',
  platform TEXT NOT NULL,
  provider_id TEXT NOT NULL REFERENCES providers(id),
  enabled INTEGER NOT NULL DEFAULT 1,
  featured INTEGER NOT NULL DEFAULT 0,
  badge TEXT,
  unit TEXT NOT NULL CHECK (unit IN ('mailbox','tenant','server')),
  mailboxes_per_unit INTEGER,
  monthly_price_cents INTEGER NOT NULL,
  annual_discount_pct REAL,
  setup_fee_cents INTEGER NOT NULL DEFAULT 0,
  cost_cents INTEGER,
  billing_terms TEXT NOT NULL DEFAULT '["monthly","annual"]',
  min_qty INTEGER NOT NULL DEFAULT 1,
  max_qty INTEGER NOT NULL DEFAULT 1000,
  qty_presets TEXT NOT NULL DEFAULT '[10,20,50,100]',
  allowed_ratios TEXT NOT NULL DEFAULT '[1,2,3,4,5]',
  default_ratio INTEGER NOT NULL DEFAULT 3,
  needs_domains INTEGER NOT NULL DEFAULT 1,
  needs_personas INTEGER NOT NULL DEFAULT 1,
  allow_existing_domain INTEGER NOT NULL DEFAULT 0,
  price_tiers TEXT,
  sort_order INTEGER NOT NULL DEFAULT 100,
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL,
  label TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'number'
);
CREATE TABLE IF NOT EXISTS orders (
  id TEXT PRIMARY KEY,
  tenant_id TEXT NOT NULL REFERENCES tenants(id),
  user_id TEXT NOT NULL REFERENCES users(id),
  journey TEXT NOT NULL CHECK (journey IN ('fresh','prewarmed')),
  status TEXT NOT NULL,
  product_code TEXT,
  step TEXT NOT NULL DEFAULT 'product',
  config TEXT NOT NULL DEFAULT '{}',
  quote TEXT,
  total_due_cents INTEGER,
  currency TEXT NOT NULL DEFAULT 'USD',
  checkout_key TEXT,
  payment_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE UNIQUE INDEX IF NOT EXISTS orders_checkout_key ON orders(tenant_id, checkout_key) WHERE checkout_key IS NOT NULL;
CREATE INDEX IF NOT EXISTS orders_tenant ON orders(tenant_id, created_at);
CREATE TABLE IF NOT EXISTS order_events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  from_status TEXT,
  to_status TEXT NOT NULL,
  actor TEXT NOT NULL,
  note TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS provider_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  order_id TEXT NOT NULL REFERENCES orders(id),
  step_key TEXT NOT NULL,
  provider TEXT NOT NULL,
  operation TEXT NOT NULL,
  mode TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('pending','succeeded','failed','unknown','skipped')),
  attempts INTEGER NOT NULL DEFAULT 0,
  request TEXT,
  response TEXT,
  error TEXT,
  external_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now')),
  UNIQUE (order_id, step_key)
);
CREATE TABLE IF NOT EXISTS payments (
  id TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  gateway TEXT NOT NULL,
  status TEXT NOT NULL,
  amount_cents INTEGER NOT NULL,
  currency TEXT NOT NULL,
  gateway_ref TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS webhook_events (
  id TEXT PRIMARY KEY,
  gateway TEXT NOT NULL,
  type TEXT NOT NULL,
  received_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  action TEXT NOT NULL,
  before_json TEXT,
  after_json TEXT,
  created_at TEXT NOT NULL DEFAULT (datetime('now'))
);
CREATE TABLE IF NOT EXISTS prewarmed_holds (
  domain TEXT PRIMARY KEY,
  order_id TEXT NOT NULL REFERENCES orders(id),
  expires_at TEXT NOT NULL
);
`;

export function openDb(file = config.databasePath): DatabaseSync {
  if (file !== ':memory:') fs.mkdirSync(path.dirname(path.resolve(file)), { recursive: true });
  const db = new DatabaseSync(file);
  db.exec('PRAGMA journal_mode = WAL; PRAGMA foreign_keys = ON; PRAGMA busy_timeout = 5000;');
  db.exec(SCHEMA);
  return db;
}

export function getDb(): DatabaseSync {
  if (!instance) instance = openDb();
  return instance;
}

/** For tests: swap the singleton. */
export function setDb(db: DatabaseSync) {
  instance = db;
}

export function tx<T>(db: DatabaseSync, fn: () => T): T {
  db.exec('BEGIN IMMEDIATE');
  try {
    const out = fn();
    db.exec('COMMIT');
    return out;
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
}

export const json = {
  parse<T>(s: unknown, fallback: T): T {
    if (typeof s !== 'string' || !s) return fallback;
    try { return JSON.parse(s) as T; } catch { return fallback; }
  },
};

export function audit(db: DatabaseSync, userId: string | null, entity: string, entityId: string, action: string, before: unknown, after: unknown) {
  db.prepare('INSERT INTO audit_log (user_id, entity, entity_id, action, before_json, after_json) VALUES (?,?,?,?,?,?)')
    .run(userId, entity, entityId, action, before === undefined ? null : JSON.stringify(before), after === undefined ? null : JSON.stringify(after));
}
