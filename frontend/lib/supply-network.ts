import { z } from 'zod';
import { apiRequest } from './api-client';
import type { Locale } from '../i18n/routing';

const countryCode = z.string().regex(/^[A-Z]{2}$/);
export const supplyNetworkCountryCodes = z.array(countryCode).max(249);
export const supplyNetworkSettingSchema = z.strictObject({
  countries: supplyNetworkCountryCodes.refine((countries) => new Set(countries).size === countries.length),
});
const supplyDestination = z.object({
  country: countryCode,
  latitude: z.number().min(-65).max(85),
  longitude: z.number().min(-180).max(180),
});
const publicSupplyNetwork = z.object({ destinations: z.array(supplyDestination).max(249) });
export interface SupplyCountry { country: string; name: string }
export type SupplyDestination = z.infer<typeof supplyDestination> & SupplyCountry;

// Resolve labels on the server so different browser locale data cannot change the rendered names or order.
export function nameSupplyCountries<T extends { country: string }>(countries: T[], locale: Locale): (T & SupplyCountry)[] {
  const names = new Intl.DisplayNames(locale, { type: 'region' });
  return countries.map((entry) => ({ ...entry, name: names.of(entry.country) ?? entry.country }))
    .sort((a, b) => a.name.localeCompare(b.name, locale));
}

export async function getSupplyNetwork(locale: Locale): Promise<SupplyDestination[]> {
  try {
    const result = await apiRequest('/v1/public/supply-network', publicSupplyNetwork,
      process.env.NODE_ENV === 'production' && process.env.REVALIDATE_WEBHOOK_SECRET
        ? { next: { revalidate: 300, tags: ['settings'] } }
        : { cache: 'no-store' });
    return nameSupplyCountries(result.data.destinations, locale);
  } catch {
    return [];
  }
}
