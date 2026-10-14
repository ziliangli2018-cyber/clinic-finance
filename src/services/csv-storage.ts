import type { FinanceDataset } from '../types/domain';
import { dateValue } from '../domain/dates';
import { createCsvDataset, CSV_ORGANISATION_ID, MAX_CSV_LEDGER_ROWS } from '../domain/csv-import';

export const CSV_STORAGE_KEY = 'clinic-finance.csv-workspace.v1';
export const WORKSPACE_SOURCE_KEY = 'clinic-finance.workspace-source';
export type WorkspaceSource = 'csv' | 'bank';

export interface CsvStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

type RecordValue = Record<string, unknown>;
const MAX_BACKUP_BYTES = 10 * 1024 * 1024;
const uuid = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function record(value: unknown): value is RecordValue {
  return !!value && typeof value === 'object' && !Array.isArray(value);
}

function text(value: unknown, max = 200): value is string {
  return typeof value === 'string' && value.trim().length > 0 && value.length <= max;
}

function id(value: unknown): value is string {
  return typeof value === 'string' && uuid.test(value);
}

function nullableText(value: unknown, max = 200): boolean {
  return value === null || (typeof value === 'string' && value.length <= max);
}

function timestamp(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    /^\d{4}-\d{2}-\d{2}T(?:[01]\d|2[0-3]):[0-5]\d:[0-5]\d(?:\.\d{1,3})?Z$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    Number.isFinite(dateValue(value.slice(0, 10)))
  );
}

function cents(value: unknown): value is number {
  return typeof value === 'number' && Number.isSafeInteger(value);
}

function rows(value: unknown, max: number): value is RecordValue[] {
  if (!Array.isArray(value) || value.length > max || !value.every(record)) return false;
  const ids = value.map((row) => row.id);
  return ids.every(id) && new Set(ids).size === ids.length;
}

/** A backup may only contain a valid local AUD statement workspace, never cloud identities. */
export function validateCsvDataset(value: unknown): value is FinanceDataset {
  if (!record(value) || !record(value.organisation)) return false;
  const org = value.organisation;
  if (
    org.id !== CSV_ORGANISATION_ID ||
    org.isDemo !== false ||
    org.dataSource !== 'csv' ||
    !text(org.name)
  )
    return false;
  if (
    !rows(value.entities, 50) ||
    !rows(value.connections, 100) ||
    !rows(value.accounts, 100) ||
    !rows(value.categories, 100) ||
    !rows(value.transactions, MAX_CSV_LEDGER_ROWS)
  )
    return false;
  const entityIds = new Set(value.entities.map((row) => row.id));
  const connections = new Map(value.connections.map((row) => [row.id, row]));
  const accounts = new Map(value.accounts.map((row) => [row.id, row]));
  const categoryIds = new Set(value.categories.map((row) => row.id));
  if (
    !value.entities.every(
      (row) =>
        row.organisationId === org.id &&
        text(row.name) &&
        ['clinic', 'group', 'personal'].includes(String(row.kind)),
    ) ||
    !value.connections.every(
      (row) =>
        row.organisationId === org.id &&
        entityIds.has(row.entityId) &&
        row.provider === 'csv' &&
        ['pending', 'active', 'error', 'consent_required', 'disconnected'].includes(
          String(row.status),
        ) &&
        (row.lastSyncedAt === null || timestamp(row.lastSyncedAt)) &&
        (row.institutionId === undefined || nullableText(row.institutionId)) &&
        (row.institutionName === undefined || nullableText(row.institutionName)) &&
        (row.consentExpiresAt === undefined || row.consentExpiresAt === null),
    ) ||
    !value.accounts.every(
      (row) =>
        row.organisationId === org.id &&
        entityIds.has(row.entityId) &&
        connections.get(row.connectionId)?.entityId === row.entityId &&
        text(row.name) &&
        text(row.institution) &&
        [
          'operating',
          'savings',
          'credit_card',
          'transaction',
          'loan',
          'mortgage',
          'term_deposit',
        ].includes(String(row.kind)) &&
        row.currency === 'AUD' &&
        cents(row.balanceCents) &&
        (row.availableFundsCents === undefined ||
          row.availableFundsCents === null ||
          cents(row.availableFundsCents)) &&
        typeof row.maskedNumber === 'string' &&
        row.maskedNumber.length <= 40 &&
        timestamp(row.updatedAt),
    ) ||
    !value.categories.every(
      (row) =>
        text(row.name) &&
        ['income', 'expense', 'transfer'].includes(String(row.kind)) &&
        typeof row.colour === 'string' &&
        /^#[0-9a-f]{6}$/i.test(row.colour),
    )
  )
    return false;
  let absoluteBalances = 0;
  for (const row of value.accounts) {
    absoluteBalances += Math.abs(row.balanceCents as number);
    if (!Number.isSafeInteger(absoluteBalances)) return false;
  }
  const providerIds = new Set<string>();
  const pairRows = new Map<string, RecordValue[]>();
  let absoluteTransactions = 0;
  for (const row of value.transactions) {
    if (
      row.organisationId !== org.id ||
      !accounts.has(row.accountId) ||
      !text(row.providerTransactionId, 500) ||
      typeof row.postedAt !== 'string' ||
      !Number.isFinite(dateValue(row.postedAt)) ||
      !text(row.description, 2000) ||
      !nullableText(row.merchant, 500) ||
      !cents(row.amountCents) ||
      row.currency !== 'AUD' ||
      !(row.categoryId === null || categoryIds.has(row.categoryId)) ||
      !['rule', 'manual', 'uncategorised'].includes(String(row.categorySource)) ||
      !['posted', 'pending'].includes(String(row.status)) ||
      !(row.transferPairId === null || id(row.transferPairId)) ||
      !['missing', 'attached', 'not_required'].includes(String(row.receiptStatus))
    )
      return false;
    absoluteTransactions += Math.abs(row.amountCents);
    if (!Number.isSafeInteger(absoluteTransactions)) return false;
    const providerId = `${String(row.accountId)}:${row.providerTransactionId}`;
    if (providerIds.has(providerId)) return false;
    providerIds.add(providerId);
    if (typeof row.transferPairId === 'string') {
      const group = pairRows.get(row.transferPairId) ?? [];
      group.push(row);
      pairRows.set(row.transferPairId, group);
    }
  }
  // Avoid carrying one-sided, cross-currency, or impossible derived transfer matches into totals.
  for (const pair of pairRows.values()) {
    if (pair.length !== 2) return false;
    const [a, b] = pair;
    const first = accounts.get(a.accountId)!;
    const second = accounts.get(b.accountId)!;
    if (
      a.accountId === b.accountId ||
      a.status !== 'posted' ||
      b.status !== 'posted' ||
      a.amountCents === 0 ||
      a.amountCents !== -(b.amountCents as number) ||
      Math.abs(dateValue(a.postedAt as string) - dateValue(b.postedAt as string)) >
        3 * 86_400_000 ||
      ['loan', 'mortgage'].includes(String(first.kind)) ||
      ['loan', 'mortgage'].includes(String(second.kind))
    )
      return false;
  }
  return true;
}

function storage(target?: CsvStorage | null): CsvStorage {
  if (target) return target;
  if (target === null)
    throw new Error('Browser storage is unavailable. Enable storage to use your CSV workspace.');
  try {
    if (typeof window !== 'undefined') return window.localStorage;
  } catch {
    // Report denied storage; imported data must not silently become an unsaved workspace.
  }
  throw new Error('Browser storage is unavailable. Enable storage to use your CSV workspace.');
}

export function exportCsvBackup(dataset: FinanceDataset): string {
  if (!validateCsvDataset(dataset)) throw new Error('The CSV workspace could not be validated.');
  // Compact storage leaves more browser quota available for actual transaction details.
  const raw = JSON.stringify({ version: 1, dataset });
  if (new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES)
    throw new Error(
      'The workspace backup exceeds the 10 MiB size limit. No saved data was changed.',
    );
  return raw;
}

export function parseCsvBackup(raw: string): FinanceDataset {
  if (
    typeof raw !== 'string' ||
    raw.length > MAX_BACKUP_BYTES ||
    new TextEncoder().encode(raw).length > MAX_BACKUP_BYTES
  )
    throw new Error('The workspace backup is too large.');
  let value: unknown;
  try {
    value = JSON.parse(raw);
  } catch {
    throw new Error('This is not a readable Clinic Finance workspace backup.');
  }
  if (!record(value) || value.version !== 1 || !validateCsvDataset(value.dataset))
    throw new Error(
      'This backup is not a valid local CSV workspace. Your saved data was not changed.',
    );
  return value.dataset;
}

export function loadCsvDataset(target?: CsvStorage | null): FinanceDataset {
  let raw: string | null;
  try {
    raw = storage(target).getItem(CSV_STORAGE_KEY);
  } catch (cause) {
    throw new Error(
      cause instanceof Error && cause.message.startsWith('Browser storage')
        ? cause.message
        : 'Your saved CSV workspace could not be read. It has not been replaced.',
    );
  }
  if (raw === null) return createCsvDataset();
  try {
    return parseCsvBackup(raw);
  } catch {
    throw new Error(
      'Your saved CSV workspace is damaged or unsupported. It has not been replaced. Restore a backup or explicitly reset it.',
    );
  }
}

export function saveCsvDataset(dataset: FinanceDataset, target?: CsvStorage | null): void {
  const raw = exportCsvBackup(dataset);
  try {
    storage(target).setItem(CSV_STORAGE_KEY, raw);
  } catch {
    throw new Error(
      'The CSV workspace was not saved. Browser storage is unavailable or full. Your previous saved data is unchanged; export a backup before clearing browser data.',
    );
  }
}

/** Delete only the local statement dataset; never clear browser storage or cloud data. */
export function clearCsvDataset(target?: CsvStorage | null): void {
  try {
    storage(target).removeItem(CSV_STORAGE_KEY);
  } catch {
    throw new Error('The CSV workspace could not be reset. Your saved data has not been replaced.');
  }
}

export function getWorkspaceSource(target?: CsvStorage | null): WorkspaceSource {
  try {
    return storage(target).getItem(WORKSPACE_SOURCE_KEY) === 'csv' ? 'csv' : 'bank';
  } catch {
    // A missing preference must not crash app initialisation. This never overwrites saved data.
    return 'bank';
  }
}

export function setWorkspaceSource(source: WorkspaceSource, target?: CsvStorage | null): void {
  if (source !== 'csv' && source !== 'bank') throw new Error('Choose a supported workspace.');
  try {
    storage(target).setItem(WORKSPACE_SOURCE_KEY, source);
  } catch {
    throw new Error(
      'The workspace selection could not be saved. Check browser storage permissions.',
    );
  }
}
