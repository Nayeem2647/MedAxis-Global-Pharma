import { isIP } from 'node:net';
import geoip from 'geoip-lite';

export interface GeoLocation {
  country: string | null;
  city: string | null;
}

export function normalizeIp(ip: string): string {
  return ip.startsWith('::ffff:') && isIP(ip.slice(7)) === 4 ? ip.slice(7) : ip.toLowerCase();
}

export function lookupGeoIp(ip?: string): GeoLocation {
  const unknown = { country: null, city: null };
  if (!ip) return unknown;
  const normalized = normalizeIp(ip);
  if (!isIP(normalized)) return unknown;
  if (normalized.includes(':')) {
    if (!/^[23][0-9a-f]{0,3}:/.test(normalized) || normalized.startsWith('2001:db8:')) return unknown;
  } else {
    const [a = 0, b = 0] = normalized.split('.').map(Number);
    if (
      a === 0 ||
      a === 10 ||
      a === 127 ||
      a >= 224 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168) ||
      (a === 100 && b >= 64 && b <= 127)
    )
      return unknown;
  }
  try {
    const result = geoip.lookup(normalized);
    return result ? { country: result.country || null, city: result.city || null } : unknown;
  } catch {
    return unknown;
  }
}

export function maskIp(ip?: string): string | null {
  if (!ip) return null;
  const normalized = normalizeIp(ip);
  if (isIP(normalized) === 4) return `${normalized.split('.').slice(0, 3).join('.')}.*`;
  if (isIP(normalized) === 6) return `${normalized.split(':').slice(0, 3).join(':')}:*`;
  return null;
}
