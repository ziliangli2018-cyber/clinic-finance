const DAY_MS = 86_400_000;

/** Parse a date-only ledger value without local-time or daylight-saving shifts. */
export function dateValue(value: string): number {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return Number.NaN;
  const parsed = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isFinite(parsed) && new Date(parsed).toISOString().slice(0, 10) === value
    ? parsed
    : Number.NaN;
}

export function shiftDate(value: string, days: number): string {
  const parsed = dateValue(value);
  if (!Number.isFinite(parsed) || !Number.isInteger(days)) throw new Error('A valid ledger date and whole day offset are required.');
  return new Date(parsed + days * DAY_MS).toISOString().slice(0, 10);
}

export function daysBetween(a: string, b: string): number {
  return Math.abs(dateValue(a) - dateValue(b)) / DAY_MS;
}
