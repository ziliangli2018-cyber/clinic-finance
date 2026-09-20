import type { Account, CashflowPoint, CategoryBreakdown, FinanceDataset, FinanceScope, FinanceSummary, Transaction } from '../types/domain.ts';
import { dateValue, shiftDate } from './dates.ts';
import { verifiedTransferIds } from './transfers.ts';

function validateScope(scope: FinanceScope): void {
  for (const date of [scope.from, scope.to]) {
    if (date !== undefined && !Number.isFinite(dateValue(date))) throw new Error('Date filters must be valid YYYY-MM-DD dates.');
  }
  if (scope.from && scope.to && scope.from > scope.to) throw new Error('The start date must not follow the end date.');
}

export function filterAccounts(dataset: FinanceDataset, scope: FinanceScope = {}): Account[] {
  const explicitEntity = scope.entityId && scope.entityId !== 'all' ? scope.entityId : undefined;
  const explicitAccount = scope.accountId && scope.accountId !== 'all' ? scope.accountId : undefined;
  const entities = new Map(dataset.entities.filter((entity) => entity.organisationId === dataset.organisation.id).map((entity) => [entity.id, entity]));
  return dataset.accounts.filter((account) => {
    const entity = entities.get(account.entityId);
    if (account.organisationId !== dataset.organisation.id || !entity) return false;
    if (explicitEntity && entity.id !== explicitEntity) return false;
    if (explicitAccount && account.id !== explicitAccount) return false;
    return entity.kind !== 'personal' || scope.includePersonal === true || Boolean(explicitEntity || explicitAccount);
  });
}

/** Includes pending and transfers for ledger display; excludes personal by default. */
export function filterTransactions(dataset: FinanceDataset, scope: FinanceScope = {}): Transaction[] {
  validateScope(scope);
  const accountIds = new Set(filterAccounts(dataset, scope).map((account) => account.id));
  return dataset.transactions.filter((transaction) =>
    transaction.organisationId === dataset.organisation.id
    && accountIds.has(transaction.accountId)
    && Number.isFinite(dateValue(transaction.postedAt))
    && (!scope.from || transaction.postedAt >= scope.from)
    && (!scope.to || transaction.postedAt <= scope.to));
}

function reportTransactions(dataset: FinanceDataset, scope: FinanceScope): Transaction[] {
  const transfers = verifiedTransferIds(dataset.transactions, dataset.accounts);
  return filterTransactions(dataset, scope).filter((transaction) =>
    transaction.status === 'posted' && !transfers.has(transaction.id));
}

export function calculateSummary(dataset: FinanceDataset, scope: FinanceScope = {}): FinanceSummary {
  const scoped = filterTransactions(dataset, scope);
  const transfers = verifiedTransferIds(dataset.transactions, dataset.accounts);
  const posted = scoped.filter((transaction) => transaction.status === 'posted' && !transfers.has(transaction.id));
  const incomeCents = posted.reduce((total, transaction) => total + Math.max(transaction.amountCents, 0), 0);
  const expenseCents = posted.reduce((total, transaction) => total + Math.max(-transaction.amountCents, 0), 0);
  return {
    balanceCents: filterAccounts(dataset, scope).reduce((total, account) => total + account.balanceCents, 0),
    incomeCents,
    expenseCents,
    netCashflowCents: incomeCents - expenseCents,
    transactionCount: posted.length,
    uncategorisedCount: posted.filter((transaction) => !transaction.categoryId).length,
    missingReceiptCount: posted.filter((transaction) => transaction.amountCents < 0 && transaction.receiptStatus === 'missing').length,
    pendingCount: scoped.filter((transaction) => transaction.status === 'pending').length,
    internalTransferCount: scoped.filter((transaction) => transfers.has(transaction.id)).length,
  };
}

/** Outgoing cash by category, displayed as positive spending amounts. */
export function calculateCategoryBreakdown(dataset: FinanceDataset, scope: FinanceScope = {}): CategoryBreakdown[] {
  const categoryMap = new Map(dataset.categories.map((category) => [category.id, category]));
  const totals = new Map<string | null, CategoryBreakdown>();
  for (const transaction of reportTransactions(dataset, scope)) {
    if (transaction.amountCents >= 0) continue;
    const category = transaction.categoryId ? categoryMap.get(transaction.categoryId) : undefined;
    const key = category?.id ?? null;
    const row = totals.get(key) ?? {
      categoryId: key,
      name: category?.name ?? 'Uncategorised',
      colour: category?.colour ?? '#94a3b8',
      amountCents: 0,
      count: 0,
    };
    row.amountCents -= transaction.amountCents;
    row.count += 1;
    totals.set(key, row);
  }
  return [...totals.values()].sort((a, b) => b.amountCents - a.amountCents || a.name.localeCompare(b.name));
}

function emptyPoint(date: string): CashflowPoint {
  return { date, incomeCents: 0, expenseCents: 0, netCashflowCents: 0 };
}

export function calculateDailyCashflow(dataset: FinanceDataset, scope: FinanceScope = {}): CashflowPoint[] {
  const transactions = reportTransactions(dataset, scope);
  const dates = transactions.map((transaction) => transaction.postedAt).sort();
  const from = scope.from ?? dates[0];
  const to = scope.to ?? dates[dates.length - 1];
  if (!from || !to) return [];
  // Refuse accidental unbounded chart construction from malformed upstream scope.
  if (dateValue(to) - dateValue(from) > 3660 * 86_400_000) throw new Error('Cash-flow chart range cannot exceed ten years.');
  const points = new Map<string, CashflowPoint>();
  for (let date = from; date <= to; date = shiftDate(date, 1)) points.set(date, emptyPoint(date));
  for (const transaction of transactions) {
    const point = points.get(transaction.postedAt)!;
    point.incomeCents += Math.max(transaction.amountCents, 0);
    point.expenseCents += Math.max(-transaction.amountCents, 0);
    point.netCashflowCents += transaction.amountCents;
  }
  return [...points.values()];
}

export function calculateMonthlyCashflow(dataset: FinanceDataset, scope: FinanceScope = {}): CashflowPoint[] {
  const points = new Map<string, CashflowPoint>();
  for (const daily of calculateDailyCashflow(dataset, scope)) {
    const month = daily.date.slice(0, 7);
    const point = points.get(month) ?? emptyPoint(month);
    point.incomeCents += daily.incomeCents;
    point.expenseCents += daily.expenseCents;
    point.netCashflowCents += daily.netCashflowCents;
    points.set(month, point);
  }
  return [...points.values()];
}

export function formatMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', maximumFractionDigits: 2 }).format(cents / 100);
}

export function formatCompactMoney(cents: number): string {
  return new Intl.NumberFormat('en-AU', { style: 'currency', currency: 'AUD', notation: 'compact', maximumFractionDigits: 1 }).format(cents / 100);
}
