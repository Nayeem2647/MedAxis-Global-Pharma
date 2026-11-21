import { z } from 'zod';
import { guardedAdminRead } from '../../../../lib/admin-server';
import { blogCategories, blogPostRecord, paramsFor, requirePagination, resourceQuery } from '../../../../lib/admin-management';
import { AdminUnavailable } from '../../../../components/admin/AdminFeedback';
import { AdminBlogSetup } from '../../../../components/admin/AdminBlogSetup';

export default async function AdminBlogPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  let query: URLSearchParams;
  try {
    query = paramsFor(await searchParams, ['page', 'limit', 'q', 'is_active', 'category']);
    resourceQuery.parse(Object.fromEntries(query));
  } catch {
    return <AdminUnavailable problem={{ status: 422 }} />;
  }

  const result = await guardedAdminRead(`/v1/admin/cms/blogs?${query}`, z.array(blogPostRecord).max(100));
  if (!result.ok) return <AdminUnavailable problem={result.problem} />;

  let pagination;
  try {
    pagination = requirePagination(result.result.meta);
  } catch {
    return <AdminUnavailable problem={{ status: 502 }} />;
  }

  const categoryParam = z.enum(blogCategories).safeParse(query.get('category'));
  return (
    <AdminBlogSetup
      initialItems={result.result.data}
      initialPagination={pagination}
      initialFilterCategory={categoryParam.success ? categoryParam.data : ''}
    />
  );
}
