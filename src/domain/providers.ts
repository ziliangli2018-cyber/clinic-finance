import type { Account, BankConnection, FinanceDataset, Transaction } from '../types/domain.ts';

export interface AccountBalance { accountId: string; currency: 'AUD'; balanceCents: number; asOf: string }

export interface FinancialDataProvider {
  readonly provider: 'mock' | 'basiq';
  connect(): Promise<BankConnection[]>;
  refreshConnection(connectionId: string): Promise<void>;
  getAccounts(connectionId: string): Promise<Account[]>;
  getBalances(connectionId: string): Promise<AccountBalance[]>;
  getTransactions(connectionId: string, since?: string): Promise<Transaction[]>;
  disconnect(connectionId: string): Promise<void>;
  /** Providers return a complete owned dataset, before display filters. */
  loadDataset(): Promise<FinanceDataset>;
}

/** Dependency injection prevents this module importing mock fixtures into production. */
export class MockFinancialProvider implements FinancialDataProvider {
  readonly provider = 'mock' as const;
  private disconnected = new Set<string>();

  constructor(private readonly createDataset: () => FinanceDataset) {}

  async loadDataset(): Promise<FinanceDataset> {
    return this.createDataset();
  }

  async connect() { return (await this.loadDataset()).connections; }
  private async connection(connectionId: string) {
    const data = await this.loadDataset();
    if (this.disconnected.has(connectionId) || !data.connections.some(connection => connection.id === connectionId)) throw new Error('Connection unavailable');
    return data;
  }
  async refreshConnection(connectionId: string) { await this.connection(connectionId); }
  async getAccounts(connectionId: string) { return (await this.connection(connectionId)).accounts.filter(account => account.connectionId === connectionId); }
  async getBalances(connectionId: string) {
    return (await this.getAccounts(connectionId)).map(account => ({ accountId: account.id, currency: account.currency, balanceCents: account.balanceCents, asOf: account.updatedAt }));
  }
  async getTransactions(connectionId: string, since?: string) {
    const data = await this.connection(connectionId);
    const accounts = new Set(data.accounts.filter(account => account.connectionId === connectionId).map(account => account.id));
    return data.transactions.filter(transaction => accounts.has(transaction.accountId) && (!since || transaction.postedAt >= since));
  }
  async disconnect(connectionId: string) { await this.connection(connectionId); this.disconnected.add(connectionId); }
}

/** Production bank access belongs in authenticated server functions, never this browser. */
export class BasiqFinancialProvider implements FinancialDataProvider {
  readonly provider = 'basiq' as const;

  async loadDataset(): Promise<FinanceDataset> {
    throw new Error('Basiq is not connected. Live banking is unavailable in version 0.1.');
  }
  async connect(): Promise<BankConnection[]> { await this.loadDataset(); return []; }
  async refreshConnection(): Promise<void> { await this.loadDataset(); }
  async getAccounts(): Promise<Account[]> { await this.loadDataset(); return []; }
  async getBalances(): Promise<AccountBalance[]> { await this.loadDataset(); return []; }
  async getTransactions(): Promise<Transaction[]> { await this.loadDataset(); return []; }
  async disconnect(): Promise<void> { await this.loadDataset(); }
}
