import type { Account, Category, FinanceDataset, Transaction } from '../types/domain.ts';
import { categoriseTransaction } from './categories.ts';
import { dateValue } from './dates.ts';
import { detectInternalTransfers, stableId } from './transfers.ts';

export const MAX_CSV_BYTES = 5 * 1024 * 1024;
export const MAX_CSV_ROWS = 5_000;
export const MAX_CSV_LEDGER_ROWS = 10_000;
export const CSV_ORGANISATION_ID = stableId('csv-organisation', 'clinic-finance');
const LOAN_ENTITY_ID = stableId('csv-entity', 'loan-owner-unconfirmed');

export interface CsvDocument {
  headers: string[];
  rows: string[][];
  /** First data record number, including a header when present. */
  rowOffset?: number;
}

export interface CsvMapping {
  date: number;
  description: number;
  amount: number;
  debit: number;
  credit: number;
  transactionId: number;
  dateFormat: 'dmy' | 'mdy' | 'iso';
  reverseSign: boolean;
}

export interface CsvRow {
  rowNumber: number;
  postedAt: string;
  description: string;
  amountCents: number;
  externalId: string | null;
}

export interface CsvPreview {
  rows: CsvRow[];
  errors: { rowNumber: number; message: string }[];
  warnings: string[];
}

export interface CsvImportTarget {
  accountId?: string;
  entityId: string;
  accountName: string;
  institution: string;
  kind: Account['kind'];
  balanceCents: number;
  balanceDate: string;
  /** Actual borrower name, required before the placeholder loan entity is used. */
  loanOwnerName?: string;
}

/** No sample balances or transactions can enter a statement workspace. */
export function createCsvDataset(): FinanceDataset {
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
  return {
    organisation: {
      id: CSV_ORGANISATION_ID,
      name: 'Kilcoy & Burpengary · Statement workspace',
      isDemo: false,
      dataSource: 'csv',
    },
    entities: [
      {
        id: stableId('csv-entity', 'kilcoy'),
        organisationId: CSV_ORGANISATION_ID,
        name: 'Kilcoy',
        kind: 'clinic',
      },
      {
        id: stableId('csv-entity', 'burpengary'),
        organisationId: CSV_ORGANISATION_ID,
        name: 'Burpengary',
        kind: 'clinic',
      },
      {
        id: LOAN_ENTITY_ID,
        organisationId: CSV_ORGANISATION_ID,
        name: 'Loan entity (confirm borrower)',
        kind: 'group',
      },
    ],
    connections: [],
    accounts: [],
    categories: catalogue.map(([name, kind, colour]) => ({
      id: stableId('category', name),
      name,
      kind,
      colour,
    })),
    transactions: [],
  };
}

export function isCsvDataset(dataset: FinanceDataset): boolean {
  return (
    dataset.organisation.id === CSV_ORGANISATION_ID &&
    dataset.organisation.dataSource === 'csv' &&
    !dataset.organisation.isDemo
  );
}

/** Select a separator using only characters outside quoted fields. */
function csvDelimiter(text: string): string {
  const counts = new Map([
    [',', 0],
    [';', 0],
    ['\t', 0],
  ]);
  let quoted = false;
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (character === '"') {
      if (quoted && text[index + 1] === '"') {
        index += 1;
        continue;
      }
      quoted = !quoted;
    } else if (!quoted) {
      if (character === '\n' || character === '\r') break;
      if (counts.has(character)) counts.set(character, counts.get(character)! + 1);
    }
  }
  return [...counts].sort((a, b) => b[1] - a[1])[0][0];
}

/** Strict CSV parser: malformed quotes are never silently repaired. */
export function parseCsv(input: string): CsvDocument {
  if (new TextEncoder().encode(input).length > MAX_CSV_BYTES)
    throw new Error('CSV files must be 5 MiB or smaller.');
  const text = input.replace(/^\uFEFF/, '').replace(/^(?:[ \t]*(?:\r\n|\r|\n))*/, '');
  if (!text.trim()) throw new Error('The CSV file is empty.');
  if (text.includes('\0')) throw new Error('The CSV contains unsupported binary characters.');
  const delimiter = csvDelimiter(text);
  const records: string[][] = [];
  let record: string[] = [];
  let cell = '';
  let quoted = false;
  let closedQuote = false;
  const endCell = () => {
    record.push(cell);
    cell = '';
    closedQuote = false;
    if (record.length > 100) throw new Error('CSV files may contain at most 100 columns.');
  };
  const endRecord = () => {
    endCell();
    if (record.some((value) => value.trim())) records.push(record);
    record = [];
    if (records.length > MAX_CSV_ROWS + 1)
      throw new Error('A CSV file may contain at most 5,000 transaction rows.');
  };
  for (let index = 0; index < text.length; index += 1) {
    const character = text[index];
    if (quoted) {
      if (character === '"') {
        if (text[index + 1] === '"') {
          cell += '"';
          index += 1;
        } else {
          quoted = false;
          closedQuote = true;
        }
      } else cell += character;
      continue;
    }
    if (character === delimiter) endCell();
    else if (character === '\r' || character === '\n') {
      endRecord();
      if (character === '\r' && text[index + 1] === '\n') index += 1;
    } else if (character === '"') {
      if (closedQuote || cell.trim())
        throw new Error(`Unexpected quote in CSV record ${records.length + 1}.`);
      cell = '';
      quoted = true;
    } else if (closedQuote) {
      if (!/\s/.test(character))
        throw new Error(`Unexpected text after a quote in CSV record ${records.length + 1}.`);
    } else cell += character;
  }
  if (quoted) throw new Error('The CSV contains an unclosed quoted field.');
  if (record.length || cell || closedQuote) endRecord();
  if (!records.length) throw new Error('The CSV file is empty.');
  const first = records[0];
  // NAB transaction exports can omit the header: date, signed amount, description.
  const headerless =
    first.length >= 3 &&
    /^(?:\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{4})$/.test(first[0].trim());
  const headers = headerless
    ? first.map((_, index) => ['Date', 'Amount', 'Description'][index] ?? `Column ${index + 1}`)
    : first.map((value, index) => value.trim() || `Column ${index + 1}`);
  const rows = headerless ? records : records.slice(1);
  if (rows.length > MAX_CSV_ROWS)
    throw new Error('A CSV file may contain at most 5,000 transaction rows.');
  if (!rows.length) throw new Error('The CSV contains a header but no transaction rows.');
  return { headers, rows, rowOffset: headerless ? 1 : 2 };
}

export function inferCsvMapping(headers: string[]): CsvMapping {
  const names = headers.map((value) => value.toLowerCase().replace(/[^a-z0-9]/g, ''));
  const find = (options: string[]) => names.findIndex((name) => options.includes(name));
  const amount = find(['amount', 'transactionamount', 'netamount', 'amountaud', 'signedamount']);
  return {
    date: find([
      'date',
      'transactiondate',
      'posteddate',
      'postingdate',
      'valuedate',
      'bookingdate',
      'processdate',
    ]),
    description: find([
      'description',
      'transactiondescription',
      'transactiondetails',
      'details',
      'narration',
      'particulars',
      'memo',
    ]),
    amount,
    debit:
      amount >= 0
        ? -1
        : find([
            'debit',
            'debits',
            'debitamount',
            'withdrawal',
            'withdrawals',
            'withdrawalamount',
            'moneyout',
            'paidout',
          ]),
    credit:
      amount >= 0
        ? -1
        : find([
            'credit',
            'credits',
            'creditamount',
            'deposit',
            'deposits',
            'depositamount',
            'moneyin',
            'paidin',
          ]),
    transactionId: find(['transactionid', 'banktransactionid', 'transactionnumber', 'id']),
    dateFormat: 'dmy',
    reverseSign: false,
  };
}

/** Parse AUD using decimal digits, not floating-point multiplication or rounding. */
export function parseCsvMoney(value: string): number {
  let text = value.trim();
  if (!text || text.length > 64) throw new Error('Enter a valid AUD amount.');
  let negative = false;
  let hasSign = false;
  if (text.startsWith('(') && text.endsWith(')')) {
    negative = true;
    hasSign = true;
    text = text.slice(1, -1).trim();
  }
  const suffix = text.match(/\s+(CR|DR)$/i);
  if (suffix) {
    if (hasSign) throw new Error('The amount has conflicting sign markers.');
    hasSign = true;
    negative = suffix[1].toUpperCase() === 'DR';
    text = text.slice(0, suffix.index).trim();
  }
  const match = text.match(
    /^([+-])?\s*(?:AUD\s*|A\$|\$)?\s*([+-])?((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d{1,2})?|\.\d{1,2})$/i,
  );
  if (!match)
    throw new Error(
      'Use AUD amounts with no more than two decimal places (for example -1,234.56).',
    );
  const signs = [match[1], match[2]].filter(Boolean);
  if (signs.length > 1 || (signs.length && hasSign))
    throw new Error('The amount has conflicting sign markers.');
  if (signs.length) negative = signs[0] === '-';
  const [whole, fraction = ''] = match[3].replace(/,/g, '').split('.');
  const cents = BigInt(whole || '0') * 100n + BigInt(fraction.padEnd(2, '0'));
  if (cents > BigInt(Number.MAX_SAFE_INTEGER)) throw new Error('The amount is too large.');
  return cents === 0n ? 0 : Number(cents) * (negative ? -1 : 1);
}

function csvDate(value: string, format: CsvMapping['dateFormat']): string {
  const text = value.trim();
  let result = text;
  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const match = text.match(/^(\d{1,2})[/-](\d{1,2})[/-](\d{4})$/);
    if (!match || format === 'iso')
      throw new Error('Date does not match the selected date format.');
    const day = format === 'dmy' ? match[1] : match[2];
    const month = format === 'dmy' ? match[2] : match[1];
    result = `${match[3]}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`;
  }
  if (!Number.isFinite(dateValue(result)))
    throw new Error('The row contains an invalid calendar date.');
  return result;
}

export function previewCsv(document: CsvDocument, mapping: CsvMapping): CsvPreview {
  const preview: CsvPreview = { rows: [], errors: [], warnings: [] };
  const mapped = [
    mapping.date,
    mapping.description,
    mapping.amount,
    mapping.debit,
    mapping.credit,
    mapping.transactionId,
  ];
  if (document.rows.length > MAX_CSV_ROWS) {
    preview.errors.push({
      rowNumber: 1,
      message: 'A CSV file may contain at most 5,000 transaction rows.',
    });
    return preview;
  }
  const signed = mapping.amount >= 0;
  if (
    mapping.date < 0 ||
    mapping.description < 0 ||
    (signed
      ? mapping.debit >= 0 || mapping.credit >= 0
      : mapping.debit < 0 || mapping.credit < 0) ||
    mapped.some(
      (index) => !Number.isInteger(index) || index < -1 || index >= document.headers.length,
    ) ||
    new Set(mapped.filter((index) => index >= 0)).size !==
      mapped.filter((index) => index >= 0).length ||
    !['dmy', 'mdy', 'iso'].includes(mapping.dateFormat) ||
    typeof mapping.reverseSign !== 'boolean'
  ) {
    preview.errors.push({
      rowNumber: 1,
      message:
        'Map distinct date and description columns, then either one signed amount column or both debit and credit columns.',
    });
    return preview;
  }
  if (document.rowOffset === 1)
    preview.warnings.push(
      'No header was detected. Date, amount and description columns were inferred; review the mapping.',
    );
  let ambiguousDates = false;
  for (const [index, row] of document.rows.entries()) {
    const rowNumber = index + (document.rowOffset ?? 2);
    try {
      if (row.length !== document.headers.length)
        throw new Error(`Expected ${document.headers.length} columns but found ${row.length}.`);
      const dateText = row[mapping.date].trim();
      const ambiguous = dateText.match(/^(\d{1,2})[/-](\d{1,2})[/-]\d{4}$/);
      if (
        ambiguous &&
        Number(ambiguous[1]) <= 12 &&
        Number(ambiguous[2]) <= 12 &&
        ambiguous[1] !== ambiguous[2]
      )
        ambiguousDates = true;
      const postedAt = csvDate(dateText, mapping.dateFormat);
      const description = row[mapping.description].trim();
      if (!description || description.length > 1_000)
        throw new Error('Description must contain between 1 and 1,000 characters.');
      let amountCents: number;
      if (signed) amountCents = parseCsvMoney(row[mapping.amount]);
      else {
        const debitText = row[mapping.debit].trim();
        const creditText = row[mapping.credit].trim();
        const debit = debitText ? parseCsvMoney(debitText) : 0;
        const credit = creditText ? parseCsvMoney(creditText) : 0;
        if (debit < 0 || credit < 0)
          throw new Error('Debit and credit columns must contain non-negative amounts.');
        if (debit > 0 === credit > 0)
          throw new Error('Exactly one debit or credit amount must be greater than zero.');
        amountCents = credit - debit;
      }
      if (mapping.reverseSign) amountCents *= -1;
      const externalId =
        mapping.transactionId >= 0 ? row[mapping.transactionId].trim() || null : null;
      if (externalId && externalId.length > 200)
        throw new Error('Transaction ID must not exceed 200 characters.');
      preview.rows.push({ rowNumber, postedAt, description, amountCents, externalId });
    } catch (error) {
      preview.errors.push({
        rowNumber,
        message: error instanceof Error ? error.message : 'Invalid transaction row.',
      });
    }
  }
  if (ambiguousDates)
    preview.warnings.push(
      `Some dates can be read as either day/month or month/day. Review the selected ${mapping.dateFormat.toUpperCase()} format.`,
    );
  if (mapping.transactionId < 0 || preview.rows.some((row) => !row.externalId))
    preview.warnings.push(
      'Rows without a bank transaction ID are matched by account, date, amount, description and occurrence count. Review overlapping exports with identical transactions.',
    );
  return preview;
}

const normalise = (value: string) =>
  value.normalize('NFKC').trim().replace(/\s+/g, ' ').toUpperCase();
const fingerprint = (row: Pick<CsvRow, 'postedAt' | 'amountCents' | 'description'>) =>
  stableId(
    'csv-row-fingerprint',
    JSON.stringify([row.postedAt, row.amountCents, normalise(row.description)]),
  );

function todayInBrisbane(): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const value = (type: string) => parts.find((part) => part.type === type)!.value;
  return `${value('year')}-${value('month')}-${value('day')}`;
}

/**
 * Atomically append a validated statement, preserving manual categories. Explicit
 * statement balance snapshots are independent of imported transaction totals.
 */
export function applyCsvImport(
  dataset: FinanceDataset,
  rows: CsvRow[],
  target: CsvImportTarget,
): { dataset: FinanceDataset; imported: number; duplicates: number } {
  if (!isCsvDataset(dataset))
    throw new Error('CSV imports require a separate statement workspace.');
  if (!rows.length || rows.length > MAX_CSV_ROWS)
    throw new Error('Import between 1 and 5,000 valid transaction rows.');
  const entity = dataset.entities.find(
    (candidate) =>
      candidate.id === target.entityId && candidate.organisationId === CSV_ORGANISATION_ID,
  );
  if (!entity) throw new Error('Select an entity belonging to this statement workspace.');
  if (!Number.isSafeInteger(target.balanceCents) || !Number.isFinite(dateValue(target.balanceDate)))
    throw new Error('An explicit AUD statement balance and valid balance date are required.');
  if (target.balanceDate > todayInBrisbane())
    throw new Error('The balance snapshot date cannot be in the future.');
  if ((target.kind === 'loan' || target.kind === 'mortgage') && target.balanceCents > 0)
    throw new Error('Enter outstanding loan debt as a negative balance.');
  const accountName = target.accountName.trim();
  const institution = target.institution.trim();
  if (
    !accountName ||
    accountName.length > 120 ||
    !institution ||
    institution.length > 120 ||
    ![
      'operating',
      'savings',
      'credit_card',
      'transaction',
      'loan',
      'mortgage',
      'term_deposit',
    ].includes(target.kind)
  )
    throw new Error('Enter a valid account name, bank and account type.');
  const borrower = target.loanOwnerName?.trim();
  const confirmBorrower =
    entity.id === LOAN_ENTITY_ID && entity.name === 'Loan entity (confirm borrower)';
  if (
    confirmBorrower &&
    (!borrower ||
      borrower.length < 2 ||
      borrower.length > 120 ||
      /confirm borrower|group finance|loan entity/i.test(borrower))
  )
    throw new Error('Confirm the actual loan borrower entity name before importing.');
  for (const row of rows) {
    if (
      !Number.isFinite(dateValue(row.postedAt)) ||
      !Number.isSafeInteger(row.amountCents) ||
      !row.description.trim() ||
      row.description.length > 1_000 ||
      (row.externalId !== null && (!row.externalId.trim() || row.externalId.length > 200))
    )
      throw new Error(`Transaction record ${row.rowNumber} is invalid; no rows were imported.`);
    if (row.postedAt > target.balanceDate)
      throw new Error(
        `Transaction record ${row.rowNumber} is later than the balance snapshot date. Confirm a balance dated on or after the last transaction.`,
      );
  }
  const existing = target.accountId
    ? dataset.accounts.find((account) => account.id === target.accountId)
    : undefined;
  if (target.accountId && !existing) throw new Error('The selected account no longer exists.');
  if (
    existing &&
    (existing.entityId !== entity.id ||
      existing.organisationId !== CSV_ORGANISATION_ID ||
      existing.currency !== 'AUD' ||
      existing.kind !== target.kind ||
      !dataset.connections.some(
        (connection) => connection.id === existing.connectionId && connection.provider === 'csv',
      ))
  )
    throw new Error('The selected account does not belong to this entity or account type.');
  const accountId =
    existing?.id ??
    stableId(
      'csv-account',
      JSON.stringify([entity.id, normalise(institution), normalise(accountName), target.kind]),
    );
  if (!existing && dataset.accounts.some((account) => account.id === accountId))
    throw new Error(
      'An account with this name and bank already exists. Select that account to import another statement.',
    );
  const connectionId = existing?.connectionId ?? stableId('csv-connection', accountId);
  if (!existing && dataset.accounts.length >= 100)
    throw new Error('This browser workspace supports at most 100 accounts.');
  const snapshotAt = `${target.balanceDate}T00:00:00.000Z`;
  const account: Account = existing
    ? {
        ...existing,
        ...(target.balanceDate >= existing.updatedAt.slice(0, 10)
          ? { balanceCents: target.balanceCents, updatedAt: snapshotAt }
          : {}),
      }
    : {
        id: accountId,
        organisationId: CSV_ORGANISATION_ID,
        entityId: entity.id,
        connectionId,
        name: accountName,
        institution,
        kind: target.kind,
        currency: 'AUD',
        balanceCents: target.balanceCents,
        maskedNumber: 'CSV statement',
        updatedAt: snapshotAt,
      };
  const ledger = dataset.transactions.map((transaction) => ({ ...transaction }));
  const known = new Map(
    ledger
      .filter((transaction) => transaction.accountId === accountId)
      .map((transaction) => [transaction.providerTransactionId, transaction]),
  );
  const occurrences = new Map<string, number>();
  let imported = 0;
  let duplicates = 0;
  for (const row of rows) {
    const key = fingerprint(row);
    const ordinal = (occurrences.get(key) ?? 0) + 1;
    if (!row.externalId) occurrences.set(key, ordinal);
    const providerTransactionId = row.externalId
      ? `csv:external:${row.externalId}`
      : `csv:row:${key}:${ordinal}`;
    const prior = known.get(providerTransactionId);
    if (prior) {
      if (
        prior.postedAt !== row.postedAt ||
        prior.amountCents !== row.amountCents ||
        normalise(prior.description) !== normalise(row.description)
      )
        throw new Error(
          `Transaction ID in record ${row.rowNumber} conflicts with an existing transaction. No rows were imported.`,
        );
      duplicates += 1;
      continue;
    }
    const transaction: Transaction = {
      id: stableId('csv-transaction', `${accountId}:${providerTransactionId}`),
      organisationId: CSV_ORGANISATION_ID,
      accountId,
      providerTransactionId,
      postedAt: row.postedAt,
      description: row.description.trim(),
      merchant: null,
      amountCents: row.amountCents,
      currency: 'AUD',
      categoryId: null,
      categorySource: 'uncategorised',
      status: 'posted',
      transferPairId: null,
      receiptStatus: row.amountCents < 0 ? 'missing' : 'not_required',
    };
    ledger.push(transaction);
    known.set(providerTransactionId, transaction);
    imported += 1;
  }
  if (ledger.length > MAX_CSV_LEDGER_ROWS)
    throw new Error(
      'This browser workspace supports at most 10,000 transactions. Export a backup before starting a new workspace.',
    );
  // Prevent unsafe aggregate arithmetic in analytics, including mixed-sign rows.
  let absoluteTotal = 0;
  for (const transaction of ledger) {
    absoluteTotal += Math.abs(transaction.amountCents);
    if (!Number.isSafeInteger(absoluteTotal))
      throw new Error('Combined transaction values exceed the safe calculation limit.');
  }
  let absoluteBalances = 0;
  const accounts = existing
    ? dataset.accounts.map((item) => (item.id === account.id ? account : { ...item }))
    : [...dataset.accounts.map((item) => ({ ...item })), account];
  for (const item of accounts) {
    absoluteBalances += Math.abs(item.balanceCents);
    if (!Number.isSafeInteger(absoluteBalances))
      throw new Error('Combined balance values exceed the safe calculation limit.');
  }
  const transactions = detectInternalTransfers(ledger, accounts)
    .map((transaction) => categoriseTransaction(transaction, dataset.categories))
    .sort((a, b) => b.postedAt.localeCompare(a.postedAt) || a.id.localeCompare(b.id));
  const importedAt = new Date().toISOString();
  const connections = dataset.connections
    .filter((connection) => connection.id !== connectionId)
    .map((connection) => ({ ...connection }));
  connections.push({
    id: connectionId,
    organisationId: CSV_ORGANISATION_ID,
    entityId: entity.id,
    provider: 'csv',
    status: 'active',
    lastSyncedAt: importedAt,
    institutionName: account.institution,
  });
  return {
    dataset: {
      organisation: { ...dataset.organisation },
      entities: dataset.entities.map((item) => ({
        ...item,
        ...(confirmBorrower && item.id === entity.id ? { name: borrower! } : {}),
      })),
      connections,
      accounts,
      categories: dataset.categories.map((category) => ({ ...category })),
      transactions,
    },
    imported,
    duplicates,
  };
}
