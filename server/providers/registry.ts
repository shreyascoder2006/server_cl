import { config } from '../config.ts';
import type { DB } from '../db.ts';
import { cloudflareLive } from './cloudflare.ts';
import { inboxkitMailboxesLive, inboxkitPrewarmedLive } from './inboxkit.ts';
import { mailpoolLive } from './mailpool.ts';
import { mockDns, mockInboxkitMailboxes, mockMailpool, mockPrewarmed, mockRegistrar, mockServers } from './mock.ts';
import { namesiloLive } from './namesilo.ts';
import { ovhLive } from './ovh.ts';
import type { DnsProvider, EffectiveMode, MailboxProvider, PrewarmedProvider, RegistrarProvider, ServerProvider } from './types.ts';

const hasCreds: Record<string, () => boolean> = {
  namesilo: () => !!config.namesilo.apiKey,
  mailpool: () => !!config.mailpool.apiKey,
  inboxkit: () => !!config.inboxkit.apiKey,
  cloudflare: () => !!config.cloudflare.apiToken,
  ovh: () => !!(config.ovh.appKey && config.ovh.appSecret && config.ovh.consumerKey),
};

export interface ModeInfo { provider: string; configured: 'mock' | 'live'; effective: EffectiveMode; reason: string; credentialsSet: boolean }

/**
 * A provider runs live only when ALL of these hold:
 *   1. PROVIDER_MODE=live in the environment (global kill switch),
 *   2. the provider is set to "live" in Admin > Integrations,
 *   3. its credentials are present.
 * Otherwise it uses the deterministic mock, which never buys anything.
 */
export function modeFor(db: DB, providerId: string): ModeInfo {
  const row = db.prepare('SELECT mode FROM providers WHERE id = ?').get(providerId) as { mode: 'mock' | 'live' } | undefined;
  const configured = row?.mode ?? 'mock';
  const credentialsSet = hasCreds[providerId]?.() ?? false;
  let effective: EffectiveMode = 'mock';
  let reason = 'Set to mock in admin.';
  if (configured === 'live') {
    if (config.providerMode !== 'live') reason = 'Admin says live, but PROVIDER_MODE is not "live" in .env.';
    else if (!credentialsSet) reason = 'Admin says live, but credentials are missing in .env.';
    else { effective = 'live'; reason = 'Live: real API calls are made.'; }
  }
  return { provider: providerId, configured, effective, reason, credentialsSet };
}

export function registrar(db: DB): RegistrarProvider {
  return modeFor(db, 'namesilo').effective === 'live' ? namesiloLive : mockRegistrar;
}

export function dns(db: DB): DnsProvider {
  return modeFor(db, 'cloudflare').effective === 'live' ? cloudflareLive : mockDns;
}

export function mailboxProvider(db: DB, providerId: string): MailboxProvider {
  const live = modeFor(db, providerId).effective === 'live';
  if (providerId === 'mailpool') return live ? mailpoolLive : mockMailpool;
  if (providerId === 'inboxkit') return live ? inboxkitMailboxesLive : mockInboxkitMailboxes;
  throw new Error(`Provider ${providerId} does not sell mailboxes.`);
}

export function prewarmedProvider(db: DB): PrewarmedProvider {
  return modeFor(db, 'inboxkit').effective === 'live' ? inboxkitPrewarmedLive : mockPrewarmed;
}

export function serverProvider(db: DB): ServerProvider {
  return modeFor(db, 'ovh').effective === 'live' ? ovhLive : mockServers;
}

export async function healthFor(db: DB, providerId: string) {
  const mode = modeFor(db, providerId);
  const impl: { health(): Promise<any[]> } =
    providerId === 'namesilo' ? registrar(db)
      : providerId === 'cloudflare' ? dns(db)
        : providerId === 'ovh' ? serverProvider(db)
          : mailboxProvider(db, providerId);
  let checks;
  try { checks = await impl.health(); } catch (e: any) { checks = [{ name: 'Health check', ok: false, detail: e.message }]; }
  return { ...mode, checks };
}
