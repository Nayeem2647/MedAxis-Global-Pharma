import { guardedAdminRead } from '../../../../lib/admin-server';
import { settingsSchema } from '../../../../lib/admin-workflow';
import { adminFxSchema } from '../../../../lib/admin-contract';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
import { SettingsManager } from '../../../../components/admin/SettingsManager';
export default async function SettingsPage() {
  const [settings, fx] = await Promise.all([
    guardedAdminRead('/v1/admin/settings', settingsSchema),
    guardedAdminRead('/v1/admin/fx-rates', adminFxSchema),
  ]);
  return settings.ok ? (
    <SettingsManager initial={settings.result.data} initialFx={fx.ok ? fx.result.data : null} />
  ) : (
    <AdminUnavailable problem={settings.problem} />
  );
}
