import { describe, expect, it } from 'vitest';
import { advanceDemoDataset } from '../src/domain/simulation.ts';
import { createMockDataset, MOCK_AS_OF } from '../src/domain/mock.ts';
import {
  clearDemoState,
  DEMO_STORAGE_KEY,
  loadDemoState,
  resetDemoState,
  saveDemoState,
  type DemoState,
  type DemoStorage,
} from '../src/services/demo-storage.ts';

class MemoryStorage implements DemoStorage {
  readonly values = new Map<string, string>();

  getItem(key: string): string | null {
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    this.values.delete(key);
  }
}

const tick = new Date('2026-10-06T01:02:03.000Z');

describe('deterministic demo activity', () => {
  it('adds a categorised posted transaction without mutating the input', () => {
    const seed = createMockDataset();
    const snapshot = JSON.stringify(seed);
    const account = seed.accounts.find((candidate) => candidate.name === 'Kilcoy operating')!;
    const beforeBalance = account.balanceCents;

    // Sequence 1 is the patient-receipts activity in the fixed cycle.
    const result = advanceDemoDataset(seed, 1, tick);
    const created = result.dataset.transactions.find(
      (transaction) => transaction.providerTransactionId === 'simulated-000002',
    )!;
    const updatedAccount = result.dataset.accounts.find(
      (candidate) => candidate.id === account.id,
    )!;
    const category = result.dataset.categories.find(
      (candidate) => candidate.id === created.categoryId,
    );

    expect(JSON.stringify(seed)).toBe(snapshot);
    expect(result.dataset).not.toBe(seed);
    expect(result.dataset.accounts).not.toBe(seed.accounts);
    expect(result.dataset.transactions).not.toBe(seed.transactions);
    expect(result.sequence).toBe(2);
    expect(result.message).toContain('posted');
    expect(created).toMatchObject({
      accountId: account.id,
      postedAt: MOCK_AS_OF,
      amountCents: 286_450,
      status: 'posted',
      categorySource: 'rule',
    });
    expect(category?.name).toBe('Patient receipts');
    expect(updatedAccount.balanceCents).toBe(beforeBalance + created.amountCents);
    expect(updatedAccount.updatedAt).toBe(tick.toISOString());
    expect(
      result.dataset.accounts.reduce((sum, candidate) => sum + candidate.balanceCents, 0) -
        seed.accounts.reduce((sum, candidate) => sum + candidate.balanceCents, 0),
    ).toBe(created.amountCents);
  });

  it('settles a pending item exactly once and preserves a manual category', () => {
    const seed = createMockDataset();
    const pending = seed.transactions
      .filter((transaction) => transaction.status === 'pending')
      .sort(
        (a, b) =>
          a.postedAt.localeCompare(b.postedAt) ||
          a.providerTransactionId.localeCompare(b.providerTransactionId),
      )[0];
    const manualCategory = seed.categories.find((category) => category.kind === 'expense')!;
    const edited = {
      ...seed,
      transactions: seed.transactions.map((transaction) =>
        transaction.id === pending.id
          ? {
              ...transaction,
              categoryId: manualCategory.id,
              categorySource: 'manual' as const,
            }
          : transaction,
      ),
    };
    const before = edited.accounts.find((account) => account.id === pending.accountId)!;

    const result = advanceDemoDataset(edited, 0, tick);
    const settled = result.dataset.transactions.find(
      (transaction) => transaction.id === pending.id,
    )!;
    const after = result.dataset.accounts.find((account) => account.id === pending.accountId)!;

    expect(edited.transactions.find((transaction) => transaction.id === pending.id)?.status).toBe(
      'pending',
    );
    expect(settled).toMatchObject({
      status: 'posted',
      categoryId: manualCategory.id,
      categorySource: 'manual',
    });
    expect(after.balanceCents).toBe(before.balanceCents + pending.amountCents);
    expect(after.updatedAt).toBe(tick.toISOString());
    expect(result.dataset.transactions).toHaveLength(edited.transactions.length);
    expect(result.sequence).toBe(1);
    expect(result.message).toContain('pending to posted');
  });

  it('keeps a newly pending expense out of the balance until a settlement step', () => {
    const seed = createMockDataset();
    const pendingResult = advanceDemoDataset(seed, 2, tick);
    const created = pendingResult.dataset.transactions.find(
      (transaction) => transaction.providerTransactionId === 'simulated-000003',
    )!;
    const before = seed.accounts.find((account) => account.id === created.accountId)!;
    const pendingAccount = pendingResult.dataset.accounts.find(
      (account) => account.id === created.accountId,
    )!;

    expect(created.status).toBe('pending');
    expect(created.postedAt).toBe(MOCK_AS_OF);
    expect(pendingAccount.balanceCents).toBe(before.balanceCents);

    // Sequence 4 is a settlement step. Remove the seed pending rows so the
    // generated row is the deterministic next item to settle.
    const onlyGeneratedPending = {
      ...pendingResult.dataset,
      transactions: pendingResult.dataset.transactions.filter(
        (transaction) => transaction.status === 'posted' || transaction.id === created.id,
      ),
    };
    const settledResult = advanceDemoDataset(onlyGeneratedPending, 4, tick);
    const settled = settledResult.dataset.transactions.find(
      (transaction) => transaction.id === created.id,
    )!;
    const settledAccount = settledResult.dataset.accounts.find(
      (account) => account.id === created.accountId,
    )!;
    expect(settled.status).toBe('posted');
    expect(settledAccount.balanceCents).toBe(before.balanceCents + created.amountCents);
  });
});

describe('versioned demo storage', () => {
  it('round-trips the complete state without sharing objects', () => {
    const seed = createMockDataset();
    const activity = advanceDemoDataset(seed, 1, tick);
    const storage = new MemoryStorage();
    const state: DemoState = {
      dataset: activity.dataset,
      paused: true,
      sequence: activity.sequence,
      lastUpdatedAt: tick.toISOString(),
    };

    expect(saveDemoState(state, storage)).toBe(true);
    const loaded = loadDemoState(seed, storage);
    expect(loaded).toEqual(state);
    expect(loaded).not.toBe(state);
    expect(loaded.dataset).not.toBe(state.dataset);
    expect(loaded.dataset.transactions).not.toBe(state.dataset.transactions);
  });

  it('falls back safely for corrupt or mismatched persisted data', () => {
    const seed = createMockDataset();
    const storage = new MemoryStorage();

    storage.setItem(DEMO_STORAGE_KEY, '{broken json');
    const corrupt = loadDemoState(seed, storage);
    expect(corrupt).toEqual({
      dataset: seed,
      paused: false,
      sequence: 0,
      lastUpdatedAt: null,
    });
    expect(corrupt.dataset).not.toBe(seed);

    storage.setItem(
      DEMO_STORAGE_KEY,
      JSON.stringify({ version: 999, state: { dataset: seed, paused: true, sequence: 99 } }),
    );
    expect(loadDemoState(seed, storage)).toEqual({
      dataset: seed,
      paused: false,
      sequence: 0,
      lastUpdatedAt: null,
    });
  });

  it('reset clears persisted activity and returns a clean independent seed', () => {
    const seed = createMockDataset();
    const storage = new MemoryStorage();
    const activity = advanceDemoDataset(seed, 1, tick);
    expect(
      saveDemoState(
        {
          dataset: activity.dataset,
          paused: true,
          sequence: activity.sequence,
          lastUpdatedAt: tick.toISOString(),
        },
        storage,
      ),
    ).toBe(true);
    expect(storage.getItem(DEMO_STORAGE_KEY)).not.toBeNull();

    const reset = resetDemoState(seed, storage);
    expect(storage.getItem(DEMO_STORAGE_KEY)).toBeNull();
    expect(reset).toEqual({ dataset: seed, paused: false, sequence: 0, lastUpdatedAt: null });
    expect(reset.dataset).not.toBe(seed);
    reset.dataset.accounts[0].balanceCents = -1;
    expect(seed.accounts[0].balanceCents).not.toBe(-1);
    expect(clearDemoState(storage)).toBe(true);
  });
});
