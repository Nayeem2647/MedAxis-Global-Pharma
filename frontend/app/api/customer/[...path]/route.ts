import { proxyCustomer } from '../../../../lib/customer-proxy';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';
async function handler(request: Request, { params }: { params: Promise<{ path: string[] }> }) { return proxyCustomer(request, (await params).path); }
export { handler as GET, handler as POST, handler as PATCH, handler as DELETE };
