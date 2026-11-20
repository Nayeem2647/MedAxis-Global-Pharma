import { siteOrigin } from '../../lib/seo';

export function GET(): Response {
  const text = ['User-agent: *', 'Allow: /', 'Disallow: /q/', 'Disallow: /admin/', 'Disallow: /api/', 'Disallow: /dashboard/', 'Disallow: /*/account', 'Disallow: /*/login', 'Disallow: /*/register', 'Disallow: /search', 'Disallow: /*/search', '# Hierarchical index: products, generics, categories, manufacturers, static.', `Sitemap: ${siteOrigin()}/sitemap.xml`, ''].join('\n');
  return new Response(text, { headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
}
