/** Bangladesh has a fixed UTC+06:00 offset. Preserve local wall time, including month/year rollover. */
export function addCalendarDays(date: Date, days: number, zone: 'Asia/Dhaka' = 'Asia/Dhaka'): Date {
  if (zone !== 'Asia/Dhaka' || !Number.isSafeInteger(days) || !Number.isFinite(date.getTime()))
    throw new Error('Invalid calendar input');
  const local = new Date(date.getTime() + 6 * 3_600_000);
  local.setUTCDate(local.getUTCDate() + days);
  return new Date(local.getTime() - 6 * 3_600_000);
}
