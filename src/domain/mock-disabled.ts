import type { FinanceDataset } from '../types/domain';

/** Production builds resolve the demo import here so fictional records are not shipped. */
export function createMockDataset(): FinanceDataset {
  throw new Error('Demo data is unavailable in this deployment.');
}
