import { createHash, randomUUID } from "node:crypto";
import type { ServerResponse } from "node:http";
import { z } from "zod";
import {
  adminVersionFixture,
  quotationDetailFixture,
  rfqFixture,
  workflowIds,
} from "../admin-fixtures.ts";

type Message = {
  id: string;
  author: string;
  kind: string;
  body: string;
  version_number: number;
  created_at: string;
  scope?: string;
  proposed_delivery_charge?: string;
  proposed_medicine_subtotal?: string;
};
type Version = ReturnType<typeof adminVersionFixture> & {
  medicine_weight_g?: string;
  packed_weight_g?: string;
  payment_requested_at?: string;
  items: (ReturnType<typeof adminVersionFixture>["items"][number] & {
    weight_per_pack_g?: string;
    line_weight_g?: string;
  })[];
};
type ProductionState = {
  token: string;
  rfq: ReturnType<typeof rfqFixture> & {
    workflow: {
      enabled: boolean;
      reviewed_at?: string;
      pending_request_id?: string;
      offer_state?: string;
      messages: Message[];
    };
  };
  quote:
    | (Omit<ReturnType<typeof quotationDetailFixture>, "versions"> & {
        versions: Version[];
      })
    | null;
  writes: string[];
};
const states = new Map<string, ProductionState>();
const now = () => new Date().toISOString();
export function createProductionWorkflow(owner: string) {
  const rfq = rfqFixture();
  rfq.items = rfq.items.slice(0, 1);
  rfq.has_prescription = false;
  rfq.prescriptions = [];
  const value: ProductionState = {
    token: createHash("sha256").update(`rfq:${owner}`).digest("hex"),
    rfq: { ...rfq, workflow: { enabled: true, messages: [] } },
    quote: null,
    writes: [],
  };
  states.set(owner, value);
  return value;
}
export const productionWorkflowState = (owner: string) => states.get(owner);
const current = (state: ProductionState) =>
  state.quote?.versions.find(
    (version) => version.id === state.quote?.quotation.current_version_id,
  );
function status(state: ProductionState) {
  const version = current(state);
  if (version?.status === "DELIVERED") return "COMPLETED";
  if (version?.status === "DECLINED") return "DECLINED";
  if (version?.status === "DISPATCHED") return "DISPATCHED";
  if (version?.status === "PAYMENT_RECEIVED") return "PAID";
  if (version?.status === "ACCEPTED")
    return version.payment_requested_at ? "AWAITING_PAYMENT" : "APPROVED";
  if (version?.status === "SENT")
    return state.rfq.workflow.pending_request_id
      ? "CHANGE_REQUESTED"
      : (state.rfq.workflow.offer_state ?? "SENT");
  return state.rfq.workflow.reviewed_at ? "UNDER_REVIEW" : "SUBMITTED";
}
function reply(res: ServerResponse, data: unknown, total?: number) {
  res.end(
    JSON.stringify({
      success: true,
      data,
      meta: {
        timestamp: now(),
        request_id: randomUUID(),
        ...(total === undefined
          ? {}
          : {
              pagination: {
                page: 1,
                limit: 20,
                total_items: total,
                total_pages: total ? 1 : 0,
                has_next: false,
                has_prev: false,
              },
            }),
      },
    }),
  );
}
function conflict(res: ServerResponse) {
  res.writeHead(409);
  res.end(
    JSON.stringify({
      success: false,
      error: {
        status: 409,
        code: "QUOTATION_VERSION_CONFLICT",
        message: "Offer changed. Review the latest version.",
      },
      meta: { timestamp: now(), request_id: randomUUID() },
    }),
  );
}
function changed(state: ProductionState, streams: Set<ServerResponse>) {
  state.rfq.updated_at = now();
  const frame = `id: ${randomUUID()}\nevent: RFQ_CHANGED\ndata: ${JSON.stringify({ rfq_id: workflowIds.rfq, changed_at: now() })}\n\n`;
  for (const stream of streams) stream.write(frame);
}
function publicData(state: ProductionState) {
  const version = current(state);
  const commercial = (offer: Version) => ({
    ...offer,
    magic_link_token_hash: undefined,
    admin_password_hash: undefined,
  });
  return {
    rfq: {
      id: state.rfq._id,
      rfq_number: state.rfq.rfq_number,
      buyer_name: state.rfq.contact_snapshot.full_name,
      country: state.rfq.destination_country,
      received_at: state.rfq.created_at,
      items: state.rfq.items.map((line) => ({
        name: line.product_snapshot?.brand_name ?? line.custom_medicine_name,
        quantity: line.quantity,
        packaging_unit: line.packaging_unit,
      })),
    },
    workflow_status: status(state),
    quote: version && version.status !== "DRAFT" ? commercial(version) : null,
    history:
      state.quote?.versions
        .filter((version) => version.status !== "DRAFT")
        .map(commercial) ?? [],
    messages: state.rfq.workflow.messages,
    expires_at: "2030-01-01T00:00:00.000Z",
  };
}
export function handleProductionAdmin(
  owner: string,
  url: URL,
  method: string,
  input: unknown,
  res: ServerResponse,
  streams: Set<ServerResponse>,
): boolean {
  const state = states.get(owner);
  if (!state) return false;
  const path = url.pathname.slice("/v1/admin/".length);
  const base = `rfq-workflow/${workflowIds.rfq}`;
  const quoteBase = `quotations/${workflowIds.quote}`;
  if (path === "rfq-workflow") {
    const workflowStatus = status(state);
    const closed = ["COMPLETED", "DECLINED"].includes(workflowStatus);
    const history = url.searchParams.get("scope") === "HISTORY";
    const needle = url.searchParams.get("q")?.toLowerCase() ?? "";
    const queue = url.searchParams.get("queue") ?? "ALL";
    const groups: Record<string, string[]> = {
      REVIEW: ["SUBMITTED", "UNDER_REVIEW"],
      CUSTOMER: ["SENT", "COUNTEROFFER", "REVISED", "RETAINED"],
      NEGOTIATION: ["CHANGE_REQUESTED"],
      PAYMENT: ["APPROVED", "AWAITING_PAYMENT"],
      SHIPPING: ["PAID", "DISPATCHED"],
    };
    const matches =
      closed === history &&
      (!url.searchParams.get("country") ||
        url.searchParams.get("country") === state.rfq.destination_country) &&
      (!url.searchParams.get("status") ||
        url.searchParams.get("status") === workflowStatus) &&
      (!groups[queue] || groups[queue].includes(workflowStatus)) &&
      `${state.rfq.rfq_number} ${state.rfq.contact_snapshot.full_name} ${state.rfq.contact_snapshot.company_name}`
        .toLowerCase()
        .includes(needle);
    const rows = matches
      ? [
          {
            ...state.rfq,
            workflow_status: workflowStatus,
            attachments: state.rfq.prescriptions,
          },
        ]
      : [];
    reply(
      res,
      {
        rows,
        summary: {
          open_requests: Number(!closed),
          awaiting_customer: Number(
            ["SENT", "COUNTEROFFER", "REVISED", "RETAINED"].includes(
              workflowStatus,
            ),
          ),
          payment_followup: Number(
            ["APPROVED", "AWAITING_PAYMENT"].includes(workflowStatus),
          ),
          completed: Number(workflowStatus === "COMPLETED"),
        },
      },
      rows.length,
    );
    return true;
  }
  if (path === base && method === "GET") {
    reply(res, {
      rfq: state.rfq,
      quotation: state.quote,
      workflow_status: status(state),
      catalog_products: [
        {
          _id: workflowIds.rfq,
          manufacturer_id: workflowIds.manufacturer,
          strength: "80 mg",
          dosage_form: "Tablet",
          pack_size: "30 tablets",
          cold_chain_required: false,
        },
      ],
    });
    return true;
  }
  if (path === `rfqs/${workflowIds.rfq}` && method === "GET") {
    reply(res, state.rfq);
    return true;
  }
  if (path === quoteBase && method === "GET") {
    reply(res, state.quote);
    return true;
  }
  if (
    ![
      `${base}/review`,
      `${base}/respond`,
      `${base}/payment-request`,
      "quotations/draft",
      `${quoteBase}/draft`,
      `${quoteBase}/send`,
      `${quoteBase}/fulfillment`,
    ].includes(path)
  )
    return false;
  const body = z.record(z.string(), z.unknown()).parse(input);
  const version = current(state);
  if (body.expected_version_id && body.expected_version_id !== version?.id) {
    conflict(res);
    return true;
  }
  state.writes.push(path);
  if (path.endsWith("/review")) {
    const review = z
      .array(
        z.object({
          id: z.string(),
          availability: z.string(),
          note: z.string(),
        }),
      )
      .parse(body.items);
    state.rfq.workflow.reviewed_at = now();
    state.rfq.status = "UNDER_REVIEW";
    for (const line of state.rfq.items) {
      const reviewed = review.find((item) => item.id === line._id)!;
      line.item_availability_status = reviewed.availability;
      line.customer_facing_note = reviewed.note;
    }
    changed(state, streams);
    reply(res, { reviewed: true });
    return true;
  }
  if (path === "quotations/draft" || path.endsWith("/draft")) {
    const draft = quotationDetailFixture();
    const offer: Version = draft.versions[0]!;
    const prices = z
      .array(
        z.object({
          rfq_item_id: z.string(),
          selling_price: z.string(),
          weight_per_pack_g: z.string(),
        }),
      )
      .parse(body.items);
    offer.items = offer.items.slice(0, 1).map((line) => {
      const price = prices.find(
        (item) => item.rfq_item_id === line.rfq_item_id,
      )!;
      return {
        ...line,
        unit_quoted_price: price.selling_price,
        total_line_price: (Number(price.selling_price) * line.quantity).toFixed(
          2,
        ),
        weight_per_pack_g: price.weight_per_pack_g,
        line_weight_g: (
          Number(price.weight_per_pack_g) * line.quantity
        ).toFixed(2),
      };
    });
    offer.subtotal_amount = offer.items[0]!.total_line_price!;
    offer.freight_cost = String(body.freight_amount);
    offer.total_amount = (
      Number(offer.subtotal_amount) + Number(offer.freight_cost)
    ).toFixed(2);
    offer.medicine_weight_g = offer.items[0]!.line_weight_g;
    offer.packed_weight_g = String(body.packed_weight_g ?? "");
    state.quote = { ...draft, versions: [offer] };
    state.rfq.quotations = [{ ...draft.quotation, created_at: now() }];
    changed(state, streams);
    reply(res, { quotation_id: workflowIds.quote, version: offer });
    return true;
  }
  if (!version || !state.quote) {
    conflict(res);
    return true;
  }
  if (path.endsWith("/send")) {
    version.status = "SENT";
    version.issued_at = now();
    state.rfq.status = "QUOTED";
    changed(state, streams);
    reply(res, {
      version,
      magic_link_url: `https://medaxisglobalpharma.com/r/${state.token}`,
    });
    return true;
  }
  if (path.endsWith("/respond")) {
    if (body.mode !== "RETAINED") {
      const next = structuredClone(version);
      next.id = randomUUID();
      next.version_number += 1;
      next.freight_cost = String(body.delivery_charge);
      next.total_amount = (
        Number(next.subtotal_amount) + Number(next.freight_cost)
      ).toFixed(2);
      next.issued_at = now();
      version.status = "SUPERSEDED";
      state.quote.versions.push(next);
      state.quote.quotation.current_version_id = next.id;
      state.quote.quotation.current_version = next.version_number;
    }
    state.rfq.workflow.pending_request_id = undefined;
    state.rfq.workflow.offer_state =
      body.mode === "ACCEPT" ? "REVISED" : String(body.mode);
    state.rfq.workflow.messages.push({
      id: randomUUID(),
      author: "ADMIN",
      kind: state.rfq.workflow.offer_state,
      body: String(body.body),
      version_number: current(state)!.version_number,
      created_at: now(),
    });
  }
  if (path.endsWith("/payment-request")) version.payment_requested_at = now();
  if (path.endsWith("/fulfillment")) {
    version.status = String(body.status);
    if (body.status === "PAYMENT_RECEIVED") {
      version.reservation_status = "CONSUMED";
      version.payment = {
        reference: String(body.wire_reference),
        amount: String(body.amount),
        currency: String(body.currency),
        received_at: now(),
      };
    }
    if (body.status === "DISPATCHED")
      version.shipment = {
        courier_name: String(body.courier_name),
        awb_tracking_number: String(body.awb_tracking_number),
        dispatched_at: now(),
      };
    if (body.status === "DELIVERED") {
      version.delivered_at = now();
      state.quote.quotation.overall_status = "COMPLETED";
    }
  }
  version.updated_at = now();
  changed(state, streams);
  reply(res, { responded: true });
  return true;
}
export async function handleProductionGuest(
  url: URL,
  method: string,
  raw: string,
  res: ServerResponse,
  streamsFor: (owner: string) => Set<ServerResponse>,
): Promise<boolean> {
  const match =
    /^\/v1\/public\/rfq-workflow\/([a-f0-9]{64})(?:\/(negotiate|accept|decline))?$/.exec(
      url.pathname,
    );
  if (!match) return false;
  res.setHeader("Access-Control-Allow-Origin", "http://127.0.0.1:3100");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");
  res.setHeader("Cache-Control", "private, no-store");
  if (method === "OPTIONS") {
    res.writeHead(204);
    res.end();
    return true;
  }
  const entry = [...states.entries()].find(
    ([, state]) => state.token === match[1],
  );
  if (!entry) {
    res.writeHead(404);
    res.end("{}");
    return true;
  }
  const [owner, state] = entry;
  if (!match[2]) {
    reply(res, publicData(state));
    return true;
  }
  const body = z.record(z.string(), z.unknown()).parse(JSON.parse(raw));
  const version = current(state);
  if (
    !version ||
    body.expected_version_id !== version.id ||
    (match[2] === "accept" && state.rfq.workflow.pending_request_id)
  ) {
    conflict(res);
    return true;
  }
  if (match[2] === "negotiate") {
    const id = randomUUID();
    state.rfq.workflow.pending_request_id = id;
    state.rfq.workflow.messages.push({
      id,
      author: "BUYER",
      kind: "REQUEST",
      body: String(body.body),
      scope: String(body.scope),
      ...(body.proposed_delivery_charge
        ? { proposed_delivery_charge: String(body.proposed_delivery_charge) }
        : {}),
      version_number: version.version_number,
      created_at: now(),
    });
  }
  if (match[2] === "accept") {
    version.status = "ACCEPTED";
    version.reservation_status = "ACTIVE";
    version.accepted_at = now();
    version.reservation_expires_at = "2030-01-01T00:00:00.000Z";
    state.rfq.status = "CONVERTED";
  }
  if (match[2] === "decline") version.status = "DECLINED";
  state.writes.push(`guest/${match[2]}`);
  changed(state, streamsFor(owner));
  reply(res, {});
  return true;
}
