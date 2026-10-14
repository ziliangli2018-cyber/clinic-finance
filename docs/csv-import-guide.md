# CSV import guide

The statement workspace lets you analyse bank exports without waiting for Basiq activation. It reuses the dashboard, transaction categorisation, analytics, budgets, bills, goals and indicative forecasts, but keeps imported data separate from the fictional demo and any connected-bank workspace.

## Privacy and storage

CSV contents are read, processed and stored on your device in the current browser profile. This importer does not upload statement rows to GitHub, Basiq or Supabase. The public website's source and fictional fixtures are public; your imported contents are not published with them.

The local dataset and downloaded backups are **not encrypted by the app**. Anyone with access to this browser profile can access the imported data; this mode is not protected by cloud authentication or organisation membership. Avoid shared devices. Remove or anonymise patient names and identifiers before uploading. Never commit real statements, downloaded backups, banking credentials or sensitive descriptions to the public repository.

Clearing browser data, switching browser profiles or exiting a private-browsing session can remove the workspace. Keep the original bank statements and secure downloaded backups. Browser storage quotas can limit the practical dataset size; a failed save leaves the previously saved dataset unchanged and is not reported as a successful import.

## Import a statement

1. Export one account's transactions as CSV from NAB, BOQ Specialist or another bank. Use AUD accounts only: there is no currency conversion or verification of a bank's currency column.
2. Open **Import CSV**. **Download a fictional example CSV** is available for practice and contains no patient names. Clear practice imports before loading real statements; the example is not automatically separated from other CSV imports.
3. Choose the file and review the suggested column mapping. Identify the date, description and either a signed amount or separate debit/credit columns. Map a stable bank transaction ID if the export includes one.
4. Choose the clinic/legal owner and either add a new CSV account or select an existing imported account for the same owner. Check its account name, bank and type.
5. Enter the bank statement's **closing balance in AUD** and its **closing balance date**. These are required for every import, including an existing account. Do not substitute the sum of transactions for the balance.
6. Review the normalized dates, amount signs, category suggestions, money-in/out totals and every error or warning. Check the review confirmation, then select **Import … transactions**. Any invalid row or invalid account/balance input blocks the whole import; invalid rows are not silently skipped.
7. After success, open **Overview**, **Review categories**, **Visualise cash flow** or **Forecast**. A successful import or restore selects **My CSV data**. Choose the clinic and reporting period you want; **All imported history** includes statements outside the latest 30/60/90-day window.

The importer never starts a bank login, requests passwords or generates simulated transactions. To update the dataset, import another statement. **My CSV data** and the bank/demo workspace can be selected independently; switching does not merge their records.

## Supported CSV formats and limits

The parser accepts comma, semicolon or tab separators, UTF-8 BOMs, quoted descriptions, escaped quotes and line breaks within quoted fields. Malformed quotes and inconsistent column counts are errors. Excel workbooks and PDFs are not supported.

| Item                  | Limit or behaviour                                                                                   |
| --------------------- | ---------------------------------------------------------------------------------------------------- |
| CSV upload            | Non-empty `.csv`, up to 5 MiB and 5,000 transaction rows per file                                    |
| Imported workspace    | Up to 10,000 transactions and 100 accounts                                                           |
| JSON backup/restore   | Clinic Finance versioned imported-data backup, up to 10 MiB                                          |
| Currency              | AUD only; amounts stored and calculated as integer cents                                             |
| Dates                 | Australian day/month/year, month/day/year or ISO year-month-day; ISO dates work in every date mode   |
| Signed amount         | Positive money in; negative money out. Reverse signs only if the export uses the opposite convention |
| Debit/credit layout   | Both columns mapped; non-negative values with exactly one positive amount per row                    |
| Headerless NAB layout | Date, signed amount, description; detected automatically and shown for review                        |

For other headerless layouts, untick **First row contains column headings** and map the columns yourself. Ambiguous dates such as `03/04/2026` require checking the selected format. Amounts support common AUD symbols, correctly grouped thousands separators, parentheses and separated `DR`/`CR` suffixes, but never more than two decimal places. Comma-containing amounts must be quoted in comma-separated CSVs. Unsafe aggregate values are rejected rather than rounded into misleading totals.

This is a fictional signed-amount example:

```csv
Date,Description,Amount,Transaction ID
2026-09-01,EFTPOS SETTLEMENT,4200.00,example-001
2026-09-02,DENTAL SUPPLIES,-350.00,example-002
2026-09-03,COMMERCIAL LEASE,-1200.00,example-003
```

Headers are suggestions, not proof that a column is correct. Always compare the preview with the source export before importing.

## Account ownership and balances

Kilcoy and Burpengary have separate legal-entity records and their own NAB accounts. Each imported account belongs to one selected entity. Only existing **CSV** accounts for that entity appear as import targets; a statement cannot be appended to a bank-feed account.

For the shared BOQ Specialist loan, choose **Loan entity (confirm borrower)** and enter the **actual legal borrower name** from the loan agreement. Neither clinic nor an invented “Group finance” owner is assumed. The placeholder is renamed only after a successful import. Additional accounts can be added later under the appropriate owner.

Balances are explicit dated statement snapshots, not calculated from partial transaction history and not real-time bank balances. Enter an outstanding loan or mortgage balance as negative; those account types cannot have a positive imported balance. Enter credit-card money owed as negative; an actual credit balance may be positive.

The closing balance date must be valid, not in the future, and on or after every transaction date in the uploaded file. Importing an older statement can add historical transactions, but does not replace a newer saved account balance with an older snapshot. Accounts retain their latest saved balance date even when a dashboard's transaction reporting period changes.

## Categories, duplicates and visualisations

Category suggestions are **description-based rules, not AI**. Recognised descriptions such as dental supplies, rent, payroll and EFTPOS settlements receive suggestions. Unknown descriptions remain uncategorised. Check suggestions and use individual or bulk category edits in **Transactions**; manual choices survive subsequent imports into the same account.

Internal transfers can be matched when compatible transaction rows from both account sides have been imported. Matched transfers are treated separately in cash-flow calculations; one-sided or ambiguous movements need review. Loan payments are not automatically turned into ordinary cash-account transfers. This is a cash-movement planning view, not an accounting ledger, a profit calculation or a GST/tax report.

Duplicate detection is scoped to the selected imported account. A repeated bank transaction ID with unchanged date, amount and description is skipped; conflicting content for the same ID blocks the import. When IDs are unavailable, matching uses date, normalized description, amount and the occurrence number of identical rows in that file. This preserves multiple identical rows within one export, but cannot prove that identical same-day movements in overlapping exports are the same transaction. Review those cases carefully. Keep ID mapping consistent across uploads; switching between exports with and without IDs can bypass matching.

Dashboard totals, category breakdowns and charts update after a successful import. **Transactions → Export CSV** exports the complete filtered result, not just the visible page, with entity, account, category, signed amount, direction and status. Text cells are escaped to reduce spreadsheet-formula risk. This CSV is a reporting export, not a full-fidelity restore backup.

## Forecasting statement data

The 30/60/90-day forecast starts from dated balances of selected cash accounts and uses available posted transaction history and recurring patterns. Loan and mortgage balances are liabilities, not available cash.

A combined statement forecast requires the selected cash accounts' closing balances to have the **same date**. If Kilcoy and Burpengary statements end on different dates, choose one clinic whose cash accounts are aligned, or import updated balance snapshots for a common date. The interface blocks the combined forecast rather than presenting differently dated balances as one current cash position. A loan-only scope cannot produce a cash forecast.

Short or incomplete histories produce less informative projections. Forecasts are indicative planning signals, not promises, financial advice or a replacement for checking statements and known future commitments.

## Back up, restore or clear imports

**Imported data backup (JSON)** downloads the imported organisation/entity mapping, accounts and their balance dates, transactions, categories and category assignments. It does **not** include budgets, goals or bill plans; unrelated browser-local keys, authentication data and workspace-selection preferences are also excluded. Store the unencrypted file securely.

**Restore JSON backup** validates a Clinic Finance backup before replacing the current browser's imported dataset. If there are existing imports, the app asks for confirmation; export the current dataset first. A malformed, unsupported or oversized backup does not replace saved records. Restoring on a different browser does not transfer plans. Plans already on that browser remain separate, so check account links after restoring a different dataset.

**Clear imported data** requires confirmation and removes only the imported dataset from this browser. It does not clear all browser storage, remove the fictional demo, delete connected-bank records or revoke bank consent. Locally saved budgets, goals and bill plans are not included in this dataset reset; review links to any removed accounts. If the imported dataset is damaged, the error is shown without silently overwriting it; restore a valid backup or explicitly clear imports to start again.
