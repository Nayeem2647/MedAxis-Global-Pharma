import { afterAll, describe, expect, it, vi } from 'vitest';
import puppeteer, { type Page } from 'puppeteer';
import { getDocument } from 'pdfjs-dist/legacy/build/pdf.mjs';
import { createPdfService, loadEmbeddedFonts } from '../src/modules/pdf/pdf.service.js';
import { pdfFixture } from './fixtures/commercial.js';

const fontUsage: Array<{ familyName: string; isCustomFont: boolean; glyphCount: number }> = [];
let launchCount = 0;
let launchArgs: string[] = [];
async function recordRenderedFonts(page: Page) {
  const session = await page.createCDPSession();
  try {
    await session.send('DOM.enable');
    await session.send('CSS.enable');
    const { root } = await session.send('DOM.getDocument');
    for (const selector of ['h1', 'tbody strong']) {
      const { nodeId } = await session.send('DOM.querySelector', { nodeId: root.nodeId, selector });
      const { fonts } = await session.send('CSS.getPlatformFontsForNode', { nodeId });
      expect(fonts.length).toBeGreaterThan(0);
      fontUsage.push(...fonts);
    }
  } finally {
    await session.detach();
  }
}
const launch = vi.fn<typeof puppeteer.launch>(async (options) => {
  launchCount++;
  launchArgs = options?.args ?? [];
  const browser = await puppeteer.launch(options);
  const contextFor = browser.createBrowserContext.bind(browser);
  vi.spyOn(browser, 'createBrowserContext').mockImplementation(async (...args) => {
    const context = await contextFor(...args);
    const newPage = context.newPage.bind(context);
    vi.spyOn(context, 'newPage').mockImplementation(async (...pageArgs) => {
      const page = await newPage(...pageArgs);
      const print = page.pdf.bind(page);
      vi.spyOn(page, 'pdf').mockImplementation(async (...pdfArgs) => {
        const bytes = await print(...pdfArgs);
        await recordRenderedFonts(page);
        return bytes;
      });
      return page;
    });
    return context;
  });
  return browser;
});
const service = createPdfService({ launch });
afterAll(() => service.close());
async function extract(buffer: Buffer) {
  const task = getDocument({ data: new Uint8Array(buffer), useSystemFonts: false });
  const document = await task.promise;
  let text = '';
  try {
    for (let index = 1; index <= document.numPages; index++) {
      const page = await document.getPage(index);
      const content = await page.getTextContent();
      text += content.items.map((item) => ('str' in item ? item.str : '')).join(' ');
    }
  } finally {
    await task.destroy();
  }
  return text.replace(/\s/g, '');
}
describe('real Chromium PDF output', () => {
  it('embeds every local WOFF2 subset without external font URLs', async () => {
    const css = await loadEmbeddedFonts();
    expect(css).toContain('data:font/woff2;base64,');
    expect(css).not.toMatch(/url\(\.\/files|https?:/);
  });
  it.each(['en', 'zh-CN'] as const)(
    'renders %s original and accepted PDFs using local Noto glyphs with no internal cost values',
    async (locale) => {
      fontUsage.length = 0;
      const originalInput = pdfFixture();
      originalInput.version.contact.preferred_locale = locale;
      const privateFields = {
        procurement_cost_bdt: '981234567.89',
        markup_percent: '87.654321',
        internal_procurement_notes: 'SECRET-NOTES',
      };
      Object.assign(originalInput.version, privateFields);
      Object.assign(originalInput.version.items[0]!, privateFields);
      const original = await service.render(originalInput);
      expect(original.subarray(0, 5).toString()).toBe('%PDF-');
      expect(/NotoSansSC/.test(original.toString('latin1'))).toBe(true);
      const originalText = await extract(original);
      expect(originalText).toContain('MedAxisGlobalPharma');
      expect(originalText).toContain('测试药品');
      expect(originalText).toContain('中国测试银行');
      expect(originalText).toContain('6.35');
      expect(originalText).toContain(locale === 'en' ? 'QUOTATION' : '报价单');
      expect(originalText).not.toContain('ACCEPTED/PROFORMAINVOICE');
      const input = pdfFixture(true);
      input.version.contact.preferred_locale = locale;
      Object.assign(input.version, privateFields);
      Object.assign(input.version.items[0]!, privateFields);
      const accepted = await service.render(input);
      const acceptedText = await extract(accepted);
      expect(acceptedText).toContain('ACCEPTED/PROFORMAINVOICE');
      expect(acceptedText).toContain('123456789');
      expect(acceptedText).toContain('TESTBDDH');
      expect(acceptedText).toContain(locale === 'en' ? 'Acceptedat' : '接受时间');
      for (const text of [originalText, acceptedText]) {
        expect(text).not.toMatch(/SECRET-|procurement|markup|margin|981234567\.89|87\.654321|\u25a1|\ufffd/i);
      }
      expect(fontUsage.length).toBeGreaterThanOrEqual(4);
      for (const font of fontUsage) {
        expect(font.familyName).toMatch(/Noto Sans SC/);
        expect(font.isCustomFont).toBe(true);
        expect(font.glyphCount).toBeGreaterThan(0);
      }
      expect(launchCount).toBe(1);
      expect(launchArgs).toEqual(['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu']);
    },
  );
});
