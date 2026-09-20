/** Currency values are integer cents; inflows are positive and outflows negative. */
export interface Organisation {
  id: string;
  name: string;
  isDemo: boolean;
}

export interface Entity {
  id: string;
  organisationId: string;
  name: string;
  kind: 'clinic' | 'personal';
}

export interface BankConnection {
  id: string;
  organisationId: string;
  entityId: string;
  provider: 'mock' | 'basiq';
  status: 'active' | 'error' | 'disconnected';
  lastSyncedAt: string | null;
}

export interface Account {
  id: string;
  organisationId: string;
  entityId: string;
  connectionId: string;
  name: string;
  institution: string;
  kind: 'operating' | 'savings' | 'credit_card' | 'transaction';
  currency: 'AUD';
  balanceCents: number;
  maskedNumber: string;
  updatedAt: string;
}

export interface Category {
  id: string;
  name: string;
  kind: 'income' | 'expense' | 'transfer';
  colour: string;
}

export interface Transaction {
  id: string;
  organisationId: string;
  accountId: string;
  providerTransactionId: string;
  postedAt: string;
  description: string;
  merchant: string | null;
  amountCents: number;
  currency: 'AUD';
  categoryId: string | null;
  categorySource: 'rule' | 'manual' | 'uncategorised';
  status: 'posted' | 'pending';
  transferPairId: string | null;
  receiptStatus: 'missing' | 'attached' | 'not_required';
}

export interface FinanceDataset {
  organisation: Organisation;
  entities: Entity[];
  connections: BankConnection[];
  accounts: Account[];
  categories: Category[];
  transactions: Transaction[];
}

export interface FinanceScope {
  entityId?: string;
  accountId?: string;
  from?: string;
  to?: string;
  /** Personal data is excluded unless explicitly selected or included. */
  includePersonal?: boolean;
}

export interface FinanceSummary {
  /** Latest account balances, independent of transaction date range. */
  balanceCents: number;
  incomeCents: number;
  expenseCents: number;
  netCashflowCents: number;
  transactionCount: number;
  uncategorisedCount: number;
  missingReceiptCount: number;
  pendingCount: number;
  internalTransferCount: number;
}

export interface CategoryBreakdown {
  categoryId: string | null;
  name: string;
  colour: string;
  amountCents: number;
  count: number;
}

export interface CashflowPoint {
  /** YYYY-MM-DD for daily data; YYYY-MM for monthly data. */
  date: string;
  incomeCents: number;
  expenseCents: number;
  netCashflowCents: number;
}
