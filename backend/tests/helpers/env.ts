export const validEnv = Object.freeze({
  NODE_ENV: 'test',
  PORT: '4000',
  MONGODB_URI: 'mongodb://127.0.0.1:27017/medaxis_test',
  PUBLIC_ORIGIN: 'http://localhost:3000',
  API_ORIGIN: 'http://localhost:4000',
  ADMIN_SESSION_SECRET: 'x'.repeat(48),
  QUOTATION_TOKEN_ENCRYPTION_KEY: 'cd'.repeat(32),
  QUOTATION_TOKEN_KEY_ID: 'test-workflow-delivery',
});

export const s3EnvSettings = Object.freeze({
  STORAGE_DRIVER: 's3',
  AWS_REGION: 'ap-southeast-1',
  S3_BUCKET_PRODUCTS: 'catalog-images',
  S3_BUCKET_QUOTES: 'private-quotes',
  S3_BUCKET_PRESCRIPTIONS: 'private-prescriptions',
  S3_BUCKET_AVATARS: 'private-avatars',
  S3_PUBLIC_BASE_URL: 'https://cdn.example.test',
});

export const productionEnv = Object.freeze({
  ...s3EnvSettings,
  NODE_ENV: 'production',
  MONGODB_URI: 'mongodb+srv://user:pass@cluster0.example.mongodb.net/medaxis',
  PUBLIC_ORIGIN: 'https://www.medaxisglobalpharma.com',
  API_ORIGIN: 'https://api.medaxisglobalpharma.com',
  ADMIN_SESSION_SECRET: 'p'.repeat(48),
  TOTP_ENCRYPTION_KEY_BASE64: Buffer.alloc(32, 1).toString('base64'),
  TOTP_KEY_ID: 'test-totp-v1',
  PRESCRIPTION_ENCRYPTION_KEY: 'a'.repeat(64),
  PRESCRIPTION_KEY_ID: 'key-2026-01',
  CLOUDFLARE_TURNSTILE_SECRET: 'ts-secret',
  RESEND_API_KEY: 're_123',
  EMAIL_FROM: 'MedAxis Global Pharma <quotes@medaxisglobalpharma.com>',
  EXCHANGE_RATE_API_KEY: 'fx-key',
  REVALIDATE_WEBHOOK_SECRET: 'reval-secret',
  WEBHOOK_HMAC_SECRET: 'hmac-secret',
  ADMIN_ALERT_EMAIL: 'owner@medaxisglobalpharma.com',
});
