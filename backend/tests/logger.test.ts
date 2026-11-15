import { describe, expect, it } from 'vitest';
import { REDACTED, redact, redactRoute } from '../src/shared/utils/logger.js';

describe('redact', () => {
  it('redacts credentials, tokens, cookies and Turnstile values at any depth', () => {
    const out = redact({
      password: 'hunter2',
      headers: { authorization: 'Bearer abc', cookie: 'medaxis_admin_session=s%3Axyz', 'cf-turnstile-response': 'ts' },
      body: { turnstile_token: 't', magic_link_token: 'm', totp_code: '123456', backup_code: 'ABC' },
      nested: [{ medaxis_admin_session: 'SESSION-VALUE-9' }],
      magic_link_url: 'https://example.test/q/SECRET-ISSUED-TOKEN',
      delivery: { ciphertext: 'encrypted-token-data' },
    }) as { password: string; nested: Array<{ medaxis_admin_session: string }> };

    const text = JSON.stringify(out);
    for (const secret of [
      'hunter2',
      'Bearer abc',
      's%3Axyz',
      ':"ts"',
      ':"t"',
      ':"m"',
      '123456',
      ':"ABC"',
      'SESSION-VALUE-9',
      'SECRET-ISSUED-TOKEN',
      'encrypted-token-data',
    ]) {
      expect(text).not.toContain(secret);
    }
    expect(out.password).toBe(REDACTED);
    expect(out.nested[0]?.medaxis_admin_session).toBe(REDACTED);
  });

  it('redacts internal pricing, prescriptions and contact details', () => {
    const out = redact({
      procurement_cost_bdt: '1200.00',
      markup_percent: '18',
      internal_costs: [{ x: 1 }],
      prescription: Buffer.from('medical'),
      email: 'buyer@example.com',
      whatsapp_number: '+8801700000000',
      contact_snapshot: { full_name: 'A' },
    }) as Record<string, unknown>;
    for (const key of Object.keys(out)) expect(out[key]).toBe(REDACTED);
  });

  it('keeps non-sensitive operational fields', () => {
    const out = redact({ request_id: 'r1', method: 'GET', status: 200, duration_ms: 3.2 });
    expect(out).toEqual({ request_id: 'r1', method: 'GET', status: 200, duration_ms: 3.2 });
  });

  it('is safe with cycles and errors', () => {
    const a: Record<string, unknown> = { name: 'a' };
    a.self = a;
    expect((redact(a) as Record<string, unknown>).self).toBe('[Circular]');
    const out = redact({ err: Object.assign(new Error('boom'), { code: 'E1' }) }) as { err: Record<string, unknown> };
    expect(out.err).toMatchObject({ name: 'Error', message: 'boom', code: 'E1' });
  });
});

describe('redactRoute', () => {
  it('replaces magic-link tokens in quotation routes', () => {
    const token = 'a'.repeat(64);
    expect(redactRoute(`/v1/public/quotation/accept/${token}`)).toBe('/v1/public/quotation/accept/:token');
    expect(redactRoute(`/v1/public/quotation/pdf/${token}?download=1`)).toBe('/v1/public/quotation/pdf/:token');
    expect(redactRoute(`/v1/public/quotation/token/${token}`)).toBe('/v1/public/quotation/token/:token');
    expect(redactRoute(`/v1/public/quotation/request-refresh/${token}`)).toBe(
      '/v1/public/quotation/request-refresh/:token',
    );
  });

  it('replaces UUID identifiers and strips query strings', () => {
    expect(
      redactRoute('/v1/admin/rfqs/8f9a2b1c-3d4e-4f5a-8b9c-0d1e2f3a4b5c/items/1b2c3d4e-5f6a-4b7c-8d9e-0f1a2b3c4d5e?x=1'),
    ).toBe('/v1/admin/rfqs/:id/items/:id');
  });

  it('leaves static routes untouched', () => {
    expect(redactRoute('/v1/health')).toBe('/v1/health');
  });
});
