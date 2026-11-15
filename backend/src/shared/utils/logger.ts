import winston from 'winston';
import type { AppEnv } from '../../config/env.js';

export const REDACTED = '[REDACTED]' as const;

const SENSITIVE_KEYS = new Set([
  'password',
  'password_hash',
  'new_password',
  'current_password',
  'authorization',
  'cookie',
  'set-cookie',
  'medaxis_admin_session',
  'pre_auth_session',
  'session_token',
  'token',
  'magic_link',
  'magic_link_token',
  'magic_link_token_hash',
  'token_hash',
  'turnstile_token',
  'cf-turnstile-response',
  'x-webhook-signature',
  'totp',
  'totp_code',
  'code',
  'totp_secret',
  'totp_secret_encrypted',
  'backup_code',
  'backup_codes',
  'backup_code_hashes',
  'recovery_code',
  'recovery_codes',
  'qr_code',
  'qr_data_url',
  'otpauth_url',
  'secret',
  'api_key',
  'apikey',
  'prescription',
  'prescription_content',
  'body',
  'message_body',
  'customer_notes',
  'line_notes',
  'custom_medicine_name',
  'custom_strength',
  'unable_to_supply_reason',
  'r2_object_key',
  'iv',
  'auth_tag',
  'encryption',
  'r2_storage_key',
  'email',
  'phone',
  'whatsapp_number',
  'wechat_id',
  'full_name',
  'contact_snapshot',
  'procurement_cost_bdt',
  'procurement_unit_cost_bdt',
  'markup_percent',
  'target_markup_percent',
  'calculated_base_bdt',
  'effective_gross_margin_percent',
  'internal_procurement_notes',
  'internal_note',
  'internal_costs',
  'gross_margin_bdt',
  'ciphertext',
  'delivery',
]);

const SENSITIVE_FRAGMENTS = [
  'password',
  'secret',
  'token',
  'magic_link',
  'authorization',
  'cookie',
  'internal_cost',
  'backup_code',
  'recovery_code',
];

function isSensitiveKey(key: string): boolean {
  const k = key.toLowerCase();
  if (SENSITIVE_KEYS.has(k)) return true;
  return SENSITIVE_FRAGMENTS.some((fragment) => k.includes(fragment));
}

export function redact(value: unknown, depth = 0, seen = new WeakSet<object>()): unknown {
  if (value === null || typeof value !== 'object') return value;
  if (depth > 8) return '[Truncated]';
  if (seen.has(value)) return '[Circular]';
  seen.add(value);

  if (value instanceof Error) {
    const errWithCode = value as Error & { code?: unknown };
    return { name: value.name, message: value.message, code: errWithCode.code, stack: value.stack };
  }
  if (Array.isArray(value)) {
    return value.map((item) => redact(item, depth + 1, seen));
  }
  const out: Record<string, unknown> = {};
  for (const [key, val] of Object.entries(value)) {
    out[key] = isSensitiveKey(key) ? REDACTED : redact(val, depth + 1, seen);
  }
  return out;
}

export function redactRoute(path = ''): string {
  const withoutQuery = path.split('?')[0] ?? '';
  return withoutQuery
    .replace(
      /(\/v1\/public\/quotation\/(?:pdf|token|accept|request-revision|request-refresh|decline)\/)[^/]+/i,
      '$1:token',
    )
    .replace(/\/[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}(?=\/|$)/gi, '/:id')
    .replace(/\/[0-9a-f]{32,}(?=\/|$)/gi, '/:token');
}

const redactFormat = winston.format((info) => {
  const { level, message, ...meta } = info;
  const safe = redact(meta) as Record<string, unknown>;
  for (const key of Object.keys(meta)) delete info[key];
  Object.assign(info, safe);
  info.level = level;
  info.message = typeof message === 'string' ? message : JSON.stringify(redact(message));
  return info;
});

export interface LoggerOptions {
  level?: string;
  silent?: boolean;
  pretty?: boolean;
}

export type AppLogger = winston.Logger;

export function createLogger({ level = 'info', silent = false, pretty = false }: LoggerOptions = {}): AppLogger {
  const formats = [
    winston.format.timestamp(),
    winston.format.errors({ stack: true }),
    redactFormat(),
    pretty ? winston.format.colorize() : winston.format.uncolorize(),
    pretty
      ? winston.format.printf(({ timestamp, level: lvl, message, ...meta }) => {
          const rest = Object.keys(meta).length ? ` ${JSON.stringify(meta)}` : '';
          return `${String(timestamp)} ${String(lvl)}: ${String(message)}${rest}`;
        })
      : winston.format.json(),
  ];

  return winston.createLogger({
    level,
    silent,
    format: winston.format.combine(...formats),
    defaultMeta: { service: 'medaxis-api' },
    transports: [
      new winston.transports.Console({
        stderrLevels: ['error', 'warn', 'info', 'http', 'verbose', 'debug', 'silly'],
      }),
    ],
    exitOnError: false,
  });
}

let defaultLogger: AppLogger | undefined;

export function getLogger(env?: Pick<AppEnv, 'LOG_LEVEL' | 'isTest' | 'isProduction'>): AppLogger {
  if (!defaultLogger) {
    defaultLogger = createLogger({
      level: env?.LOG_LEVEL ?? 'info',
      silent: env?.isTest ?? false,
      pretty: env ? !env.isProduction : false,
    });
  }
  return defaultLogger;
}
