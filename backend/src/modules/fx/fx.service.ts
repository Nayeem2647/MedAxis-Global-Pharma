import { parse } from 'lossless-json';
import mongoose, { type ClientSession } from 'mongoose';
import type { Request } from 'express';
import { z } from 'zod';
import { FX_CURRENCIES, type FxCurrency, type Currency } from '../../config/constants.js';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';
import { writeAuditLog } from '../../shared/middleware/auditLogger.js';
import { Exact, bsonDecimal, saneRate } from '../../shared/utils/decimal.js';
import type { AppLogger } from '../../shared/utils/logger.js';
import { fxPatchSchema } from '../../shared/validators/quotation.validator.js';
import { AdminModel } from '../auth/auth.schema.js';
import { NotificationLogModel } from '../notification/notification.schema.js';
import { ExchangeRateModel, type IExchangeRate } from './fx.schema.js';

export const FX_TTL_MS = 3_600_000;
export interface CachedRate {
  currency: FxCurrency;
  live_rate_to_bdt: string;
  manual_rate_to_bdt?: string;
  mode: 'LIVE' | 'MANUAL_FIXED';
  live_fetched_at: Date;
  cached_at: Date;
}
export interface FxOptions {
  fetcher?: typeof fetch;
  onAlert?: (code: string) => void | Promise<void>;
}
export function createFxService(env: AppEnv, logger: AppLogger, options: FxOptions = {}) {
  const cache = new Map<FxCurrency, CachedRate>();
  let lastFailure: string | null = null;
  let pending: Promise<boolean> | undefined;
  let timer: ReturnType<typeof setInterval> | undefined;
  let lastAlertAt = 0;
  function remember(rows: IExchangeRate[]) {
    for (const row of rows)
      cache.set(row.currency_code, {
        currency: row.currency_code,
        live_rate_to_bdt: row.live_rate_to_bdt.toString(),
        manual_rate_to_bdt: row.manual_rate_to_bdt?.toString(),
        mode: row.mode,
        live_fetched_at: row.live_fetched_at,
        cached_at: new Date(),
      });
  }
  async function hydrate() {
    const rows = await ExchangeRateModel.find().lean();
    remember(rows);
    return rows;
  }
  async function alert(code: string) {
    lastFailure = code;
    logger.warn('FX refresh failed; retaining last good rates', { error_code: code });
    if (Date.now() - lastAlertAt < FX_TTL_MS) return;
    lastAlertAt = Date.now();
    try {
      const owner = await AdminModel.findOne({ singleton_key: 'SUPER_ADMIN', is_active: true })
        .select({ _id: 1, email: 1 })
        .lean();
      if (owner)
        await NotificationLogModel.updateOne(
          { dedupe_key: `fx-alert:${Math.floor(Date.now() / FX_TTL_MS)}` },
          {
            $setOnInsert: {
              entity_type: 'admins',
              entity_id: owner._id,
              kind: 'EMAIL',
              recipient: env.ADMIN_ALERT_EMAIL ?? owner.email,
              template_id: 'fx-rate-alert',
              safe_payload: { error_code: code, priority: 'HIGH' },
              status: 'PENDING',
              next_retry_at: new Date(),
            },
          },
          { upsert: true, runValidators: true },
        );
      await options.onAlert?.(code);
    } catch {
      logger.error('Unable to queue FX admin alert');
    }
  }
  async function fetchRates(): Promise<boolean> {
    if (!env.EXCHANGE_RATE_API_KEY) {
      await alert('FX_NOT_CONFIGURED');
      return false;
    }
    try {
      const response = await (options.fetcher ?? fetch)(
        `https://v6.exchangerate-api.com/v6/${encodeURIComponent(env.EXCHANGE_RATE_API_KEY)}/latest/BDT`,
        { redirect: 'error', signal: AbortSignal.timeout(10_000) },
      );
      if (!response.ok) throw new Error();
      const text = await response.text();
      if (text.length > 100_000) throw new Error();
      const raw = z
        .object({
          result: z.literal('success'),
          base_code: z.literal('BDT'),
          time_last_update_unix: z.string().regex(/^\d{1,13}$/),
          conversion_rates: z.object({ BDT: z.string(), USD: z.string(), CNY: z.string(), EUR: z.string() }),
        })
        .parse(parse(text, undefined, (value) => value));
      const fetched = new Date(Number(raw.time_last_update_unix) * 1000);
      if (
        !Number.isFinite(fetched.getTime()) ||
        fetched.getTime() > Date.now() + 300_000 ||
        fetched.getTime() <= 0 ||
        !new Exact(raw.conversion_rates.BDT).eq(1)
      )
        throw new Error();
      const rates = FX_CURRENCIES.map((currency) => {
        const units = new Exact(raw.conversion_rates[currency]);
        if (!units.isFinite() || units.lte(0)) throw new Error();
        const rate = new Exact(1).div(units);
        if (!saneRate(rate.toString())) throw new Error();
        return { currency, value: rate.toDecimalPlaces(16).toString() };
      });
      await mongoose.connection.transaction(async (session) => {
        for (const rate of rates)
          await ExchangeRateModel.updateOne(
            { _id: rate.currency },
            {
              $set: {
                currency_code: rate.currency,
                live_rate_to_bdt: bsonDecimal(rate.value),
                live_fetched_at: fetched,
              },
              $setOnInsert: { mode: 'LIVE' },
            },
            { upsert: true, runValidators: true, session },
          );
      });
      lastFailure = null;
      await hydrate();
      return true;
    } catch {
      await alert('FX_PROVIDER_REJECTED');
      return false;
    }
  }
  const refresh = () =>
    (pending ??= fetchRates().finally(() => {
      pending = undefined;
    }));
  async function inspect() {
    if (
      cache.size !== FX_CURRENCIES.length ||
      [...cache.values()].some((row) => Date.now() - row.cached_at.getTime() >= FX_TTL_MS)
    ) {
      try {
        await hydrate();
      } catch {
        if (!cache.size) throw AppError.unavailable('No FX rates are available.');
      }
    }
    return {
      last_error_code: lastFailure,
      rates: FX_CURRENCIES.map((currency) => {
        const row = cache.get(currency);
        if (!row) return { currency, available: false };
        const stale = Date.now() - row.live_fetched_at.getTime() >= FX_TTL_MS;
        return {
          ...row,
          active_rate_to_bdt: row.mode === 'MANUAL_FIXED' ? row.manual_rate_to_bdt : row.live_rate_to_bdt,
          stale: row.mode === 'LIVE' && stale,
          cache_expires_at: new Date(row.cached_at.getTime() + FX_TTL_MS),
          live_stale_at: new Date(row.live_fetched_at.getTime() + FX_TTL_MS),
          available: true,
        };
      }),
    };
  }
  async function snapshot(currency: Currency, session: ClientSession, allowStale: boolean) {
    const rows = await ExchangeRateModel.find().session(session).lean();
    const rates = {} as Record<FxCurrency, string>;
    const modes = {} as Record<FxCurrency, 'LIVE' | 'MANUAL_FIXED'>;
    const fetched = {} as Record<FxCurrency, Date>;
    let stale = false;
    for (const code of FX_CURRENCIES) {
      const row = rows.find((item) => item.currency_code === code);
      const value =
        row?.mode === 'MANUAL_FIXED' ? row.manual_rate_to_bdt?.toString() : row?.live_rate_to_bdt.toString();
      if (!row || !value || !saneRate(value)) throw AppError.unavailable(`A valid ${code} exchange rate is required.`);
      const old = row.mode === 'LIVE' && Date.now() - row.live_fetched_at.getTime() >= FX_TTL_MS;
      if (old) stale = true;
      rates[code] = value;
      modes[code] = row.mode;
      fetched[code] = row.live_fetched_at;
    }
    if (stale && !allowStale)
      throw AppError.conflict(
        'Fresh FX rates were requested, but cached live rates are stale. Refresh or switch to manual.',
      );
    return { rate: currency === 'BDT' ? '1' : rates[currency], rates, modes, fetched, stale, captured_at: new Date() };
  }
  async function patch(req: Request, input: z.infer<typeof fxPatchSchema>) {
    await mongoose.connection.transaction(async (session) => {
      for (const change of input.rates) {
        const row = await ExchangeRateModel.findById(change.currency).session(session);
        if (!row) throw AppError.notFound('Initialize live rates before configuring their mode.');
        if (change.manual_rate_to_bdt !== undefined) row.manual_rate_to_bdt = bsonDecimal(change.manual_rate_to_bdt);
        if (
          change.active_mode === 'MANUAL_FIXED' &&
          (!row.manual_rate_to_bdt || !saneRate(row.manual_rate_to_bdt.toString()))
        )
          throw AppError.validation([
            { field: 'manual_rate_to_bdt', issue: 'Manual mode requires a valid manual rate.' },
          ]);
        row.mode = change.active_mode;
        row.updated_by = req.admin!.id;
        await row.save({ session });
        await writeAuditLog(
          req,
          {
            actor_type: 'SUPER_ADMIN',
            actor_id: req.admin!.id,
            action: 'FX_MODE_UPDATED',
            entity_type: 'admins',
            entity_id: req.admin!.id,
            metadata: { currency: change.currency, mode: change.active_mode },
          },
          session,
        );
      }
    });
    await hydrate();
    return inspect();
  }
  async function start() {
    await hydrate();
    await refresh();
    if (!timer) {
      timer = setInterval(() => {
        void refresh().catch(() => logger.error('FX scheduled refresh failed'));
      }, FX_TTL_MS);
      timer.unref();
    }
  }
  function stop() {
    if (timer) clearInterval(timer);
    timer = undefined;
  }
  return { cache, hydrate, refresh, inspect, snapshot, patch, start, stop };
}
export type FxService = ReturnType<typeof createFxService>;
