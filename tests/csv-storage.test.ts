import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { FinanceDataset } from '../src/types/domain';
import type { PlanInput } from '../src/types/planning';
import { applyCsvImport, createCsvDataset, MAX_CSV_LEDGER_ROWS } from '../src/domain/csv-import';
import { stableId } from '../src/domain/transfers';
import {
  clearCsvDataset,
  CSV_STORAGE_KEY,
  exportCsvBackup,
  getWorkspaceSource,
  loadCsvDataset,
  parseCsvBackup,
  saveCsvDataset,
  setWorkspaceSource,
  validateCsvDataset,
  WORKSPACE_SOURCE_KEY,
  type CsvStorage,
} from '../src/services/csv-storage';

const { from } = vi.hoisted(() => ({ from: vi.fn() }));
vi.mock('../src/services/supabase', () => ({ isMock: false, supabase: { from } }));
import { deletePlan, loadPlans, persistDemoPlans, persistPlan } from '../src/services/plans';

class MemoryStorage implements CsvStorage {
  readonly values = new Map<string, string>();
  getItem(key: string) {
    return this.values.get(key) ?? null;
  }
  setItem(key: string, value: string) {
    this.values.set(key, value);
  }
  removeItem(key: string) {
    this.values.delete(key);
  }
}

function fixture(): FinanceDataset {
  const seed = createCsvDataset();
  const entityId = seed.entities[0].id;
  const connectionId = stableId('test-csv-connection', entityId);
  const accountId = stableId('test-csv-account', entityId);
  return {
    ...seed,
    connections: [
      {
        id: connectionId,
        organisationId: seed.organisation.id,
        entityId,
        provider: 'csv',
        status: 'active',
        lastSyncedAt: '2026-10-15T00:00:00.000Z',
      },
    ],
    accounts: [
      {
        id: accountId,
        organisationId: seed.organisation.id,
        entityId,
        connectionId,
        name: 'Kilcoy statement account',
        institution: 'NAB',
        kind: 'operating',
        currency: 'AUD',
        balanceCents: 125_000,
        maskedNumber: '•••• 1234',
        updatedAt: '2026-10-10T00:00:00.000Z',
      },
    ],
    transactions: [
      {
        id: stableId('test-csv-transaction', 1),
        organisationId: seed.organisation.id,
        accountId,
        providerTransactionId: 'csv:test-row-1',
        postedAt: '2026-10-10',
        description: 'Dental supplies',
        merchant: null,
        amountCents: -15_000,
        currency: 'AUD',
        categoryId: null,
        categorySource: 'uncategorised',
        status: 'posted',
        transferPairId: null,
        receiptStatus: 'missing',
      },
    ],
  };
}

describe('local CSV workspace storage', () => {
  it('starts with a clean, non-fictional workspace and independently round-trips data', () => {
    const storage = new MemoryStorage();
    const empty = loadCsvDataset(storage);
    expect(empty.organisation).toMatchObject({ isDemo: false, dataSource: 'csv' });
    expect(empty.accounts).toEqual([]);
    expect(empty.transactions).toEqual([]);
    const data = fixture();
    expect(validateCsvDataset(data)).toBe(true);
    saveCsvDataset(data, storage);
    const loaded = loadCsvDataset(storage);
    expect(loaded).toEqual(data);
    expect(loaded).not.toBe(data);
    expect(loaded.accounts).not.toBe(data.accounts);
    expect(loaded.accounts[0].updatedAt).toBe('2026-10-10T00:00:00.000Z');
    expect(loaded.connections[0].lastSyncedAt).toBe('2026-10-15T00:00:00.000Z');
  });

  it('reports corrupted saved data and never replaces it with an empty workspace', () => {
    const storage = new MemoryStorage();
    for (const raw of ['{broken', '{}', JSON.stringify({ version: 99, dataset: fixture() })]) {
      storage.setItem(CSV_STORAGE_KEY, raw);
      expect(() => loadCsvDataset(storage)).toThrow('has not been replaced');
      expect(storage.getItem(CSV_STORAGE_KEY)).toBe(raw);
    }
  });

  it('accepts actual engine imports, category rules and distinct clinic accounts', () => {
    const seed = createCsvDataset();
    const target = {
      entityId: seed.entities[0].id,
      accountName: 'Operating',
      institution: 'NAB',
      kind: 'operating' as const,
      balanceCents: 100_000,
      balanceDate: '2026-10-10',
    };
    const first = applyCsvImport(
      seed,
      [
        {
          rowNumber: 2,
          postedAt: '2026-10-10',
          description: 'INTERNAL TRANSFER own account',
          amountCents: -10_000,
          externalId: '1',
        },
      ],
      target,
    );
    const second = applyCsvImport(
      first.dataset,
      [
        {
          rowNumber: 2,
          postedAt: '2026-10-10',
          description: 'INTERNAL TRANSFER own account',
          amountCents: 10_000,
          externalId: '2',
        },
      ],
      { ...target, entityId: seed.entities[1].id },
    );
    expect(second.dataset.transactions[0].transferPairId).not.toBeNull();
    expect(validateCsvDataset(second.dataset)).toBe(true);
    expect(parseCsvBackup(exportCsvBackup(second.dataset))).toEqual(second.dataset);
  });

  it('reports quota and denied storage errors without accepting a new saved snapshot', () => {
    const memory = new MemoryStorage();
    const old = fixture();
    saveCsvDataset(old, memory);
    const denied: CsvStorage = {
      getItem: (key) => memory.getItem(key),
      setItem: () => {
        throw new Error('quota');
      },
      removeItem: () => {
        throw new Error('denied');
      },
    };
    expect(() => saveCsvDataset(createCsvDataset(), denied)).toThrow('was not saved');
    expect(loadCsvDataset(memory)).toEqual(old);
    expect(() => clearCsvDataset(denied)).toThrow('could not be reset');
    expect(() => loadCsvDataset(null)).toThrow('Browser storage is unavailable');
    expect(() =>
      loadCsvDataset({
        ...denied,
        getItem: () => {
          throw new Error('denied');
        },
      }),
    ).toThrow('could not be read');
  });

  it('clears only the CSV dataset, retaining demo, plans, auth, and other browser data', () => {
    const storage = new MemoryStorage();
    saveCsvDataset(fixture(), storage);
    const preserved = [
      'clinic-finance.demo-state',
      'clinic-finance.plans.v1.csv',
      'sb-auth',
      'other-app',
    ];
    preserved.forEach((key) => storage.setItem(key, 'preserve'));
    clearCsvDataset(storage);
    expect(storage.getItem(CSV_STORAGE_KEY)).toBeNull();
    preserved.forEach((key) => expect(storage.getItem(key)).toBe('preserve'));
  });

  it('safely loads the remembered source and explicitly reports failed preference writes', () => {
    const storage = new MemoryStorage();
    expect(getWorkspaceSource(storage)).toBe('bank');
    setWorkspaceSource('csv', storage);
    expect(getWorkspaceSource(storage)).toBe('csv');
    setWorkspaceSource('bank', storage);
    expect(getWorkspaceSource(storage)).toBe('bank');
    storage.setItem(WORKSPACE_SOURCE_KEY, 'invalid');
    expect(getWorkspaceSource(storage)).toBe('bank');
    expect(storage.getItem(WORKSPACE_SOURCE_KEY)).toBe('invalid');
    expect(getWorkspaceSource(null)).toBe('bank');
    expect(() => setWorkspaceSource('csv', null)).toThrow('could not be saved');
    expect(() => setWorkspaceSource('cloud' as 'csv', storage)).toThrow('supported workspace');
  });
});

describe('imported account and transaction backup validation', () => {
  it('round-trips valid local statements and excludes plans from the backup envelope', () => {
    const data = fixture();
    const raw = exportCsvBackup(data);
    expect(JSON.parse(raw)).toEqual({ version: 1, dataset: data });
    expect(parseCsvBackup(raw)).toEqual(data);
  });

  it('rejects cloud/mock identity, broken relationships, foreign currency, and imprecise cents', () => {
    const invalid: FinanceDataset[] = [
      { ...fixture(), organisation: { ...fixture().organisation, isDemo: true } },
      { ...fixture(), organisation: { ...fixture().organisation, dataSource: undefined } },
      { ...fixture(), organisation: { ...fixture().organisation, id: stableId('foreign-org', 1) } },
    ];
    for (const edit of [
      (data: FinanceDataset) => {
        data.connections[0].provider = 'basiq';
      },
      (data: FinanceDataset) => {
        data.accounts[0].entityId = data.entities[1].id;
      },
      (data: FinanceDataset) => {
        data.accounts[0].connectionId = stableId('missing', 1);
      },
      (data: FinanceDataset) => {
        data.transactions[0].accountId = stableId('missing', 1);
      },
      (data: FinanceDataset) => {
        data.transactions[0].categoryId = stableId('missing', 1);
      },
      (data: FinanceDataset) => {
        data.transactions[0].amountCents = 1.5;
      },
      (data: FinanceDataset) => {
        data.accounts[0].balanceCents = Number.MAX_SAFE_INTEGER + 1;
      },
      (data: FinanceDataset) => {
        data.accounts[0].availableFundsCents = 1.5;
      },
      (data: FinanceDataset) => {
        data.transactions[0].currency = 'USD' as 'AUD';
      },
      (data: FinanceDataset) => {
        data.transactions[0].postedAt = '2026-02-29';
      },
      (data: FinanceDataset) => {
        data.accounts[0].updatedAt = '2026-10-10T24:00:00Z';
      },
      (data: FinanceDataset) => {
        data.connections[0].lastSyncedAt = 'yesterday';
      },
      (data: FinanceDataset) => {
        data.transactions[0].id = 'not-an-id';
      },
      (data: FinanceDataset) => {
        data.transactions[0].transferPairId = stableId('unpaired', 1);
      },
      (data: FinanceDataset) => {
        data.transactions.push({ ...data.transactions[0] });
      },
    ]) {
      const data = fixture();
      edit(data);
      invalid.push(data);
    }
    for (const data of invalid) {
      expect(validateCsvDataset(data)).toBe(false);
      expect(() => parseCsvBackup(JSON.stringify({ version: 1, dataset: data }))).toThrow(
        'not a valid local CSV',
      );
    }
    expect(() => parseCsvBackup('{broken')).toThrow('not a readable');
    expect(() => exportCsvBackup(invalid[0])).toThrow('could not be validated');
  });

  it('rejects duplicate provider identities and too-large ledgers before persistence', () => {
    const duplicate = fixture();
    duplicate.transactions.push({ ...duplicate.transactions[0], id: stableId('duplicate-row', 2) });
    expect(validateCsvDataset(duplicate)).toBe(false);
    const large = fixture();
    large.transactions = Array.from({ length: MAX_CSV_LEDGER_ROWS + 1 }, (_, index) => ({
      ...large.transactions[0],
      id: stableId('large-row', index),
      providerTransactionId: `csv:${index}`,
    }));
    expect(validateCsvDataset(large)).toBe(false);
    expect(() => parseCsvBackup(' '.repeat(10 * 1024 * 1024 + 1))).toThrow('too large');
    const unsafeSum = fixture();
    unsafeSum.transactions[0].amountCents = Number.MAX_SAFE_INTEGER;
    unsafeSum.transactions.push({
      ...unsafeSum.transactions[0],
      id: stableId('second', 2),
      providerTransactionId: 'csv:second',
      amountCents: 1,
    });
    expect(validateCsvDataset(unsafeSum)).toBe(false);
  });
});

describe('CSV plans remain local even in a production build', () => {
  let storage: MemoryStorage;
  beforeEach(() => {
    from.mockReset();
    storage = new MemoryStorage();
    vi.stubGlobal('localStorage', storage);
  });

  it('starts with no fictional plans, then saves and removes locally without cloud calls', async () => {
    const data = fixture();
    expect(await loadPlans(data)).toEqual([]);
    const input: PlanInput = {
      kind: 'budget',
      name: 'Clinical supplies',
      amountCents: 100_000,
      savedCents: 0,
      entityId: data.entities[0].id,
      categoryId: null,
      accountId: null,
      dueDate: null,
      frequency: null,
    };
    const plan = await persistPlan(data, input);
    persistDemoPlans(data.organisation.id, [plan]);
    expect(await loadPlans(data)).toEqual([plan]);
    await deletePlan(data.organisation.id, plan.id);
    persistDemoPlans(data.organisation.id, []);
    expect(await loadPlans(data)).toEqual([]);
    expect(from).not.toHaveBeenCalled();
  });

  it('does not hide corrupt plan storage or quota errors as successful saves', async () => {
    const data = fixture();
    storage.setItem(`clinic-finance.plans.v1.${data.organisation.id}`, '{broken');
    await expect(loadPlans(data)).rejects.toThrow('could not be read');
    vi.stubGlobal('localStorage', {
      setItem: () => {
        throw new Error('quota');
      },
    });
    expect(() => persistDemoPlans(data.organisation.id, [])).toThrow('quota');
    expect(from).not.toHaveBeenCalled();
  });
});
