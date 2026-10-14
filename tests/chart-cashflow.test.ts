import { expect, it } from 'vitest';
import { chartCashflow } from '../src/domain/chart-cashflow';
import { calculateSummary } from '../src/domain/analytics';
import { createMockDataset } from '../src/domain/mock';

it('charts more than ten years in bounded intervals without truncating ledger totals', () => {
  const data = createMockDataset();
  data.transactions = [
    { ...data.transactions[0], postedAt: '1999-01-01', amountCents: 12345, transferPairId: null },
    { ...data.transactions[1], postedAt: '2026-09-20', amountCents: -3456, transferPairId: null },
  ];
  const scope = { from: '1999-01-01', to: '2026-09-20' };
  const result = chartCashflow(data, scope);
  expect(result.points).toHaveLength(12);
  expect(result.grouping).toContain('intervals');
  const summary = calculateSummary(data, scope);
  expect(result.points.reduce((sum, row) => sum + row.incomeCents, 0)).toBe(summary.incomeCents);
  expect(result.points.reduce((sum, row) => sum + row.expenseCents, 0)).toBe(summary.expenseCents);
});
