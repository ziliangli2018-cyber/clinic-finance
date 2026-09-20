import type { FinanceDataset } from '../../../src/types/domain.ts';
import { MockFinancialProvider } from '../../../src/domain/providers.ts';
import { HttpError } from './http.ts';

export interface BankProvider {
  readonly name: 'mock' | 'basiq';
  fetchDataset(organisationId: string): Promise<Record<string, unknown>>;
}

export function assertMockAllowed(
  environment: string | undefined,
  allowMock: string | undefined,
  isDemo: boolean,
): void {
  if (!['development', 'demo'].includes(environment ?? '') || allowMock !== 'true' || !isDemo) {
    throw new HttpError(403, 'Mock banking is disabled for this environment or organisation');
  }
}

/** Stable tenant-scoped identifiers allow safe retries and several demo tenants. */
export async function scopedUuid(organisationId: string, id: string): Promise<string> {
  const bytes = new Uint8Array(
    await crypto.subtle.digest('SHA-256', new TextEncoder().encode(`${organisationId}:${id}`)),
  ).slice(0, 16);
  bytes[6] = (bytes[6] & 0x0f) | 0x50;
  bytes[8] = (bytes[8] & 0x3f) | 0x80;
  const hex = Array.from(bytes, (byte) => byte.toString(16).padStart(2, '0')).join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

export async function normaliseMockDataset(
  source: FinanceDataset,
  organisationId: string,
): Promise<Record<string, unknown>> {
  const ids = new Set(
    [...source.entities, ...source.connections, ...source.accounts, ...source.transactions].map(
      (row) => row.id,
    ),
  );
  source.transactions.forEach((row) => {
    if (row.transferPairId) ids.add(row.transferPairId);
  });
  const map = new Map(
    await Promise.all(
      [...ids].map(async (id) => [id, await scopedUuid(organisationId, id)] as const),
    ),
  );
  const mapped = (id: string) => {
    const value = map.get(id);
    if (!value) throw new Error('Invalid provider relationship');
    return value;
  };
  const connectionByAccount = new Map(source.accounts.map((row) => [row.id, row.connectionId]));
  return {
    categories: source.categories,
    entities: source.entities.map((row) => ({
      id: mapped(row.id),
      name: row.name,
      kind: row.kind,
    })),
    connections: source.connections.map((row) => ({
      id: mapped(row.id),
      entity_id: mapped(row.entityId),
    })),
    accounts: source.accounts.map((row) => ({
      id: mapped(row.id),
      entity_id: mapped(row.entityId),
      connection_id: mapped(row.connectionId),
      name: row.name,
      institution: row.institution,
      kind: row.kind,
      balance_cents: row.balanceCents,
      masked_number: row.maskedNumber,
      updated_at: row.updatedAt,
    })),
    transactions: source.transactions.map((row) => ({
      id: mapped(row.id),
      account_id: mapped(row.accountId),
      provider_transaction_id: row.providerTransactionId,
      posted_at: row.postedAt,
      description: row.description,
      merchant: row.merchant,
      amount_cents: row.amountCents,
      category_id: row.categoryId,
      category_source: row.categorySource,
      status: row.status,
      transfer_pair_id: row.transferPairId ? mapped(row.transferPairId) : null,
      receipt_status: row.receiptStatus,
    })),
    raw_records: source.transactions.map((row) => {
      const connectionId = connectionByAccount.get(row.accountId);
      if (!connectionId) throw new Error('Missing provider account');
      return {
        connection_id: mapped(connectionId),
        provider_record_id: row.providerTransactionId,
        payload: row,
      };
    }),
  };
}

export function bankProvider(
  name: 'mock' | 'basiq',
  environment: string | undefined,
  allowMock: string | undefined,
  isDemo: boolean,
): BankProvider {
  if (name === 'basiq')
    throw new HttpError(501, 'Live bank integration is not available in version 0.1');
  assertMockAllowed(environment, allowMock, isDemo);
  return {
    name: 'mock',
    async fetchDataset(organisationId) {
      // Loaded only after all explicit mock gates passed. No provider secret reaches the browser.
      const { createMockDataset } = await import('../../../src/domain/mock.ts');
      const adapter = new MockFinancialProvider(createMockDataset);
      const source = await adapter.loadDataset();
      const connections = await adapter.connect();
      for (const connection of connections) await adapter.refreshConnection(connection.id);
      const accounts = (
        await Promise.all(connections.map((connection) => adapter.getAccounts(connection.id)))
      ).flat();
      const balances = (
        await Promise.all(connections.map((connection) => adapter.getBalances(connection.id)))
      ).flat();
      const transactions = (
        await Promise.all(connections.map((connection) => adapter.getTransactions(connection.id)))
      ).flat();
      for (const account of accounts)
        account.balanceCents = balances.find(
          (balance) => balance.accountId === account.id,
        )!.balanceCents;
      return normaliseMockDataset(
        { ...source, connections, accounts, transactions },
        organisationId,
      );
    },
  };
}
