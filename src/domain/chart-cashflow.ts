import type { FinanceDataset, FinanceScope } from '../types/domain';
import { calculateDailyCashflow, calculateSummary } from './analytics';
import { dateValue, shiftDate } from './dates';

/** Bounded chart points, while summary/ledger filters retain the entire history. */
export function chartCashflow(data: FinanceDataset, scope: FinanceScope) {
  const from = scope.from;
  const to = scope.to;
  const span = from && to ? Math.round((dateValue(to) - dateValue(from)) / 86_400_000) + 1 : 0;
  if (!from || !to || span <= 3661)
    return { points: calculateDailyCashflow(data, scope), grouping: '' };
  const interval = Math.ceil(span / 12);
  const points = [];
  for (let offset = 0; offset < span; offset += interval) {
    const start = shiftDate(from, offset);
    const end = shiftDate(from, Math.min(span - 1, offset + interval - 1));
    const summary = calculateSummary(data, { ...scope, from: start, to: end });
    points.push({
      date: start,
      incomeCents: summary.incomeCents,
      expenseCents: summary.expenseCents,
      netCashflowCents: summary.netCashflowCents,
    });
  }
  return {
    points,
    grouping: `Statement history grouped into intervals of up to ${interval} days.`,
  };
}
