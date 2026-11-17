import { notFound } from 'next/navigation';
import { z } from 'zod';
import { guardedAdminRead, requireAdminSession } from '../../../../../../lib/admin-server';
import { resourceKinds, resourcePath, resourceSchema } from '../../../../../../lib/admin-management';
import { settingsSchema } from '../../../../../../lib/admin-workflow';
import { AdminUnavailable } from '../../../../../../components/admin/AdminFeedback';
import { ResourceEditor } from '../../../../../../components/admin/ResourceEditor';
export default async function EditorPage({ params }: { params: Promise<{ kind: string; id: string }> }) {
  const value = await params;
  const kind = z.enum(resourceKinds).safeParse(value.kind);
  if (!kind.success || (value.id !== 'new' && !z.uuidv4().safeParse(value.id).success)) notFound();
  const auth = await requireAdminSession();
  if (!auth.ok) return <AdminUnavailable problem={auth.problem} />;
  const row =
    value.id === 'new' ? null : await guardedAdminRead(resourcePath(kind.data, value.id), resourceSchema(kind.data));
  if (row && !row.ok) return <AdminUnavailable problem={row.problem} />;
  const settings = kind.data === 'products' ? await guardedAdminRead('/v1/admin/settings', settingsSchema) : null;
  if (settings && !settings.ok) return <AdminUnavailable problem={settings.problem} />;
  return (
    <ResourceEditor
      kind={kind.data}
      initial={row?.ok ? row.result.data : null}
      units={settings?.ok ? (settings.result.data.packaging_units?.value.units ?? []) : []}
    />
  );
}
