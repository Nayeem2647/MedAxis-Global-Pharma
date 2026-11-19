import { describe, expect, it } from 'vitest';
import { EnvValidationError, loadEnv, type RawEnvInput } from '../src/config/env.js';
import { productionEnv, s3EnvSettings, validEnv } from './helpers/env.js';

describe('loadEnv', () => {
  it('loads a valid development/test environment with defaults', () => {
    const env = loadEnv({ ...validEnv });
    expect(env.PORT).toBe(4000);
    expect(env.PUBLIC_ORIGIN).toEqual(['http://localhost:3000']);
    expect(env.isProduction).toBe(false);
    expect(env.DB_REQUIRE_REPLICA_SET).toBe(false);
    expect(env.TRUST_CLOUDFLARE_HEADERS).toBe(false);
    expect(env.STORAGE_DRIVER).toBe('local');
  });

  it.each(['MONGODB_URI', 'PUBLIC_ORIGIN', 'API_ORIGIN', 'ADMIN_SESSION_SECRET'])(
    'fails fast with a descriptive error when %s is missing',
    (key) => {
      const source: RawEnvInput = { ...validEnv };
      delete source[key];
      expect(() => loadEnv(source)).toThrow(EnvValidationError);
      expect(() => loadEnv(source)).toThrow(new RegExp(key));
    },
  );

  it('rejects a short ADMIN_SESSION_SECRET without echoing it', () => {
    const secret = 'short-secret';
    try {
      loadEnv({ ...validEnv, ADMIN_SESSION_SECRET: secret });
      expect.unreachable();
    } catch (err) {
      expect(err).toBeInstanceOf(EnvValidationError);
      expect((err as Error).message).toContain('ADMIN_SESSION_SECRET');
      expect((err as Error).message).not.toContain(secret);
    }
  });

  it('parses a comma-separated PUBLIC_ORIGIN allowlist and trims trailing slashes', () => {
    const env = loadEnv({ ...validEnv, PUBLIC_ORIGIN: 'http://localhost:3000/, https://www.medaxisglobalpharma.com' });
    expect(env.PUBLIC_ORIGIN).toEqual(['http://localhost:3000', 'https://www.medaxisglobalpharma.com']);
  });

  it('rejects a non-MongoDB connection string', () => {
    expect(() => loadEnv({ ...validEnv, MONGODB_URI: 'postgres://x' })).toThrow(/MONGODB_URI/);
  });

  describe('production', () => {
    it('accepts AWS S3 without R2 credentials and requires isolation of private buckets', () => {
      const source: RawEnvInput = {
        ...productionEnv,
        ...s3EnvSettings,
        S3_PUBLIC_BASE_URL: 'https://assets.example.com',
      };
      expect(loadEnv(source).S3_BUCKET_AVATARS).toBe('private-avatars');
      expect(() => loadEnv({ ...source, S3_BUCKET_PRESCRIPTIONS: undefined })).toThrow(/S3_BUCKET_PRESCRIPTIONS/);
      expect(() => loadEnv({ ...source, S3_BUCKET_QUOTES: source.S3_BUCKET_PRODUCTS })).toThrow(/separate buckets/);
    });

    it('accepts a complete production environment and enables strict defaults', () => {
      const env = loadEnv({ ...productionEnv });
      expect(env.isProduction).toBe(true);
      expect(env.DB_REQUIRE_REPLICA_SET).toBe(true);
      expect(env.TRUST_CLOUDFLARE_HEADERS).toBe(true);
    });

    it.each([
      'PRESCRIPTION_ENCRYPTION_KEY',
      'PRESCRIPTION_KEY_ID',
      'CLOUDFLARE_TURNSTILE_SECRET',
      'RESEND_API_KEY',
      'EXCHANGE_RATE_API_KEY',
      'REVALIDATE_WEBHOOK_SECRET',
      'WEBHOOK_HMAC_SECRET',
      'ADMIN_ALERT_EMAIL',
      'TOTP_ENCRYPTION_KEY_BASE64',
      'TOTP_KEY_ID',
    ])('fails when %s is missing', (key) => {
      const source: RawEnvInput = { ...productionEnv };
      delete source[key];
      expect(() => loadEnv(source)).toThrow(new RegExp(`${key}: is required in production`));
    });

    it('treats blank values as missing', () => {
      expect(() => loadEnv({ ...productionEnv, RESEND_API_KEY: '   ' })).toThrow(/RESEND_API_KEY/);
    });

    it('requires https origins', () => {
      expect(() => loadEnv({ ...productionEnv, API_ORIGIN: 'http://api.example.com' })).toThrow(/API_ORIGIN/);
      expect(() => loadEnv({ ...productionEnv, PUBLIC_ORIGIN: 'http://www.example.com' })).toThrow(/PUBLIC_ORIGIN/);
    });

    it('validates the prescription encryption key format', () => {
      expect(() => loadEnv({ ...productionEnv, PRESCRIPTION_ENCRYPTION_KEY: 'not-a-key' })).toThrow(
        /PRESCRIPTION_ENCRYPTION_KEY/,
      );
    });

    it('rejects local storage in production', () => {
      expect(() => loadEnv({ ...productionEnv, STORAGE_DRIVER: 'local' })).toThrow(/development\/test only/);
    });
  });

  it('validates the prescription key format outside production when supplied', () => {
    expect(() => loadEnv({ ...validEnv, PRESCRIPTION_ENCRYPTION_KEY: 'abc' })).toThrow(/PRESCRIPTION_ENCRYPTION_KEY/);
    expect(
      loadEnv({ ...validEnv, PRESCRIPTION_ENCRYPTION_KEY: 'b'.repeat(64) }).PRESCRIPTION_ENCRYPTION_KEY,
    ).toBeDefined();
  });

  it('accepts the bootstrap encryption-key variables as runtime fallbacks', () => {
    const key = Buffer.alloc(32, 7).toString('base64');
    const env = loadEnv({ ...validEnv, SEED_TOTP_ENCRYPTION_KEY_BASE64: key, SEED_TOTP_KEY_ID: 'bootstrap-v1' });
    expect(env.TOTP_ENCRYPTION_KEY_BASE64).toBe(key);
    expect(env.TOTP_KEY_ID).toBe('bootstrap-v1');
  });

  it('rejects invalid TOTP encryption keys without revealing the input', () => {
    const key = 'not-a-valid-key';
    expect(() => loadEnv({ ...validEnv, TOTP_ENCRYPTION_KEY_BASE64: key })).toThrow(/TOTP_ENCRYPTION_KEY_BASE64/);
    try {
      loadEnv({ ...validEnv, TOTP_ENCRYPTION_KEY_BASE64: key });
    } catch (error) {
      expect((error as Error).message).not.toContain(key);
    }
  });
});
