import { z } from 'zod';

const emptyToUndefined = (value: unknown): unknown =>
  typeof value === 'string' && value.trim() === '' ? undefined : value;

const optionalString = z.preprocess(emptyToUndefined, z.string().min(1).optional());
const optionalUrl = z.preprocess(emptyToUndefined, z.string().url().optional());
const booleanFromString = z.preprocess((value) => {
  if (typeof value === 'string') {
    const v = value.trim().toLowerCase();
    if (['true', '1', 'yes', 'on'].includes(v)) return true;
    if (['false', '0', 'no', 'off'].includes(v)) return false;
  }
  return value;
}, z.boolean());

const originList = z
  .string()
  .min(1, 'is required')
  .transform((raw) =>
    raw
      .split(',')
      .map((o) => o.trim().replace(/\/+$/, ''))
      .filter(Boolean),
  )
  .pipe(z.array(z.string().url('must be a valid http(s) origin')).min(1));

const baseSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().min(1).max(65535).default(4000),
  LOG_LEVEL: z.enum(['error', 'warn', 'info', 'http', 'debug']).default('info'),

  MONGODB_URI: z
    .string()
    .min(1, 'is required')
    .regex(/^mongodb(\+srv)?:\/\//, 'must start with mongodb:// or mongodb+srv://'),
  PUBLIC_ORIGIN: originList,
  API_ORIGIN: z.string().min(1, 'is required').url('must be a valid URL'),
  ADMIN_SESSION_SECRET: z.string().min(32, 'must be at least 32 characters'),
  TOTP_ENCRYPTION_KEY_BASE64: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^[A-Za-z0-9+/]{43}=$/)
      .optional(),
  ),
  TOTP_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).max(200).optional()),
  ADMIN_HOME_COUNTRY: z
    .string()
    .regex(/^[A-Z]{2}$/)
    .default('BD'),

  DB_CONNECT_RETRIES: z.coerce.number().int().min(0).max(20).default(5),
  DB_CONNECT_RETRY_DELAY_MS: z.coerce.number().int().min(100).default(2000),
  DB_REQUIRE_REPLICA_SET: booleanFromString.optional(),

  TRUST_CLOUDFLARE_HEADERS: booleanFromString.optional(),

  PRESCRIPTION_ENCRYPTION_KEY: optionalString,
  PRESCRIPTION_KEY_ID: optionalString,
  R2_ACCOUNT_ID: optionalString,
  R2_ACCESS_KEY_ID: optionalString,
  R2_SECRET_ACCESS_KEY: optionalString,
  R2_BUCKET_PRODUCTS: optionalString,
  R2_BUCKET_QUOTES: optionalString,
  R2_BUCKET_PRESCRIPTIONS: optionalString,
  R2_PUBLIC_BASE_URL: optionalUrl,
  CLOUDFLARE_TURNSTILE_SECRET: optionalString,
  RESEND_API_KEY: optionalString,
  BREVO_API_KEY: optionalString,
  EMAIL_FALLBACK_ENABLED: booleanFromString.default(false),
  EMAIL_REPLY_TO: z.preprocess(emptyToUndefined, z.string().email().optional()),
  EMAIL_REPLY_DOMAIN: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]*[a-zA-Z0-9])?\.)+[a-zA-Z]{2,63}$/)
      .optional(),
  ),
  EMAIL_FROM: optionalString,
  EXCHANGE_RATE_API_KEY: optionalString,
  PUPPETEER_EXECUTABLE_PATH: optionalString,
  QUOTATION_TOKEN_ENCRYPTION_KEY: z.preprocess(
    emptyToUndefined,
    z
      .string()
      .regex(/^([0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=)$/)
      .optional(),
  ),
  QUOTATION_TOKEN_KEY_ID: z.preprocess(emptyToUndefined, z.string().min(1).max(200).optional()),
  REVALIDATE_WEBHOOK_SECRET: optionalString,
  WEBHOOK_HMAC_SECRET: optionalString,
  ADMIN_ALERT_EMAIL: z.preprocess(emptyToUndefined, z.string().email().optional()),
});

const PRODUCTION_REQUIRED = [
  'PRESCRIPTION_ENCRYPTION_KEY',
  'PRESCRIPTION_KEY_ID',
  'R2_ACCOUNT_ID',
  'R2_ACCESS_KEY_ID',
  'R2_SECRET_ACCESS_KEY',
  'R2_BUCKET_PRODUCTS',
  'R2_BUCKET_QUOTES',
  'R2_BUCKET_PRESCRIPTIONS',
  'CLOUDFLARE_TURNSTILE_SECRET',
  'RESEND_API_KEY',
  'EMAIL_FROM',
  'EXCHANGE_RATE_API_KEY',
  'REVALIDATE_WEBHOOK_SECRET',
  'WEBHOOK_HMAC_SECRET',
  'ADMIN_ALERT_EMAIL',
] as const;

const KEY_PATTERN = /^([0-9a-fA-F]{64}|[A-Za-z0-9+/]{43}=)$/;

const schema = baseSchema.superRefine((env, ctx) => {
  if (env.EMAIL_FALLBACK_ENABLED && !env.BREVO_API_KEY)
    ctx.addIssue({
      code: 'custom',
      path: ['BREVO_API_KEY'],
      message: 'is required when EMAIL_FALLBACK_ENABLED is true',
    });
  if (env.PRESCRIPTION_ENCRYPTION_KEY && !KEY_PATTERN.test(env.PRESCRIPTION_ENCRYPTION_KEY)) {
    ctx.addIssue({
      code: 'custom',
      path: ['PRESCRIPTION_ENCRYPTION_KEY'],
      message: 'must be a 32-byte key encoded as 64 hex characters or base64',
    });
  }
  if (env.NODE_ENV === 'production') {
    for (const key of ['TOTP_ENCRYPTION_KEY_BASE64', 'TOTP_KEY_ID'] as const) {
      if (!env[key]) ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
    }
    for (const key of PRODUCTION_REQUIRED) {
      if (env[key] === undefined) {
        ctx.addIssue({ code: 'custom', path: [key], message: 'is required in production' });
      }
    }
    if (!env.API_ORIGIN.startsWith('https://')) {
      ctx.addIssue({ code: 'custom', path: ['API_ORIGIN'], message: 'must use https:// in production' });
    }
    for (const origin of env.PUBLIC_ORIGIN) {
      if (!origin.startsWith('https://')) {
        ctx.addIssue({
          code: 'custom',
          path: ['PUBLIC_ORIGIN'],
          message: `"${origin}" must use https:// in production`,
        });
      }
    }
  }
});

export type RawEnvInput = Record<string, string | undefined>;

export interface AppEnv extends z.infer<typeof baseSchema> {
  readonly isProduction: boolean;
  readonly isTest: boolean;
  readonly DB_REQUIRE_REPLICA_SET: boolean;
  readonly TRUST_CLOUDFLARE_HEADERS: boolean;
}

export class EnvValidationError extends Error {
  readonly issues: z.ZodIssue[];

  constructor(issues: z.ZodIssue[]) {
    const lines = issues.map((i) => `  - ${i.path.join('.') || '(root)'}: ${i.message}`);
    super(`Invalid environment configuration:\n${lines.join('\n')}`);
    this.name = 'EnvValidationError';
    this.issues = issues;
  }
}

export function loadEnv(source: RawEnvInput = process.env): AppEnv {
  const result = schema.safeParse({
    ...source,
    TOTP_ENCRYPTION_KEY_BASE64: source.TOTP_ENCRYPTION_KEY_BASE64 || source.SEED_TOTP_ENCRYPTION_KEY_BASE64,
    TOTP_KEY_ID: source.TOTP_KEY_ID || source.SEED_TOTP_KEY_ID,
  });
  if (!result.success) {
    throw new EnvValidationError(
      result.error.issues.map((issue) => ({
        ...issue,
        message:
          issue.code === 'invalid_type' && /received undefined/i.test(issue.message) ? 'is required' : issue.message,
      })),
    );
  }
  const env = result.data;
  const isProduction = env.NODE_ENV === 'production';
  return Object.freeze({
    ...env,
    isProduction,
    isTest: env.NODE_ENV === 'test',
    DB_REQUIRE_REPLICA_SET: env.DB_REQUIRE_REPLICA_SET ?? isProduction,
    TRUST_CLOUDFLARE_HEADERS: env.TRUST_CLOUDFLARE_HEADERS ?? isProduction,
  });
}

let cached: AppEnv | undefined;

export function getEnv(): AppEnv {
  if (!cached) cached = loadEnv(process.env);
  return cached;
}

export function resetEnvCache(): void {
  cached = undefined;
}
