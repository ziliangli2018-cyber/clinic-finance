import type { FinanceDataset, FinanceScope, Transaction } from '../types/domain.ts';
import { filterAccounts } from './analytics.ts';
import { dateValue, shiftDate } from './dates.ts';
import { verifiedTransferIds } from './transfers.ts';

const DAY_MS = 86_400_000;
const MAX_HISTORY_DAYS = 180;
const DISCLAIMER =
  'Indicative cash-flow projection only; it is not financial, accounting, or tax advice.';

export type ForecastHorizonDays = 30 | 60 | 90;

export interface CashflowForecastPoint {
  date: string;
  expectedCents: number;
  lowCents: number;
  highCents: number;
}

export interface CashflowForecast {
  asOfDate: string;
  horizonDays: ForecastHorizonDays;
  historyDays: number;
  openingBalanceCents: number;
  closingBalanceCents: number;
  lowClosingBalanceCents: number;
  highClosingBalanceCents: number;
  dailyDiscretionaryOutflowCents: number;
  recurringSeriesCount: number;
  /** One point per future day; the opening balance is reported separately. */
  points: CashflowForecastPoint[];
  assumptions: string[];
  disclaimer: string;
}

interface HistoryTransaction {
  transaction: Transaction;
  amountCents: number;
}

interface RecurringSeries {
  intervalDays: 7 | 14 | 30;
  amountCents: number;
  lastDate: string;
  transactionIds: string[];
}

function validateScope(scope: FinanceScope): void {
  for (const date of [scope.from, scope.to]) {
    if (date !== undefined && !Number.isFinite(dateValue(date)))
      throw new Error('Date filters must be valid YYYY-MM-DD dates.');
  }
  if (scope.from && scope.to && scope.from > scope.to)
    throw new Error('The start date must not follow the end date.');
}

function validateHorizon(horizonDays: number): asserts horizonDays is ForecastHorizonDays {
  if (horizonDays !== 30 && horizonDays !== 60 && horizonDays !== 90)
    throw new Error('Forecast horizon must be 30, 60, or 90 days.');
}

function cents(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(Number.MIN_SAFE_INTEGER, Math.min(Number.MAX_SAFE_INTEGER, Math.round(value)));
}

function addCents(left: number, right: number): number {
  return cents(left + right);
}

function sumCents(values: readonly number[]): number {
  return values.reduce((total, value) => addCents(total, cents(value)), 0);
}

function daysFrom(from: string, to: string): number {
  return Math.round((dateValue(to) - dateValue(from)) / DAY_MS);
}

function accountDate(updatedAt: string): string | undefined {
  const candidate = updatedAt.slice(0, 10);
  return Number.isFinite(dateValue(candidate)) ? candidate : undefined;
}

function latestDate(values: readonly (string | undefined)[]): string | undefined {
  return values
    .filter((value): value is string => value !== undefined)
    .sort()
    .at(-1);
}

function normaliseCounterparty(transaction: Transaction): string {
  return (transaction.merchant || transaction.description)
    .trim()
    .toUpperCase()
    .replace(/\d+/g, '#')
    .replace(/\s+/g, ' ');
}

function median(values: readonly number[]): number {
  if (!values.length) return 0;
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function inferInterval(dates: readonly string[]): 7 | 14 | 30 | undefined {
  if (dates.length < 2) return undefined;
  const gaps = dates.slice(1).map((date, index) => daysFrom(dates[index], date));
  const candidates = [
    { interval: 7 as const, tolerance: 2, minimumDates: 3 },
    { interval: 14 as const, tolerance: 3, minimumDates: 3 },
    { interval: 30 as const, tolerance: 5, minimumDates: 2 },
  ];
  return candidates
    .filter(({ interval, tolerance, minimumDates }) => {
      if (dates.length < minimumDates || Math.abs(median(gaps) - interval) > tolerance)
        return false;
      const matching = gaps.filter((gap) => Math.abs(gap - interval) <= tolerance).length;
      return matching / gaps.length >= 0.75;
    })
    .sort(
      (left, right) =>
        Math.abs(median(gaps) - left.interval) - Math.abs(median(gaps) - right.interval) ||
        left.interval - right.interval,
    )[0]?.interval;
}

function inferRecurringSeries(
  history: readonly HistoryTransaction[],
  asOfDate: string,
): RecurringSeries[] {
  const grouped = new Map<string, HistoryTransaction[]>();
  for (const row of history) {
    if (row.amountCents === 0) continue;
    const sign = row.amountCents > 0 ? 'in' : 'out';
    const key = `${row.transaction.accountId}\u0000${sign}\u0000${normaliseCounterparty(row.transaction)}`;
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }

  const series: RecurringSeries[] = [];
  for (const key of [...grouped.keys()].sort()) {
    const rows = grouped.get(key)!;
    const daily = new Map<string, { amountCents: number; transactionIds: string[] }>();
    for (const row of rows.sort(
      (left, right) =>
        left.transaction.postedAt.localeCompare(right.transaction.postedAt) ||
        left.transaction.id.localeCompare(right.transaction.id),
    )) {
      const date = row.transaction.postedAt;
      const aggregate = daily.get(date) ?? { amountCents: 0, transactionIds: [] };
      aggregate.amountCents = addCents(aggregate.amountCents, row.amountCents);
      aggregate.transactionIds.push(row.transaction.id);
      daily.set(date, aggregate);
    }
    const dates = [...daily.keys()].sort();
    const intervalDays = inferInterval(dates);
    const lastDate = dates.at(-1);
    if (!intervalDays || !lastDate || daysFrom(lastDate, asOfDate) > intervalDays * 2) continue;
    const amountCents = cents(median(dates.map((date) => daily.get(date)!.amountCents)));
    if (amountCents === 0) continue;
    series.push({
      intervalDays,
      amountCents,
      lastDate,
      transactionIds: dates.flatMap((date) => daily.get(date)!.transactionIds),
    });
  }
  return series;
}

function scenarioRecurring(amountCents: number, scenario: 'low' | 'high'): number {
  if (scenario === 'low') return cents(amountCents * (amountCents > 0 ? 0.9 : 1.1));
  return cents(amountCents * (amountCents > 0 ? 1.1 : 0.9));
}

function aud(centsValue: number): string {
  const value = Math.abs(cents(centsValue));
  return `A$${Math.floor(value / 100).toLocaleString('en-AU')}.${String(value % 100).padStart(2, '0')}`;
}

/**
 * Builds a deterministic cash-balance projection from recent observed movements.
 * It deliberately forecasts cash accounts rather than an accounting profit or
 * credit-card liability position.
 */
export function buildCashflowForecast(
  data: FinanceDataset,
  scope: FinanceScope = {},
  horizonDays: number = 30,
): CashflowForecast {
  validateScope(scope);
  validateHorizon(horizonDays);

  const cashAccounts = filterAccounts(data, scope)
    .filter((account) => account.kind !== 'credit_card')
    .sort((left, right) => left.id.localeCompare(right.id));
  const cashAccountIds = new Set(cashAccounts.map((account) => account.id));
  const transferIds = verifiedTransferIds(data.transactions, data.accounts);
  const eligible = data.transactions
    .filter(
      (transaction) =>
        transaction.organisationId === data.organisation.id &&
        cashAccountIds.has(transaction.accountId) &&
        transaction.status === 'posted' &&
        !transferIds.has(transaction.id) &&
        Number.isFinite(dateValue(transaction.postedAt)) &&
        Number.isSafeInteger(transaction.amountCents),
    )
    .sort(
      (left, right) =>
        left.postedAt.localeCompare(right.postedAt) || left.id.localeCompare(right.id),
    );

  const asOfDate =
    scope.to ??
    latestDate([
      ...eligible.map((transaction) => transaction.postedAt),
      ...cashAccounts.map((account) => accountDate(account.updatedAt)),
      scope.from,
    ]) ??
    '1970-01-01';
  const defaultHistoryStart = shiftDate(asOfDate, -(MAX_HISTORY_DAYS - 1));
  const historyStart =
    scope.from && scope.from > defaultHistoryStart ? scope.from : defaultHistoryStart;
  const history: HistoryTransaction[] = eligible
    .filter(
      (transaction) => transaction.postedAt >= historyStart && transaction.postedAt <= asOfDate,
    )
    .map((transaction) => ({ transaction, amountCents: transaction.amountCents }));
  const firstHistoryDate = history[0]?.transaction.postedAt;
  const historyDays = firstHistoryDate ? Math.max(1, daysFrom(firstHistoryDate, asOfDate) + 1) : 0;
  const recurringSeries = inferRecurringSeries(history, asOfDate);
  const recurringIds = new Set(recurringSeries.flatMap((series) => series.transactionIds));
  const discretionaryOutflowCents = sumCents(
    history
      .filter((row) => row.amountCents < 0 && !recurringIds.has(row.transaction.id))
      .map((row) => -row.amountCents),
  );
  const dailyDiscretionaryOutflowCents = historyDays
    ? cents(discretionaryOutflowCents / historyDays)
    : 0;
  const openingBalanceCents = sumCents(cashAccounts.map((account) => account.balanceCents));
  const recurringByDate = new Map<string, number[]>();
  const forecastEnd = shiftDate(asOfDate, horizonDays);

  for (const series of recurringSeries) {
    let nextDate = shiftDate(series.lastDate, series.intervalDays);
    while (nextDate <= asOfDate) nextDate = shiftDate(nextDate, series.intervalDays);
    while (nextDate <= forecastEnd) {
      const values = recurringByDate.get(nextDate) ?? [];
      values.push(series.amountCents);
      recurringByDate.set(nextDate, values);
      nextDate = shiftDate(nextDate, series.intervalDays);
    }
  }

  const points: CashflowForecastPoint[] = [];
  let expectedCents = openingBalanceCents;
  let lowCents = openingBalanceCents;
  let highCents = openingBalanceCents;
  for (let day = 1; day <= horizonDays; day += 1) {
    const date = shiftDate(asOfDate, day);
    const recurring = (recurringByDate.get(date) ?? []).sort((a, b) => a - b);
    const expectedDelta = addCents(sumCents(recurring), -dailyDiscretionaryOutflowCents);
    const lowDelta = addCents(
      sumCents(recurring.map((amount) => scenarioRecurring(amount, 'low'))),
      -cents(dailyDiscretionaryOutflowCents * 1.2),
    );
    const highDelta = addCents(
      sumCents(recurring.map((amount) => scenarioRecurring(amount, 'high'))),
      -cents(dailyDiscretionaryOutflowCents * 0.8),
    );
    expectedCents = addCents(expectedCents, expectedDelta);
    lowCents = Math.min(addCents(lowCents, lowDelta), expectedCents);
    highCents = Math.max(addCents(highCents, highDelta), expectedCents);
    points.push({ date, expectedCents, lowCents, highCents });
  }

  const closing = points.at(-1)!;
  const assumptions = [
    `Opening cash includes ${cashAccounts.length} scoped non-credit-card account${cashAccounts.length === 1 ? '' : 's'}; credit-card liabilities are excluded.`,
    historyDays
      ? `Uses ${history.length} posted, non-transfer cash transaction${history.length === 1 ? '' : 's'} over ${historyDays} observed day${historyDays === 1 ? '' : 's'} (up to the latest 180 days); pending transactions and internal transfers are excluded.`
      : 'No usable posted cash history was available, so no future income or spending was invented.',
    `${recurringSeries.length} weekly, fortnightly, or approximately monthly recurring series ${recurringSeries.length === 1 ? 'was' : 'were'} inferred from repeated counterparties.`,
    `Non-recurring outflows continue at their observed average of ${aud(dailyDiscretionaryOutflowCents)} per day.`,
    'The low/high range varies recurring movements by 10% and discretionary outflows by 20%; it does not model every possible event.',
    DISCLAIMER,
  ];

  return {
    asOfDate,
    horizonDays,
    historyDays,
    openingBalanceCents,
    closingBalanceCents: closing.expectedCents,
    lowClosingBalanceCents: closing.lowCents,
    highClosingBalanceCents: closing.highCents,
    dailyDiscretionaryOutflowCents,
    recurringSeriesCount: recurringSeries.length,
    points,
    assumptions,
    disclaimer: DISCLAIMER,
  };
}
