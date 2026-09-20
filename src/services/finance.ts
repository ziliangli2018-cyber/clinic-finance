import type { FinanceDataset, Organisation } from '../types/domain';
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
  return {
    organisation,
    entities: entities.map(camel),
    connections: connections.map(camel),
    accounts: accounts.map(camel),
    categories: categories.map(camel),
    transactions: transactions.map(camel),
  } as unknown as FinanceDataset;
}
export async function seedDemo(name: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { data, error } = await supabase.rpc('create_demo_organisation', { name });
  if (error) throw error;
  await syncBank(data as string);
  return data as string;
}
export async function syncBank(organisationId: string) {
  if (!supabase) throw new Error('Supabase is not configured');
  const { error } = await supabase.functions.invoke('bank-sync', { body: { organisationId } });
  if (error)
    throw new Error(
      `Bank sync failed. Check the backend function deployment and demo data configuration. ${error.message}`,
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
