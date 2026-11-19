import { describe, expect, it, vi } from 'vitest';
import { createIndicationsTranslator } from '../src/modules/catalog/catalog.translation.js';
import { masterBodies } from '../src/modules/catalog/catalog.validator.js';

describe('generic paragraphs and server-side DeepL translation', () => {
  it('accepts long indication paragraphs, and bounds the total text', () => {
    const base = { translations: { en: { name: 'Osimertinib', slug: 'osimertinib' } }, is_active: true };
    expect(masterBodies.generics.parse({ ...base, therapeutic_indications: ['Verified indication. '.repeat(60)] }).therapeutic_indications?.[0]?.length).toBeGreaterThan(200);
    expect(masterBodies.generics.safeParse({ ...base, therapeutic_indications: ['a'.repeat(2501), 'b'.repeat(2500)] }).success).toBe(false);
    expect(masterBodies.generics.safeParse({ ...base, therapeutic_indications: ['a'.repeat(5001)] }).success).toBe(false);
  });
  it.each([['test-key:fx', 'https://api-free.deepl.com/v2/translate'], ['test-key', 'https://api.deepl.com/v2/translate']])('uses the correct fixed DeepL endpoint for %s', async (key, url) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ translations: [{ detected_source_language: 'EN', text: '这是简体中文说明。EGFR T790M。' }] }));
    const translate = createIndicationsTranslator({ DEEPL_API_KEY: key }, fetcher);
    const result = await translate({ text: 'Verified EGFR T790M indication.' });
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(fetcher.mock.calls[0]![0]).toBe(url);
    const options = fetcher.mock.calls[0]![1]!;
    expect(options.headers).toMatchObject({ Authorization: `DeepL-Auth-Key ${key}` });
    expect(JSON.parse(options.body as string)).toEqual({ text: ['Verified EGFR T790M indication.'], source_lang: 'EN', target_lang: 'ZH-HANS', preserve_formatting: true });
    expect(result).toMatchObject({ translated_text: '这是简体中文说明。EGFR T790M。', target_language: 'zh-CN' });
    expect(JSON.stringify(result)).not.toContain(key);
  });
  it('fails clearly without a configured key and never contacts a provider for invalid input', async () => {
    const fetcher = vi.fn<typeof fetch>();
    await expect(createIndicationsTranslator({}, fetcher)({ text: 'Medicine information' })).rejects.toMatchObject({ code: 'TRANSLATION_NOT_CONFIGURED', status: 503 });
    for (const input of [{ text: '' }, { text: 'x'.repeat(5001) }, { text: 'Hello', target_language: 'de' }])
      await expect(createIndicationsTranslator({ DEEPL_API_KEY: 'test-key' }, fetcher)(input)).rejects.toThrow();
    expect(fetcher).not.toHaveBeenCalled();
  });
  it.each([[403, 'TRANSLATION_UNAVAILABLE'], [456, 'TRANSLATION_QUOTA_EXCEEDED'], [429, 'RATE_LIMIT_EXCEEDED'], [500, 'TRANSLATION_UNAVAILABLE']])('does not replay provider status %s or expose its body', async (status, code) => {
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ message: 'PRIVATE_PROVIDER_DIAGNOSTIC' }, { status }));
    const promise = createIndicationsTranslator({ DEEPL_API_KEY: 'test-key' }, fetcher)({ text: 'Medicine information' });
    await expect(promise).rejects.toMatchObject({ code });
    await expect(promise).rejects.not.toThrow('PRIVATE_PROVIDER_DIAGNOSTIC');
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
  it('rejects non-Chinese or oversized translations and interrupted responses without retrying', async () => {
    for (const value of ['Untranslated English.', '中'.repeat(5001)]) {
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(Response.json({ translations: [{ text: value }] }));
      await expect(createIndicationsTranslator({ DEEPL_API_KEY: 'test-key' }, fetcher)({ text: 'Medicine information' })).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
      expect(fetcher).toHaveBeenCalledTimes(1);
    }
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(new Error('timeout with private diagnostic'));
    await expect(createIndicationsTranslator({ DEEPL_API_KEY: 'test-key' }, fetcher)({ text: 'Medicine information' })).rejects.toMatchObject({ code: 'TRANSLATION_UNAVAILABLE' });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
