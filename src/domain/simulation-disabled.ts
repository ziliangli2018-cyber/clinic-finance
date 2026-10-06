import type { FinanceDataset } from '../types/domain';

export interface DemoAdvanceResult {
  dataset: FinanceDataset;
  sequence: number;
  message: string;
}

/** Production builds replace the fictional activity generator with this fail-closed stub. */
export function advanceDemoDataset(
  _input: FinanceDataset,
  _sequence: number,
  _now: Date,
): DemoAdvanceResult {
  void _input;
  void _sequence;
  void _now;
  throw new Error('Demo simulation is unavailable in this deployment.');
}
