import type { Locale as SupportedLocale } from '../i18n/routing';
import type messages from '../messages/en.json';
import type customerMessages from '../messages/customer-en.json';

declare module 'next-intl' {
  interface AppConfig {
    Locale: SupportedLocale;
    Messages: typeof messages & { Customer: typeof customerMessages };
  }
}
