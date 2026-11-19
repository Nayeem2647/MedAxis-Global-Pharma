import sanitizeHtml from 'sanitize-html';

export const cleanHtml = (value: string): string =>
  sanitizeHtml(value, {
    allowedTags: ['p', 'br', 'strong', 'em', 'h3', 'ul', 'ol', 'li', 'a'],
    allowedAttributes: { a: ['href', 'title'] },
    allowedSchemes: ['https', 'http'],
    allowProtocolRelative: false,
  });

export const escapeRegex = (value: string): string => value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

export function isSafeInternalPath(value: string): boolean {
  try {
    const decoded = decodeURIComponent(value);
    return (
      decoded.startsWith('/') &&
      !decoded.startsWith('//') &&
      !/[\\?#]/.test(decoded) &&
      ![...decoded].some((char) => char.codePointAt(0)! <= 32) &&
      !decoded.split('/').some((segment) => segment === '.' || segment === '..')
    );
  } catch {
    return false;
  }
}
