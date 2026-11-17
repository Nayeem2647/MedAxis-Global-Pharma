import { catalogSitemap } from '../../lib/sitemap';
export const revalidate = 3600;
export async function GET(): Promise<Response> { return catalogSitemap('static'); }
