import type { FinanceDataset, FinanceScope, Transaction } from '../types/domain';
import type { FinancePlan, PlanFrequency } from '../types/planning';
import { calculateSummary, filterAccounts, filterTransactions, isCashAccount } from './analytics';
import { dateValue, shiftDate } from './dates';
import { verifiedTransferIds } from './transfers';

export interface DetectedBill {
  id: string;
  name: string;
  accountId: string;
  entityId: string;
  categoryId: string | null;
  amountCents: number;
  frequency: PlanFrequency;
  nextDueDate: string;
  lastPaidDate: string;
  paymentCount: number;
}

export interface PlanningInsight {
  id: string;
  title: string;
  detail: string;
  tone: 'positive' | 'attention' | 'neutral';
  amountCents?: number;
  action: 'bills' | 'budgets' | 'transactions' | 'accounts';
  categoryId?: string;
}

const DAY_MS = 86_400_000;

export function planningAsOf(data: FinanceDataset, scope: FinanceScope = {}): string {
  if (scope.to && Number.isFinite(dateValue(scope.to))) return scope.to;
  const dates = [
    ...filterAccounts(data, scope).map((account) => account.updatedAt.slice(0, 10)),
    ...filterTransactions(data, { ...scope, from: undefined, to: undefined }).map(
      (transaction) => transaction.postedAt,
    ),
  ].filter((date) => Number.isFinite(dateValue(date)));
  return (
    dates.sort().at(-1) ??
    new Intl.DateTimeFormat('en-CA', {
      timeZone: 'Australia/Brisbane',
      year: 'numeric',
      month: '2-digit',
      day: '2-digit',
    }).format(new Date())
  );
}

export function visiblePlans(
  plans: readonly FinancePlan[],
  data: FinanceDataset,
  scope: FinanceScope = {},
): FinancePlan[] {
  const entities = new Set(filterAccounts(data, scope).map((account) => account.entityId));
  // An entity can have plans before its first account is connected.
  for (const entity of data.entities) {
    if (entity.organisationId !== data.organisation.id) continue;
    if (scope.entityId && scope.entityId !== 'all' && entity.id !== scope.entityId) continue;
    if (entity.kind === 'personal' && !scope.includePersonal && scope.entityId !== entity.id)
      continue;
    entities.add(entity.id);
  }
  return plans.filter(
    (plan) =>
      plan.organisationId === data.organisation.id &&
      (plan.entityId === null
        ? (!scope.entityId || scope.entityId === 'all') &&
          (!scope.accountId || scope.accountId === 'all')
        : entities.has(plan.entityId)) &&
      (!scope.accountId || scope.accountId === 'all' || plan.accountId === scope.accountId),
  );
}

export function monthPeriod(asOfDate: string): { from: string; to: string } {
  if (!Number.isFinite(dateValue(asOfDate))) throw new Error('Choose a valid reporting date.');
  const date = new Date(dateValue(asOfDate));
  return {
    from: `${asOfDate.slice(0, 7)}-01`,
    to: new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0))
      .toISOString()
      .slice(0, 10),
  };
}

export function budgetProgress(data: FinanceDataset, plan: FinancePlan, asOfDate: string) {
  const period = monthPeriod(asOfDate);
  const transfers = verifiedTransferIds(data.transactions, data.accounts);
  const transactions = filterTransactions(data, {
    entityId: plan.entityId ?? undefined,
    accountId: plan.accountId ?? undefined,
    from: period.from,
    to: asOfDate,
  }).filter(
    (transaction) =>
      transaction.status === 'posted' &&
      !transfers.has(transaction.id) &&
      transaction.amountCents < 0 &&
      (!plan.categoryId || transaction.categoryId === plan.categoryId),
  );
  const spentCents = transactions.reduce((sum, transaction) => sum - transaction.amountCents, 0);
  const elapsedDays = Number(asOfDate.slice(8, 10));
  const daysInMonth = Number(period.to.slice(8, 10));
  return {
    ...period,
    spentCents,
    remainingCents: plan.amountCents - spentCents,
    percent: plan.amountCents > 0 ? (spentCents / plan.amountCents) * 100 : 0,
    projectedCents: Math.round((spentCents / elapsedDays) * daysInMonth),
    transactionCount: transactions.length,
  };
}

export function goalProgress(data: FinanceDataset, plan: FinancePlan, asOfDate: string) {
  const account = plan.accountId
    ? data.accounts.find(
        (row) =>
          row.id === plan.accountId &&
          row.organisationId === data.organisation.id &&
          (!plan.entityId || row.entityId === plan.entityId) &&
          isCashAccount(row),
      )
    : undefined;
  const savedCents = plan.accountId ? Math.max(0, account?.balanceCents ?? 0) : plan.savedCents;
  const remainingCents = Math.max(0, plan.amountCents - savedCents);
  const daysLeft = plan.dueDate
    ? Math.ceil((dateValue(plan.dueDate) - dateValue(asOfDate)) / DAY_MS)
    : null;
  return {
    savedCents,
    remainingCents,
    percent: plan.amountCents > 0 ? Math.min(100, (savedCents / plan.amountCents) * 100) : 0,
    complete: savedCents >= plan.amountCents,
    account,
    source: plan.accountId ? (account ? 'account' : 'unavailable') : 'manual',
    daysLeft,
    monthlyNeededCents:
      daysLeft && daysLeft > 0 ? Math.ceil((remainingCents / daysLeft) * 30) : null,
  };
}

/** Calendar recurrence retains the original day; 31 Jan -> 28 Feb -> 31 Mar. */
export function advanceDueDate(
  date: string,
  frequency: PlanFrequency,
  anchorDay = Number(date.slice(8, 10)),
): string {
  if (!Number.isFinite(dateValue(date))) throw new Error('Choose a valid bill date.');
  if (frequency === 'weekly' || frequency === 'fortnightly')
    return shiftDate(date, frequency === 'weekly' ? 7 : 14);
  const months = frequency === 'monthly' ? 1 : frequency === 'quarterly' ? 3 : 12;
  const current = new Date(dateValue(date));
  const target = new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() + months, 1));
  const lastDay = new Date(
    Date.UTC(target.getUTCFullYear(), target.getUTCMonth() + 1, 0),
  ).getUTCDate();
  target.setUTCDate(Math.min(anchorDay, lastDay));
  return target.toISOString().slice(0, 10);
}

export function nextBillDate(
  dueDate: string,
  frequency: PlanFrequency,
  asOfDate: string,
  anchorDay = Number(dueDate.slice(8, 10)),
): string {
  if (!Number.isFinite(dateValue(asOfDate))) throw new Error('Choose a valid reporting date.');
  let next = dueDate;
  // Even a very old imported weekly schedule has a bounded calculation.
  for (let attempts = 0; next < asOfDate && attempts < 6000; attempts += 1)
    next = advanceDueDate(next, frequency, anchorDay);
  if (!Number.isFinite(dateValue(next)) || next < asOfDate)
    throw new Error('The bill schedule is too old.');
  return next;
}

export function billOccurrences(
  dueDate: string,
  frequency: PlanFrequency,
  from: string,
  to: string,
): string[] {
  if (!Number.isFinite(dateValue(to)) || to < from) throw new Error('Choose a valid bill period.');
  const dates: string[] = [];
  let next = nextBillDate(dueDate, frequency, from);
  const anchorDay = Number(dueDate.slice(8, 10));
  while (next <= to && dates.length < 1000) {
    dates.push(next);
    next = advanceDueDate(next, frequency, anchorDay);
  }
  return dates;
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2);
}

function merchantKey(transaction: Transaction): string {
  return (transaction.merchant || transaction.description)
    .trim()
    .toLowerCase()
    .replace(/\b\d{4,}\b/g, '')
    .replace(/\s+/g, ' ');
}

export function detectRecurringBills(
  data: FinanceDataset,
  scope: FinanceScope = {},
  asOfDate = planningAsOf(data, scope),
): DetectedBill[] {
  const transfers = verifiedTransferIds(data.transactions, data.accounts);
  const accounts = new Map(filterAccounts(data, scope).map((account) => [account.id, account]));
  const groups = new Map<string, Transaction[]>();
  for (const transaction of filterTransactions(data, {
    ...scope,
    from: shiftDate(asOfDate, -740),
    to: asOfDate,
  })) {
    if (
      transaction.status !== 'posted' ||
      transaction.amountCents >= 0 ||
      transfers.has(transaction.id)
    )
      continue;
    const key = `${transaction.accountId}:${merchantKey(transaction)}`;
    const group = groups.get(key) ?? [];
    group.push(transaction);
    groups.set(key, group);
  }
  const candidates: {
    frequency: PlanFrequency;
    days: number;
    tolerance: number;
    minimum: number;
  }[] = [
    { frequency: 'weekly', days: 7, tolerance: 2, minimum: 3 },
    { frequency: 'fortnightly', days: 14, tolerance: 3, minimum: 3 },
    { frequency: 'monthly', days: 30, tolerance: 5, minimum: 2 },
    { frequency: 'quarterly', days: 91, tolerance: 10, minimum: 2 },
    { frequency: 'yearly', days: 365, tolerance: 14, minimum: 2 },
  ];
  const results: DetectedBill[] = [];
  for (const [id, group] of groups) {
    const rows = group.sort((left, right) => left.postedAt.localeCompare(right.postedAt));
    const dates = [...new Set(rows.map((row) => row.postedAt))];
    if (dates.length < 2 || dates.length !== rows.length) continue;
    const gaps = dates
      .slice(1)
      .map((date, index) => (dateValue(date) - dateValue(dates[index])) / DAY_MS);
    const match = candidates.find(
      (candidate) =>
        dates.length >= candidate.minimum &&
        gaps.filter((gap) => Math.abs(gap - candidate.days) <= candidate.tolerance).length /
          gaps.length >=
          0.75,
    );
    const last = rows.at(-1)!;
    if (!match || (dateValue(asOfDate) - dateValue(last.postedAt)) / DAY_MS > match.days * 2)
      continue;
    const amounts = rows.map((row) => -row.amountCents);
    const amountCents = median(amounts);
    if (
      amounts.filter((amount) => Math.abs(amount - amountCents) <= amountCents * 0.25).length /
        amounts.length <
      0.75
    )
      continue;
    const account = accounts.get(last.accountId)!;
    results.push({
      id,
      name: last.merchant || last.description,
      accountId: last.accountId,
      entityId: account.entityId,
      categoryId: last.categoryId,
      amountCents,
      frequency: match.frequency,
      nextDueDate: nextBillDate(
        last.postedAt,
        match.frequency,
        last.postedAt === asOfDate ? shiftDate(asOfDate, 1) : asOfDate,
        Math.max(...dates.map((date) => Number(date.slice(8, 10)))),
      ),
      lastPaidDate: last.postedAt,
      paymentCount: dates.length,
    });
  }
  return results.sort(
    (left, right) =>
      left.nextDueDate.localeCompare(right.nextDueDate) || left.name.localeCompare(right.name),
  );
}

export function buildPlanningInsights(
  data: FinanceDataset,
  scope: FinanceScope,
  plans: readonly FinancePlan[],
): PlanningInsight[] {
  const asOfDate = planningAsOf(data, scope);
  const period = monthPeriod(asOfDate);
  const summary = calculateSummary(data, { ...scope, from: period.from, to: asOfDate });
  const insights: PlanningInsight[] = [];
  const cashCents = filterAccounts(data, scope)
    .filter(isCashAccount)
    .reduce((sum, account) => sum + account.balanceCents, 0);
  const manualBills = visiblePlans(plans, data, scope).filter(
    (plan) => plan.kind === 'bill' && plan.dueDate && plan.frequency,
  );
  const upcomingEnd = shiftDate(asOfDate, 14);
  const dueCents = manualBills.reduce(
    (sum, plan) =>
      sum +
      billOccurrences(plan.dueDate!, plan.frequency!, asOfDate, upcomingEnd).length *
        plan.amountCents,
    0,
  );
  if (manualBills.length)
    insights.push({
      id: 'bill-cover',
      title: dueCents > cashCents ? 'Upcoming bills need attention' : 'Your next bills are covered',
      detail: `Tracked bills due in the next 14 days total ${money(dueCents)}. Cash account balances total ${money(cashCents)}. This compares current cash with planned bills; other future spending is not included.`,
      tone: dueCents > cashCents ? 'attention' : 'positive',
      amountCents: dueCents,
      action: 'bills',
    });
  for (const plan of visiblePlans(plans, data, scope).filter((plan) => plan.kind === 'budget')) {
    const progress = budgetProgress(data, plan, asOfDate);
    if (progress.spentCents > plan.amountCents)
      insights.push({
        id: `budget-${plan.id}`,
        title: `${plan.name} is over budget`,
        detail: `${money(progress.spentCents)} in posted outflows this month, ${money(-progress.remainingCents)} above the ${money(plan.amountCents)} limit.`,
        tone: 'attention',
        amountCents: -progress.remainingCents,
        action: 'budgets',
      });
  }
  const transfers = verifiedTransferIds(data.transactions, data.accounts);
  const monthDate = new Date(dateValue(period.from));
  const previousFrom = new Date(
    Date.UTC(monthDate.getUTCFullYear(), monthDate.getUTCMonth() - 1, 1),
  )
    .toISOString()
    .slice(0, 10);
  const previousEnd = monthPeriod(previousFrom).to;
  const previousTo = `${previousFrom.slice(0, 7)}-${String(Math.min(Number(asOfDate.slice(8)), Number(previousEnd.slice(8)))).padStart(2, '0')}`;
  const totals = (from: string, to: string) => {
    const map = new Map<string, number>();
    for (const row of filterTransactions(data, { ...scope, from, to })) {
      if (
        row.status !== 'posted' ||
        row.amountCents >= 0 ||
        !row.categoryId ||
        transfers.has(row.id)
      )
        continue;
      map.set(row.categoryId, (map.get(row.categoryId) ?? 0) - row.amountCents);
    }
    return map;
  };
  const current = totals(period.from, asOfDate),
    previous = totals(previousFrom, previousTo);
  const changes = [...current]
    .map(([categoryId, amount]) => ({ categoryId, amount, before: previous.get(categoryId) ?? 0 }))
    .filter(
      (row) =>
        row.before > 0 && row.amount >= row.before * 1.2 && row.amount - row.before >= 10_000,
    )
    .sort((left, right) => right.amount - right.before - (left.amount - left.before))
    .slice(0, 3);
  for (const row of changes) {
    const name =
      data.categories.find((category) => category.id === row.categoryId)?.name ?? 'Category';
    insights.push({
      id: `change-${row.categoryId}`,
      title: `${name} spending has increased`,
      detail: `${money(row.amount)} this month versus ${money(row.before)} for the same elapsed days last month (${Math.round((row.amount / row.before - 1) * 100)}% higher).`,
      tone: 'attention',
      amountCents: row.amount - row.before,
      action: 'transactions',
      categoryId: row.categoryId,
    });
  }
  if (summary.uncategorisedCount)
    insights.push({
      id: 'uncategorised',
      title: 'Give your spending a clearer picture',
      detail: `${summary.uncategorisedCount} posted transactions this month need a category. Categorising them improves budgets and spending insights.`,
      tone: 'neutral',
      action: 'transactions',
    });
  if (summary.pendingCount)
    insights.push({
      id: 'pending',
      title: 'Some activity is still pending',
      detail: `${summary.pendingCount} pending transactions this month are visible in the ledger and excluded from monthly budget calculations until posted.`,
      tone: 'neutral',
      action: 'transactions',
    });
  if (!insights.length)
    insights.push({
      id: 'clear',
      title: 'Your finances at a glance',
      detail: `${money(summary.incomeCents)} came in and ${money(summary.expenseCents)} went out in posted cash movements this month. Add budgets and bills to make this view more useful.`,
      tone: 'neutral',
      amountCents: summary.netCashflowCents,
      action: 'budgets',
    });
  return insights;
}

function money(cents: number): string {
  return new Intl.NumberFormat('en-AU', {
    style: 'currency',
    currency: 'AUD',
    maximumFractionDigits: 0,
  }).format(cents / 100);
}
