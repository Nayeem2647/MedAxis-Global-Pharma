import { z } from 'zod';
import { ApiError, parseApiResponse } from './api-client';

const schemas = {
  RFQ_CHANGED: z.object({ rfq_id: z.uuidv4(), changed_at: z.iso.datetime() }),
  QUOTATION_CHANGED: z.object({ quotation_id: z.uuidv4(), changed_at: z.iso.datetime() }),
  NEW_RFQ: z.object({ rfq_id: z.uuidv4(), rfq_number: z.string().regex(/^RFQ-[A-Za-z0-9-]+$/).max(100), created_at: z.iso.datetime() }),
  QUOTATION_ACCEPTED: z.object({ quotation_id: z.uuidv4(), version_id: z.uuidv4(), rfq_id: z.uuidv4(), accepted_at: z.iso.datetime() }),
  CLARIFICATION_REPLY: z.object({ rfq_id: z.uuidv4(), received_at: z.iso.datetime() }),
};
export type AdminStreamEvent = { [K in keyof typeof schemas]: { id: string; type: K; data: z.infer<typeof schemas[K]> } }[keyof typeof schemas];
export type StreamState = 'connecting' | 'connected' | 'reconnecting' | 'offline' | 'expired';

/** Incremental SSE parser, including split UTF-8/chunks, comments and multiple data lines. */
export class AdminSseParser {
  private pending = ''; private event = ''; private id = ''; private data: string[] = [];
  constructor(private readonly emit: (event: AdminStreamEvent) => void) {}
  push(chunk: string) {
    this.pending += chunk;
    if (this.pending.length > 65_536) throw new Error('Oversized stream frame.');
    for (;;) {
      const match = /\r\n|\r|\n/.exec(this.pending); if (!match || match[0] === '\r' && match.index === this.pending.length - 1) return;
      const line = this.pending.slice(0, match.index); this.pending = this.pending.slice(match.index + match[0].length);
      if (!line) { this.flush(); continue; }
      if (line.startsWith(':')) continue;
      const index = line.indexOf(':'); const key = index < 0 ? line : line.slice(0, index); const value = (index < 0 ? '' : line.slice(index + 1)).replace(/^ /, '');
      if (key === 'event') this.event = value;
      if (key === 'id') this.id = value;
      if (key === 'data') { this.data.push(value); if (this.data.join('\n').length > 32_768) throw new Error('Oversized stream event.'); }
      // Server retry:5000 is handled by our single bounded reconnect mechanism.
    }
  }
  private flush() {
    try {
      if (!z.uuidv4().safeParse(this.id).success) return;
      const input: unknown = JSON.parse(this.data.join('\n'));
      if (this.event === 'NEW_RFQ') { const value = schemas.NEW_RFQ.safeParse(input); if (value.success) this.emit({ id: this.id, type: this.event, data: value.data }); }
      else if (this.event === 'QUOTATION_ACCEPTED') { const value = schemas.QUOTATION_ACCEPTED.safeParse(input); if (value.success) this.emit({ id: this.id, type: this.event, data: value.data }); }
      else if (this.event === 'CLARIFICATION_REPLY') { const value = schemas.CLARIFICATION_REPLY.safeParse(input); if (value.success) this.emit({ id: this.id, type: this.event, data: value.data }); }
      else if (this.event === 'RFQ_CHANGED') { const value = schemas.RFQ_CHANGED.safeParse(input); if (value.success) this.emit({ id: this.id, type: this.event, data: value.data }); }
      else if (this.event === 'QUOTATION_CHANGED') { const value = schemas.QUOTATION_CHANGED.safeParse(input); if (value.success) this.emit({ id: this.id, type: this.event, data: value.data }); }
    } catch { /* Untrusted/malformed events never become notifications or logs. */ }
    finally { this.event = ''; this.id = ''; this.data = []; }
  }
}
export function adminReconnectDelay(attempt: number, random = Math.random()): number { return Math.min(30_000, 5000 * 2 ** Math.min(attempt, 3) + Math.max(0, Math.min(1, random)) * 1000); }
interface StreamCallbacks { event(event: AdminStreamEvent): void; state(state: StreamState): void; reconnect(): void; unauthorized(): void }
export class AdminStreamConnection {
  private stopped = true; private controller: AbortController | null = null; private retry: ReturnType<typeof setTimeout> | null = null;
  private watchdog: ReturnType<typeof setTimeout> | null = null; private attempt = 0; private connectedBefore = false; private seen = new Set<string>();
  constructor(private readonly callbacks: StreamCallbacks, private readonly fetcher: typeof fetch = (input, init) => fetch(input, init)) {}
  start() { if (!this.stopped) return; this.stopped = false; void this.connect(); }
  stop() { this.stopped = true; if (this.retry) clearTimeout(this.retry); if (this.watchdog) clearTimeout(this.watchdog); this.controller?.abort(); }
  private heartbeat(controller: AbortController) { if (this.watchdog) clearTimeout(this.watchdog); this.watchdog = setTimeout(() => controller.abort(), 40_000); }
  private async connect() {
    if (this.stopped) return;
    const controller = new AbortController(); this.controller = controller;
    this.callbacks.state(this.connectedBefore ? 'reconnecting' : 'connecting');
    this.heartbeat(controller);
    try {
      const response = await this.fetcher('/api/admin/stream', { headers: { Accept: 'text/event-stream' }, credentials: 'include', cache: 'no-store', referrerPolicy: 'no-referrer', redirect: 'error', signal: controller.signal });
      if (this.stopped) { void response.body?.cancel().catch(() => undefined); return; }
      if ([401, 403].includes(response.status)) { this.stopped = true; this.callbacks.state('expired'); this.callbacks.unauthorized(); return; }
      if (!response.ok || !/^text\/event-stream(?:;|$)/i.test(response.headers.get('content-type') ?? '') || !response.body) { await parseApiResponse(response, z.never()); throw new ApiError('Invalid stream.', { status: response.status, code: 'INVALID_API_RESPONSE' }); }
      if (this.connectedBefore) this.callbacks.reconnect();
      this.connectedBefore = true; this.callbacks.state('connected'); this.attempt = 0; this.heartbeat(controller);
      const parser = new AdminSseParser((event) => {
        if (this.seen.has(event.id)) return;
        this.seen.add(event.id); if (this.seen.size > 200) this.seen.delete(this.seen.values().next().value!);
        this.callbacks.event(event);
      });
      const reader = response.body.getReader(); const decoder = new TextDecoder();
      try { for (;;) { const result = await reader.read(); if (result.done || this.stopped) break; this.heartbeat(controller); parser.push(decoder.decode(result.value, { stream: true })); } }
      finally { try { await reader.cancel(); } catch { /* Aborted stream. */ } reader.releaseLock(); }
    } catch { if (!this.stopped) this.callbacks.state('offline'); }
    finally {
      controller.abort(); if (this.watchdog) clearTimeout(this.watchdog);
      if (!this.stopped) { this.callbacks.state('reconnecting'); this.retry = setTimeout(() => { void this.connect(); }, adminReconnectDelay(this.attempt++)); }
    }
  }
}
