import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  applyCsvImport,
  createCsvDataset,
  CSV_ORGANISATION_ID,
  inferCsvMapping,
  isCsvDataset,
  MAX_CSV_BYTES,
  MAX_CSV_LEDGER_ROWS,
  MAX_CSV_ROWS,
  parseCsv,
  parseCsvMoney,
  previewCsv,
  type CsvImportTarget,
  type CsvRow,
} from '../src/domain/csv-import.ts';
import {
  calculateCategoryBreakdown,
  calculateDailyCashflow,
  calculateSummary,
} from '../src/domain/analytics.ts';
import { createMockDataset } from '../src/domain/mock.ts';
import type { FinanceDataset } from '../src/types/domain.ts';

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(new Date('2026-10-15T02:00:00.000Z'));
});
afterEach(() => vi.useRealTimers());

function target(
  dataset = createCsvDataset(),
  overrides: Partial<CsvImportTarget> = {},
): CsvImportTarget {
  return {
    entityId: dataset.entities[0].id,
    accountName: 'Kilcoy operating',
    institution: 'NAB',
    kind: 'operating',
    balanceCents: 123_456,
    balanceDate: '2026-09-30',
    ...overrides,
  };
}

function row(overrides: Partial<CsvRow> = {}): CsvRow {
  return {
    rowNumber: 2,
    postedAt: '2026-09-10',
    description: 'DENTAL SUPPLIES',
    amountCents: -1234,
    externalId: null,
    ...overrides,
  };
}

function read(text: string) {
  const document = parseCsv(text);
  return previewCsv(document, inferCsvMapping(document.headers));
}

describe('strict CSV document parsing', () => {
  it('reads BOM, CRLF, escaped quotes, embedded commas and newlines without changing descriptions', () => {
    const document = parseCsv(
      '\uFEFFDate,Amount,Description\r\n10/09/2026,-12.34,"Dental, ""clinical"" supplies\nInvoice 1"\r\n',
    );
    expect(document.headers).toEqual(['Date', 'Amount', 'Description']);
    expect(document.rows).toEqual([
      ['10/09/2026', '-12.34', 'Dental, "clinical" supplies\nInvoice 1'],
    ]);
    expect(
      read('Date,Amount,Description\n10/09/2026,-12.34,"Dental, supplies"').rows[0].amountCents,
    ).toBe(-1234);
  });

  it.each([';', '\t'])('detects %s delimiters outside quotes', (delimiter) => {
    const document = parseCsv(
      `Date${delimiter}Amount${delimiter}Description\n10/09/2026${delimiter}-12.34${delimiter}"Dental, supplies; tabs\there"`,
    );
    expect(document.headers).toEqual(['Date', 'Amount', 'Description']);
    expect(previewCsv(document, inferCsvMapping(document.headers)).errors).toEqual([]);
  });

  it('infers headerless NAB date, signed amount and description without dropping the first row', () => {
    const document = parseCsv(
      '10/09/2026,-12.34,DENTAL SUPPLIES\n11/09/2026,100.00,PATIENT RECEIPTS',
    );
    expect(document).toEqual({
      headers: ['Date', 'Amount', 'Description'],
      rows: [
        ['10/09/2026', '-12.34', 'DENTAL SUPPLIES'],
        ['11/09/2026', '100.00', 'PATIENT RECEIPTS'],
      ],
      rowOffset: 1,
    });
    const preview = previewCsv(document, inferCsvMapping(document.headers));
    expect(preview.rows.map((value) => value.rowNumber)).toEqual([1, 2]);
    expect(preview.warnings.join(' ')).toContain('No header');
  });

  it('supports extra headerless columns but does not infer running balance as transaction amount', () => {
    const document = parseCsv('2026-09-10,-12.34,Supplies,12345.67');
    expect(document.headers).toEqual(['Date', 'Amount', 'Description', 'Column 4']);
    expect(inferCsvMapping(['Date', 'Description', 'Balance']).amount).toBe(-1);
  });

  it('ignores leading blank records when detecting semicolon exports', () => {
    const document = parseCsv('\r\n  \r\nDate;Amount;Description\n10/09/2026;-1;Supplies');
    expect(document.headers).toEqual(['Date', 'Amount', 'Description']);
    expect(previewCsv(document, inferCsvMapping(document.headers)).errors).toEqual([]);
  });

  it.each([
    '',
    '   \n',
    'Date,Amount,Description',
    'Date,Amount,Description\n"10/09/2026,-12.34,x',
    'Date,Amount,Description\n10/09/2026,-12.34,"hello"oops',
    'Date,Amount,Description\n10/09/2026,-12.34,bad"quote',
    'Date,Amount,Description\n10/09/2026,1,x\0',
  ])('rejects malformed or empty input', (text) => {
    expect(() => parseCsv(text)).toThrow();
  });

  it('rejects UTF-8 file sizes over 5 MiB rather than just measuring character count', () => {
    expect(() => parseCsv('é'.repeat(Math.floor(MAX_CSV_BYTES / 2) + 1))).toThrow('5 MiB');
  });

  it('limits a file to 5,000 transaction records and 100 columns', () => {
    const header = 'Date,Amount,Description\n';
    expect(parseCsv(header + '10/09/2026,1,x\n'.repeat(MAX_CSV_ROWS)).rows).toHaveLength(
      MAX_CSV_ROWS,
    );
    expect(() => parseCsv(header + '10/09/2026,1,x\n'.repeat(MAX_CSV_ROWS + 1))).toThrow('5,000');
    expect(() => parseCsv('10/09/2026,1,x\n'.repeat(MAX_CSV_ROWS + 1))).toThrow('5,000');
    expect(() => parseCsv(Array(101).fill('column').join(','))).toThrow('100 columns');
  });
});

describe('exact money and explicit dates', () => {
  it.each([
    ['0', 0],
    ['-0.00', 0],
    ['1', 100],
    ['.5', 50],
    ['12.34', 1234],
    ['-12.34', -1234],
    ['$1,234.56', 123456],
    ['AUD 12.3', 1230],
    ['A$ -12.34', -1234],
    ['-$12.34', -1234],
    ['(1,234.56)', -123456],
    ['12.34 DR', -1234],
    ['12.34 CR', 1234],
    ['0.29', 29],
    ['90071992547409.91', Number.MAX_SAFE_INTEGER],
  ])('parses %s as exactly %i cents', (text, cents) => {
    expect(parseCsvMoney(text)).toBe(cents);
  });

  it.each([
    '',
    '1.234',
    '1,23.45',
    '1,234,56',
    '1e3',
    'NaN',
    'Infinity',
    '1 234.56',
    '1.234,56',
    '--1',
    '-$-1',
    '(12.34 DR)',
    '-12.34 DR',
    '90071992547409.92',
    '12 AUD',
    '=1+2',
  ])('rejects ambiguous or malformed money %s', (text) => {
    expect(() => parseCsvMoney(text)).toThrow();
  });

  it('requires deliberate date interpretation and warns about ambiguous dates', () => {
    const document = parseCsv('Date,Amount,Description\n03/04/2026,10,Patient receipts');
    const mapping = inferCsvMapping(document.headers);
    expect(previewCsv(document, mapping).rows[0].postedAt).toBe('2026-04-03');
    expect(previewCsv(document, { ...mapping, dateFormat: 'mdy' }).rows[0].postedAt).toBe(
      '2026-03-04',
    );
    expect(previewCsv(document, mapping).warnings.join(' ')).toContain('either day/month');
    expect(previewCsv(document, { ...mapping, dateFormat: 'iso' }).errors).toHaveLength(1);
  });

  it('accepts ISO dates without timezone conversion and validates leap years', () => {
    expect(read('Date,Amount,Description\n2024-02-29,1,x').rows[0].postedAt).toBe('2024-02-29');
    expect(read('Date,Amount,Description\n29/02/2025,1,x').errors).toHaveLength(1);
    expect(read('Date,Amount,Description\n31/04/2026,1,x').errors).toHaveLength(1);
    expect(read('Date,Amount,Description\n2026-02-30,1,x').errors).toHaveLength(1);
    expect(read('Date,Amount,Description\n10/09/26,1,x').errors).toHaveLength(1);
  });

  it('handles separate debit and credit with exact one-sided validation', () => {
    const preview = read(
      'Transaction Date,Debit Amount,Credit Amount,Transaction Details\n10/09/2026,12.34,,Supplies\n11/09/2026,0,100.01,Patient receipts\n12/09/2026,,20.00,Settlement',
    );
    expect(preview.errors).toEqual([]);
    expect(preview.rows.map((value) => value.amountCents)).toEqual([-1234, 10001, 2000]);
    const invalid = read(
      'Date,Debit,Credit,Description\n10/09/2026,1,1,both\n10/09/2026,0,0,neither\n10/09/2026,-1,,signed debit',
    );
    expect(invalid.rows).toEqual([]);
    expect(invalid.errors).toHaveLength(3);
  });

  it('reverses an explicitly selected amount sign without guessing based on account type', () => {
    const document = parseCsv('Date,Amount,Description\n10/09/2026,12.34,Card purchase');
    expect(
      previewCsv(document, { ...inferCsvMapping(document.headers), reverseSign: true }).rows[0]
        .amountCents,
    ).toBe(-1234);
  });

  it('rejects conflicting mapping columns and mixed signed/split modes', () => {
    const document = parseCsv('Date,Amount,Description,Debit,Credit\n10/09/2026,1,x,,');
    const mapping = inferCsvMapping(document.headers);
    expect(
      previewCsv(document, { ...mapping, description: mapping.date }).errors[0].rowNumber,
    ).toBe(1);
    expect(previewCsv(document, { ...mapping, debit: 3, credit: 4 }).errors).toHaveLength(1);
    expect(
      previewCsv(document, { ...mapping, amount: -1, debit: 3, credit: -1 }).errors,
    ).toHaveLength(1);
    expect(previewCsv(document, { ...mapping, date: Number.NaN }).errors).toHaveLength(1);
  });

  it('collects row errors without silently importing malformed rows', () => {
    const preview = read(
      'Date,Amount,Description\n10/09/2026,-1,good\n31/02/2026,-1,invalid date\n10/09/2026,1.234,bad cents\n10/09/2026,1,too,many\n10/09/2026,1,',
    );
    expect(preview.rows).toHaveLength(1);
    expect(preview.errors.map((error) => error.rowNumber)).toEqual([3, 4, 5, 6]);
  });
});

describe('atomic account-scoped statement import', () => {
  it('starts empty with separate clinic entities and an unconfirmed loan owner, not sample data', () => {
    const dataset = createCsvDataset();
    expect(dataset.organisation).toMatchObject({
      id: CSV_ORGANISATION_ID,
      isDemo: false,
      dataSource: 'csv',
    });
    expect(dataset.entities.map((entity) => entity.name)).toEqual([
      'Kilcoy',
      'Burpengary',
      'Loan entity (confirm borrower)',
    ]);
    expect(dataset.accounts).toEqual([]);
    expect(dataset.transactions).toEqual([]);
    expect(dataset.connections).toEqual([]);
    expect(isCsvDataset(dataset)).toBe(true);
    expect(isCsvDataset(createMockDataset())).toBe(false);
    expect(() => applyCsvImport(createMockDataset(), [row()], target())).toThrow(
      'separate statement',
    );
    dataset.categories[0].name = 'changed';
    expect(createCsvDataset().categories[0].name).toBe('Patient receipts');
  });

  it('creates account and categories using real imported values and explicit balance, leaving input unchanged', () => {
    const dataset = createCsvDataset();
    const original = structuredClone(dataset);
    const result = applyCsvImport(dataset, [row()], target(dataset));
    expect(result).toMatchObject({ imported: 1, duplicates: 0 });
    expect(dataset).toEqual(original);
    expect(result.dataset.accounts[0]).toMatchObject({
      entityId: dataset.entities[0].id,
      balanceCents: 123456,
      updatedAt: '2026-09-30T00:00:00.000Z',
      currency: 'AUD',
    });
    expect(result.dataset.connections[0]).toMatchObject({
      provider: 'csv',
      lastSyncedAt: '2026-10-15T02:00:00.000Z',
    });
    expect(result.dataset.transactions[0]).toMatchObject({
      amountCents: -1234,
      categorySource: 'rule',
      receiptStatus: 'missing',
    });
    expect(
      result.dataset.categories.find(
        (category) => category.id === result.dataset.transactions[0].categoryId,
      )?.name,
    ).toBe('Dental supplies');
  });

  it('does not change balances from transaction sums and protects newer snapshot balances', () => {
    const first = applyCsvImport(createCsvDataset(), [row()], target()).dataset;
    const accountId = first.accounts[0].id;
    const old = applyCsvImport(
      first,
      [row({ postedAt: '2026-08-10' })],
      target(first, { accountId, balanceDate: '2026-08-31', balanceCents: 999 }),
    );
    expect(old.dataset.accounts[0]).toMatchObject({
      balanceCents: 123456,
      updatedAt: '2026-09-30T00:00:00.000Z',
    });
    const current = applyCsvImport(
      old.dataset,
      [row()],
      target(first, { accountId, balanceDate: '2026-10-01', balanceCents: 789000 }),
    );
    expect(current).toMatchObject({ imported: 0, duplicates: 1 });
    expect(current.dataset.accounts[0]).toMatchObject({
      balanceCents: 789000,
      updatedAt: '2026-10-01T00:00:00.000Z',
    });
  });

  it('retains multiple legitimate identical rows and deduplicates reordered overlapping exports by multiplicity', () => {
    const firstRows = [row(), row(), row({ description: 'PATIENT RECEIPTS', amountCents: 10_000 })];
    const first = applyCsvImport(createCsvDataset(), firstRows, target()).dataset;
    const nextRows = [...firstRows]
      .reverse()
      .map((value) => ({ ...value, description: ` ${value.description.toLowerCase()} ` }));
    const second = applyCsvImport(
      first,
      [...nextRows, row()],
      target(first, { accountId: first.accounts[0].id }),
    );
    expect(first.transactions).toHaveLength(3);
    expect(second).toMatchObject({ imported: 1, duplicates: 3 });
    expect(second.dataset.transactions).toHaveLength(4);
    expect(new Set(second.dataset.transactions.map((transaction) => transaction.id)).size).toBe(4);
  });

  it('scopes external IDs to an account and treats duplicate IDs within one file as duplicates', () => {
    const dataset = createCsvDataset();
    const result = applyCsvImport(
      dataset,
      [row({ externalId: 'bank-id-1' }), row({ externalId: 'bank-id-1' })],
      target(dataset),
    );
    expect(result).toMatchObject({ imported: 1, duplicates: 1 });
    const next = applyCsvImport(
      result.dataset,
      [row({ externalId: 'bank-id-1' })],
      target(result.dataset, {
        entityId: dataset.entities[1].id,
        accountName: 'Burpengary operating',
      }),
    );
    expect(next).toMatchObject({ imported: 1, duplicates: 0 });
    expect(next.dataset.transactions[0].id).not.toBe(next.dataset.transactions[1].id);
  });

  it('rejects external ID conflicts atomically instead of overwriting manual corrections', () => {
    const first = applyCsvImport(
      createCsvDataset(),
      [row({ externalId: 'bank-id-1' })],
      target(),
    ).dataset;
    first.transactions[0].categorySource = 'manual';
    first.transactions[0].categoryId = null;
    const copy = structuredClone(first);
    expect(() =>
      applyCsvImport(
        first,
        [row({ externalId: 'new' }), row({ externalId: 'bank-id-1', amountCents: -999 })],
        target(first, { accountId: first.accounts[0].id }),
      ),
    ).toThrow('conflicts');
    expect(first).toEqual(copy);
    const duplicate = applyCsvImport(
      first,
      [row({ externalId: 'bank-id-1' })],
      target(first, { accountId: first.accounts[0].id }),
    );
    expect(duplicate.dataset.transactions[0]).toMatchObject({
      categoryId: null,
      categorySource: 'manual',
    });
    expect(() =>
      applyCsvImport(
        createCsvDataset(),
        [row({ externalId: 'same' }), row({ externalId: 'same', description: 'changed' })],
        target(),
      ),
    ).toThrow('conflicts');
  });

  it('detects internal transfers across imported accounts before categorising and reporting', () => {
    const first = applyCsvImport(
      createCsvDataset(),
      [row({ description: 'INTERNAL TRANSFER TO OWN ACCOUNT', amountCents: -50000 })],
      target(),
    ).dataset;
    const second = applyCsvImport(
      first,
      [row({ description: 'INTERNAL TRANSFER FROM OWN ACCOUNT', amountCents: 50000 })],
      target(first, { entityId: first.entities[1].id, accountName: 'Burpengary operating' }),
    ).dataset;
    expect(second.transactions.every((transaction) => transaction.transferPairId)).toBe(true);
    expect(calculateSummary(second)).toMatchObject({
      expenseCents: 0,
      incomeCents: 0,
      netCashflowCents: 0,
      internalTransferCount: 2,
    });
    expect(calculateSummary(second, { entityId: first.entities[0].id }).expenseCents).toBe(0);
    const third = applyCsvImport(
      second,
      [row({ description: 'PATIENT RECEIPTS', amountCents: 50000 })],
      target(second, { accountName: 'Kilcoy reserve', kind: 'savings' }),
    ).dataset;
    expect(third.transactions.every((transaction) => transaction.transferPairId === null)).toBe(
      true,
    );
  });

  it('requires an explicit legal borrower and never assigns the loan to either clinic automatically', () => {
    const dataset = createCsvDataset();
    const loanTarget = target(dataset, {
      entityId: dataset.entities[2].id,
      accountName: 'BOQS loan',
      institution: 'BOQ Specialist',
      kind: 'loan',
      balanceCents: -1_000_000,
    });
    expect(() => applyCsvImport(dataset, [row({ amountCents: 100 })], loanTarget)).toThrow(
      'actual loan borrower',
    );
    expect(() =>
      applyCsvImport(dataset, [row()], { ...loanTarget, loanOwnerName: 'Group finance' }),
    ).toThrow('actual loan borrower');
    const result = applyCsvImport(dataset, [row({ amountCents: 100 })], {
      ...loanTarget,
      loanOwnerName: 'Dental Holdings Pty Ltd',
    });
    expect(result.dataset.entities[2].name).toBe('Dental Holdings Pty Ltd');
    expect(result.dataset.accounts[0].entityId).toBe(dataset.entities[2].id);
    expect(dataset.entities[2].name).toBe('Loan entity (confirm borrower)');
  });

  it('requires a snapshot date covering all statement transactions and negative loan debt', () => {
    expect(() =>
      applyCsvImport(createCsvDataset(), [row({ postedAt: '2026-10-01' })], target()),
    ).toThrow('later than the balance snapshot');
    expect(() =>
      applyCsvImport(
        createCsvDataset(),
        [row()],
        target(undefined, { kind: 'loan', balanceCents: 1 }),
      ),
    ).toThrow('negative balance');
    expect(() =>
      applyCsvImport(
        createCsvDataset(),
        [row()],
        target(undefined, { kind: 'mortgage', balanceCents: 1 }),
      ),
    ).toThrow('negative balance');
    // A credit-card account can legitimately hold a positive credit balance.
    expect(
      applyCsvImport(
        createCsvDataset(),
        [row()],
        target(undefined, { kind: 'credit_card', balanceCents: 1 }),
      ).dataset.accounts[0].balanceCents,
    ).toBe(1);
  });

  it.each([
    { balanceCents: Number.NaN },
    { balanceCents: 1.5 },
    { balanceDate: '2026-02-30' },
    { balanceDate: '9999-12-31' },
    { accountName: '' },
    { institution: '' },
    { entityId: 'unknown' },
  ])('rejects invalid targets without mutation %j', (patch) => {
    const dataset = createCsvDataset();
    expect(() => applyCsvImport(dataset, [row()], target(dataset, patch))).toThrow();
    expect(dataset).toEqual(createCsvDataset());
  });

  it('rejects mismatched entity/account references and duplicate new account definitions', () => {
    const dataset = applyCsvImport(createCsvDataset(), [row()], target()).dataset;
    expect(() => applyCsvImport(dataset, [row()], target(dataset))).toThrow('already exists');
    expect(() =>
      applyCsvImport(dataset, [row()], target(dataset, { accountId: 'unknown' })),
    ).toThrow('no longer exists');
    expect(() =>
      applyCsvImport(
        dataset,
        [row()],
        target(dataset, { accountId: dataset.accounts[0].id, entityId: dataset.entities[1].id }),
      ),
    ).toThrow('does not belong');
  });

  it('validates raw rows again and respects file and whole-ledger row limits', () => {
    expect(() => applyCsvImport(createCsvDataset(), [], target())).toThrow('1 and 5,000');
    expect(() =>
      applyCsvImport(createCsvDataset(), Array(MAX_CSV_ROWS + 1).fill(row()), target()),
    ).toThrow('1 and 5,000');
    expect(() =>
      applyCsvImport(createCsvDataset(), [row({ amountCents: 1.234 })], target()),
    ).toThrow('invalid');
    const dataset: FinanceDataset = applyCsvImport(createCsvDataset(), [row()], target()).dataset;
    const fixture = dataset.transactions[0];
    dataset.transactions = Array.from({ length: MAX_CSV_LEDGER_ROWS }, (_, index) => ({
      ...fixture,
      id: `fixture-${index}`,
      providerTransactionId: `fixture-${index}`,
      amountCents: 1,
    }));
    expect(() =>
      applyCsvImport(
        dataset,
        [row({ externalId: 'new' })],
        target(dataset, { accountId: dataset.accounts[0].id }),
      ),
    ).toThrow('10,000');
  });

  it('keeps calculated income, expense, daily and category totals reconciled to integer cents', () => {
    const preview = read(
      'Date,Amount,Description\n10/09/2026,100.01,PATIENT RECEIPTS\n10/09/2026,-12.34,DENTAL SUPPLIES\n11/09/2026,-0.29,OTHER\n11/09/2026,0.58,HICAPS HEALTH FUND SETTLEMENT',
    );
    expect(preview.errors).toEqual([]);
    const dataset = applyCsvImport(createCsvDataset(), preview.rows, target()).dataset;
    const summary = calculateSummary(dataset);
    expect(summary).toMatchObject({
      incomeCents: 10059,
      expenseCents: 1263,
      netCashflowCents: 8796,
      balanceCents: 123456,
    });
    expect(
      calculateDailyCashflow(dataset).reduce((sum, item) => sum + item.netCashflowCents, 0),
    ).toBe(summary.netCashflowCents);
    expect(
      calculateCategoryBreakdown(dataset).reduce((sum, item) => sum + item.amountCents, 0),
    ).toBe(summary.expenseCents);
  });

  it('rejects unsafe aggregate transaction and account balance arithmetic', () => {
    expect(() =>
      applyCsvImport(
        createCsvDataset(),
        [row({ amountCents: Number.MAX_SAFE_INTEGER }), row({ amountCents: 1 })],
        target(),
      ),
    ).toThrow('safe calculation');
    const first = applyCsvImport(
      createCsvDataset(),
      [row()],
      target(undefined, { balanceCents: Number.MAX_SAFE_INTEGER }),
    ).dataset;
    expect(() =>
      applyCsvImport(first, [row()], target(first, { accountName: 'Reserve', balanceCents: 1 })),
    ).toThrow('safe calculation');
  });
});
