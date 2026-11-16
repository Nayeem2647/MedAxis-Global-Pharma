import type { Page } from '@playwright/test';
import { deflateSync } from 'node:zlib';

function pngChunk(type: string, data: Buffer): Buffer {
  const label = Buffer.from(type);
  let crc = 0xffffffff;
  for (const byte of Buffer.concat([label, data])) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE((crc ^ 0xffffffff) >>> 0);
  return Buffer.concat([length, label, data, checksum]);
}

function fixturePng(): Buffer {
  const width = 640; const height = 480;
  const header = Buffer.alloc(13); header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4); header[8] = 8; header[9] = 6;
  const pixels = Buffer.alloc((width * 4 + 1) * height, 255);
  for (let row = 0; row < height; row++) pixels[row * (width * 4 + 1)] = 0;
  return Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), pngChunk('IHDR', header), pngChunk('IDAT', deflateSync(pixels)), pngChunk('IEND', Buffer.alloc(0))]);
}

const image = fixturePng();

// A deterministic PNG transport fixture. No live asset host is contacted.
export async function installImageFixture(page: Page) {
  await page.route('**/_next/image?**', (route) => route.fulfill({ contentType: 'image/png', body: image }));
  // Test-only challenge transport. Production code always uses the configured
  // Cloudflare site key and server verification; no live challenge is bypassed.
  await page.route('https://challenges.cloudflare.com/turnstile/v0/api.js*', (route) => route.fulfill({ contentType: 'application/javascript', body: `
    let sequence = 0;
    const widgets = new Map();
    window.turnstile = {
      ready(callback) { callback(); },
      render(container, options) {
        const id = 'fixture-' + (++sequence);
        const button = document.createElement('button');
        button.type = 'button'; button.textContent = 'Security test fixture';
        button.style.cssText = 'min-height:44px;width:150px;max-width:100%';
        const entry = { container, options, token: 'fixture-token-' + sequence };
        widgets.set(id, entry); container.appendChild(button);
        button.onclick = () => options.callback(entry.token);
        setTimeout(() => { if (widgets.has(id)) options.callback(entry.token); }, 0);
        return id;
      },
      remove(id) { const entry = widgets.get(id); if (entry) entry.container.replaceChildren(); widgets.delete(id); },
      reset(id) { const entry = widgets.get(id); if (entry) entry.options.callback(entry.token); },
      getResponse(id) { return widgets.get(id)?.token; },
      isExpired() { return false; }
    };
    const callback = new URL(document.currentScript.src).searchParams.get('onload');
    if (callback && window[callback]) window[callback]();
  ` }));
}
