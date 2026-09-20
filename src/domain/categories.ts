import type { Category, Transaction } from '../types/domain.ts';

interface CategoryRule {
  category: string;
  sign: 'positive' | 'negative';
  pattern: RegExp;
}

/** Order is intentional: specific settlement and expense rules precede broad terms. */
const RULES: readonly CategoryRule[] = [
  {
    category: 'Health fund receipts',
    sign: 'positive',
    pattern: /\b(HICAPS|HEALTH FUND|INSURANCE SETTLEMENT)\b/i,
  },
  {
    category: 'Patient receipts',
    sign: 'positive',
    pattern: /\b(PATIENT|TYRO SETTLEMENT|EFTPOS SETTLEMENT)\b/i,
  },
  { category: 'Interest income', sign: 'positive', pattern: /\bINTEREST (CREDIT|PAID|EARNED)\b/i },
  {
    category: 'Wages & super',
    sign: 'negative',
    pattern: /\b(PAYROLL|SUPERANNUATION|SUPER PAYMENT)\b/i,
  },
  { category: 'Loan payments', sign: 'negative', pattern: /\bLOAN REPAYMENT\b/i },
  { category: 'Tax & GST payments', sign: 'negative', pattern: /\bATO TAX GST PAYMENT\b/i },
  { category: 'Interest expense', sign: 'negative', pattern: /\bINTEREST CHARGE\b/i },
  { category: 'Rent & premises', sign: 'negative', pattern: /\b(RENT|COMMERCIAL LEASE)\b/i },
  {
    category: 'Dental supplies',
    sign: 'negative',
    pattern: /\b(DENTAL SUPPLIES|DENTAL CONSUMABLES|CLINICAL SUPPLIES)\b/i,
  },
  {
    category: 'Laboratory fees',
    sign: 'negative',
    pattern: /\b(DENTAL LAB|LABORATORY|CROWN LAB)\b/i,
  },
  {
    category: 'Equipment & maintenance',
    sign: 'negative',
    pattern: /\b(EQUIPMENT|AUTOCLAVE|CHAIR SERVICE)\b/i,
  },
  {
    category: 'Utilities',
    sign: 'negative',
    pattern: /\b(ELECTRICITY|ENERGY|WATER|INTERNET|BROADBAND)\b/i,
  },
  {
    category: 'Software & subscriptions',
    sign: 'negative',
    pattern: /\b(SOFTWARE|SUBSCRIPTION|PRACTICE CLOUD)\b/i,
  },
  {
    category: 'Insurance',
    sign: 'negative',
    pattern: /\b(INSURANCE PREMIUM|PROFESSIONAL INDEMNITY)\b/i,
  },
  {
    category: 'Merchant & bank fees',
    sign: 'negative',
    pattern: /\b(MERCHANT FEE|BANK FEE|PROCESSING FEE)\b/i,
  },
  { category: 'Marketing', sign: 'negative', pattern: /\b(MARKETING|ADVERTISING|SEARCH ADS)\b/i },
  { category: 'Groceries', sign: 'negative', pattern: /\b(GROCER|SUPERMARKET|FRESH MARKET)\b/i },
  { category: 'Dining', sign: 'negative', pattern: /\b(CAFE|RESTAURANT|DINING)\b/i },
  { category: 'Transport', sign: 'negative', pattern: /\b(PETROL|FUEL|TRANSPORT|PARKING)\b/i },
  {
    category: 'Personal spending',
    sign: 'negative',
    pattern: /\b(PERSONAL SHOPPING|HOMEWARES)\b/i,
  },
];

/** Manual choices survive every processing pass, including a manual null choice. */
export function categoriseTransaction(
  transaction: Transaction,
  categories: readonly Category[],
): Transaction {
  if (transaction.categorySource === 'manual') return { ...transaction };
  if (transaction.transferPairId) {
    const transfer = categories.find((category) => category.kind === 'transfer');
    if (transfer)
      return {
        ...transaction,
        categoryId: transfer.id,
        categorySource: 'rule',
        receiptStatus: 'not_required',
      };
  }
  const searchable = `${transaction.description} ${transaction.merchant ?? ''}`;
  const matched = RULES.find(
    (rule) =>
      (rule.sign === 'positive' ? transaction.amountCents > 0 : transaction.amountCents < 0) &&
      rule.pattern.test(searchable),
  );
  const category = matched && categories.find((candidate) => candidate.name === matched.category);
  return {
    ...transaction,
    categoryId: category ? category.id : null,
    categorySource: category ? 'rule' : 'uncategorised',
  };
}
