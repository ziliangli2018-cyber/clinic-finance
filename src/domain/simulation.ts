import type { Account, FinanceDataset, Transaction } from '../types/domain.ts';
import { categoriseTransaction } from './categories.ts';
import { dateValue } from './dates.ts';
import { stableId } from './transfers.ts';

export interface DemoAdvanceResult {
  dataset: FinanceDataset;
  sequence: number;
  message: string;
}

type AccountKind = Account['kind'];

interface TransactionActivity {
  kind: 'transaction';
  accountKind: AccountKind;
  clinicIndex: number;
  description: string;
  merchant: string;
  amountCents: number;
  pending?: boolean;
  receiptStatus?: Transaction['receiptStatus'];
}

interface SettlementActivity {
  kind: 'settlement';
}

type DemoActivity = TransactionActivity | SettlementActivity;

const ACTIVITY_CYCLE: readonly DemoActivity[] = [
  { kind: 'settlement' },
  {
    kind: 'transaction',
    accountKind: 'operating',
    clinicIndex: 0,
    description: 'TYRO SETTLEMENT PATIENT RECEIPTS',
    merchant: 'Tyro · Simulated',
    amountCents: 286_450,
  },
  {
    kind: 'transaction',
    accountKind: 'credit_card',
    clinicIndex: 0,
    description: 'DENTAL CONSUMABLES ORDER PENDING',
    merchant: 'Banksia Clinical Supplies · Simulated',
    amountCents: -46_890,
    pending: true,
  },
  {
    kind: 'transaction',
    accountKind: 'operating',
    clinicIndex: 1,
    description: 'HICAPS HEALTH FUND SETTLEMENT',
    merchant: 'HICAPS · Simulated',
    amountCents: 137_250,
  },
  { kind: 'settlement' },
  {
    kind: 'transaction',
    accountKind: 'operating',
    clinicIndex: 0,
    description: 'DENTAL LABORATORY WEEKLY INVOICE',
    merchant: 'River City Dental Lab · Simulated',
    amountCents: -112_500,
    receiptStatus: 'attached',
  },
  {
    kind: 'transaction',
    accountKind: 'operating',
    clinicIndex: 1,
    description: 'ELECTRICITY ENERGY ACCOUNT',
    merchant: 'Local energy · Simulated',
    amountCents: -48_620,
    receiptStatus: 'attached',
  },
  {
    kind: 'transaction',
    accountKind: 'credit_card',
    clinicIndex: 1,
    description: 'PRACTICE CLOUD SOFTWARE SUBSCRIPTION PENDING',
    merchant: 'Practice Cloud · Simulated',
    amountCents: -29_900,
    pending: true,
  },
  { kind: 'settlement' },
] as const;

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

function latestTransactionDate(dataset: FinanceDataset, now: Date): string {
  const dates = dataset.transactions
    .map((transaction) => transaction.postedAt)
    .filter((date) => Number.isFinite(dateValue(date)));
  return (
    dates.reduce((latest, date) => (date > latest ? date : latest), '') ||
    now.toISOString().slice(0, 10)
  );
}

function selectAccount(
  dataset: FinanceDataset,
  accountKind: AccountKind,
  clinicIndex: number,
): Account {
  const clinicIds = new Set(
    dataset.entities.filter((entity) => entity.kind === 'clinic').map((entity) => entity.id),
  );
  const matching = dataset.accounts.filter(
    (account) => clinicIds.has(account.entityId) && account.kind === accountKind,
  );
  const fallback = dataset.accounts.find((account) => clinicIds.has(account.entityId));
  const account = matching[clinicIndex % Math.max(matching.length, 1)] ?? fallback;
  if (!account) throw new Error('The demo dataset has no clinic account to update.');
  return account;
}

function amountFor(activity: TransactionActivity, sequence: number): number {
  const completedCycles = Math.floor(sequence / ACTIVITY_CYCLE.length);
  const variation = (completedCycles % 5) * 173;
  return activity.amountCents < 0
    ? activity.amountCents - variation
    : activity.amountCents + variation;
}

function updateSource(
  dataset: FinanceDataset,
  accountId: string,
  balanceChange: number,
  timestamp: string,
): void {
  const account = dataset.accounts.find((candidate) => candidate.id === accountId);
  if (!account) throw new Error('The simulated transaction account is unavailable.');
  account.balanceCents += balanceChange;
  account.updatedAt = timestamp;
  const connection = dataset.connections.find((candidate) => candidate.id === account.connectionId);
  if (connection) connection.lastSyncedAt = timestamp;
}

function settlePending(
  dataset: FinanceDataset,
  timestamp: string,
): { settled: Transaction; message: string } | null {
  const pending = dataset.transactions
    .filter((transaction) => transaction.status === 'pending')
    .sort(
      (a, b) =>
        a.postedAt.localeCompare(b.postedAt) ||
        a.providerTransactionId.localeCompare(b.providerTransactionId),
    )[0];
  if (!pending) return null;
  const settled: Transaction = { ...pending, status: 'posted' };
  dataset.transactions = dataset.transactions.map((transaction) =>
    transaction.id === pending.id ? settled : transaction,
  );
  updateSource(dataset, settled.accountId, settled.amountCents, timestamp);
  return {
    settled,
    message: `${settled.merchant ?? settled.description} moved from pending to posted.`,
  };
}

/**
 * Advance the fictional browser demo by one deterministic activity.
 *
 * Posted items affect their account balance immediately; pending items do not
 * affect it until a later settlement activity. The transaction date remains at
 * the fixture's latest ledger date so activity stays in the demo report range.
 */
export function advanceDemoDataset(
  input: FinanceDataset,
  sequence: number,
  now: Date,
): DemoAdvanceResult {
  if (!Number.isSafeInteger(sequence) || sequence < 0)
    throw new Error('The demo activity sequence must be a non-negative integer.');
  if (!(now instanceof Date) || !Number.isFinite(now.getTime()))
    throw new Error('A valid demo activity timestamp is required.');

  const dataset = copyDataset(input);
  const timestamp = now.toISOString();
  const nextSequence = sequence + 1;
  const activity = ACTIVITY_CYCLE[sequence % ACTIVITY_CYCLE.length];

  if (activity.kind === 'settlement') {
    const result = settlePending(dataset, timestamp);
    if (result) return { dataset, sequence: nextSequence, message: result.message };
  }

  const transactionActivity: TransactionActivity =
    activity.kind === 'transaction'
      ? activity
      : {
          kind: 'transaction',
          accountKind: 'operating',
          clinicIndex: 0,
          description: 'TYRO SETTLEMENT PATIENT RECEIPTS',
          merchant: 'Tyro · Simulated',
          amountCents: 251_900,
        };
  const account = selectAccount(
    dataset,
    transactionActivity.accountKind,
    transactionActivity.clinicIndex,
  );
  const amountCents = amountFor(transactionActivity, sequence);
  const transaction = categoriseTransaction(
    {
      id: stableId('simulated-transaction', `${dataset.organisation.id}:${nextSequence}`),
      organisationId: dataset.organisation.id,
      accountId: account.id,
      providerTransactionId: `simulated-${String(nextSequence).padStart(6, '0')}`,
      postedAt: latestTransactionDate(dataset, now),
      description: transactionActivity.description,
      merchant: transactionActivity.merchant,
      amountCents,
      currency: 'AUD',
      categoryId: null,
      categorySource: 'uncategorised',
      status: transactionActivity.pending ? 'pending' : 'posted',
      transferPairId: null,
      receiptStatus:
        transactionActivity.receiptStatus ?? (amountCents > 0 ? 'not_required' : 'attached'),
    },
    dataset.categories,
  );
  dataset.transactions = [transaction, ...dataset.transactions];
  updateSource(dataset, account.id, transaction.status === 'posted' ? amountCents : 0, timestamp);

  return {
    dataset,
    sequence: nextSequence,
    message:
      transaction.status === 'pending'
        ? `${transaction.merchant ?? transaction.description} appeared as pending.`
        : `${transaction.merchant ?? transaction.description} was posted.`,
  };
}
