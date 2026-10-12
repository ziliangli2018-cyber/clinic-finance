import type { BankingStatus, FinanceDataset, Organisation } from '../types/domain';
import { detectInternalTransfers } from '../domain/transfers';
import { supabase } from './supabase';

type Row = Record<string, unknown>;
// PostgREST caps responses. Fetch every page in stable ID order, never silently use a partial ledger.
async function readTable(table: string, organisationId?: string): Promise<Row[]> {
  if (!supabase) throw new Error('Supabase is not configured');
  const rows: Row[] = [];
  for (let offset = 0; ; offset += 1000) {
    let query = supabase
      .from(table)
      .select('*')
      .order('id')
      .range(offset, offset + 999);
    if (organisationId) query = query.eq('organisation_id', organisationId);
    const { data, error } = await query;
    if (error) throw error;
    rows.push(...data);
    if (data.length < 1000) return rows;
  }
}
function camel(row: Row): Row {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [
      key.replace(/_([a-z])/g, (_, letter: string) => letter.toUpperCase()),
      value,
    ]),
  );
}
export async function listOrganisations(): Promise<Organisation[]> {
  return (await readTable('organisations')).map(camel) as unknown as Organisation[];
}
export async function loadDataset(organisation: Organisation): Promise<FinanceDataset> {
  const [entities, connections, accounts, categories, transactions] = await Promise.all([
    readTable('entities', organisation.id),
    readTable('bank_connections', organisation.id),
    readTable('accounts', organisation.id),
    readTable('categories'),
    readTable('transactions', organisation.id),
  ]);
  const mappedAccounts = accounts.map(camel) as unknown as FinanceDataset['accounts'];
  const mappedTransactions = transactions.map(camel) as unknown as FinanceDataset['transactions'];
  return {
    organisation,
    entities: entities.map(camel),
    connections: connections.map(camel),
    accounts: mappedAccounts,
    categories: categories.map(camel),
    transactions: detectInternalTransfers(mappedTransactions, mappedAccounts),
  } as unknown as FinanceDataset;
}
export async function seedDemo(name: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('create_demo_organisation', { name });
  if (error) throw error;
  await syncBank(data as string);
  return data as string;
}

export async function createLiveOrganisation(name: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('create_live_organisation', { name });
  if (error) throw new Error('The live workspace could not be created.');
  if (typeof data !== 'string') throw new Error('The live workspace could not be created.');
  return data;
}

/** Only Basiq's HTTPS consent application may receive a short-lived client token. */
export function validateConsentUrl(value: unknown): string {
  if (typeof value !== 'string') throw new Error('The bank consent link is unavailable.');
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('The bank consent link is invalid.');
  }
  if (
    url.origin !== 'https://consent.basiq.io' ||
    url.pathname !== '/home' ||
    url.username ||
    url.password ||
    url.hash
  )
    throw new Error('The bank consent link is invalid.');
  return url.href;
}

export type BankingAction =
  'status' | 'connect' | 'manage' | 'extend' | 'reauthorise' | 'disconnect';

async function bankingAction(organisationId: string, entityId: string, action: BankingAction) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.functions.invoke('bank-connect', {
    body: { organisationId, entityId, action },
  });
  if (error)
    throw new Error(
      'Unable to update your bank connection. Try again or contact your workspace administrator.',
    );
  if (!data || typeof data !== 'object')
    throw new Error('Bank connection response is unavailable.');
  return data as Record<string, unknown>;
}

function validTimestamp(value: unknown): value is string | null {
  return value === null || (typeof value === 'string' && Number.isFinite(Date.parse(value)));
}

export async function loadBankingStatus(
  organisationId: string,
  entityId: string,
): Promise<BankingStatus> {
  const data = await bankingAction(organisationId, entityId, 'status');
  const connectionStates = ['not_connected', 'pending', 'active', 'error', 'consent_required'];
  const rowStates = ['pending', 'active', 'error', 'consent_required'];
  if (
    data.entityId !== entityId ||
    data.provider !== 'basiq' ||
    typeof data.configured !== 'boolean' ||
    typeof data.automaticSync !== 'boolean' ||
    !connectionStates.includes(String(data.connectionState)) ||
    !validTimestamp(data.lastSyncedAt) ||
    !validTimestamp(data.consentExpiresAt) ||
    !Array.isArray(data.connections) ||
    !data.connections.every(
      (row) =>
        row &&
        typeof row === 'object' &&
        typeof row.id === 'string' &&
        typeof row.institutionId === 'string' &&
        typeof row.institutionName === 'string' &&
        rowStates.includes(String(row.state)) &&
        validTimestamp(row.lastSyncedAt) &&
        validTimestamp(row.consentExpiresAt),
    ) ||
    (data.reason !== undefined && typeof data.reason !== 'string')
  )
    throw new Error('Bank connection status is unavailable. Please try again.');
  return data as unknown as BankingStatus;
}

export async function bankingConsentUrl(
  organisationId: string,
  entityId: string,
  action: Exclude<BankingAction, 'status' | 'disconnect'>,
) {
  const data = await bankingAction(organisationId, entityId, action);
  if (data.entityId !== entityId) throw new Error('The bank consent link is unavailable.');
  return validateConsentUrl(data.url);
}

export async function disconnectBank(organisationId: string, entityId: string) {
  const data = await bankingAction(organisationId, entityId, 'disconnect');
  if (data.entityId !== entityId || data.disconnected !== true)
    throw new Error('The bank connections could not be disconnected.');
}

export async function syncBank(organisationId: string, entityId?: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.functions.invoke('bank-sync', {
    body: { organisationId, ...(entityId ? { entityId } : {}) },
  });
  if (error)
    throw new Error(
      'Bank refresh failed. Check the connection in Workspace settings and try again.',
    );
}
export async function saveCategory(transactionId: string, categoryId: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.rpc('set_transaction_category', {
    transaction_id: transactionId,
    category_id: categoryId,
  });
  if (error) throw error;
}

/** Save a selection in one database transaction; never report a partial update as success. */
export async function saveCategories(
  transactionIds: string[],
  categoryId: string,
): Promise<number> {
  if (!supabase) throw new Error('Supabase is not configured');
  const ids = [...new Set(transactionIds)];
  if (!ids.length || ids.length > 1000 || ids.some((id) => !id) || !categoryId)
    throw new Error('Select between 1 and 1,000 transactions and a category.');
  const { data, error } = await supabase.rpc('set_transaction_categories', {
    transaction_ids: ids,
    category_id: categoryId,
  });
  if (error) throw error;
  if (!Number.isInteger(data) || data !== ids.length)
    throw new Error('The category update could not be confirmed. Refresh before trying again.');
  return data as number;
}
