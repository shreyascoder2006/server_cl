import crypto from 'node:crypto';
import { config } from '../config.ts';
import { httpJson } from './http.ts';
import { NotConfiguredError, NotVerifiedError, type HealthCheck, type ServerProvider } from './types.ts';

/**
 * OVHcloud live adapter (raw SMTP servers / VPS).
 *
 * Base URL https://api.us.ovhcloud.com/1.0 (GET /auth/time confirmed reachable).
 * Requests are signed with OVH's standard scheme:
 *   X-Ovh-Signature = "$1$" + sha1_hex(AS + "+" + CK + "+" + METHOD + "+" + URL + "+" + BODY + "+" + TS)
 * using the server-time delta from /auth/time. The signing scheme comes from OVH's
 * "First steps with the OVHcloud APIs" guide, whose page was not reachable from
 * the build environment, so it is marked not live-tested.
 *
 * Server ordering goes through OVH's cart flow (/order/cart -> add VPS item ->
 * configure -> checkout). The catalog request failed during the build, so plan
 * codes and the cart payload are unverified and orderServers raises
 * NotVerifiedError rather than guessing.
 */

let timeDelta: number | null = null;

async function serverTimeDelta(): Promise<number> {
  if (timeDelta !== null) return timeDelta;
  const t = await httpJson<number>(`${config.ovh.endpoint}/auth/time`, { provider: 'ovh', operation: 'auth.time' });
  timeDelta = Number(t) - Math.floor(Date.now() / 1000);
  return timeDelta;
}

export function ovhSignature(appSecret: string, consumerKey: string, method: string, url: string, body: string, ts: number) {
  return '$1$' + crypto.createHash('sha1').update([appSecret, consumerKey, method, url, body, ts].join('+')).digest('hex');
}

async function signed<T = any>(method: 'GET' | 'POST', path: string, body?: unknown): Promise<T> {
  const { appKey, appSecret, consumerKey, endpoint } = config.ovh;
  if (!appKey || !appSecret || !consumerKey) throw new NotConfiguredError('OVH_APP_KEY, OVH_APP_SECRET and OVH_CONSUMER_KEY must be set.');
  const url = `${endpoint}${path}`;
  const bodyStr = body === undefined ? '' : JSON.stringify(body);
  const ts = Math.floor(Date.now() / 1000) + (await serverTimeDelta());
  return httpJson<T>(url, {
    method, body: body === undefined ? undefined : bodyStr, provider: 'ovh', operation: `${method} ${path}`, idempotent: method === 'GET',
    headers: {
      'X-Ovh-Application': appKey, 'X-Ovh-Consumer': consumerKey, 'X-Ovh-Timestamp': String(ts),
      'X-Ovh-Signature': ovhSignature(appSecret, consumerKey, method, url, bodyStr, ts),
    },
  });
}

export const ovhLive: ServerProvider = {
  id: 'ovh',
  async listPlans() {
    throw new NotVerifiedError('ovh', 'listPlans', 'Confirm VPS plan codes from /order/catalog/public/vps?ovhSubsidiary=US.');
  },
  async orderServers() {
    throw new NotVerifiedError('ovh', 'orderServers', 'Confirm the /order/cart VPS flow in the OVH API console, then implement.');
  },
  async health(): Promise<HealthCheck[]> {
    const checks: HealthCheck[] = [];
    try {
      const delta = await serverTimeDelta();
      checks.push({ name: 'API reachable (/auth/time)', ok: true, detail: `Server clock offset ${delta}s.` });
    } catch (e: any) {
      checks.push({ name: 'API reachable (/auth/time)', ok: false, detail: e.message });
    }
    if (!config.ovh.appKey || !config.ovh.appSecret || !config.ovh.consumerKey) {
      checks.push({ name: 'Credentials', ok: false, detail: 'Set OVH_APP_KEY, OVH_APP_SECRET and OVH_CONSUMER_KEY.' });
    } else {
      try {
        const me = await signed<any>('GET', '/me');
        checks.push({ name: 'Signed request accepted (GET /me, read-only)', ok: true, detail: `Account ${me?.nichandle ?? 'ok'}.` });
      } catch (e: any) {
        checks.push({ name: 'Signed request accepted (GET /me, read-only)', ok: false, detail: e.message });
      }
    }
    checks.push({ name: 'Order a server', ok: false, billable: true, detail: 'Not run automatically: ordering a VPS is charged by OVH. Ordering flow not verified yet.' });
    return checks;
  },
};
