import fs from 'node:fs';
import path from 'node:path';

/** Minimal .env loader (no dependency). Real environment variables always win. */
function loadDotEnv(file = path.resolve(process.cwd(), '.env')) {
  if (!fs.existsSync(file)) return;
  for (const raw of fs.readFileSync(file, 'utf8').split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq < 1) continue;
    const key = line.slice(0, eq).trim();
    let val = line.slice(eq + 1).trim();
    if ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'"))) val = val.slice(1, -1);
    if (process.env[key] === undefined) process.env[key] = val;
  }
}
loadDotEnv();

const env = (k: string, d = '') => (process.env[k] ?? d).trim();

export type ProviderMode = 'mock' | 'live';

export const config = {
  port: Number(env('PORT', '4000')),
  appSecret: env('APP_SECRET', 'dev-only-insecure-secret'),
  databasePath: env('DATABASE_PATH', './data/cloudlead-infra.sqlite'),
  providerMode: (env('PROVIDER_MODE', 'mock') === 'live' ? 'live' : 'mock') as ProviderMode,
  paymentGateway: env('PAYMENT_GATEWAY', 'mock'),
  isTest: process.env.NODE_ENV === 'test' || !!process.env.VITEST,
  namesilo: { apiKey: env('NAMESILO_API_KEY'), baseUrl: env('NAMESILO_BASE_URL', 'https://www.namesilo.com/api'), paymentId: env('NAMESILO_PAYMENT_ID') },
  mailpool: { apiKey: env('MAILPOOL_API_KEY'), baseUrl: env('MAILPOOL_BASE_URL') },
  inboxkit: { apiKey: env('INBOXKIT_API_KEY'), baseUrl: env('INBOXKIT_BASE_URL', 'https://api.inboxkit.com'), workspaceId: env('INBOXKIT_WORKSPACE_ID') },
  cloudflare: { apiToken: env('CLOUDFLARE_API_TOKEN'), accountId: env('CLOUDFLARE_ACCOUNT_ID') },
  ovh: { endpoint: env('OVH_ENDPOINT', 'https://api.us.ovhcloud.com/1.0'), appKey: env('OVH_APP_KEY'), appSecret: env('OVH_APP_SECRET'), consumerKey: env('OVH_CONSUMER_KEY'), subsidiary: env('OVH_SUBSIDIARY', 'US') },
  stripe: { secretKey: env('STRIPE_SECRET_KEY'), webhookSecret: env('STRIPE_WEBHOOK_SECRET') },
};

/** Every secret value currently loaded, used by the log redactor. */
export function secretValues(): string[] {
  return [
    config.appSecret, config.namesilo.apiKey, config.mailpool.apiKey, config.inboxkit.apiKey,
    config.cloudflare.apiToken, config.ovh.appSecret, config.ovh.consumerKey, config.ovh.appKey,
    config.stripe.secretKey, config.stripe.webhookSecret,
  ].filter((v) => v && v.length >= 6);
}
