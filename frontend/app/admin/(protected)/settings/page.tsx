import { guardedAdminRead } from '../../../../lib/admin-server';
import { settingsSchema } from '../../../../lib/admin-workflow';
import { adminFxSchema } from '../../../../lib/admin-contract';
import { nameSupplyCountries } from '../../../../lib/supply-network';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
import { SettingsManager } from '../../../../components/admin/SettingsManager';
import '../../../supply-network.css';
export default async function SettingsPage() {
  const [settings, fx] = await Promise.all([
    guardedAdminRead('/v1/admin/settings', settingsSchema),
    guardedAdminRead('/v1/admin/fx-rates', adminFxSchema),
  ]);
  return settings.ok ? (
    <SettingsManager initial={settings.result.data} initialFx={fx.ok ? fx.result.data : null}
      supplyCountries={nameSupplyCountries((settings.result.data.supply_network_country_codes ?? []).map((country) => ({ country })), 'en')} />
  ) : (
    <AdminUnavailable problem={settings.problem} />
  );
}
