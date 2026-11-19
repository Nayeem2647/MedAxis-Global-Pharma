import { z } from 'zod';
import type { AppEnv } from '../../config/env.js';
import { AppError } from '../../shared/errors/AppError.js';

export const indicationsTranslationBody = z.strictObject({ text: z.string().trim().min(1).max(5000) });
const responseBody = z.object({ translations: z.array(z.object({ text: z.string().trim().min(1).max(5000) })).length(1) });

export function createIndicationsTranslator(env: Pick<AppEnv, 'DEEPL_API_KEY'>, fetcher: typeof fetch = fetch) {
  return async (raw: unknown) => {
    const { text } = indicationsTranslationBody.parse(raw);
    if (!env.DEEPL_API_KEY) throw new AppError({ status: 503, code: 'TRANSLATION_NOT_CONFIGURED', message: 'Automatic translation requires a server DeepL API key.' });
    const origin = env.DEEPL_API_KEY.endsWith(':fx') ? 'https://api-free.deepl.com' : 'https://api.deepl.com';
    try {
      // No automatic retries: each provider request can incur character charges.
      const result = await fetcher(`${origin}/v2/translate`, {
        method: 'POST', redirect: 'error', signal: AbortSignal.timeout(10_000),
        headers: { Authorization: `DeepL-Auth-Key ${env.DEEPL_API_KEY}`, 'Content-Type': 'application/json', Accept: 'application/json' },
        body: JSON.stringify({ text: [text], source_lang: 'EN', target_lang: 'ZH-HANS', preserve_formatting: true }),
      });
      if (result.status === 429) { void result.body?.cancel().catch(() => undefined); throw AppError.tooManyRequests(60); }
      if (result.status === 456) { void result.body?.cancel().catch(() => undefined); throw new AppError({ status: 503, code: 'TRANSLATION_QUOTA_EXCEEDED', message: 'The translation provider quota has been reached.' }); }
      if (!result.ok || !result.headers.get('content-type')?.includes('application/json')) {
        void result.body?.cancel().catch(() => undefined);
        throw new Error('Translation provider unavailable');
      }
      const translated = responseBody.parse(await result.json()).translations[0]!.text;
      if (!/\p{Script=Han}/u.test(translated)) throw new Error('Expected Chinese translation');
      return { translated_text: translated, source_language: 'en' as const, target_language: 'zh-CN' as const };
    } catch (error) {
      if (error instanceof AppError) throw error;
      // Do not expose provider error bodies, request text or credentials.
      throw new AppError({ status: 503, code: 'TRANSLATION_UNAVAILABLE', message: 'Chinese translation could not be completed. Enter it manually or try again.' });
    }
  };
}
