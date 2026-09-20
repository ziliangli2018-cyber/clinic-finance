import { describe, expect, it } from 'vitest';
import type { FinanceDataset, Transaction } from '../src/types/domain.ts';
import {
  calculateCategoryBreakdown,
  calculateDailyCashflow,
  calculateMonthlyCashflow,
  calculateSummary,
  filterTransactions,
} from '../src/domain/analytics.ts';
import { categoriseTransaction } from '../src/domain/categories.ts';
import { shiftDate } from '../src/domain/dates.ts';
import { createMockDataset, MOCK_AS_OF } from '../src/domain/mock.ts';
import { BasiqFinancialProvider, MockFinancialProvider } from '../src/domain/providers.ts';
import { detectInternalTransfers, stableId } from '../src/domain/transfers.ts';

const base = createMockDataset();
const clinicA = base.accounts[0];
const reserveA = base.accounts[1];
const clinicB = base.accounts[3];
const personal = base.accounts[6];

function entry(id: string, amountCents: number, overrides: Partial<Transaction> = {}): Transaction {
  return {
    id: stableId('test', id),
    organisationId: base.organisation.id,
    accountId: clinicA.id,
    providerTransactionId: id,
    postedAt: '2026-09-10',
    description: 'EFT PAYMENT',
    merchant: null,
    amountCents,
    currency: 'AUD',
    categoryId: null,
    categorySource: 'uncategorised',
    status: 'posted',
    transferPairId: null,
    receiptStatus: 'not_required',
    ...overrides,
  };
}

function dataset(transactions: Transaction[]): FinanceDataset {
  return {
    ...base,
    accounts: base.accounts.map((account) => ({
      ...account,
      balanceCents: account.id === clinicA.id ? 100_000 : 0,
    })),
    transactions,
  };
}

function transferLegs(): Transaction[] {
  return [
    entry('from', -20_000, { description: 'INTERNAL TRANSFER TO OWN ACCOUNT' }),
    entry('to', 20_000, {
      description: 'INTERNAL TRANSFER FROM OWN ACCOUNT',
      accountId: reserveA.id,
    }),
  ];
}

describe('deterministic fictitious ledger', () => {
  it('covers exactly 90 days with 8 accounts, 2 clinics and personal, using consistent UUID relationships', () => {
    expect(createMockDataset()).toEqual(base);
    expect(base.accounts).toHaveLength(8);
    expect(base.entities.filter((entity) => entity.kind === 'clinic')).toHaveLength(2);
    expect(base.entities.filter((entity) => entity.kind === 'personal')).toHaveLength(1);
    expect(
      base.accounts
        .filter((account) => account.entityId === personal.entityId)
        .map((account) => account.kind),
    ).toEqual(['transaction', 'credit_card']);
    for (const description of ['LOAN REPAYMENT', 'GST RESERVE', 'ATO TAX GST PAYMENT'])
      expect(
        base.transactions.some((transaction) => transaction.description.includes(description)),
      ).toBe(true);
    const dates = base.transactions.map((transaction) => transaction.postedAt).sort();
    expect(dates[0]).toBe(shiftDate(MOCK_AS_OF, -89));
    expect(dates.at(-1)).toBe(MOCK_AS_OF);
    expect(base.transactions.length).toBeGreaterThan(400);
    const uuid = /^[a-f0-9]{8}-[a-f0-9]{4}-4[a-f0-9]{3}-a[a-f0-9]{3}-[a-f0-9]{12}$/;
    for (const row of [
      base.organisation,
      ...base.entities,
      ...base.connections,
      ...base.accounts,
      ...base.categories,
      ...base.transactions,
    ])
      expect(row.id).toMatch(uuid);
    expect(new Set(base.transactions.map((transaction) => transaction.id)).size).toBe(
      base.transactions.length,
    );
    for (const transaction of base.transactions) {
      expect(Number.isSafeInteger(transaction.amountCents)).toBe(true);
      expect(base.accounts.some((account) => account.id === transaction.accountId)).toBe(true);
      expect(
        transaction.categoryId === null ||
          base.categories.some((category) => category.id === transaction.categoryId),
      ).toBe(true);
    }
    for (const account of base.accounts) {
      const connection = base.connections.find(
        (candidate) => candidate.id === account.connectionId,
      )!;
      expect(connection.entityId).toBe(account.entityId);
      expect(connection.organisationId).toBe(account.organisationId);
    }
  });

  it('returns independent data so demo edits cannot pollute a later reset', () => {
    const copy = createMockDataset();
    copy.accounts[0].balanceCents = -1;
    copy.transactions[0].categoryId = null;
    expect(createMockDataset()).toEqual(base);
  });
});

describe('conservative internal transfer matching', () => {
  it('matches uniquely reciprocal owned entries across a weekend and is order-independent', () => {
    const legs = transferLegs();
    legs[1].postedAt = '2026-09-13';
    const result = detectInternalTransfers(legs, base.accounts);
    expect(result[0].transferPairId).toBeTruthy();
    expect(result[0].transferPairId).toBe(result[1].transferPairId);
    expect(detectInternalTransfers([...legs].reverse(), base.accounts)[0].transferPairId).toBe(
      result[0].transferPairId,
    );
    expect(legs[0].transferPairId).toBeNull();
  });

  it('leaves every leg unmatched when an amount has multiple possible counterparts', () => {
    const legs = [
      ...transferLegs(),
      entry('ambiguous', 20_000, { accountId: clinicB.id, description: 'INTERNAL TRANSFER' }),
    ];
    expect(
      detectInternalTransfers(legs, base.accounts).every(
        (transaction) => transaction.transferPairId === null,
      ),
    ).toBe(true);
  });

  it('requires uniqueness in both directions, even when only one side has alternatives', () => {
    const legs = [
      ...transferLegs(),
      entry('ambiguous-debit', -20_000, {
        accountId: clinicB.id,
        description: 'INTERNAL TRANSFER',
      }),
    ];
    expect(
      detectInternalTransfers(legs, base.accounts).every(
        (transaction) => transaction.transferPairId === null,
      ),
    ).toBe(true);
  });

  it('never pairs equal-value unrelated income and expenditure', () => {
    const legs = transferLegs().map((transaction) => ({
      ...transaction,
      description: transaction.amountCents > 0 ? 'PATIENT RECEIPTS' : 'DENTAL SUPPLIES',
    }));
    expect(
      detectInternalTransfers(legs, base.accounts).every(
        (transaction) => transaction.transferPairId === null,
      ),
    ).toBe(true);
  });

  it.each([
    ['same account', { accountId: clinicA.id }],
    ['different tenant', { organisationId: stableId('organisation', 'outsider') }],
    ['unknown account', { accountId: stableId('account', 'outsider') }],
    ['pending entry', { status: 'pending' as const }],
    ['outside window', { postedAt: '2026-09-14' }],
    ['invalid date', { postedAt: '2026-02-30' }],
  ])('does not match %s', (_, patch) => {
    const legs = transferLegs();
    legs[1] = { ...legs[1], ...patch };
    expect(
      detectInternalTransfers(legs, base.accounts).every(
        (transaction) => transaction.transferPairId === null,
      ),
    ).toBe(true);
  });

  it('clears stale one-sided pair identities when recalculating', () => {
    const transaction = { ...transferLegs()[0], transferPairId: stableId('pair', 'stale') };
    expect(detectInternalTransfers([transaction], base.accounts)[0].transferPairId).toBeNull();
  });
});

describe('cash-flow reporting', () => {
  it('excludes pending and matched internal transfers from cash flow while preserving them in the ledger', () => {
    const transactions = [
      entry('income', 10_001),
      entry('expense', -3_002, { receiptStatus: 'missing' }),
      entry('pending', -8_999, { status: 'pending' }),
      ...detectInternalTransfers(transferLegs(), base.accounts),
    ];
    const data = dataset(transactions);
    expect(filterTransactions(data)).toHaveLength(5);
    expect(calculateSummary(data)).toMatchObject({
      incomeCents: 10_001,
      expenseCents: 3_002,
      netCashflowCents: 6_999,
      transactionCount: 2,
      pendingCount: 1,
      internalTransferCount: 2,
      missingReceiptCount: 1,
    });
    expect(calculateCategoryBreakdown(data)[0].amountCents).toBe(3_002);
  });

  it('validates pairs before filtering, so a single-account view does not treat a reserve move as an expense', () => {
    const data = dataset(detectInternalTransfers(transferLegs(), base.accounts));
    expect(calculateSummary(data, { accountId: clinicA.id })).toMatchObject({
      incomeCents: 0,
      expenseCents: 0,
      netCashflowCents: 0,
      internalTransferCount: 1,
    });
  });

  it('does not hide cash flow behind incomplete or invalid persisted pair flags', () => {
    const pairId = stableId('pair', 'invalid');
    const oneSided = dataset([entry('only', -700, { transferPairId: pairId })]);
    expect(calculateSummary(oneSided).expenseCents).toBe(700);
    const mismatched = dataset([
      entry('one', -700, { transferPairId: pairId }),
      entry('two', 600, { accountId: reserveA.id, transferPairId: pairId }),
    ]);
    expect(calculateSummary(mismatched)).toMatchObject({
      incomeCents: 600,
      expenseCents: 700,
      netCashflowCents: -100,
    });
  });

  it('excludes personal by default and includes it only through explicit scope', () => {
    const data = dataset([
      entry('clinic', 100),
      entry('personal', -45, { accountId: personal.id }),
    ]);
    expect(calculateSummary(data).expenseCents).toBe(0);
    expect(calculateSummary(data, { includePersonal: true }).expenseCents).toBe(45);
    expect(calculateSummary(data, { entityId: personal.entityId })).toMatchObject({
      incomeCents: 0,
      expenseCents: 45,
    });
    expect(calculateSummary(data, { accountId: personal.id }).expenseCents).toBe(45);
    expect(
      filterTransactions(data, { entityId: clinicA.entityId, accountId: personal.id }),
    ).toEqual([]);
  });

  it('uses inclusive UTC date boundaries and retains current balance separately from period flow', () => {
    const data = dataset([
      entry('before', 500, { postedAt: '2026-08-31' }),
      entry('start', 101, { postedAt: '2026-09-01' }),
      entry('end', -20, { postedAt: '2026-09-20' }),
      entry('after', -200, { postedAt: '2026-09-21' }),
    ]);
    const scope = { from: '2026-09-01', to: '2026-09-20' };
    expect(calculateSummary(data, scope)).toMatchObject({
      balanceCents: 100_000,
      incomeCents: 101,
      expenseCents: 20,
      netCashflowCents: 81,
    });
    const daily = calculateDailyCashflow(data, scope);
    expect(daily).toHaveLength(20);
    expect(daily[1]).toEqual({
      date: '2026-09-02',
      incomeCents: 0,
      expenseCents: 0,
      netCashflowCents: 0,
    });
    expect(calculateMonthlyCashflow(data, scope)).toEqual([
      { date: '2026-09', incomeCents: 101, expenseCents: 20, netCashflowCents: 81 },
    ]);
  });

  it('rejects invalid or reversed periods instead of displaying misleading zeros', () => {
    expect(() => calculateSummary(base, { from: '2026-02-30' })).toThrow();
    expect(() => calculateDailyCashflow(base, { from: '2026-09-20', to: '2026-09-01' })).toThrow();
    expect(shiftDate('2026-10-04', -1)).toBe('2026-10-03');
  });

  it('keeps category totals and chart totals exactly reconciled to integer-cent summaries', () => {
    const scope = { from: '2026-09-01', to: MOCK_AS_OF };
    const summary = calculateSummary(base, scope);
    const daily = calculateDailyCashflow(base, scope);
    expect(
      calculateCategoryBreakdown(base, scope).reduce((sum, row) => sum + row.amountCents, 0),
    ).toBe(summary.expenseCents);
    expect(daily.reduce((sum, row) => sum + row.incomeCents, 0)).toBe(summary.incomeCents);
    expect(daily.reduce((sum, row) => sum + row.netCashflowCents, 0)).toBe(
      summary.netCashflowCents,
    );
    expect(Number.isSafeInteger(summary.netCashflowCents)).toBe(true);
  });
});

describe('categorisation and provider safety', () => {
  it('preserves manual corrections through reprocessing', () => {
    const transaction = entry('manual', -8_500, {
      description: 'DENTAL SUPPLIES',
      categoryId: base.categories[4].id,
      categorySource: 'manual',
    });
    expect(categoriseTransaction(transaction, base.categories)).toEqual(transaction);
    expect(
      categoriseTransaction({ ...transaction, categoryId: null }, base.categories).categoryId,
    ).toBeNull();
  });

  it('uses sign-aware rules and leaves unrecognised entries for review', () => {
    const supplies = base.categories.find((category) => category.name === 'Dental supplies')!;
    expect(
      categoriseTransaction(
        entry('supply', -150, { description: 'DENTAL SUPPLIES' }),
        base.categories,
      ).categoryId,
    ).toBe(supplies.id);
    expect(
      categoriseTransaction(
        entry('refund', 150, { description: 'DENTAL SUPPLIES REFUND' }),
        base.categories,
      ).categoryId,
    ).toBeNull();
    expect(categoriseTransaction(entry('unknown', -150), base.categories).categorySource).toBe(
      'uncategorised',
    );
  });

  it('serves injected mock data and fails closed for an unconnected live provider', async () => {
    await expect(new MockFinancialProvider(createMockDataset).loadDataset()).resolves.toEqual(base);
    await expect(new BasiqFinancialProvider().loadDataset()).rejects.toThrow('not connected');
  });
  it('scopes provider operations to a connection and refuses disconnected reads', async () => {
    const provider = new MockFinancialProvider(createMockDataset);
    const connections = await provider.connect();
    const accounts = await provider.getAccounts(connections[0].id);
    expect(accounts).toHaveLength(3);
    expect(await provider.getBalances(connections[0].id)).toHaveLength(3);
    const transactions = await provider.getTransactions(connections[0].id, '2026-09-01');
    expect(
      transactions.every(
        (transaction) =>
          accounts.some((account) => account.id === transaction.accountId) &&
          transaction.postedAt >= '2026-09-01',
      ),
    ).toBe(true);
    await provider.disconnect(connections[0].id);
    await expect(provider.getAccounts(connections[0].id)).rejects.toThrow('unavailable');
  });
});
