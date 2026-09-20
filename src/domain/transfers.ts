import type { Account, Transaction } from '../types/domain.ts';
import { daysBetween } from './dates.ts';

const TRANSFER_DESCRIPTION = /\b(INTERNAL TRANSFER|OWN ACCOUNT|CARD REPAYMENT|CREDIT CARD PAYMENT)\b/i;

/** Stable UUID-format identifier, used only for synthetic/internal matching identities. */
export function stableId(namespace: string, value: string | number): string {
  const input = `${namespace}:${value}`;
  const words = [2166136261, 3339675911, 2246822507, 3266489909].map((seed) => {
    let hash = seed;
    for (let index = 0; index < input.length; index += 1) hash = Math.imul(hash ^ input.charCodeAt(index), 16777619);
    return (hash >>> 0).toString(16).padStart(8, '0');
  });
  const hex = words.join('');
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-4${hex.slice(13, 16)}-a${hex.slice(17, 20)}-${hex.slice(20, 32)}`;
}

/**
 * Match only uniquely reciprocal posted entries in owned, distinct accounts.
 * Both descriptions must identify an internal move. Equal amounts alone are
 * insufficient. Any plausible additional counterpart makes the match ambiguous.
 * Call with the complete owned ledger, before applying entity/date UI filters.
 */
export function detectInternalTransfers(
  transactions: readonly Transaction[],
  accounts: readonly Account[],
  options: { maxDaysApart?: number } = {},
): Transaction[] {
  const maxDaysApart = options.maxDaysApart ?? 3;
  if (!Number.isFinite(maxDaysApart) || maxDaysApart < 0) throw new Error('Transfer matching window must be non-negative.');
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const eligible = transactions.filter((transaction) => {
    const account = accountMap.get(transaction.accountId);
    return transaction.status === 'posted' && Number.isSafeInteger(transaction.amountCents)
      && transaction.amountCents !== 0 && account?.organisationId === transaction.organisationId
      && account.currency === transaction.currency;
  });
  const candidates = new Map<string, Transaction[]>();
  for (const transaction of eligible) {
    candidates.set(transaction.id, eligible.filter((other) =>
      transaction.id !== other.id
      && transaction.accountId !== other.accountId
      && transaction.organisationId === other.organisationId
      && transaction.currency === other.currency
      && transaction.amountCents === -other.amountCents
      && daysBetween(transaction.postedAt, other.postedAt) <= maxDaysApart));
  }
  const pairs = new Map<string, string>();
  for (const transaction of eligible) {
    const possible = candidates.get(transaction.id)!;
    if (possible.length !== 1) continue;
    const other = possible[0];
    if (candidates.get(other.id)?.length !== 1) continue;
    if (!TRANSFER_DESCRIPTION.test(transaction.description) || !TRANSFER_DESCRIPTION.test(other.description)) continue;
    const pairId = stableId('transfer-pair', [transaction.id, other.id].sort().join(':'));
    pairs.set(transaction.id, pairId);
    pairs.set(other.id, pairId);
  }
  // Recompute derived matches so stale or one-sided prior matches cannot persist.
  return transactions.map((transaction) => ({ ...transaction, transferPairId: pairs.get(transaction.id) ?? null }));
}

/** Validate persisted pairs against the full ledger before excluding cash flows. */
export function verifiedTransferIds(transactions: readonly Transaction[], accounts: readonly Account[]): Set<string> {
  const accountMap = new Map(accounts.map((account) => [account.id, account]));
  const pairs = new Map<string, Transaction[]>();
  for (const transaction of transactions) {
    if (!transaction.transferPairId) continue;
    const group = pairs.get(transaction.transferPairId) ?? [];
    group.push(transaction);
    pairs.set(transaction.transferPairId, group);
  }
  const matched = new Set<string>();
  for (const group of pairs.values()) {
    if (group.length !== 2) continue;
    const [a, b] = group;
    const aAccount = accountMap.get(a.accountId);
    const bAccount = accountMap.get(b.accountId);
    if (a.status !== 'posted' || b.status !== 'posted' || !aAccount || !bAccount) continue;
    if (a.id === b.id || a.accountId === b.accountId || a.organisationId !== b.organisationId) continue;
    if (aAccount.organisationId !== a.organisationId || bAccount.organisationId !== b.organisationId) continue;
    if (a.currency !== b.currency || aAccount.currency !== a.currency || bAccount.currency !== b.currency) continue;
    if (!Number.isSafeInteger(a.amountCents) || a.amountCents === 0 || a.amountCents !== -b.amountCents) continue;
    if (!(daysBetween(a.postedAt, b.postedAt) <= 3)) continue;
    matched.add(a.id);
    matched.add(b.id);
  }
  return matched;
}
