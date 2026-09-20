import type { Account, Category, FinanceDataset, Transaction } from '../types/domain.ts';
import { categoriseTransaction } from './categories.ts';
import { shiftDate } from './dates.ts';
import { detectInternalTransfers, stableId } from './transfers.ts';

export const MOCK_AS_OF = '2026-09-20';
const UPDATED_AT = `${MOCK_AS_OF}T07:30:00.000Z`;

/** Entirely fictitious, repeatable fixture. It contains no customer bank data. */
export function createMockDataset(): FinanceDataset {
  const organisation = {
    id: stableId('organisation', 'demo'),
    name: 'Banksia Dental Group',
    isDemo: true,
  };
  const entities = [
    {
      id: stableId('entity', 'a'),
      organisationId: organisation.id,
      name: 'Clinic A · Paddington',
      kind: 'clinic' as const,
    },
    {
      id: stableId('entity', 'b'),
      organisationId: organisation.id,
      name: 'Clinic B · New Farm',
      kind: 'clinic' as const,
    },
    {
      id: stableId('entity', 'personal'),
      organisationId: organisation.id,
      name: 'Personal',
      kind: 'personal' as const,
    },
  ];
  const connections = entities.map((entity) => ({
    id: stableId('connection', entity.id),
    organisationId: organisation.id,
    entityId: entity.id,
    provider: 'mock' as const,
    status: 'active' as const,
    lastSyncedAt: UPDATED_AT,
  }));
  const definitions: Array<[number, string, Account['kind'], string, number, string]> = [
    [0, 'Clinic A operating', 'operating', 'Commonwealth Bank · Demo', 5_720_500, '4821'],
    [0, 'Clinic A reserve', 'savings', 'Commonwealth Bank · Demo', 9_500_000, '1168'],
    [0, 'Clinic A card', 'credit_card', 'Westpac · Demo', -425_700, '9042'],
    [1, 'Clinic B operating', 'operating', 'ANZ · Demo', 4_381_200, '7305'],
    [1, 'Clinic B reserve', 'savings', 'ANZ · Demo', 6_200_000, '2289'],
    [1, 'Clinic B card', 'credit_card', 'NAB · Demo', -280_500, '6501'],
    [2, 'Everyday personal', 'transaction', 'Macquarie · Demo', 894_500, '3156'],
    [2, 'Personal credit card', 'credit_card', 'Macquarie · Demo', -95_000, '8824'],
  ];
  const accounts: Account[] = definitions.map(
    ([entityIndex, name, kind, institution, balanceCents, ending], index) => ({
      id: stableId('account', index),
      organisationId: organisation.id,
      entityId: entities[entityIndex].id,
      connectionId: connections[entityIndex].id,
      name,
      institution,
      kind,
      currency: 'AUD',
      balanceCents,
      maskedNumber: `•••• ${ending}`,
      updatedAt: UPDATED_AT,
    }),
  );
  const catalogue: Array<[string, Category['kind'], string]> = [
    ['Patient receipts', 'income', '#4f8d81'],
    ['Health fund receipts', 'income', '#77b5a1'],
    ['Interest income', 'income', '#a6cfb7'],
    ['Wages & super', 'expense', '#456b5c'],
    ['Rent & premises', 'expense', '#8f9e75'],
    ['Dental supplies', 'expense', '#91b5a9'],
    ['Laboratory fees', 'expense', '#bea778'],
    ['Equipment & maintenance', 'expense', '#a4adb5'],
    ['Utilities', 'expense', '#92a1bb'],
    ['Software & subscriptions', 'expense', '#b0a4bf'],
    ['Insurance', 'expense', '#c0ada1'],
    ['Merchant & bank fees', 'expense', '#91aaa6'],
    ['Marketing', 'expense', '#d0bb8e'],
    ['Groceries', 'expense', '#a0b481'],
    ['Dining', 'expense', '#c89e83'],
    ['Transport', 'expense', '#88a8ba'],
    ['Personal spending', 'expense', '#c4a5b0'],
    ['Internal transfers', 'transfer', '#95a29d'],
    ['Loan payments', 'expense', '#8e99b2'],
    ['Tax & GST payments', 'expense', '#a8896f'],
    ['Interest expense', 'expense', '#9e8aa1'],
    ['Miscellaneous business expenses', 'expense', '#98aaa3'],
  ];
  const categories = catalogue.map(([name, kind, colour]) => ({
    id: stableId('category', name),
    name,
    kind,
    colour,
  }));
  let transactions: Transaction[] = [];
  let sequence = 0;
  const add = (
    accountIndex: number,
    date: string,
    description: string,
    amountCents: number,
    merchant: string | null = null,
    pending = false,
  ): void => {
    sequence += 1;
    transactions.push({
      id: stableId('transaction', sequence),
      organisationId: organisation.id,
      accountId: accounts[accountIndex].id,
      providerTransactionId: `mock-${String(sequence).padStart(6, '0')}`,
      postedAt: date,
      description,
      merchant,
      amountCents,
      currency: 'AUD',
      categoryId: null,
      categorySource: 'uncategorised',
      status: pending ? 'pending' : 'posted',
      transferPairId: null,
      receiptStatus: amountCents > 0 ? 'not_required' : sequence % 5 === 0 ? 'missing' : 'attached',
    });
  };
  const transfer = (
    from: number,
    to: number,
    date: string,
    amount: number,
    label: string,
  ): void => {
    add(from, date, `${label} TO ${accounts[to].maskedNumber}`, -amount);
    add(to, date, `${label} FROM ${accounts[from].maskedNumber}`, amount);
  };
  for (let day = 0; day < 90; day += 1) {
    const date = shiftDate(MOCK_AS_OF, day - 89);
    const weekday = new Date(`${date}T00:00:00Z`).getUTCDay();
    const monthDay = Number(date.slice(-2));
    const variation = ((day * 7919 + 137) % 1000) / 1000;
    for (const [clinic, operating, reserve, card] of [
      [0, 0, 1, 2],
      [1, 3, 4, 5],
    ]) {
      const scale = clinic === 0 ? 1 : 0.79;
      const amount = (value: number): number => Math.round(value * scale);
      if (weekday >= 1 && weekday <= 5) {
        add(
          operating,
          date,
          'TYRO SETTLEMENT PATIENT RECEIPTS',
          amount(235_000 + Math.round(variation * 155_000)),
          'Tyro · Demo',
        );
        add(
          operating,
          date,
          'HICAPS HEALTH FUND SETTLEMENT',
          amount(111_000 + Math.round((1 - variation) * 67_000)),
          'HICAPS · Demo',
        );
      }
      if (weekday === 2) {
        add(
          operating,
          date,
          'DENTAL LABORATORY WEEKLY INVOICE',
          -amount(102_750 + day * 59),
          'River City Dental Lab · Fictitious',
        );
        add(
          card,
          date,
          'DENTAL CONSUMABLES ORDER',
          -amount(67_990 + day * 41),
          'Banksia Clinical Supplies · Fictitious',
        );
      }
      if (weekday === 4 && Math.floor(day / 7) % 2 === 0) {
        add(
          operating,
          date,
          'PAYROLL FORTNIGHTLY STAFF WAGES',
          -amount(2_270_000 + (day % 3) * 8100),
          'Staff payroll · Demo',
        );
        add(
          operating,
          date,
          'SUPERANNUATION CONTRIBUTIONS',
          -amount(272_400),
          'Super clearing house · Demo',
        );
      }
      if (weekday === 5)
        transfer(
          operating,
          reserve,
          date,
          amount(150_000 + clinic * 10_000),
          'INTERNAL TRANSFER RESERVE',
        );
      if (monthDay === 1) {
        add(
          operating,
          date,
          'COMMERCIAL LEASE MONTHLY RENT',
          -amount(628_000),
          'Practice property · Fictitious',
        );
        add(
          operating,
          date,
          'PROFESSIONAL INDEMNITY INSURANCE PREMIUM',
          -amount(48_750),
          'Clinic cover · Fictitious',
        );
        add(reserve, date, 'INTEREST CREDIT', amount(21_175), 'Bank interest · Demo');
      }
      if (monthDay === 7) {
        add(
          card,
          date,
          'PRACTICE CLOUD SOFTWARE SUBSCRIPTION',
          -amount(41_900),
          'Practice Cloud · Fictitious',
        );
        add(
          card,
          date,
          'SEARCH ADS MONTHLY ADVERTISING',
          -amount(85_000),
          'Search advertising · Demo',
        );
      }
      if (monthDay === 12) {
        add(
          operating,
          date,
          'ELECTRICITY ENERGY ACCOUNT',
          -amount(78_625),
          'Local energy · Fictitious',
        );
        add(
          card,
          date,
          'INTERNET BROADBAND SERVICE',
          -amount(13_900),
          'Business internet · Fictitious',
        );
        add(operating, date, 'TYRO MERCHANT FEE', -amount(86_213), 'Tyro · Demo');
      }
      if (monthDay === 15) transfer(operating, card, date, amount(455_000), 'CARD REPAYMENT');
      if (monthDay === 18)
        add(
          operating,
          date,
          'AUTOCLAVE EQUIPMENT SERVICE',
          -amount(64_900),
          'Chaircare Maintenance · Fictitious',
        );
      if (monthDay === 21)
        add(
          operating,
          date,
          'BUSINESS EQUIPMENT LOAN REPAYMENT',
          -amount(185_500),
          'Practice lender · Fictitious',
        );
      if (monthDay === 24)
        transfer(operating, reserve, date, amount(240_000), 'INTERNAL TRANSFER GST RESERVE');
      if (monthDay === 28)
        add(
          reserve,
          date,
          'ATO TAX GST PAYMENT',
          -amount(310_000),
          'Australian Taxation Office · Demo',
        );
      if (day === 65 || day === 87)
        add(card, date, `EFT PURCHASE REF ${7382 + day + clinic}`, -amount(23_750 + day * 100));
    }
    if (weekday === 6) {
      add(
        6,
        date,
        'LOCAL SUPERMARKET GROCERIES',
        -(18_300 + day * 53),
        'Neighbourhood Grocer · Fictitious',
      );
      add(7, date, 'WEEKEND CAFE', -(4_650 + day * 11), 'Garden Cafe · Fictitious');
    }
    if (weekday === 3) add(6, date, 'PETROL FUEL', -(7_850 + day * 9), 'Local fuel · Fictitious');
    if (monthDay === 5) transfer(6, 7, date, 85_000, 'CARD REPAYMENT');
    if (monthDay === 15)
      add(7, date, 'CREDIT CARD INTEREST CHARGE', -3_456, 'Bank interest · Demo');
    if (monthDay === 21)
      add(6, date, 'HOMEWARES PERSONAL SHOPPING', -24_950, 'Home store · Fictitious');
    if (day === 89) {
      add(
        2,
        date,
        'DENTAL SUPPLIES ORDER PENDING',
        -38_940,
        'Banksia Clinical Supplies · Fictitious',
        true,
      );
      add(5, date, 'EFT PURCHASE PENDING', -12_750, null, true);
      add(0, date, 'PATIENT EFTPOS SETTLEMENT PENDING', 195_000, 'Tyro · Demo', true);
    }
  }
  transactions = detectInternalTransfers(transactions, accounts).map((transaction) =>
    categoriseTransaction(transaction, categories),
  );
  // Definitions describe opening balances on 23 June; reconcile posted movements only.
  for (const transaction of transactions) {
    if (transaction.status === 'posted')
      accounts.find((account) => account.id === transaction.accountId)!.balanceCents +=
        transaction.amountCents;
  }
  transactions.sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));
  return { organisation, entities, connections, accounts, categories, transactions };
}
