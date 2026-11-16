import { proxyAdmin } from '../../../../lib/admin-proxy';
export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
export const revalidate = 0;
export const maxDuration = 60;
async function handle(request: Request, context: { params: Promise<{ path: string[] }> }) { return proxyAdmin(request, (await context.params).path); }
export { handle as GET, handle as POST, handle as PATCH, handle as PUT, handle as DELETE };
