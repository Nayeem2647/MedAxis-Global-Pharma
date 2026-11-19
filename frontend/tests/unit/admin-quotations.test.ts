import { describe, expect, it } from "vitest";
import {
  quotationAction,
  quotationDate,
  quotationStatus,
  quotationTabHref,
} from "../../lib/admin-quotations";
import { quotationQuery } from "../../lib/admin-management";
import { adminProxyRule } from "../../lib/admin-contract";

describe("quotation directory and deadlines", () => {
  it("displays deadlines in Dhaka independent of the browser timezone", () => {
    expect(quotationDate("2026-11-19T20:30:00Z")).toBe("20 Nov 2026, 02:30 am");
    expect(quotationDate()).toBe("—");
    expect(quotationDate("invalid")).toBe("—");
  });
  it("switches work queues without retaining a contradictory status or old page", () => {
    const url = new URL(
      quotationTabHref(
        "/admin/quotations",
        {
          page: "8",
          status: "SENT",
          overall_status: "COMPLETED",
          worklist: "EXPIRING",
          q: "Buyer & company",
          rfq_id: "source",
          limit: "10",
        },
        { status: "DRAFT" },
      ),
      "http://localhost",
    );
    expect(Object.fromEntries(url.searchParams)).toEqual({
      q: "Buyer & company",
      rfq_id: "source",
      limit: "10",
      status: "DRAFT",
    });
    expect(quotationTabHref("/admin/quotations", {})).toBe("/admin/quotations");
  });
  it("uses readable statuses and status-specific next actions", () => {
    expect(quotationStatus("ACCEPTED")).toBe("Awaiting payment");
    expect(quotationAction("DRAFT")).toBe("Review draft");
    expect(quotationAction("PAYMENT_RECEIVED")).toBe("Arrange dispatch");
    expect(quotationAction("DELIVERED")).toBe("View quotation");
  });
  it("accepts only supported work queues at both read boundaries", () => {
    expect(quotationQuery.safeParse({ worklist: "EXPIRING" }).success).toBe(
      true,
    );
    expect(
      quotationQuery.safeParse({ worklist: "AUTOMATIC_EMAIL" }).success,
    ).toBe(false);
    expect(adminProxyRule("quotations", "GET")?.query).toContain("worklist");
  });
});
