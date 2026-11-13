import { config } from '../config.ts';
import { standardMailRecords } from './mock.ts';
import { NotVerifiedError, type HealthCheck, type MailboxProvider } from './types.ts';

/**
 * Mailpool live adapter.
 *
 * Mailpool's public help center (https://docs.mailpool.ai/en/collections/11895805-api)
 * only explains how to request API access and create keys (dashboard: Settings >
 * Workspace > API Keys). No public endpoint reference was available, so every
 * live operation raises NotVerifiedError. Once Mailpool shares its API reference,
 * implement createMailboxes here (base URL from MAILPOOL_BASE_URL) and update
 * INTEGRATION_NOTES.md. Mock mode works end to end in the meantime.
 */
export const mailpoolLive: MailboxProvider = {
  id: 'mailpool',
  platforms: ['google', 'microsoft', 'smtp'],
  supportsProfileImage: true, // advertised on mailpool.ai pricing page ("Custom profile picture")
  requiredDnsRecords: standardMailRecords,
  async createMailboxes() {
    throw new NotVerifiedError('mailpool', 'createMailboxes', 'Ask Mailpool for the API reference (base URL, auth header, mailbox order endpoint).');
  },
  async health(): Promise<HealthCheck[]> {
    return [
      { name: 'Credentials present', ok: !!config.mailpool.apiKey, detail: config.mailpool.apiKey ? 'API key is set (not shown).' : 'MAILPOOL_API_KEY is not set.' },
      { name: 'Base URL', ok: !!config.mailpool.baseUrl, detail: config.mailpool.baseUrl ? 'MAILPOOL_BASE_URL is set.' : 'MAILPOOL_BASE_URL not set (Mailpool provides it with API access).' },
      { name: 'Key accepted (read-only)', ok: false, detail: 'No public read-only endpoint documented yet; see INTEGRATION_NOTES.md.' },
    ];
  },
};
