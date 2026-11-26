import { z } from 'zod';
import { PlatformSettingModel } from './settings.schema.js';
import countryPoints from './supply-network-points.json' with { type: 'json' };

// Representative points from Natural Earth v5.1.2 (public domain).
const points = z.record(z.string().regex(/^[A-Z]{2}$/), z.tuple([
  z.number().min(-65).max(85),
  z.number().min(-180).max(180),
])).parse(countryPoints);
export const supplyNetworkCountryCodes = Object.keys(points);
export const supplyNetworkSetting = z.strictObject({
  countries: z.array(z.string().refine((code) => Object.hasOwn(points, code), 'Choose a supported destination.'))
    .max(supplyNetworkCountryCodes.length)
    .refine((codes) => new Set(codes).size === codes.length, 'Choose each destination once.'),
});

export async function readPublicSupplyNetwork() {
  const setting = await PlatformSettingModel.findOne({ key: 'supply_network' }).select({ _id: 0, value: 1 }).lean();
  const parsed = supplyNetworkSetting.safeParse(setting?.value);
  return {
    destinations: (parsed.success ? parsed.data.countries : []).map((country) => {
      const [latitude, longitude] = points[country]!;
      return { country, latitude, longitude };
    }),
  };
}
