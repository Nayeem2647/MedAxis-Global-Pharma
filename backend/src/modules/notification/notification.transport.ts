import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { hashToken } from '../../shared/utils/crypto.js';

export type MailProvider = 'RESEND' | 'BREVO';
export interface EmailMessage {
  subject: string;
  html: string;
  text: string;
  locale: 'en' | 'zh-CN';
  replyTo?: string;
}
export class DeliveryError extends Error {
  constructor(
    readonly code = 'DELIVERY_FAILED',
    readonly fallbackAllowed = false,
    readonly permanent = false,
  ) {
    super(code);
  }
}
export function senderAddress(value: string) {
  if (/[\r\n]/.test(value)) throw new DeliveryError('INVALID_SENDER', false, true);
  const email = value.match(/<([^<>]+)>$/)?.[1] ?? value;
  if (!z.email().safeParse(email).success) throw new DeliveryError('INVALID_SENDER', false, true);
  return { email, name: value.includes('<') ? value.slice(0, value.indexOf('<')).trim() : 'MedAxis Global Pharma' };
}
export function createMailTransport(env: AppEnv, fetcher: typeof fetch = fetch) {
  const ready = () => !!env.EMAIL_FROM && (!!env.RESEND_API_KEY || (env.EMAIL_FALLBACK_ENABLED && !!env.BREVO_API_KEY));
  async function send(
    provider: MailProvider,
    recipient: string,
    message: EmailMessage,
    dedupeKey: string,
    jobId: string,
  ) {
    if (
      !env.EMAIL_FROM ||
      !z.email().safeParse(recipient).success ||
      /[\r\n]/.test(message.subject) ||
      (message.replyTo && !z.email().safeParse(message.replyTo).success)
    )
      throw new DeliveryError('INVALID_EMAIL_MESSAGE', false, true);
    const sender = senderAddress(env.EMAIL_FROM);
    const headers = {
      'Message-ID': `<${hashToken(dedupeKey)}@${sender.email.split('@')[1]}>`,
      'Auto-Submitted': 'auto-generated',
      'X-Auto-Response-Suppress': 'All',
      'Content-Language': message.locale,
      'X-Entity-Ref-ID': jobId,
    };
    const key = provider === 'RESEND' ? env.RESEND_API_KEY : env.BREVO_API_KEY;
    if (!key) throw new DeliveryError('EMAIL_PROVIDER_NOT_CONFIGURED');
    let response: Response;
    try {
      response = await fetcher(
        provider === 'RESEND' ? 'https://api.resend.com/emails' : 'https://api.brevo.com/v3/smtp/email',
        {
          method: 'POST',
          redirect: 'error',
          signal: AbortSignal.timeout(10000),
          headers: {
            'Content-Type': 'application/json',
            ...(provider === 'RESEND'
              ? { Authorization: `Bearer ${key}`, 'Idempotency-Key': dedupeKey }
              : { 'api-key': key }),
          },
          body: JSON.stringify(
            provider === 'RESEND'
              ? {
                  from: env.EMAIL_FROM,
                  to: [recipient],
                  subject: message.subject,
                  html: message.html,
                  text: message.text,
                  headers,
                  ...(message.replyTo ? { reply_to: message.replyTo } : {}),
                }
              : {
                  sender,
                  to: [{ email: recipient }],
                  subject: message.subject,
                  htmlContent: message.html,
                  textContent: message.text,
                  headers: { ...headers, idempotencyKey: jobId },
                  ...(message.replyTo ? { replyTo: { email: message.replyTo } } : {}),
                },
          ),
        },
      );
    } catch {
      throw new DeliveryError('AMBIGUOUS_DELIVERY');
    } // Do not switch providers after an ambiguous timeout.
    if (!response.ok) {
      if (provider === 'BREVO' && response.status === 400) {
        try {
          const data: unknown = await response.json();
          if (data && typeof data === 'object' && 'code' in data && data.code === 'duplicate_parameter')
            return { provider, id: undefined };
        } catch {
          /* No provider diagnostics are retained. */
        }
      }
      await response.body?.cancel().catch(() => undefined);
      throw new DeliveryError(
        'DELIVERY_FAILED',
        [401, 403, 429].includes(response.status) || response.status >= 500,
        response.status >= 400 && response.status < 500 && ![401, 403, 408, 429].includes(response.status),
      );
    }
    try {
      const data: unknown = await response.json();
      const name = provider === 'RESEND' ? 'id' : 'messageId';
      if (!data || typeof data !== 'object' || !(name in data)) throw new Error();
      const id = (data as Record<string, unknown>)[name];
      if (typeof id !== 'string' || !id || id.length > 200) throw new Error();
      return { provider, id };
    } catch {
      throw new DeliveryError('AMBIGUOUS_DELIVERY');
    }
  }
  return { send, ready };
}
