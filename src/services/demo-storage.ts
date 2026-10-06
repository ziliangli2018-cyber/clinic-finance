import type { FinanceDataset } from '../types/domain.ts';
import { dateValue } from '../domain/dates.ts';

export const DEMO_STORAGE_KEY = 'clinic-finance.demo-state';
export const DEMO_STORAGE_VERSION = 1 as const;

export interface DemoState {
  dataset: FinanceDataset;
  paused: boolean;
  sequence: number;
  lastUpdatedAt: string | null;
}

export interface DemoStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

interface StoredDemoState {
  version: typeof DEMO_STORAGE_VERSION;
  state: DemoState;
}

type UnknownRecord = Record<string, unknown>;

function isRecord(value: unknown): value is UnknownRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isString(value: unknown): value is string {
  return typeof value === 'string' && value.length > 0;
}

function isNullableString(value: unknown): value is string | null {
  return value === null || typeof value === 'string';
}

function isTimestamp(value: unknown): value is string {
  return typeof value === 'string' && Number.isFinite(Date.parse(value));
}

function hasUniqueStrings(rows: UnknownRecord[]): boolean {
  const ids = rows.map((row) => row.id);
  return ids.every(isString) && new Set(ids).size === ids.length;
}

function isDataset(value: unknown, expectedOrganisationId?: string): value is FinanceDataset {
  if (!isRecord(value) || !isRecord(value.organisation)) return false;
  const organisation = value.organisation;
  if (
    !isString(organisation.id) ||
    (expectedOrganisationId !== undefined && organisation.id !== expectedOrganisationId) ||
    !isString(organisation.name) ||
    organisation.isDemo !== true
  )
    return false;
  if (
    !Array.isArray(value.entities) ||
    !Array.isArray(value.connections) ||
    !Array.isArray(value.accounts) ||
    !Array.isArray(value.categories) ||
    !Array.isArray(value.transactions) ||
    !value.entities.every(isRecord) ||
    !value.connections.every(isRecord) ||
    !value.accounts.every(isRecord) ||
    !value.categories.every(isRecord) ||
    !value.transactions.every(isRecord) ||
    !hasUniqueStrings(value.entities) ||
    !hasUniqueStrings(value.connections) ||
    !hasUniqueStrings(value.accounts) ||
    !hasUniqueStrings(value.categories) ||
    !hasUniqueStrings(value.transactions)
  )
    return false;

  const entityIds = new Set(value.entities.map((row) => row.id as string));
  const connectionIds = new Set(value.connections.map((row) => row.id as string));
  const accountIds = new Set(value.accounts.map((row) => row.id as string));
  const categoryIds = new Set(value.categories.map((row) => row.id as string));

  if (
    !value.entities.every(
      (row) =>
        row.organisationId === organisation.id &&
        isString(row.name) &&
        (row.kind === 'clinic' || row.kind === 'personal'),
    )
  )
    return false;
  if (
    !value.connections.every(
      (row) =>
        row.organisationId === organisation.id &&
        isString(row.entityId) &&
        entityIds.has(row.entityId) &&
        (row.provider === 'mock' || row.provider === 'basiq') &&
        (row.status === 'active' || row.status === 'error' || row.status === 'disconnected') &&
        (row.lastSyncedAt === null || isTimestamp(row.lastSyncedAt)),
    )
  )
    return false;
  if (
    !value.accounts.every(
      (row) =>
        row.organisationId === organisation.id &&
        isString(row.entityId) &&
        entityIds.has(row.entityId) &&
        isString(row.connectionId) &&
        connectionIds.has(row.connectionId) &&
        isString(row.name) &&
        isString(row.institution) &&
        ['operating', 'savings', 'credit_card', 'transaction'].includes(String(row.kind)) &&
        row.currency === 'AUD' &&
        typeof row.balanceCents === 'number' &&
        Number.isSafeInteger(row.balanceCents) &&
        isString(row.maskedNumber) &&
        isTimestamp(row.updatedAt),
    )
  )
    return false;
  if (
    !value.categories.every(
      (row) =>
        isString(row.name) &&
        ['income', 'expense', 'transfer'].includes(String(row.kind)) &&
        isString(row.colour),
    )
  )
    return false;

  return value.transactions.every(
    (row) =>
      row.organisationId === organisation.id &&
      isString(row.accountId) &&
      accountIds.has(row.accountId) &&
      isString(row.providerTransactionId) &&
      typeof row.postedAt === 'string' &&
      Number.isFinite(dateValue(row.postedAt)) &&
      isString(row.description) &&
      isNullableString(row.merchant) &&
      typeof row.amountCents === 'number' &&
      Number.isSafeInteger(row.amountCents) &&
      row.currency === 'AUD' &&
      (row.categoryId === null || (isString(row.categoryId) && categoryIds.has(row.categoryId))) &&
      ['rule', 'manual', 'uncategorised'].includes(String(row.categorySource)) &&
      (row.status === 'posted' || row.status === 'pending') &&
      isNullableString(row.transferPairId) &&
      ['missing', 'attached', 'not_required'].includes(String(row.receiptStatus)),
  );
}

function isDemoState(value: unknown, expectedOrganisationId?: string): value is DemoState {
  return (
    isRecord(value) &&
    isDataset(value.dataset, expectedOrganisationId) &&
    typeof value.paused === 'boolean' &&
    typeof value.sequence === 'number' &&
    Number.isSafeInteger(value.sequence) &&
    value.sequence >= 0 &&
    (value.lastUpdatedAt === null || isTimestamp(value.lastUpdatedAt))
  );
}

function copyDataset(dataset: FinanceDataset): FinanceDataset {
  return {
    organisation: { ...dataset.organisation },
    entities: dataset.entities.map((entity) => ({ ...entity })),
    connections: dataset.connections.map((connection) => ({ ...connection })),
    accounts: dataset.accounts.map((account) => ({ ...account })),
    categories: dataset.categories.map((category) => ({ ...category })),
    transactions: dataset.transactions.map((transaction) => ({ ...transaction })),
  };
}

function copyState(state: DemoState): DemoState {
  return { ...state, dataset: copyDataset(state.dataset) };
}

function initialState(seed: FinanceDataset): DemoState {
  return {
    dataset: copyDataset(seed),
    paused: false,
    sequence: 0,
    lastUpdatedAt: null,
  };
}

function browserStorage(storage?: DemoStorage | null): DemoStorage | null {
  if (storage !== undefined) return storage;
  try {
    return typeof window === 'undefined' ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** Load a saved demo, or return an independent seed copy when storage is unavailable or invalid. */
export function loadDemoState(seed: FinanceDataset, storage?: DemoStorage | null): DemoState {
  const fallback = initialState(seed);
  const target = browserStorage(storage);
  if (!target) return fallback;
  try {
    const raw = target.getItem(DEMO_STORAGE_KEY);
    if (!raw) return fallback;
    const parsed: unknown = JSON.parse(raw);
    if (
      !isRecord(parsed) ||
      parsed.version !== DEMO_STORAGE_VERSION ||
      !isDemoState(parsed.state, seed.organisation.id)
    )
      return fallback;
    return copyState(parsed.state);
  } catch {
    return fallback;
  }
}

/** Save the complete demo snapshot. Storage denial/quota errors are reported as `false`. */
export function saveDemoState(state: DemoState, storage?: DemoStorage | null): boolean {
  const target = browserStorage(storage);
  if (!target || !isDemoState(state)) return false;
  const stored: StoredDemoState = {
    version: DEMO_STORAGE_VERSION,
    state: copyState(state),
  };
  try {
    target.setItem(DEMO_STORAGE_KEY, JSON.stringify(stored));
    return true;
  } catch {
    return false;
  }
}

/** Remove only Clinic Finance's demo snapshot. */
export function clearDemoState(storage?: DemoStorage | null): boolean {
  const target = browserStorage(storage);
  if (!target) return false;
  try {
    target.removeItem(DEMO_STORAGE_KEY);
    return true;
  } catch {
    return false;
  }
}

/** Clear persisted activity and return a fresh, independent state built from the supplied seed. */
export function resetDemoState(seed: FinanceDataset, storage?: DemoStorage | null): DemoState {
  clearDemoState(storage);
  return initialState(seed);
}
