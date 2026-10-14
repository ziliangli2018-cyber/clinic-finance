import { useEffect, useId, useMemo, useRef, useState } from 'react';
import { Link } from 'react-router-dom';
import {
  ArrowDownLeft,
  ArrowRight,
  ArrowUpRight,
  Check,
  CircleHelp,
  Download,
  FileSpreadsheet,
  HardDrive,
  RefreshCw,
  ShieldAlert,
  Trash2,
  Upload,
} from 'lucide-react';
import type { Account, FinanceDataset, Transaction } from '../types/domain';
import { formatMoney } from '../domain/analytics';
import { categoriseTransaction } from '../domain/categories';
import {
  inferCsvMapping,
  parseCsv,
  parseCsvMoney,
  previewCsv,
  type CsvDocument,
  type CsvImportTarget,
  type CsvMapping,
  type CsvRow,
} from '../domain/csv-import';
import './csv-import.css';

const csvLimitBytes = 5 * 1024 * 1024;
const backupLimitBytes = 10 * 1024 * 1024;
const accountKinds: { value: Account['kind']; label: string }[] = [
  { value: 'operating', label: 'Clinic operating account' },
  { value: 'savings', label: 'Savings account' },
  { value: 'loan', label: 'Loan account' },
  { value: 'credit_card', label: 'Credit card' },
  { value: 'transaction', label: 'Transaction account' },
  { value: 'mortgage', label: 'Mortgage' },
  { value: 'term_deposit', label: 'Term deposit' },
];

function todayInBrisbane(): string {
  const parts = new Intl.DateTimeFormat('en-AU', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(new Date());
  const part = (type: string) => parts.find((value) => value.type === type)!.value;
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function sampleDownload() {
  const today = todayInBrisbane();
  const dates = Array.from({ length: 5 }, (_, index) => {
    const date = new Date(`${today}T00:00:00Z`);
    date.setUTCDate(date.getUTCDate() - 4 + index);
    return date.toISOString().slice(0, 10);
  });
  const csv = [
    'Date,Description,Amount,Transaction ID',
    `${dates[0]},EFTPOS SETTLEMENT,4200.00,example-001`,
    `${dates[1]},DENTAL SUPPLIES,-350.00,example-002`,
    `${dates[2]},COMMERCIAL LEASE,-1200.00,example-003`,
    `${dates[3]},SOFTWARE SUBSCRIPTION,-75.00,example-004`,
    `${dates[4]},LABORATORY FEES,-400.00,example-005`,
  ].join('\r\n');
  const url = URL.createObjectURL(new Blob([csv], { type: 'text/csv;charset=utf-8' }));
  const anchor = document.createElement('a');
  anchor.href = url;
  anchor.download = 'clinic-finance-fictional-example.csv';
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  window.setTimeout(() => URL.revokeObjectURL(url), 1_000);
}

function suggestedCategory(row: CsvRow, data: FinanceDataset): string {
  const transaction: Transaction = {
    id: 'preview',
    organisationId: data.organisation.id,
    accountId: 'preview',
    providerTransactionId: row.externalId ?? 'preview',
    postedAt: row.postedAt,
    description: row.description,
    merchant: null,
    amountCents: row.amountCents,
    currency: 'AUD',
    categoryId: null,
    categorySource: 'uncategorised',
    status: 'posted',
    transferPairId: null,
    receiptStatus: 'missing',
  };
  const categorised = categoriseTransaction(transaction, data.categories);
  return (
    data.categories.find((category) => category.id === categorised.categoryId)?.name ??
    'Needs review'
  );
}

export function CsvImport({
  data,
  onImport,
  onActivate,
  onBackup,
  onRestore,
  onClear,
  busy,
  error,
}: {
  data: FinanceDataset;
  onImport: (
    rows: CsvRow[],
    target: CsvImportTarget,
  ) => Promise<{ imported: number; duplicates: number } | undefined>;
  onActivate: () => void;
  onBackup: () => void;
  onRestore: (file: File) => Promise<void>;
  onClear: () => void;
  busy: boolean;
  error: string;
}) {
  const controlId = useId();
  const readVersion = useRef(0);
  const [rawDocument, setRawDocument] = useState<CsvDocument | null>(null);
  const [mapping, setMapping] = useState<CsvMapping | null>(null);
  const [amountMode, setAmountMode] = useState<'signed' | 'split'>('signed');
  const [hasHeader, setHasHeader] = useState(true);
  const [fileName, setFileName] = useState('');
  const [reading, setReading] = useState(false);
  const [localError, setLocalError] = useState('');
  const [entityId, setEntityId] = useState(
    data.entities.find((entity) => entity.kind === 'clinic')?.id ?? data.entities[0]?.id ?? '',
  );
  const [accountId, setAccountId] = useState('new');
  const [accountName, setAccountName] = useState(
    `${data.entities.find((entity) => entity.kind === 'clinic')?.name ?? 'Clinic'} operating`,
  );
  const [institution, setInstitution] = useState('NAB');
  const [kind, setKind] = useState<Account['kind']>('operating');
  const [loanOwnerName, setLoanOwnerName] = useState('');
  const [balance, setBalance] = useState('');
  const [balanceDate, setBalanceDate] = useState('');
  const [reviewed, setReviewed] = useState(false);
  const [result, setResult] = useState<{ imported: number; duplicates: number } | null>(null);
  useEffect(
    () => () => {
      readVersion.current += 1;
    },
    [],
  );
  const locked = busy || reading;
  const selectedEntity = data.entities.find((entity) => entity.id === entityId);
  const csvConnectionIds = new Set(
    data.connections
      .filter((connection) => connection.provider === 'csv')
      .map((connection) => connection.id),
  );
  const csvAccounts = data.accounts.filter((account) => csvConnectionIds.has(account.connectionId));
  const eligibleAccounts = csvAccounts.filter((account) => account.entityId === entityId);
  const selectedAccount = eligibleAccounts.find((account) => account.id === accountId);
  const loanOwnerRequired = selectedEntity?.name === 'Loan entity (confirm borrower)';

  const document = useMemo((): CsvDocument | null => {
    if (!rawDocument) return null;
    const allRows =
      rawDocument.rowOffset === 1 ? rawDocument.rows : [rawDocument.headers, ...rawDocument.rows];
    if (hasHeader) {
      return { headers: allRows[0] ?? [], rows: allRows.slice(1), rowOffset: 2 };
    }
    const headers =
      rawDocument.rowOffset === 1
        ? rawDocument.headers
        : rawDocument.headers.map((_, index) => `Column ${index + 1}`);
    return { headers, rows: allRows, rowOffset: 1 };
  }, [rawDocument, hasHeader]);
  const preview = useMemo(
    () => (document && mapping ? previewCsv(document, mapping) : null),
    [document, mapping],
  );
  const totals = useMemo(() => {
    let inflow = 0n;
    let outflow = 0n;
    for (const row of preview?.rows ?? []) {
      if (row.amountCents > 0) inflow += BigInt(row.amountCents);
      else outflow += BigInt(-row.amountCents);
    }
    const unsafe = inflow + outflow > BigInt(Number.MAX_SAFE_INTEGER);
    return { inflow: unsafe ? 0 : Number(inflow), outflow: unsafe ? 0 : Number(outflow), unsafe };
  }, [preview]);
  const targetCheck = useMemo(() => {
    const errors: string[] = [];
    if (!selectedEntity || selectedEntity.kind === 'personal')
      errors.push('Choose a business entity.');
    if (accountId !== 'new' && !selectedAccount)
      errors.push('Choose an imported account belonging to this entity.');
    if (accountName.trim().length < 2 || accountName.trim().length > 120)
      errors.push('Enter an account name between 2 and 120 characters.');
    if (institution.trim().length < 2 || institution.trim().length > 80)
      errors.push('Enter a bank or institution name between 2 and 80 characters.');
    if (
      loanOwnerRequired &&
      (loanOwnerName.trim().length < 2 ||
        loanOwnerName.trim().length > 120 ||
        /confirm borrower|group finance|loan entity/i.test(loanOwnerName))
    )
      errors.push('Enter the actual legal borrower name for the shared loan entity.');
    if (totals.unsafe)
      errors.push('Combined transaction amounts exceed the safe calculation limit.');
    let balanceCents = 0;
    try {
      if (!balance.trim()) throw new Error('Enter the closing balance from your statement.');
      balanceCents = parseCsvMoney(balance);
    } catch (caught) {
      errors.push(
        caught instanceof Error ? caught.message : 'Enter a valid closing balance in AUD.',
      );
    }
    if ((kind === 'loan' || kind === 'mortgage') && balanceCents > 0)
      errors.push('Enter an outstanding loan or mortgage balance as a negative amount.');
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(balanceDate) ||
      !Number.isFinite(Date.parse(`${balanceDate}T00:00:00Z`)) ||
      new Date(`${balanceDate}T00:00:00Z`).toISOString().slice(0, 10) !== balanceDate
    ) {
      errors.push('Choose the date of that closing balance.');
    }
    if (balanceDate > todayInBrisbane())
      errors.push('The closing balance date cannot be in the future.');
    if (preview?.rows.some((row) => row.postedAt > balanceDate))
      errors.push(
        'The closing balance date must be on or after the latest transaction in this file.',
      );
    return { errors, balanceCents };
  }, [
    selectedEntity,
    accountId,
    selectedAccount,
    accountName,
    institution,
    loanOwnerRequired,
    loanOwnerName,
    balance,
    kind,
    balanceDate,
    preview,
    totals.unsafe,
  ]);

  function editMapping(changes: Partial<CsvMapping>) {
    setMapping((current) => (current ? { ...current, ...changes } : current));
    setReviewed(false);
    setResult(null);
  }

  async function readFile(file: File) {
    const version = ++readVersion.current;
    setLocalError('');
    setResult(null);
    setReviewed(false);
    setRawDocument(null);
    setMapping(null);
    setFileName('');
    setBalance('');
    setBalanceDate('');
    if (!/\.csv$/i.test(file.name)) {
      setLocalError(
        'Choose a CSV file exported by your bank. Excel workbooks and PDFs are not supported.',
      );
      return;
    }
    if (!file.size || file.size > csvLimitBytes) {
      setLocalError(
        'Choose a non-empty CSV file up to 5 MiB. Split a larger export into shorter periods.',
      );
      return;
    }
    setReading(true);
    try {
      const parsed = parseCsv(await file.text());
      if (version !== readVersion.current) return;
      setRawDocument(parsed);
      setHasHeader(parsed.rowOffset !== 1);
      const inferred = inferCsvMapping(parsed.headers);
      setMapping(inferred);
      setAmountMode(
        inferred.amount < 0 && inferred.debit >= 0 && inferred.credit >= 0 ? 'split' : 'signed',
      );
      setFileName(file.name);
    } catch (caught) {
      if (version === readVersion.current)
        setLocalError(caught instanceof Error ? caught.message : 'The CSV could not be read.');
    } finally {
      if (version === readVersion.current) setReading(false);
    }
  }

  function changeEntity(nextId: string) {
    const entity = data.entities.find((candidate) => candidate.id === nextId);
    setEntityId(nextId);
    setAccountId('new');
    setAccountName(
      entity?.kind === 'group' ? 'BOQ Specialist loan' : `${entity?.name ?? 'Clinic'} operating`,
    );
    setInstitution(entity?.kind === 'group' ? 'BOQ Specialist' : 'NAB');
    setKind(entity?.kind === 'group' ? 'loan' : 'operating');
    setLoanOwnerName('');
    setBalance('');
    setBalanceDate('');
    setReviewed(false);
    setResult(null);
  }

  function changeAccount(nextId: string) {
    setAccountId(nextId);
    const account = eligibleAccounts.find((candidate) => candidate.id === nextId);
    if (account) {
      setAccountName(account.name);
      setInstitution(account.institution);
      setKind(account.kind);
    } else {
      setAccountName(
        selectedEntity?.kind === 'group'
          ? 'BOQ Specialist loan'
          : `${selectedEntity?.name ?? 'Clinic'} operating`,
      );
      setInstitution(selectedEntity?.kind === 'group' ? 'BOQ Specialist' : 'NAB');
      setKind(selectedEntity?.kind === 'group' ? 'loan' : 'operating');
    }
    setBalance('');
    setBalanceDate('');
    setReviewed(false);
    setResult(null);
  }

  async function importRows() {
    if (
      locked ||
      !preview?.rows.length ||
      preview.errors.length ||
      targetCheck.errors.length ||
      !reviewed ||
      result
    )
      return;
    setLocalError('');
    try {
      const imported = await onImport(preview.rows, {
        accountId: selectedAccount?.id,
        entityId,
        accountName: accountName.trim(),
        institution: institution.trim(),
        kind,
        balanceCents: targetCheck.balanceCents,
        balanceDate,
        ...(loanOwnerRequired ? { loanOwnerName: loanOwnerName.trim() } : {}),
      });
      if (imported) {
        setResult(imported);
        setReviewed(false);
        onActivate();
      }
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'The import could not be saved.');
    }
  }

  async function restore(file: File) {
    setLocalError('');
    if (!/\.json$/i.test(file.name) || !file.size || file.size > backupLimitBytes) {
      setLocalError('Choose a Clinic Finance JSON backup up to 10 MiB.');
      return;
    }
    try {
      await onRestore(file);
    } catch (caught) {
      setLocalError(caught instanceof Error ? caught.message : 'The backup could not be restored.');
    }
  }

  function columnControl(
    label: string,
    key: 'date' | 'description' | 'amount' | 'debit' | 'credit' | 'transactionId',
    optional = false,
  ) {
    return (
      <label>
        {label}
        <select
          aria-label={label}
          value={mapping?.[key] ?? -1}
          onChange={(event) => editMapping({ [key]: Number(event.target.value) })}
          disabled={locked}
        >
          <option value={-1}>{optional ? 'Not provided' : 'Choose a column'}</option>
          {document?.headers.map((header, index) => (
            <option value={index} key={index}>
              {index + 1}. {header || 'Unnamed column'}
            </option>
          ))}
        </select>
      </label>
    );
  }

  return (
    <div className="csv-import" aria-busy={locked}>
      <section className="ci-intro">
        <div className="ci-intro-copy">
          <span className="ci-eyebrow">YOUR STATEMENTS, A CLEARER PICTURE</span>
          <h2>Turn a CSV into financial clarity</h2>
          <p>
            Import a bank export, review the details, then see cash flow, category breakdowns and
            forecasts for each clinic.
          </p>
        </div>
        <span className="ci-device-pill">
          <HardDrive size={16} /> Device-only workspace
        </span>
      </section>
      <div className="ci-privacy-note">
        <ShieldAlert size={21} aria-hidden="true" />
        <p>
          <strong>Private to this browser, not encrypted.</strong> Statement contents are processed
          on your device and are not uploaded or cloud-synced by this importer. Anyone with access
          to this browser profile may see them. Avoid patient names or identifiers. Clearing browser
          data can erase imports; keep a backup. CSV balances are statement snapshots, not real-time
          bank balances.
        </p>
      </div>

      {(localError || error) && (
        <div className="ci-message ci-error" role="alert">
          {localError || error}
        </div>
      )}
      {result && (
        <section className="ci-message ci-success" role="status">
          <Check size={21} />
          <div>
            <strong>
              {result.imported} transaction{result.imported === 1 ? '' : 's'} imported.
            </strong>
            <p>
              {result.duplicates} duplicate{result.duplicates === 1 ? '' : 's'} skipped. Categories
              and visualisations have been recalculated. This is separate from sample and
              connected-bank data.
            </p>
          </div>
        </section>
      )}
      {(result || data.transactions.length > 0) && (
        <div className="ci-result-links">
          <Link to="/" onClick={onActivate}>
            Overview <ArrowRight size={15} />
          </Link>
          <Link to="/transactions" onClick={onActivate}>
            Review categories <ArrowRight size={15} />
          </Link>
          <Link to="/analytics" onClick={onActivate}>
            Visualise cash flow <ArrowRight size={15} />
          </Link>
          <Link to="/forecast" onClick={onActivate}>
            Forecast <ArrowRight size={15} />
          </Link>
        </div>
      )}

      <section className="ci-card" aria-labelledby={`${controlId}-upload`}>
        <div className="ci-section-heading">
          <span className="ci-step">1</span>
          <div>
            <h3 id={`${controlId}-upload`}>Choose your bank CSV</h3>
            <p>Export one account at a time from NAB or another bank. Up to 5 MiB per file.</p>
          </div>
        </div>
        <div className="ci-upload-area">
          <FileSpreadsheet size={34} />
          <div>
            <strong>
              {reading ? 'Reading your statement…' : fileName || 'Choose a transaction export'}
            </strong>
            <p>CSV only · Date, description and amount or debit/credit columns</p>
          </div>
          <label className={`ci-file-button ${locked ? 'ci-disabled' : ''}`}>
            <Upload size={17} /> {fileName ? 'Choose another CSV' : 'Choose CSV file'}
            <input
              aria-label="Choose CSV file"
              type="file"
              accept=".csv,text/csv"
              disabled={locked}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void readFile(file);
              }}
            />
          </label>
        </div>
        <button className="ci-text-button" onClick={sampleDownload} disabled={locked}>
          <Download size={15} /> Download a fictional example CSV
        </button>
        <p className="ci-small">
          The example is synthetic. Import it only to practise; clear imported data before loading
          your real statements.
        </p>
      </section>

      {document && mapping && (
        <>
          <section className="ci-card" aria-labelledby={`${controlId}-mapping`}>
            <div className="ci-section-heading">
              <span className="ci-step">2</span>
              <div>
                <h3 id={`${controlId}-mapping`}>Check the column mapping</h3>
                <p>
                  We suggest matching columns. Please check the dates and signs against your
                  statement.
                </p>
              </div>
            </div>
            <label className="ci-checkbox">
              <input
                type="checkbox"
                checked={hasHeader}
                disabled={locked}
                onChange={(event) => {
                  const next = event.target.checked;
                  const allRows =
                    rawDocument!.rowOffset === 1
                      ? rawDocument!.rows
                      : [rawDocument!.headers, ...rawDocument!.rows];
                  const headers = next
                    ? allRows[0]
                    : rawDocument!.rowOffset === 1
                      ? rawDocument!.headers
                      : rawDocument!.headers.map((_, index) => `Column ${index + 1}`);
                  setHasHeader(next);
                  const inferred = inferCsvMapping(headers);
                  setMapping(inferred);
                  setAmountMode(
                    inferred.amount < 0 && inferred.debit >= 0 && inferred.credit >= 0
                      ? 'split'
                      : 'signed',
                  );
                  setReviewed(false);
                  setResult(null);
                }}
              />{' '}
              First row contains column headings
            </label>
            <div className="ci-form-grid">
              {columnControl('Transaction date', 'date')}
              {columnControl('Description', 'description')}
              <label>
                Amount layout
                <select
                  aria-label="Amount layout"
                  value={amountMode}
                  disabled={locked}
                  onChange={(event) => {
                    const inferred = inferCsvMapping(document.headers);
                    setAmountMode(event.target.value as 'signed' | 'split');
                    editMapping(
                      event.target.value === 'signed'
                        ? { amount: inferred.amount, debit: -1, credit: -1 }
                        : { amount: -1, debit: inferred.debit, credit: inferred.credit },
                    );
                  }}
                >
                  <option value="signed">One signed amount column</option>
                  <option value="split">Separate debit and credit columns</option>
                </select>
              </label>
              {amountMode === 'signed' ? (
                columnControl('Signed amount', 'amount')
              ) : (
                <>
                  {columnControl('Debit / money out', 'debit')}
                  {columnControl('Credit / money in', 'credit')}
                </>
              )}
              {columnControl('Bank transaction ID (optional)', 'transactionId', true)}
              <label>
                Date format
                <select
                  aria-label="Date format"
                  value={mapping.dateFormat}
                  disabled={locked}
                  onChange={(event) =>
                    editMapping({ dateFormat: event.target.value as CsvMapping['dateFormat'] })
                  }
                >
                  <option value="dmy">Day / month / year (Australian)</option>
                  <option value="mdy">Month / day / year</option>
                  <option value="iso">Year-month-day (ISO)</option>
                </select>
              </label>
            </div>
            <label className="ci-checkbox">
              <input
                type="checkbox"
                checked={mapping.reverseSign}
                disabled={locked}
                onChange={(event) => editMapping({ reverseSign: event.target.checked })}
              />{' '}
              Reverse amount signs (only if your bank export uses the opposite convention)
            </label>
            <p className="ci-small">
              Positive = money in. Negative = money out. ISO dates are supported in every date mode.
              Without a bank transaction ID, repeated imports use date, description, amount and
              occurrence count to detect overlapping rows; review same-day identical transactions
              carefully.
            </p>
          </section>

          <section className="ci-card" aria-labelledby={`${controlId}-account`}>
            <div className="ci-section-heading">
              <span className="ci-step">3</span>
              <div>
                <h3 id={`${controlId}-account`}>Assign the account and statement balance</h3>
                <p>
                  Kilcoy and Burpengary stay separate. Adding another account does not require a
                  bank connection.
                </p>
              </div>
            </div>
            <div className="ci-form-grid">
              <label>
                Clinic / legal owner
                <select
                  aria-label="Clinic / legal owner"
                  value={entityId}
                  disabled={locked}
                  onChange={(event) => changeEntity(event.target.value)}
                >
                  {data.entities
                    .filter((entity) => entity.kind !== 'personal')
                    .map((entity) => (
                      <option key={entity.id} value={entity.id}>
                        {entity.name}
                      </option>
                    ))}
                </select>
              </label>
              <label>
                Import into account
                <select
                  aria-label="Import into account"
                  value={accountId}
                  disabled={locked}
                  onChange={(event) => changeAccount(event.target.value)}
                >
                  <option value="new">Add a new CSV account</option>
                  {eligibleAccounts.map((account) => (
                    <option key={account.id} value={account.id}>
                      {account.name} · {account.institution}
                    </option>
                  ))}
                </select>
              </label>
              <label>
                Account name
                <input
                  aria-label="Account name"
                  value={accountName}
                  maxLength={120}
                  disabled={locked || Boolean(selectedAccount)}
                  onChange={(event) => {
                    setAccountName(event.target.value);
                    setReviewed(false);
                  }}
                  placeholder="Kilcoy operating"
                />
              </label>
              <label>
                Bank / institution
                <input
                  aria-label="Bank / institution"
                  value={institution}
                  maxLength={80}
                  disabled={locked || Boolean(selectedAccount)}
                  onChange={(event) => {
                    setInstitution(event.target.value);
                    setReviewed(false);
                  }}
                  placeholder="NAB"
                />
              </label>
              <label>
                Account type
                <select
                  aria-label="Account type"
                  value={kind}
                  disabled={locked || Boolean(selectedAccount)}
                  onChange={(event) => {
                    setKind(event.target.value as Account['kind']);
                    setReviewed(false);
                  }}
                >
                  {accountKinds.map((option) => (
                    <option key={option.value} value={option.value}>
                      {option.label}
                    </option>
                  ))}
                </select>
              </label>
              {loanOwnerRequired && (
                <label>
                  Actual legal borrower name
                  <input
                    aria-label="Actual legal borrower name"
                    value={loanOwnerName}
                    maxLength={120}
                    disabled={locked}
                    onChange={(event) => {
                      setLoanOwnerName(event.target.value);
                      setReviewed(false);
                    }}
                    placeholder="Legal entity named on the loan agreement"
                  />
                  <small>
                    Not an assumed clinic group. Use the actual borrower on the BOQ Specialist loan.
                  </small>
                </label>
              )}
              <label>
                Statement closing balance (AUD)
                <input
                  aria-label="Statement closing balance (AUD)"
                  value={balance}
                  inputMode="decimal"
                  disabled={locked}
                  onChange={(event) => {
                    setBalance(event.target.value);
                    setReviewed(false);
                  }}
                  placeholder={
                    kind === 'loan' || kind === 'mortgage' || kind === 'credit_card'
                      ? '-125000.00'
                      : '12345.67'
                  }
                />
                <small>
                  Enter the bank statement figure, not the sum of uploaded transactions. Enter money
                  owed as negative.
                </small>
              </label>
              <label>
                Closing balance date
                <input
                  aria-label="Closing balance date"
                  type="date"
                  value={balanceDate}
                  disabled={locked}
                  onChange={(event) => {
                    setBalanceDate(event.target.value);
                    setReviewed(false);
                  }}
                />
                <small>
                  On or after the latest transaction in this CSV. Never presented as a live balance.
                </small>
              </label>
            </div>
            <p className="ci-account-note">
              <CircleHelp size={17} />{' '}
              {loanOwnerRequired
                ? 'You must confirm the legal borrower before importing the shared loan. A loan is not treated as available cash.'
                : `Import only accounts legally owned by ${selectedEntity?.name ?? 'the selected entity'}. Existing CSV imports are separate from any bank-feed accounts.`}
            </p>
          </section>

          <section className="ci-card" aria-labelledby={`${controlId}-review`}>
            <div className="ci-section-heading">
              <span className="ci-step">4</span>
              <div>
                <h3 id={`${controlId}-review`}>Review, then import</h3>
                <p>No rows are saved until all errors are fixed and you confirm the review.</p>
              </div>
            </div>
            <div className="ci-review-totals">
              <div>
                <FileSpreadsheet size={18} />
                <span>Valid rows</span>
                <strong>{preview?.rows.length ?? 0}</strong>
              </div>
              <div>
                <ArrowDownLeft size={18} />
                <span>Money in</span>
                <strong>{totals.unsafe ? 'Exceeds safe limit' : formatMoney(totals.inflow)}</strong>
              </div>
              <div>
                <ArrowUpRight size={18} />
                <span>Money out</span>
                <strong>
                  {totals.unsafe ? 'Exceeds safe limit' : formatMoney(totals.outflow)}
                </strong>
              </div>
              <div>
                <RefreshCw size={18} />
                <span>Net movement</span>
                <strong>
                  {totals.unsafe
                    ? 'Exceeds safe limit'
                    : formatMoney(totals.inflow - totals.outflow)}
                </strong>
              </div>
            </div>
            {!!preview?.errors.length && (
              <div className="ci-message ci-error" role="alert">
                <strong>
                  {preview.errors.length} error{preview.errors.length === 1 ? '' : 's'} to fix —
                  nothing will be imported.
                </strong>
                <ol>
                  {preview.errors.map((issue, index) => (
                    <li key={`${issue.rowNumber}-${index}`}>
                      {issue.rowNumber ? `Row ${issue.rowNumber}: ` : ''}
                      {issue.message}
                    </li>
                  ))}
                </ol>
              </div>
            )}
            {!!preview?.warnings.length && (
              <div className="ci-message ci-warning">
                <strong>Review these notices</strong>
                <ul>
                  {preview.warnings.map((warning, index) => (
                    <li key={index}>{warning}</li>
                  ))}
                </ul>
              </div>
            )}
            {preview && preview.rows.length > 0 && (
              <div
                className="ci-preview-scroll"
                tabIndex={0}
                role="region"
                aria-label="Transaction import preview"
              >
                <table className="ci-preview-table">
                  <caption>
                    First {Math.min(12, preview.rows.length)} valid rows · category suggestions can
                    be corrected after import
                  </caption>
                  <thead>
                    <tr>
                      <th>CSV row</th>
                      <th>Date</th>
                      <th>Description</th>
                      <th className="ci-money">Amount (AUD)</th>
                      <th>Suggested category</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.rows.slice(0, 12).map((row) => (
                      <tr key={row.rowNumber}>
                        <td>{row.rowNumber}</td>
                        <td>{row.postedAt}</td>
                        <td className="ci-description">{row.description}</td>
                        <td className={`ci-money ${row.amountCents > 0 ? 'ci-positive' : ''}`}>
                          {formatMoney(row.amountCents)}
                        </td>
                        <td>{suggestedCategory(row, data)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
            {targetCheck.errors.length > 0 && (
              <div className="ci-incomplete">
                <strong>Complete before importing</strong>
                <ul>
                  {targetCheck.errors.map((issue, index) => (
                    <li key={index}>{issue}</li>
                  ))}
                </ul>
              </div>
            )}
            <label className="ci-checkbox ci-review-confirm">
              <input
                type="checkbox"
                checked={reviewed}
                disabled={locked || Boolean(result)}
                onChange={(event) => setReviewed(event.target.checked)}
              />{' '}
              I have checked the dates, money-in/out signs, legal account owner and signed statement
              closing balance.
            </label>
            <div className="ci-import-footer">
              <button
                className="button primary"
                disabled={
                  locked ||
                  !preview?.rows.length ||
                  Boolean(preview?.errors.length) ||
                  targetCheck.errors.length > 0 ||
                  !reviewed ||
                  Boolean(result)
                }
                onClick={() => void importRows()}
              >
                <Upload size={17} />
                {busy
                  ? 'Saving import…'
                  : result
                    ? 'Import complete'
                    : `Import ${preview?.rows.length ?? 0} transactions`}
              </button>
              <p>
                Category suggestions use description rules, not AI. Unknown descriptions remain
                uncategorised. Internal transfers are matched only when both account sides are
                available; review suggestions for accuracy.
              </p>
            </div>
          </section>
        </>
      )}

      <section className="ci-card ci-backup" aria-labelledby={`${controlId}-backup`}>
        <div className="ci-section-heading">
          <HardDrive size={24} />
          <div>
            <h3 id={`${controlId}-backup`}>Keep control of your imported data</h3>
            <p>
              {csvAccounts.length} imported account{csvAccounts.length === 1 ? '' : 's'} ·{' '}
              {data.transactions.length} transactions in this browser.
            </p>
          </div>
        </div>
        <div className="ci-backup-actions">
          <button
            className="button secondary"
            disabled={locked || !csvAccounts.length}
            onClick={onBackup}
          >
            <Download size={16} /> Imported data backup (JSON)
          </button>
          <label className={`ci-file-button ci-secondary ${locked ? 'ci-disabled' : ''}`}>
            <Upload size={16} /> Restore JSON backup
            <input
              aria-label="Restore JSON backup"
              type="file"
              accept=".json,application/json"
              disabled={locked}
              onChange={(event) => {
                const file = event.target.files?.[0];
                event.target.value = '';
                if (file) void restore(file);
              }}
            />
          </label>
          <button
            className="ci-text-button ci-danger"
            disabled={locked || (!csvAccounts.length && !error)}
            onClick={onClear}
          >
            <Trash2 size={16} /> Clear imported data
          </button>
        </div>
        <p className="ci-small">
          The JSON backup includes imported accounts, transactions and categories; budgets, goals
          and bill plans are not included. Backups are not encrypted: keep them securely. Restoring
          replaces this browser's imported dataset only. Clearing imported data does not delete
          sample data or connected-bank records.
        </p>
      </section>
    </div>
  );
}
