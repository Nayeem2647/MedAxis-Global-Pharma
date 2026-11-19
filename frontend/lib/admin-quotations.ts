export const quotationStatusLabels: Record<string, string> = {
  DRAFT: "Draft",
  SENT: "Sent to customer",
  ACCEPTED: "Awaiting payment",
  PAYMENT_RECEIVED: "Payment received",
  DISPATCHED: "Dispatched",
  DELIVERED: "Delivered",
  DECLINED: "Declined",
  VALIDITY_EXPIRED: "Quote expired",
  SUPERSEDED: "Superseded",
  PAYMENT_EXPIRED: "Payment window expired",
  ACTIVE: "Active",
  COMPLETED: "Completed",
  EXPIRED: "Expired",
};
export function quotationStatus(value: string) {
  return (
    quotationStatusLabels[value] ?? value.replaceAll("_", " ").toLowerCase()
  );
}
export function quotationDate(value?: string) {
  if (!value || !Number.isFinite(Date.parse(value))) return "—";
  return new Intl.DateTimeFormat("en-GB", {
    timeZone: "Asia/Dhaka",
    day: "2-digit",
    month: "short",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: true,
  }).format(new Date(value));
}
export const quotationWorklistLabels = {
  AWAITING_PAYMENT: "Awaiting payment",
  READY_TO_DISPATCH: "Ready to dispatch",
  EXPIRING: "Payment deadlines within 24h",
} as const;
export function quotationAction(status: string) {
  return (
    (
      {
        DRAFT: "Review draft",
        SENT: "View / revise",
        ACCEPTED: "Record payment",
        PAYMENT_RECEIVED: "Arrange dispatch",
        DISPATCHED: "Track delivery",
      } as Record<string, string>
    )[status] ?? "View quotation"
  );
}
export function quotationTabHref(
  path: string,
  query: Record<string, string>,
  filter: { status?: string; worklist?: string } = {},
) {
  const params = new URLSearchParams(query);
  for (const key of [
    "page",
    "status",
    "worklist",
    "overall_status",
    "reservation_before",
  ])
    params.delete(key);
  for (const [key, value] of Object.entries(filter))
    if (value) params.set(key, value);
  return `${path}${params.size ? `?${params}` : ""}`;
}
