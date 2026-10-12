import { describe, expect, it } from 'vitest';
import { createMockDataset } from '../src/domain/mock';
import { stableId } from '../src/domain/transfers';
import type { FinanceDataset, Transaction } from '../src/types/domain';
import type { FinancePlan } from '../src/types/planning';
import {
  advanceDueDate,
  billOccurrences,
  budgetProgress,
  buildPlanningInsights,
  detectRecurringBills,
  goalProgress,
  nextBillDate,
  visiblePlans,
} from '../src/domain/planning';

const base = createMockDataset();
const clinic = base.accounts[0];
const reserve = base.accounts[1];
const other = base.accounts[3];
const personal = base.accounts.find(
  (account) => base.entities.find((entity) => entity.id === account.entityId)?.kind === 'personal',
)!;
const expenseCategory = base.categories.find((category) => category.kind === 'expense')!;

function entry(
  id: string,
  date: string,
  amountCents: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: stableId('plan-entry', id),
    organisationId: base.organisation.id,
    accountId: clinic.id,
    providerTransactionId: id,
    postedAt: date,
    description: 'RENT',
    merchant: 'Practice rent',
    amountCents,
    currency: 'AUD',
    categoryId: expenseCategory.id,
    categorySource: 'rule',
    status: 'posted',
    transferPairId: null,
    receiptStatus: 'not_required',
    ...overrides,
  };
}
function data(transactions: Transaction[]): FinanceDataset {
  return { ...base, transactions };
}
function plan(overrides: Partial<FinancePlan> = {}): FinancePlan {
  return {
    id: stableId('plan', 'test'),
    organisationId: base.organisation.id,
    entityId: clinic.entityId,
    kind: 'budget',
    name: 'Practice spending',
    amountCents: 100_000,
    savedCents: 0,
    categoryId: expenseCategory.id,
    accountId: null,
    dueDate: null,
    frequency: null,
    ...overrides,
  };
}

describe('planning from the posted ledger', () => {
  it('uses month-to-date category outflows in the right entity and excludes pending and verified transfers', () => {
    const pair = stableId('pair', 'reserve');
    const dataset = data([
      entry('before', '2026-08-31', -5_000),
      entry('included', '2026-09-02', -12_000),
      entry('future', '2026-09-30', -5_000),
      entry('pending', '2026-09-03', -7_000, { status: 'pending' }),
      entry('other', '2026-09-02', -9_000, { accountId: other.id }),
      entry('refund', '2026-09-04', 1_000),
      entry('transfer-out', '2026-09-05', -20_000, { transferPairId: pair }),
      entry('transfer-in', '2026-09-05', 20_000, { transferPairId: pair, accountId: reserve.id }),
    ]);
    expect(budgetProgress(dataset, plan(), '2026-09-10')).toMatchObject({
      from: '2026-09-01',
      to: '2026-09-30',
      spentCents: 12_000,
      remainingCents: 88_000,
      percent: 12,
      transactionCount: 1,
    });
  });

  it('detects a regular expense with its account evidence without treating one-offs, pending or transfers as bills', () => {
    const pair = stableId('pair', 'recurring');
    const dataset = data([
      entry('rent-july', '2026-07-05', -150_000),
      entry('rent-august', '2026-08-05', -151_000),
      entry('rent-september', '2026-09-05', -150_000),
      entry('oneoff', '2026-09-01', -20_000, { merchant: 'Equipment repair' }),
      entry('pending', '2026-09-05', -150_000, { merchant: 'Other service', status: 'pending' }),
      entry('transfer-out', '2026-08-01', -10_000, {
        merchant: 'Reserve transfer',
        transferPairId: pair,
      }),
      entry('transfer-in', '2026-08-01', 10_000, { accountId: reserve.id, transferPairId: pair }),
      entry('transfer-next', '2026-09-01', -10_000, { merchant: 'Reserve transfer' }),
    ]);
    expect(detectRecurringBills(dataset, { entityId: clinic.entityId }, '2026-09-10')).toEqual([
      expect.objectContaining({
        name: 'Practice rent',
        amountCents: 150_000,
        frequency: 'monthly',
        nextDueDate: '2026-10-05',
        lastPaidDate: '2026-09-05',
        paymentCount: 3,
        accountId: clinic.id,
      }),
    ]);
  });

  it('keeps recurring merchants separate across accounts and respects entity selection', () => {
    const dataset = data([
      entry('a1', '2026-08-01', -10_000),
      entry('a2', '2026-09-01', -10_000),
      entry('b1', '2026-08-01', -20_000, { accountId: other.id }),
      entry('b2', '2026-09-01', -20_000, { accountId: other.id }),
    ]);
    expect(detectRecurringBills(dataset, {}, '2026-09-02')).toHaveLength(2);
    expect(detectRecurringBills(dataset, { entityId: other.entityId }, '2026-09-02')).toEqual([
      expect.objectContaining({ accountId: other.id, amountCents: 20_000 }),
    ]);
  });

  it('keeps a detected month-end schedule on its original day after February', () => {
    const dataset = data([
      entry('january', '2026-01-31', -10_000),
      entry('february', '2026-02-28', -10_000),
    ]);
    expect(detectRecurringBills(dataset, {}, '2026-03-01')[0].nextDueDate).toBe('2026-03-31');
  });

  it('rejects erratic amounts, stale payments and same-day duplicate merchant ambiguity', () => {
    const dataset = data([
      entry('e1', '2026-07-01', -100),
      entry('e2', '2026-08-01', -100_000),
      entry('e3', '2026-09-01', -500),
      entry('stale1', '2026-01-01', -1000, { merchant: 'Old subscription' }),
      entry('stale2', '2026-02-01', -1000, { merchant: 'Old subscription' }),
      entry('dupe1', '2026-08-01', -1000, { merchant: 'Shared merchant' }),
      entry('dupe2', '2026-08-01', -1000, { merchant: 'Shared merchant' }),
      entry('dupe3', '2026-09-01', -1000, { merchant: 'Shared merchant' }),
    ]);
    expect(detectRecurringBills(dataset, {}, '2026-09-10')).toEqual([]);
  });

  it('follows an eligible cash account balance for a goal and keeps manual savings distinct', () => {
    const dataset = {
      ...base,
      accounts: base.accounts.map((account) => ({
        ...account,
        balanceCents: account.id === reserve.id ? 75_000 : account.balanceCents,
      })),
    };
    expect(
      goalProgress(
        dataset,
        plan({
          kind: 'goal',
          categoryId: null,
          accountId: reserve.id,
          savedCents: 99_000,
          dueDate: '2026-10-10',
        }),
        '2026-09-10',
      ),
    ).toMatchObject({
      savedCents: 75_000,
      remainingCents: 25_000,
      source: 'account',
      daysLeft: 30,
      monthlyNeededCents: 25_000,
    });
    expect(
      goalProgress(dataset, plan({ kind: 'goal', savedCents: 120_000 }), '2026-09-10'),
    ).toMatchObject({ complete: true, percent: 100, source: 'manual' });
    expect(
      goalProgress(dataset, plan({ kind: 'goal', accountId: other.id }), '2026-09-10'),
    ).toMatchObject({ source: 'unavailable', savedCents: 0 });
  });

  it('does not expose plans from other organisations or personal scope in a business view', () => {
    const plans = [
      plan(),
      plan({ id: 'group', entityId: null }),
      plan({ id: 'personal', entityId: personal.entityId }),
      plan({ id: 'outside', organisationId: 'other' }),
    ];
    expect(visiblePlans(plans, base).map((row) => row.id)).toEqual([plan().id, 'group']);
    expect(visiblePlans(plans, base, { entityId: clinic.entityId }).map((row) => row.id)).toEqual([
      plan().id,
    ]);
    expect(visiblePlans(plans, base, { entityId: personal.entityId }).map((row) => row.id)).toEqual(
      ['personal'],
    );
  });
});

describe('calendar-aware scheduled payments', () => {
  it('preserves end-of-month anchors and leap days', () => {
    expect(advanceDueDate('2026-01-31', 'monthly')).toBe('2026-02-28');
    expect(nextBillDate('2026-01-31', 'monthly', '2026-03-01')).toBe('2026-03-31');
    expect(nextBillDate('2024-02-29', 'yearly', '2028-02-01')).toBe('2028-02-29');
    expect(nextBillDate('2026-01-31', 'quarterly', '2026-05-01')).toBe('2026-07-31');
  });

  it('counts every payment in a look-ahead window, including the current due date', () => {
    expect(billOccurrences('2026-09-01', 'weekly', '2026-09-01', '2026-09-15')).toEqual([
      '2026-09-01',
      '2026-09-08',
      '2026-09-15',
    ]);
    expect(nextBillDate('2026-09-10', 'monthly', '2026-09-10')).toBe('2026-09-10');
  });

  it('compares upcoming tracked bills with cash and quantifies category changes for equal elapsed days', () => {
    const dataset = {
      ...data([entry('last', '2026-08-02', -10_000), entry('current', '2026-09-02', -30_000)]),
      accounts: base.accounts.map((account) => ({
        ...account,
        balanceCents: account.id === clinic.id ? 5_000 : 0,
      })),
    };
    const insight = buildPlanningInsights(
      dataset,
      { entityId: clinic.entityId, to: '2026-09-10' },
      [plan({ kind: 'bill', amountCents: 10_000, dueDate: '2026-09-10', frequency: 'weekly' })],
    );
    expect(insight).toContainEqual(
      expect.objectContaining({ id: 'bill-cover', amountCents: 30_000, tone: 'attention' }),
    );
    expect(insight).toContainEqual(
      expect.objectContaining({
        id: `change-${expenseCategory.id}`,
        amountCents: 20_000,
        tone: 'attention',
      }),
    );
  });
});
