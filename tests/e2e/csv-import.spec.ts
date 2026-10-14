import { test, expect, type Page } from '@playwright/test';

const statement = [
  'Date,Description,Amount,Transaction ID',
  '15/09/2026,EFTPOS SETTLEMENT,4200.00,nab-001',
  '16/09/2026,DENTAL SUPPLIES,-350.00,nab-002',
  '17/09/2026,COMMERCIAL LEASE,-1200.00,nab-003',
  '18/09/2026,SOFTWARE SUBSCRIPTION,-75.00,nab-004',
  '19/09/2026,LABORATORY FEES,-400.00,nab-005',
].join('\n');

async function upload(page: Page, csv = statement) {
  await page.getByLabel('Choose CSV file', { exact: true }).setInputFiles({
    name: 'synthetic-nab.csv',
    mimeType: 'text/csv',
    buffer: Buffer.from(csv),
  });
  await expect(page.getByRole('heading', { name: 'Review, then import' })).toBeVisible();
}
async function confirmImport(page: Page, balance = '12345.67', date = '2026-09-20') {
  await page.getByLabel('Statement closing balance (AUD)', { exact: true }).fill(balance);
  await page.getByLabel('Closing balance date', { exact: true }).fill(date);
  await page.getByLabel(/I have checked the dates/).check();
  await page.getByRole('button', { name: /^Import \d+ transactions$/ }).click();
}

test('CSV categorisation, calculations, charts, reload, duplicates, export and backup', async ({
  page,
}) => {
  const errors: string[] = [];
  const uploads: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  page.on('request', (request) => {
    if (request.method() === 'POST') uploads.push(request.url());
  });
  await page.goto('./#/import');
  await expect(
    page.getByText('0 imported accounts · 0 transactions in this browser.'),
  ).toBeVisible();
  await upload(page);
  await expect(page.locator('.ci-preview-table tbody tr')).toHaveCount(5);
  await expect(page.locator('.ci-review-totals')).toContainText('$4,200.00');
  await expect(page.locator('.ci-review-totals')).toContainText('$2,025.00');
  await confirmImport(page);
  await expect(page.getByText('5 transactions imported.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click();
  await expect(page.getByText('Statement cash balance', { exact: true })).toBeVisible();
  const metrics = page.locator('.metric-card');
  await expect(metrics.nth(0)).toContainText('$12,345.67');
  await expect(metrics.nth(1)).toContainText('$4,200.00');
  await expect(metrics.nth(2)).toContainText('$2,025.00');
  await expect(metrics.nth(3)).toContainText('$2,175.00');
  await expect(page.getByRole('region', { name: 'Demonstration mode' })).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Simulate update' })).toHaveCount(0);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.artifacts/csv-overview-desktop.png',
    fullPage: true,
    animations: 'disabled',
  });
  await page.getByRole('link', { name: 'Transactions', exact: true }).first().click();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  const csvPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Export', exact: true }).click();
  const exportedCsv = await csvPromise;
  const csvStream = await exportedCsv.createReadStream();
  const csvChunks: Buffer[] = [];
  for await (const chunk of csvStream!) csvChunks.push(chunk as Buffer);
  expect(Buffer.concat(csvChunks).toString()).toContain('EFTPOS SETTLEMENT');
  await page.locator('.transaction-link').filter({ hasText: 'DENTAL SUPPLIES' }).click();
  const dialog = page.getByRole('dialog');
  await dialog
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption({ label: 'Miscellaneous business expenses' });
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog.getByText('Category saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await page.reload();
  await expect(page.locator('tbody tr')).toHaveCount(5);
  await expect(page.locator('tbody tr').filter({ hasText: 'DENTAL SUPPLIES' })).toContainText(
    'Miscellaneous business expenses',
  );
  await page.getByRole('link', { name: 'Import CSV', exact: true }).click();
  await upload(page);
  await page
    .getByLabel('Import into account', { exact: true })
    .selectOption({ label: 'Kilcoy operating · NAB' });
  await confirmImport(page);
  await expect(page.getByText('0 transactions imported.', { exact: true })).toBeVisible();
  await expect(page.locator('.ci-success')).toContainText('5 duplicates skipped');
  const backupPromise = page.waitForEvent('download');
  await page.getByRole('button', { name: 'Imported data backup (JSON)' }).click();
  const backup = await backupPromise;
  const stream = await backup.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream!) chunks.push(chunk as Buffer);
  const backupBytes = Buffer.concat(chunks);
  expect(JSON.parse(backupBytes.toString()).dataset.transactions).toHaveLength(5);
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Clear imported data' }).click();
  await expect(
    page.getByText('0 imported accounts · 0 transactions in this browser.'),
  ).toBeVisible();
  await expect(page.getByText('Import complete', { exact: true })).toHaveCount(0);
  await page
    .getByLabel('Restore JSON backup', { exact: true })
    .setInputFiles({ name: 'backup.json', mimeType: 'application/json', buffer: backupBytes });
  await expect(
    page.getByText('1 imported account · 5 transactions in this browser.'),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Analytics', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Expense breakdown' })).toBeVisible();
  await page.getByRole('link', { name: 'Forecast', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Cash-flow forecast' })).toBeVisible();
  await page.getByRole('button', { name: '90 days', exact: true }).click();
  await expect(page.getByRole('img', { name: /90-day cash forecast/ })).toBeVisible();
  await page.getByRole('link', { name: 'Import CSV', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.screenshot({
    path: '.artifacts/csv-import-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
  expect(uploads).toEqual([]);
  expect(errors).toEqual([]);
});

test('unknown headers map manually and malformed CSV never imports partial rows', async ({
  page,
}) => {
  await page.goto('./#/import');
  await upload(page, 'When,Details,Value\n2026-09-18,DENTAL SUPPLIES,-12.34');
  await page.getByLabel('Amount layout', { exact: true }).selectOption('signed');
  await page.getByLabel('Transaction date', { exact: true }).selectOption('0');
  await page.getByLabel('Description', { exact: true }).selectOption('1');
  await page.getByLabel('Signed amount', { exact: true }).selectOption('2');
  await confirmImport(page, '100.00');
  await expect(page.getByText('1 transaction imported.', { exact: true })).toBeVisible();
  await upload(page, 'Date,Description,Amount\n19/09/2026,RENT,-30.00\n31/02/2026,BAD DATE,-4.00');
  await page.getByLabel('Statement closing balance (AUD)', { exact: true }).fill('70');
  await page.getByLabel('Closing balance date', { exact: true }).fill('2026-09-20');
  await page.getByLabel(/I have checked the dates/).check();
  await expect(
    page.getByRole('button', { name: 'Import 1 transactions', exact: true }),
  ).toBeDisabled();
  await expect(page.getByText(/1 error to fix/)).toBeVisible();
  await expect(
    page.getByText('1 imported account · 1 transactions in this browser.'),
  ).toBeVisible();
});

test('corrupt storage is explicitly recoverable and sample data stays separate', async ({
  page,
}) => {
  await page.goto('./');
  await page.evaluate(() =>
    localStorage.setItem('clinic-finance.csv-workspace.v1', 'corrupt-data'),
  );
  await page.goto('./#/import');
  await page.reload();
  await expect(page.getByRole('button', { name: 'Clear imported data' })).toBeEnabled();
  page.once('dialog', (d) => void d.accept());
  await page.getByRole('button', { name: 'Clear imported data' }).click();
  await expect(
    page.getByText('0 imported accounts · 0 transactions in this browser.'),
  ).toBeVisible();
  await page.getByLabel('Workspace data source').selectOption('bank');
  await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
  await expect(page.getByRole('region', { name: 'Demonstration mode' })).toBeVisible();
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card')).toHaveCount(7);
});

test('long imported history charts and mixed snapshot dates are not mislabelled as live forecasts', async ({
  page,
}) => {
  await page.goto('./#/import');
  await upload(
    page,
    'Date,Description,Amount\n1999-01-01,PATIENT RECEIPTS,100.00\n2026-09-18,RENT,-10.00',
  );
  await confirmImport(page, '1000');
  await page.getByRole('link', { name: 'Overview', exact: true }).first().click();
  await page.getByLabel('Reporting period').selectOption('0');
  await expect(page.locator('.metric-card').nth(1)).toContainText('$100.00');
  await expect(
    page.getByRole('img', { name: 'Money in and money out across the selected period' }),
  ).toBeVisible();
  await page.getByRole('link', { name: 'Import CSV', exact: true }).click();
  await upload(page, 'Date,Description,Amount\n2026-08-01,PATIENT RECEIPTS,50.00');
  await page
    .getByLabel('Clinic / legal owner', { exact: true })
    .selectOption({ label: 'Burpengary' });
  await confirmImport(page, '500', '2026-08-02');
  await page.getByRole('link', { name: 'Forecast', exact: true }).first().click();
  await expect(page.getByRole('heading', { name: 'Align statement balance dates' })).toBeVisible();
  await page.getByRole('button', { name: 'Burpengary', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Cash-flow forecast' })).toBeVisible();
  await expect(page.getByText('Statement balance at 2 Aug 2026', { exact: true })).toBeVisible();
});

test('a newer loan statement does not advance the cash forecast snapshot date', async ({
  page,
}) => {
  await page.goto('./#/import');
  await upload(page);
  await confirmImport(page);
  await upload(page, 'Date,Description,Amount\n2026-10-01,LOAN REPAYMENT,500.00');
  await page
    .getByLabel('Clinic / legal owner', { exact: true })
    .selectOption({ label: 'Loan entity (confirm borrower)' });
  await page
    .getByLabel('Actual legal borrower name', { exact: true })
    .fill('Fictional Practice Finance Entity');
  await confirmImport(page, '-100000', '2026-10-02');
  await expect(page.getByText('1 transaction imported.', { exact: true })).toBeVisible();
  await page.getByRole('link', { name: 'Forecast', exact: true }).first().click();
  await expect(page.getByText('Statement balance at 20 Sept 2026', { exact: true })).toBeVisible();
  await expect(page.getByRole('img', { name: /30-day cash forecast/ })).toBeVisible();
});
