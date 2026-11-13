import { log, redact } from '../log.ts';
import { OutcomeUnknownError } from './types.ts';

export interface HttpOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE';
  headers?: Record<string, string>;
  body?: unknown;
  timeoutMs?: number;
  /** Only safe (read-only / idempotent) calls are retried automatically. */
  idempotent?: boolean;
  retries?: number;
  provider: string;
  operation: string;
}

export class ProviderHttpError extends Error {
  constructor(public provider: string, public status: number, message: string, public body?: unknown) {
    super(`${provider}: HTTP ${status} ${message}`);
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * fetch wrapper with timeout, bounded exponential backoff for idempotent calls,
 * and secret-redacted logging. Non-idempotent calls that time out raise
 * OutcomeUnknownError so they are never retried blindly.
 */
export async function httpJson<T = any>(url: string, opts: HttpOptions): Promise<T> {
  const method = opts.method ?? 'GET';
  const idempotent = opts.idempotent ?? method === 'GET';
  const maxAttempts = idempotent ? 1 + (opts.retries ?? 2) : 1;
  let lastErr: unknown;
  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), opts.timeoutMs ?? 15_000);
    const started = Date.now();
    try {
      const res = await fetch(url, {
        method,
        headers: { Accept: 'application/json', ...(opts.body !== undefined ? { 'Content-Type': 'application/json' } : {}), ...opts.headers },
        body: opts.body === undefined ? undefined : typeof opts.body === 'string' ? opts.body : JSON.stringify(opts.body),
        signal: controller.signal,
      });
      const text = await res.text();
      let data: any = text;
      try { data = text ? JSON.parse(text) : null; } catch { /* non-JSON */ }
      log.info('provider_http', { provider: opts.provider, operation: opts.operation, method, url, status: res.status, ms: Date.now() - started, attempt });
      if (res.status === 429 || res.status >= 500) {
        lastErr = new ProviderHttpError(opts.provider, res.status, 'temporary failure', redact(data));
        if (attempt < maxAttempts) {
          const retryAfter = Number(res.headers.get('retry-after')) * 1000;
          await sleep(retryAfter > 0 ? Math.min(retryAfter, 10_000) : 300 * 2 ** (attempt - 1));
          continue;
        }
        throw lastErr;
      }
      if (!res.ok) throw new ProviderHttpError(opts.provider, res.status, typeof data === 'object' && data?.message ? String(data.message) : 'request failed', redact(data));
      return data as T;
    } catch (e: any) {
      if (e instanceof ProviderHttpError) throw e;
      const aborted = e?.name === 'AbortError';
      log.warn('provider_http_error', { provider: opts.provider, operation: opts.operation, url, error: String(e?.message ?? e), attempt });
      if (!idempotent) {
        throw new OutcomeUnknownError(`${opts.provider}.${opts.operation}: ${aborted ? 'timed out' : 'network error'} after sending; outcome unknown, needs manual check.`);
      }
      lastErr = e;
      if (attempt < maxAttempts) { await sleep(300 * 2 ** (attempt - 1)); continue; }
      throw e;
    } finally {
      clearTimeout(timer);
    }
  }
  throw lastErr;
}
