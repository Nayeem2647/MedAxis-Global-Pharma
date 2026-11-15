import { readFile } from 'node:fs/promises';
import puppeteer, { type Browser, type BrowserContext } from 'puppeteer';
import { AppError } from '../../shared/errors/AppError.js';
import { renderQuotationHtml, type PdfInput } from './pdf.template.js';

export const PDF_TIMEOUT_MS = 15_000;
let embeddedFonts: Promise<string> | undefined;
export function loadEmbeddedFonts(): Promise<string> {
  embeddedFonts ??= (async () => {
    const root = new URL('../../../public/fonts/', import.meta.url);
    const css = await readFile(new URL('noto-sans-sc.css', root), 'utf8');
    const paths = [
      ...new Set([...css.matchAll(/url\(['"]?(\.\/files\/[\w-]+\.woff2)['"]?\)/g)].map((entry) => entry[1]!)),
    ];
    if (!paths.length) throw new Error('Self-hosted PDF fonts are missing');
    let result = css;
    for (const path of paths)
      result = result.replaceAll(
        path,
        `data:font/woff2;base64,${(await readFile(new URL(path, root))).toString('base64')}`,
      );
    return result;
  })();
  return embeddedFonts;
}
export interface PdfRenderer {
  render(input: PdfInput): Promise<Buffer>;
  close(): Promise<void>;
}
/** Reuses one Chromium process, with at most two isolated contexts and a bounded queue. */
export function createPdfService(
  options: { executablePath?: string; launch?: typeof puppeteer.launch } = {},
): PdfRenderer {
  let browser: Promise<Browser> | undefined;
  let liveBrowser: Browser | undefined;
  let active = 0;
  let stopped = false;
  const queue: Array<{ start: () => void; reject: () => void }> = [];
  async function acquire() {
    if (stopped) throw AppError.unavailable('PDF renderer is shutting down.');
    if (active < 2) {
      active++;
      return;
    }
    if (queue.length >= 20) throw AppError.unavailable('PDF renderer is busy.', 5);
    await new Promise<void>((resolve, reject) => {
      const entry = {
        start: () => {
          clearTimeout(timer);
          resolve();
        },
        reject: () => {
          clearTimeout(timer);
          reject(AppError.unavailable('PDF renderer is busy.', 5));
        },
      };
      const timer = setTimeout(() => {
        const index = queue.indexOf(entry);
        if (index >= 0) queue.splice(index, 1);
        entry.reject();
      }, PDF_TIMEOUT_MS);
      timer.unref();
      queue.push(entry);
    });
  }
  function release() {
    const next = queue.shift();
    if (next && !stopped) next.start();
    else active--;
  }
  function instance() {
    browser ??= (options.launch ?? puppeteer.launch)({
      headless: true,
      pipe: true,
      executablePath: options.executablePath,
      args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-gpu'],
      timeout: PDF_TIMEOUT_MS,
    })
      .then((value) => {
        liveBrowser = value;
        value.once('disconnected', () => {
          if (liveBrowser === value) {
            browser = undefined;
            liveBrowser = undefined;
          }
        });
        return value;
      })
      .catch((error: unknown) => {
        browser = undefined;
        throw error;
      });
    return browser;
  }
  async function cleanup(work: Promise<unknown>, current?: Browser) {
    let deadline: ReturnType<typeof setTimeout> | undefined;
    try {
      await Promise.race([
        work.catch(() => undefined),
        new Promise<void>((resolve) => {
          deadline = setTimeout(() => {
            try {
              current?.process()?.kill('SIGKILL');
            } catch {
              /* Already exited. */
            }
            if (liveBrowser === current) {
              browser = undefined;
              liveBrowser = undefined;
            }
            resolve();
          }, 1000);
          deadline.unref();
        }),
      ]);
    } finally {
      if (deadline) clearTimeout(deadline);
    }
  }
  async function render(input: PdfInput): Promise<Buffer> {
    if (
      input.mode === 'ORIGINAL_QUOTE'
        ? input.version.status !== 'SENT'
        : !input.version.accepted_at ||
          !['ACCEPTED', 'PAYMENT_RECEIVED', 'DISPATCHED', 'DELIVERED'].includes(input.version.status)
    )
      throw AppError.conflict('PDF mode does not match the quotation state.');
    const fonts = await loadEmbeddedFonts();
    await acquire();
    let context: BrowserContext | undefined;
    let currentBrowser: Browser | undefined;
    let timedOut = false;
    let timer: ReturnType<typeof setTimeout> | undefined;
    const task = (async () => {
      const current = await instance();
      currentBrowser = current;
      if (timedOut || stopped) throw new Error();
      context = await current.createBrowserContext();
      if (timedOut || stopped) {
        await cleanup(context.close(), current);
        throw new Error();
      }
      const page = await context.newPage();
      await page.setJavaScriptEnabled(false);
      await page.setRequestInterception(true);
      page.on('request', (request) => {
        void (
          request.url().startsWith('data:') || request.url() === 'about:blank' ? request.continue() : request.abort()
        ).catch(() => undefined);
      });
      page.setDefaultTimeout(PDF_TIMEOUT_MS);
      await page.setContent(renderQuotationHtml(input, fonts), { waitUntil: 'load', timeout: PDF_TIMEOUT_MS });
      return Buffer.from(
        await page.pdf({
          format: 'A4',
          printBackground: true,
          preferCSSPageSize: true,
          waitForFonts: true,
          timeout: PDF_TIMEOUT_MS,
        }),
      );
    })();
    try {
      return await Promise.race([
        task,
        new Promise<never>((_, reject) => {
          timer = setTimeout(() => {
            timedOut = true;
            reject(new Error());
          }, PDF_TIMEOUT_MS);
          timer.unref();
        }),
      ]);
    } catch {
      throw AppError.unavailable('PDF rendering failed. Please try again.', 5);
    } finally {
      if (timer) clearTimeout(timer);
      if (context) await cleanup(context.close(), currentBrowser);
      else if (timedOut && currentBrowser) await cleanup(currentBrowser.close(), currentBrowser);
      release();
    }
  }
  async function close() {
    stopped = true;
    for (const entry of queue.splice(0)) entry.reject();
    const current = browser;
    browser = undefined;
    await current?.then((value) => cleanup(value.close(), value)).catch(() => undefined);
  }
  return { render, close };
}
