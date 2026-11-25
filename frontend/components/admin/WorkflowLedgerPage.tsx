import { guardedAdminRead } from "../../lib/admin-server";
import { paginationSchema } from "../../lib/api-client";
import {
  ledgerData,
  ledgerFilters,
  ledgerQuery,
  type LedgerPage,
} from "../../lib/rfq-workflow";
import { AdminUnavailable, type AdminFeedbackValue } from "./AdminFeedback";
import { WorkflowLedger } from "./WorkflowLedger";
import { redirect } from "next/navigation";
export async function WorkflowLedgerPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  const raw = await searchParams;
  if (
    ["overall_status", "worklist", "rfq_id", "reservation_before"].some(
      (key) => raw[key],
    ) ||
    [
      "DRAFT",
      "ACCEPTED",
      "PAYMENT_RECEIVED",
      "DELIVERED",
      "VALIDITY_EXPIRED",
      "PAYMENT_EXPIRED",
    ].includes(String(raw.status ?? ""))
  ) {
    const query = new URLSearchParams();
    for (const [key, value] of Object.entries(raw))
      if (typeof value === "string") query.set(key, value);
    redirect(`/admin/quotations/documents?${query}`);
  }
  const parsed = ledgerFilters.safeParse(raw);
  if (!parsed.success) return <AdminUnavailable problem={{ status: 422 }} />;
  const filters = parsed.data;
  const results = await Promise.all(
    [false, true].map((history) =>
      guardedAdminRead(
        `/v1/admin/rfq-workflow?${ledgerQuery(filters, history)}`,
        ledgerData,
      ),
    ),
  );
  let problem: AdminFeedbackValue | undefined;
  const pages: (LedgerPage | null)[] = results.map((result) => {
    if (!result.ok) {
      problem = result.problem;
      return null;
    }
    try {
      return {
        ...result.result.data,
        pagination: paginationSchema.parse(result.result.meta.pagination),
      };
    } catch {
      problem = { status: 502 };
      return null;
    }
  });
  return (
    <WorkflowLedger
      filters={filters}
      initialActive={pages[0]}
      initialHistory={pages[1]}
      initialProblem={problem}
    />
  );
}
