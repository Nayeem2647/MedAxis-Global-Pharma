import { Decimal } from 'decimal.js';
import { Types } from 'mongoose';
import { AppError } from '../errors/AppError.js';

// Isolated configuration: bounded inputs and 80 significant digits leave ample
// headroom before the single, explicit monetary rounding boundary.
export const Exact = Decimal.clone({ precision: 80, rounding: Decimal.ROUND_HALF_UP, toExpNeg: -100, toExpPos: 100 });
export function nonnegative(value: string, field: string): Decimal {
  if (typeof value !== 'string' || !/^\d{1,18}(?:\.\d{1,8})?$/.test(value))
    throw AppError.validation([
      { field, issue: 'Use a nonnegative decimal string (18 integer and 8 fractional digits maximum).' },
    ]);
  return new Exact(value);
}
export function amount(value: Decimal, places = 2): string {
  if (!value.isFinite() || value.abs().gte('1e24'))
    throw AppError.validation([{ field: 'amount', issue: 'Calculated amount exceeds the supported range.' }]);
  return value.toFixed(places, Exact.ROUND_HALF_UP);
}
export const bsonDecimal = (value: string) => Types.Decimal128.fromString(value);
export function saneRate(value: string): boolean {
  try {
    const rate = new Exact(value);
    return rate.isFinite() && rate.gte('0.1') && rate.lte('10000');
  } catch {
    return false;
  }
}
