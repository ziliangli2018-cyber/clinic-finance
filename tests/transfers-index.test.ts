import { describe, expect, it } from 'vitest';
import type { Account, Transaction } from '../src/types/domain';
import { detectInternalTransfers, stableId } from '../src/domain/transfers';
import { daysBetween, shiftDate } from '../src/domain/dates';

const organisationId = stableId('test', 'indexed-transfers');
const accounts: Account[] = [0, 1, 2].map((n) => ({
  id: stableId('test-account', n),
  organisationId,
  entityId: stableId('test-entity', n),
  connectionId: stableId('test-connection', n),
  name: `Account ${n}`,
  institution: 'Test',
  kind: 'operating',
  currency: 'AUD',
  balanceCents: 0,
  maskedNumber: 'Not provided',
  updatedAt: '2026-09-20T00:00:00.000Z',
}));
const entry = (n: number, amountCents: number, account = n % 3): Transaction => ({
  id: stableId('test-entry', n),
  organisationId,
  accountId: accounts[account].id,
  providerTransactionId: String(n),
  postedAt: shiftDate('2026-09-20', n % 9),
  description: n % 7 ? 'INTERNAL TRANSFER OWN ACCOUNT' : 'Supplier payment',
  merchant: null,
  amountCents,
  currency: 'AUD',
  categoryId: null,
  categorySource: 'uncategorised',
  status: 'posted',
  transferPairId: null,
  receiptStatus: 'not_required',
});

function reference(rows: Transaction[], days: number) {
  const candidates = new Map(
    rows.map((a) => [
      a.id,
      rows.filter(
        (b) =>
          a.id !== b.id &&
          a.accountId !== b.accountId &&
          a.amountCents === -b.amountCents &&
          daysBetween(a.postedAt, b.postedAt) <= days,
      ),
    ]),
  );
  return rows.map((a) => {
    const possible = candidates.get(a.id)!;
    const b = possible[0];
    const paired =
      possible.length === 1 &&
      candidates.get(b.id)!.length === 1 &&
      a.description.includes('INTERNAL TRANSFER') &&
      b.description.includes('INTERNAL TRANSFER');
    return paired ? stableId('transfer-pair', [a.id, b.id].sort().join(':')) : null;
  });
}

describe('indexed transfer matching for statement ledgers', () => {
  it('retains the conservative unique-counterpart matching result', () => {
    for (const seed of [11, 23, 41]) {
      const rows = Array.from({ length: 100 }, (_, n) =>
        entry(n, (n % 2 ? 1 : -1) * (100 + ((n * seed) % 17) * 100)),
      );
      for (const days of [0, 1, 3])
        expect(
          detectInternalTransfers(rows, accounts, { maxDaysApart: days }).map(
            (r) => r.transferPairId,
          ),
        ).toEqual(reference(rows, days));
    }
  });
  it('handles ten thousand same-account rows without full-ledger quadratic scans', () => {
    const rows = Array.from({ length: 10_000 }, (_, n) => entry(n, n % 2 ? 100 : -100, 0));
    expect(
      detectInternalTransfers(rows, accounts).every((row) => row.transferPairId === null),
    ).toBe(true);
  });
});
