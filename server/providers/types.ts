/**
 * Provider contracts. Each vendor has a mock and a live implementation behind
 * the same interface. Customer-facing code never knows which vendor it talks to.
 */

export type EffectiveMode = 'mock' | 'live';

export interface HealthCheck {
  name: string;
  ok: boolean;
  detail: string;
  /** true when the check could create resources or incur charges (never run automatically). */
  billable?: boolean;
}

export interface ProviderHealth {
  provider: string;
  mode: EffectiveMode;
  checks: HealthCheck[];
}

/** Thrown when a live operation has no verified API contract yet. Never treated as success. */
export class NotVerifiedError extends Error {
  code = 'NOT_VERIFIED';
  constructor(provider: string, operation: string, hint = '') {
    super(`${provider}.${operation} has no verified live API contract yet. ${hint}`.trim());
  }
}

/** Thrown when credentials are missing for a live call. */
export class NotConfiguredError extends Error {
  code = 'NOT_CONFIGURED';
}

/** Thrown when the outcome of a non-idempotent call is unknown (timeout after send). */
export class OutcomeUnknownError extends Error {
  code = 'OUTCOME_UNKNOWN';
}

export interface Contact {
  firstName: string;
  lastName: string;
  company?: string;
  email: string;
  phone: string;
  address1: string;
  address2?: string;
  city: string;
  state: string;
  postalCode: string;
  country: string; // ISO-3166 alpha-2
}

export interface DomainAvailability {
  domain: string;
  available: boolean;
  /** Registrar cost in cents, when the registrar returns it. Admin-only. */
  registrarPriceCents?: number;
  renewalPriceCents?: number;
  premium?: boolean;
  reason?: string;
}

export interface RegistrarProvider {
  id: string;
  checkAvailability(domains: string[]): Promise<DomainAvailability[]>;
  registerDomain(input: { domain: string; years: number; contact: Contact; idempotencyKey: string }): Promise<{ externalRef: string; status: 'registered' | 'pending' }>;
  setNameservers(domain: string, nameservers: string[]): Promise<void>;
  health(): Promise<HealthCheck[]>;
}

export interface DnsRecord { type: 'A' | 'AAAA' | 'CNAME' | 'MX' | 'TXT'; name: string; content: string; priority?: number; ttl?: number; proxied?: boolean }

export interface DnsProvider {
  id: string;
  ensureZone(domain: string): Promise<{ zoneId: string; nameservers: string[] }>;
  upsertRecords(zoneId: string, domain: string, records: DnsRecord[]): Promise<{ created: number; updated: number }>;
  health(): Promise<HealthCheck[]>;
}

export interface MailboxSpec { username: string; firstName: string; lastName: string; address: string }

export interface MailboxProvider {
  id: string;
  platforms: string[];
  supportsProfileImage: boolean;
  /** DNS records the mailbox platform needs on the customer's domain. */
  requiredDnsRecords(platform: string, domain: string, forwardingUrl?: string): DnsRecord[];
  createMailboxes(input: { platform: string; domain: string; mailboxes: MailboxSpec[]; term: 'monthly' | 'annual'; idempotencyKey: string }): Promise<{ externalRef: string; status: 'scheduled' | 'active' | 'pending' }>;
  health(): Promise<HealthCheck[]>;
}

export interface PrewarmedListing {
  domain: string;
  platform: 'google' | 'microsoft';
  tierKey: string;
  warmupWeeks: number;
  mailboxes: { address: string; name: string }[];
  domainExpires: string;
  recommended?: boolean;
}

export interface PrewarmedProvider {
  id: string;
  search(filters: { platform?: string; tierKey?: string; q?: string }): Promise<PrewarmedListing[]>;
  checkAvailability(domains: string[]): Promise<{ domain: string; available: boolean }[]>;
  buy(input: { domains: string[]; forwardingDomain?: string; idempotencyKey: string }): Promise<{ externalRef: string; status: 'pending' | 'completed' }>;
  health(): Promise<HealthCheck[]>;
}

export interface ServerPlan { planCode: string; label: string; region: string; costCents?: number }

export interface ServerProvider {
  id: string;
  listPlans(): Promise<ServerPlan[]>;
  orderServers(input: { quantity: number; planCode?: string; idempotencyKey: string }): Promise<{ externalRef: string; status: 'pending' | 'delivered' }>;
  health(): Promise<HealthCheck[]>;
}
