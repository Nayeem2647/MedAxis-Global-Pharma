import { randomUUID } from 'node:crypto';
import { describe, expect, it, vi } from 'vitest';
import cron from 'node-cron';
import { loadEnv } from '../src/config/env.js';
import { createLogger } from '../src/shared/utils/logger.js';
import { createMailTransport, DeliveryError } from '../src/modules/notification/notification.transport.js';
import { createNotificationService } from '../src/modules/notification/notification.service.js';
import { template, type TemplateId } from '../src/modules/notification/email.templates/template.js';
import { createFxService } from '../src/modules/fx/fx.service.js';
import { createStorageService } from '../src/modules/storage/storage.service.js';
import { registerJobs } from '../src/jobs/index.js';
import { validEnv } from './helpers/env.js';
import { pdfFixture } from './fixtures/commercial.js';

const ids: TemplateId[] = [
  'rfq-confirmation',
  'quotation-sent',
  'accepted',
  'expiry-reminder',
  'dispatch',
  'delivered',
  'clarification-request',
  'unable-to-supply',
  'revision-request',
  'admin-new-rfq-alert',
  'admin-accepted-alert',
];
describe('typed bilingual transactional email templates', () => {
  it.each(ids.flatMap((id) => (['en', 'zh-CN'] as const).map((locale) => ({ id, locale }))))(
    '$id / $locale escapes untrusted content and excludes internal costs',
    ({ id, locale }) => {
      const context = {
        locale,
        reference: 'REF-TEST',
        buyerName: '<img src=x onerror=alert(1)>',
        quotation: pdfFixture(true).version,
        body: '<script>unsafe()</script>',
        link: 'https://example.test/q/test',
        pdfLink: 'https://example.test/pdf',
        reminderKind: 'RESERVATION_DAY3' as const,
      };
      Object.assign(context, { procurement_cost_bdt: 'SECRET-COST', markup_percent: 'SECRET-MARGIN' });
      context.quotation.bank_details = pdfFixture(true).wire_details;
      Object.assign(context.quotation, { procurement_cost_bdt: 'SECRET-COST' });
      const result = template(id)(context);
      expect(result.html).toContain(`lang="${locale}"`);
      expect(result.html).not.toMatch(/<script>|<img|SECRET-COST|SECRET-MARGIN/);
      expect(result.subject).toContain('REF-TEST');
      expect(result.text).not.toMatch(/SECRET-COST|SECRET-MARGIN/);
      if (locale === 'zh-CN') expect(result.subject).toMatch(/[\u3400-\u9fff]/);
      if (id === 'accepted' || id === 'expiry-reminder') {
        expect(result.text).toContain('123456789');
        expect(result.text).toContain('TESTBDDH');
      }
      if (id === 'quotation-sent') {
        expect(result.text).toContain('https://example.test/q/test');
        expect(result.text).toContain('6.35');
      }
    },
  );
});
describe('provider adapters and cron registration', () => {
  const env = loadEnv({
    ...validEnv,
    RESEND_API_KEY: 'test-resend',
    BREVO_API_KEY: 'test-brevo',
    EMAIL_FROM: 'MedAxis <sender@example.test>',
  });
  it('uses a stable Message-ID, provider idempotency key, UTF-8 bodies and trusted Reply-To', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(async () => new Response(JSON.stringify({ id: 'msg-test' })));
    const message = template('rfq-confirmation')({
      locale: 'zh-CN',
      reference: 'RFQ-1',
      replyTo: 'reply@example.test',
    });
    await createMailTransport(env, fetcher).send('RESEND', 'buyer@qq.com', message, 'stable-key', randomUUID());
    const options = fetcher.mock.calls[0]![1]!;
    const data = JSON.parse(String(options.body));
    expect(options.headers).toMatchObject({ 'Idempotency-Key': 'stable-key' });
    expect(data.headers).toMatchObject({ 'Content-Language': 'zh-CN', 'Auto-Submitted': 'auto-generated' });
    expect(data.headers['Message-ID']).toMatch(/@example\.test>$/);
    expect(data.reply_to).toBe('reply@example.test');
    expect(data.headers).not.toHaveProperty('DKIM-Signature');
    expect(data.from).toBe(env.EMAIL_FROM);
  });
  it('distinguishes explicit provider rejection from ambiguous transport failure and rejects header injection', async () => {
    const fetcher = vi.fn<typeof fetch>().mockImplementation(async () => new Response(null, { status: 500 }));
    const message = template('rfq-confirmation')({ locale: 'en', reference: 'R' });
    await expect(
      createMailTransport(env, fetcher).send('RESEND', 'buyer@163.com', message, 'key', randomUUID()),
    ).rejects.toMatchObject({ fallbackAllowed: true });
    fetcher.mockRejectedValue(new Error('timeout with secret provider details'));
    await expect(
      createMailTransport(env, fetcher).send('RESEND', 'buyer@163.com', message, 'key', randomUUID()),
    ).rejects.toMatchObject({ code: 'AMBIGUOUS_DELIVERY', fallbackAllowed: false });
    await expect(
      createMailTransport(env, fetcher).send(
        'RESEND',
        'buyer@example.test',
        { ...message, subject: 'Subject\r\nBcc: leaked@example.test' },
        'key',
        randomUUID(),
      ),
    ).rejects.toBeInstanceOf(DeliveryError);
  });
  it('uses a stable UUID for Brevo and treats its duplicate acknowledgement as delivery without inventing a provider ID', async () => {
    const fetcher = vi
      .fn<typeof fetch>()
      .mockImplementation(
        async () =>
          new Response(JSON.stringify({ code: 'duplicate_parameter', message: 'Already processed' }), { status: 400 }),
      );
    const id = randomUUID();
    const message = template('rfq-confirmation')({ locale: 'en', reference: 'RFQ' });
    expect(await createMailTransport(env, fetcher).send('BREVO', 'buyer@example.test', message, 'stable', id)).toEqual({
      provider: 'BREVO',
      id: undefined,
    });
    expect(JSON.parse(String(fetcher.mock.calls[0]![1]!.body)).headers.idempotencyKey).toBe(id);
    expect(() => loadEnv({ ...validEnv, EMAIL_FALLBACK_ENABLED: 'true' })).toThrow(/BREVO_API_KEY/);
  });
  it('registers no schedules in test and all six job modules (seven slots) outside test, with Dhaka timezone and overlap protection', async () => {
    const logger = createLogger({ silent: true });
    const destroy = vi.fn(async () => undefined);
    const schedule = vi
      .fn<typeof cron.schedule>()
      .mockImplementation(() => ({ destroy }) as unknown as ReturnType<typeof cron.schedule>);
    const dependencies = {
      notifications: createNotificationService(env, logger),
      fx: createFxService(env, logger),
      storage: createStorageService(env),
    };
    const disabled = registerJobs(env, logger, dependencies, { schedule });
    expect(schedule).not.toHaveBeenCalled();
    await disabled.close();
    const active = registerJobs(loadEnv({ ...validEnv, NODE_ENV: 'development' }), logger, dependencies, { schedule });
    expect(schedule).toHaveBeenCalledTimes(7);
    expect(schedule.mock.calls.map((call) => call[0])).toEqual([
      '*/15 * * * *',
      '*/30 * * * *',
      '0 0 * * *',
      '0 9 * * *',
      '0 10 * * *',
      '0 * * * *',
      '0 * * * *',
    ]);
    for (const call of schedule.mock.calls) expect(call[2]).toMatchObject({ timezone: 'Asia/Dhaka', noOverlap: true });
    await active.close();
    expect(destroy).toHaveBeenCalledTimes(7);
  });
});
