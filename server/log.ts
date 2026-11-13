import { secretValues } from './config.ts';

const SECRET_KEYS = /^(key|api_?key|apikey|token|password|secret|authorization|x-ovh-signature|x-ovh-consumer|app_password|consumer_?key)$/i;

/** Deep-copies a value replacing secret-looking fields and any known secret string. */
export function redact<T>(value: T): T {
  const secrets = secretValues();
  const scrubString = (s: string) => secrets.reduce((acc, sec) => acc.split(sec).join('[REDACTED]'), s)
    .replace(/([?&](?:key|token|api_key)=)[^&\s]+/gi, '$1[REDACTED]');
  const walk = (v: any): any => {
    if (typeof v === 'string') return scrubString(v);
    if (Array.isArray(v)) return v.map(walk);
    if (v && typeof v === 'object') {
      const out: any = {};
      for (const [k, val] of Object.entries(v)) out[k] = SECRET_KEYS.test(k) ? '[REDACTED]' : walk(val);
      return out;
    }
    return v;
  };
  return walk(value);
}

type Level = 'debug' | 'info' | 'warn' | 'error';
function write(level: Level, msg: string, meta?: Record<string, unknown>) {
  if (process.env.VITEST && level !== 'error') return;
  const line = JSON.stringify({ t: new Date().toISOString(), level, msg, ...(meta ? redact(meta) : {}) });
  (level === 'error' ? console.error : console.log)(line);
}
export const log = {
  debug: (m: string, meta?: Record<string, unknown>) => write('debug', m, meta),
  info: (m: string, meta?: Record<string, unknown>) => write('info', m, meta),
  warn: (m: string, meta?: Record<string, unknown>) => write('warn', m, meta),
  error: (m: string, meta?: Record<string, unknown>) => write('error', m, meta),
};
