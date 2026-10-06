import { describe, expect, it } from 'vitest';
import type { Account, FinanceDataset, Transaction } from '../src/types/domain.ts';
import { buildCashflowForecast } from '../src/domain/forecast.ts';
import { shiftDate } from '../src/domain/dates.ts';
import { createMockDataset, MOCK_AS_OF } from '../src/domain/mock.ts';
import { detectInternalTransfers, stableId } from '../src/domain/transfers.ts';

const organisationId = stableId('organisation', 'forecast-test');
const entityId = stableId('entity', 'forecast-clinic');
const personalEntityId = stableId('entity', 'forecast-personal');
const connectionId = stableId('connection', 'forecast-test');

function account(
  id: string,
  balanceCents: number,
  kind: Account['kind'] = 'operating',
  ownerEntityId = entityId,
  updatedAt = '2026-03-03T00:00:00.000Z',
): Account {
  return {
    id,
    organisationId,
    entityId: ownerEntityId,
    connectionId,
    name: id,
    institution: 'Test bank',
    kind,
    currency: 'AUD',
    balanceCents,
    maskedNumber: '1234',
    updatedAt,
  };
}

function transaction(
  id: string,
  accountId: string,
  postedAt: string,
  amountCents: number,
  overrides: Partial<Transaction> = {},
): Transaction {
  return {
    id: stableId('transaction', id),
    organisationId,
    accountId,
    providerTransactionId: id,
    postedAt,
    description: id,
    merchant: id,
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

function dataset(accounts: Account[], transactions: Transaction[]): FinanceDataset {
  return {
    organisation: { id: organisationId, name: 'Forecast test', isDemo: true },
    entities: [
      { id: entityId, organisationId, name: 'Clinic', kind: 'clinic' },
      { id: personalEntityId, organisationId, name: 'Personal', kind: 'personal' },
    ],
    connections: [
      {
        id: connectionId,
        organisationId,
        entityId,
        provider: 'mock',
        status: 'active',
        lastSyncedAt: null,
      },
    ],
    accounts,
    categories: [],
    transactions,
  };
}

describe('cash-flow forecast', () => {
  it('returns one finite, ordered balance point per future day for each supported horizon', () => {
    const data = createMockDataset();
    for (const horizon of [30, 60, 90] as const) {
      const forecast = buildCashflowForecast(data, {}, horizon);
      expect(forecast.asOfDate).toBe(MOCK_AS_OF);
      expect(forecast.points).toHaveLength(horizon);
      expect(forecast.points[0].date).toBe(shiftDate(MOCK_AS_OF, 1));
      expect(forecast.points.at(-1)?.date).toBe(shiftDate(MOCK_AS_OF, horizon));
      expect(forecast.closingBalanceCents).toBe(forecast.points.at(-1)?.expectedCents);
      for (const point of forecast.points) {
        expect(Number.isSafeInteger(point.expectedCents)).toBe(true);
        expect(Number.isSafeInteger(point.lowCents)).toBe(true);
        expect(Number.isSafeInteger(point.highCents)).toBe(true);
        expect(point.lowCents).toBeLessThanOrEqual(point.expectedCents);
        expect(point.expectedCents).toBeLessThanOrEqual(point.highCents);
      }
    }
  });

  it('combines inferred weekly/monthly movements with average discretionary outflows', () => {
    const cash = account('cash', 100_000);
    const data = dataset(
      [cash],
      [
        transaction('rent-1', cash.id, '2026-02-01', -30_000, { merchant: 'Landlord' }),
        transaction('rent-2', cash.id, '2026-03-03', -30_000, { merchant: 'Landlord' }),
        transaction('income-1', cash.id, '2026-02-17', 7_000, { merchant: 'Weekly income' }),
        transaction('income-2', cash.id, '2026-02-24', 7_000, { merchant: 'Weekly income' }),
        transaction('income-3', cash.id, '2026-03-03', 7_000, { merchant: 'Weekly income' }),
        transaction('supplies', cash.id, '2026-02-15', -3_100, { merchant: 'One-off supplies' }),
      ],
    );
    const forecast = buildCashflowForecast(data, {}, 30);

    expect(forecast).toMatchObject({
      asOfDate: '2026-03-03',
      historyDays: 31,
      openingBalanceCents: 100_000,
      dailyDiscretionaryOutflowCents: 100,
      recurringSeriesCount: 2,
      closingBalanceCents: 95_000,
      lowClosingBalanceCents: 88_600,
      highClosingBalanceCents: 101_400,
    });
    expect(
      buildCashflowForecast({ ...data, transactions: [...data.transactions].reverse() }, {}, 30),
    ).toEqual(forecast);
  });

  it('excludes credit cards, pending entries, and verified internal transfers', () => {
    const cash = account('cash', 80_000);
    const reserve = account('reserve', 20_000, 'savings');
    const card = account('card', -25_000, 'credit_card');
    const transferLegs = detectInternalTransfers(
      [
        transaction('transfer-out', cash.id, '2026-03-03', -20_000, {
          description: 'INTERNAL TRANSFER TO OWN ACCOUNT',
          merchant: null,
        }),
        transaction('transfer-in', reserve.id, '2026-03-03', 20_000, {
          description: 'INTERNAL TRANSFER FROM OWN ACCOUNT',
          merchant: null,
        }),
      ],
      [cash, reserve, card],
    );
    const data = dataset(
      [cash, reserve, card],
      [
        ...transferLegs,
        transaction('pending', cash.id, '2026-03-03', -90_000, { status: 'pending' }),
        transaction('card-purchase', card.id, '2026-03-03', -100_000),
      ],
    );
    const forecast = buildCashflowForecast(data, {}, 30);

    expect(forecast.openingBalanceCents).toBe(100_000);
    expect(forecast.dailyDiscretionaryOutflowCents).toBe(0);
    expect(forecast.recurringSeriesCount).toBe(0);
    expect(forecast.closingBalanceCents).toBe(100_000);
  });

  it('honours entity and personal scope for opening cash and history', () => {
    const clinic = account('clinic', 90_000);
    const personal = account('personal', 12_000, 'transaction', personalEntityId);
    const data = dataset(
      [clinic, personal],
      [transaction('personal-spend', personal.id, '2026-03-03', -1_200)],
    );

    expect(buildCashflowForecast(data, {}, 30).openingBalanceCents).toBe(90_000);
    expect(buildCashflowForecast(data, { includePersonal: true }, 30).openingBalanceCents).toBe(
      102_000,
    );
    expect(
      buildCashflowForecast(data, { entityId: personalEntityId }, 30).openingBalanceCents,
    ).toBe(12_000);
  });

  it('stays flat and finite for sparse or invalid upstream numeric data', () => {
    const broken = account('broken', Number.NaN, 'operating', entityId, 'not-a-date');
    const data = dataset(
      [broken],
      [transaction('invalid-amount', broken.id, 'not-a-date', Number.NaN)],
    );
    const forecast = buildCashflowForecast(data, {}, 90);

    expect(forecast.asOfDate).toBe('1970-01-01');
    expect(forecast.historyDays).toBe(0);
    expect(forecast.openingBalanceCents).toBe(0);
    expect(forecast.closingBalanceCents).toBe(0);
    expect(
      forecast.points.every((point) =>
        Object.values(point).every((value) => typeof value === 'string' || Number.isFinite(value)),
      ),
    ).toBe(true);
    expect(forecast.disclaimer).toContain('not financial, accounting, or tax advice');
    expect(forecast.assumptions).toContain(forecast.disclaimer);
  });

  it('rejects unsupported horizons and invalid date scopes', () => {
    const data = createMockDataset();
    expect(() => buildCashflowForecast(data, {}, 31)).toThrow('30, 60, or 90');
    expect(() => buildCashflowForecast(data, { from: '2026-02-30' }, 30)).toThrow(
      'valid YYYY-MM-DD',
    );
    expect(() => buildCashflowForecast(data, { from: '2026-09-20', to: '2026-09-01' }, 30)).toThrow(
      'must not follow',
    );
  });
});
