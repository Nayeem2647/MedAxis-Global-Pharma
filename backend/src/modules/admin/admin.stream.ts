import { randomUUID } from 'node:crypto';
import type { Request, Response } from 'express';
import { AdminModel, AdminSessionModel } from '../auth/auth.schema.js';
import { rfqEvents } from '../rfq/rfq.events.js';
import { quotationEvents } from '../quotation/quotation.service.js';
import type { AppLogger } from '../../shared/utils/logger.js';

export const SSE_HEARTBEAT_MS = 25_000;
/** In-process fan-out for Release 1's single server. Payloads carry IDs/timestamps only. */
export function createAdminStream(logger: AppLogger) {
  const clients = new Set<() => void>();
  async function valid(req: Request) {
    const session = await AdminSessionModel.findOne({
      _id: req.admin!.sessionId,
      admin_id: req.admin!.id,
      purpose: 'ADMIN',
      revoked_at: null,
      expires_at: { $gt: new Date() },
    })
      .select({ session_generation: 1 })
      .lean();
    return (
      !!session &&
      !!(await AdminModel.exists({
        _id: req.admin!.id,
        is_active: true,
        session_generation: session.session_generation,
      }))
    );
  }
  function connect(req: Request, res: Response) {
    res.status(200).set({
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-store',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.flushHeaders();
    res.write('retry: 5000\n\n: connected\n\n');
    let closed = false;
    let checking = false;
    const close = () => {
      if (closed) return;
      closed = true;
      clearInterval(timer);
      rfqEvents.off('NEW_RFQ', onRfq);
      rfqEvents.off('CLARIFICATION_REPLY', onReply);
      quotationEvents.off('QUOTATION_ACCEPTED', onAccepted);
      clients.delete(close);
      req.off('close', close);
      res.off('close', close);
      res.end();
    };
    async function write(event: string, data: Record<string, unknown>) {
      if (closed) return;
      try {
        if (!(await valid(req))) return close();
        if (!closed && !res.write(`id: ${randomUUID()}\nevent: ${event}\ndata: ${JSON.stringify(data)}\n\n`)) close();
      } catch {
        logger.warn('Admin stream authorization check failed', { request_id: req.requestId });
        close();
      }
    }
    const text = (input: unknown, key: string) =>
      input && typeof input === 'object' && key in input && typeof (input as Record<string, unknown>)[key] === 'string'
        ? (input as Record<string, string>)[key]!.slice(0, 200)
        : undefined;
    const onRfq = (input: unknown) => {
      void write('NEW_RFQ', {
        rfq_id: text(input, 'rfq_id'),
        rfq_number: text(input, 'rfq_number'),
        created_at: text(input, 'created_at'),
      });
    };
    const onReply = (input: unknown) => {
      void write('CLARIFICATION_REPLY', { rfq_id: text(input, 'rfq_id'), received_at: text(input, 'received_at') });
    };
    const onAccepted = (input: unknown) => {
      void write('QUOTATION_ACCEPTED', {
        quotation_id: text(input, 'quotation_id'),
        version_id: text(input, 'version_id'),
        rfq_id: text(input, 'rfq_id'),
        accepted_at: text(input, 'accepted_at'),
      });
    };
    const timer = setInterval(() => {
      if (checking || closed) return;
      checking = true;
      void valid(req)
        .then((allowed) => {
          if (!allowed) close();
          else if (!closed && !res.write(': ping\n\n')) close();
        })
        .catch(() => close())
        .finally(() => {
          checking = false;
        });
    }, SSE_HEARTBEAT_MS);
    timer.unref();
    rfqEvents.on('NEW_RFQ', onRfq);
    rfqEvents.on('CLARIFICATION_REPLY', onReply);
    quotationEvents.on('QUOTATION_ACCEPTED', onAccepted);
    clients.add(close);
    req.on('close', close);
    res.on('close', close);
  }
  function close() {
    for (const end of clients) end();
  }
  return { connect, close };
}
export type AdminStream = ReturnType<typeof createAdminStream>;
