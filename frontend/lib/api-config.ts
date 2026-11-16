export function getApiBaseUrl(): URL {
  const value = typeof window === 'undefined' && process.env.API_INTERNAL_BASE_URL
    ? process.env.API_INTERNAL_BASE_URL
    : process.env.NEXT_PUBLIC_API_BASE_URL;
  if (!value) throw new Error('NEXT_PUBLIC_API_BASE_URL is required (or API_INTERNAL_BASE_URL on the server).');
  const url = new URL(value);
  if (!['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash || url.pathname !== '/') {
    throw new Error('The API base URL must be an HTTP(S) origin without credentials, path, query, or fragment.');
  }
  return url;
}

export function apiUrl(path: string): URL {
  if (!/^\/v1\/(public|admin)\//.test(path) || /[\\\r\n#]/.test(path)) {
    throw new Error('API paths must start with /v1/public/ or /v1/admin/.');
  }
  const adminBrowser = typeof window !== 'undefined' && path.startsWith('/v1/admin/');
  const url = new URL(path, adminBrowser ? window.location.origin : getApiBaseUrl());
  if (!/^\/v1\/(public|admin)\//.test(url.pathname) || path.split('?')[0] !== url.pathname) {
    throw new Error('API paths must be normalized versioned paths without traversal.');
  }
  if (adminBrowser) url.pathname = `/api/admin/${url.pathname.slice('/v1/admin/'.length)}`;
  return url;
}
