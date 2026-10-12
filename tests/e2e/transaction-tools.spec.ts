import { expect, test, type Page } from '@playwright/test';
import type { DemoState } from '../../src/services/demo-storage';

async function savedState(page: Page): Promise<DemoState> {
  return page.evaluate(() => JSON.parse(localStorage.getItem('clinic-finance.demo-state')!).state);
}

test('amount filters include both directions and category drillthrough survives reload', async ({
  page,
}) => {
  await page.goto('./#/transactions');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByLabel('Minimum amount (AUD)').fill('600');
  await page.getByLabel('Maximum amount (AUD)').fill('900');
  const amounts = await page.locator('tbody .amount').allTextContents();
  expect(amounts.length).toBeGreaterThan(0);
  for (const amount of amounts) {
    const absolute = Number(amount.replace(/[^\d.]/g, ''));
    expect(absolute).toBeGreaterThanOrEqual(600);
    expect(absolute).toBeLessThanOrEqual(900);
  }
  expect(amounts.some((amount) => amount.includes('−'))).toBe(true);
  await page.getByLabel('Minimum amount (AUD)').fill('1000');
  await expect(page.getByRole('alert')).toHaveText(
    'Minimum amount must not exceed maximum amount.',
  );
  await page.getByRole('button', { name: 'Clear filters', exact: true }).click();
  await page.getByLabel('Category filter').selectOption({ label: 'Dental supplies' });
  expect(page.url()).toContain('category=');
  await expect(page.getByLabel('Category filter')).not.toHaveValue('all');
  const categoryId = await page.getByLabel('Category filter').inputValue();
  await page.reload();
  await expect(page.getByLabel('Category filter')).toHaveValue(categoryId);
  await expect(page.locator('tbody .category-tag').first()).toHaveText('Dental supplies');
  await page.goto('./#/transactions?category=not-a-category');
  await expect(page.getByLabel('Category filter')).toHaveValue('all');
});

test('bulk edit saves exactly the visible selection and retains simulated activity', async ({
  page,
}) => {
  await page.goto('./#/transactions');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  await page.getByRole('button', { name: 'Simulate update', exact: true }).click();
  const before = await savedState(page);
  const visibleCount = await page.locator('tbody tr').count();
  await page
    .getByRole('checkbox', { name: 'Select all visible transactions', exact: true })
    .check();
  await expect(
    page.getByText(`${visibleCount} selected on this page`, { exact: true }),
  ).toBeVisible();
  await page
    .getByLabel('Category for selected transactions')
    .selectOption({ label: 'Miscellaneous business expenses' });
  await page.getByRole('button', { name: 'Save selected categories', exact: true }).click();
  await expect(
    page.getByText(`Category saved for ${visibleCount} transactions.`, { exact: true }),
  ).toBeVisible();
  await expect(page.getByText('0 selected on this page', { exact: true })).toBeVisible();
  await expect(page.locator('tbody .category-tag')).toHaveText(
    Array(visibleCount).fill('Miscellaneous business expenses'),
  );
  const after = await savedState(page);
  expect(after.paused).toBe(before.paused);
  expect(after.sequence).toBe(before.sequence);
  expect(after.lastUpdatedAt).toBe(before.lastUpdatedAt);
  expect(after.dataset.accounts).toEqual(before.dataset.accounts);
  expect(
    after.dataset.transactions.filter((transaction) => transaction.categorySource === 'manual'),
  ).toHaveLength(visibleCount);
  await page.reload();
  await expect(page.locator('tbody .category-tag')).toHaveText(
    Array(visibleCount).fill('Miscellaneous business expenses'),
  );
  await expect(page.getByRole('button', { name: 'Resume', exact: true })).toBeVisible();
});

test('matching merchant edit changes posted entries of one direction only', async ({ page }) => {
  await page.goto('./#/transactions');
  await page.getByRole('button', { name: 'Pause', exact: true }).click();
  const before = await savedState(page);
  await page.getByLabel('Search transactions').fill('Tyro');
  await page.getByLabel('Status filter').selectOption('posted');
  await page.locator('.transaction-link').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog.getByRole('heading')).toHaveText('Tyro · Demo');
  await dialog
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption({ label: 'Interest income' });
  const matching = before.dataset.transactions.filter(
    (transaction) =>
      transaction.merchant === 'Tyro · Demo' &&
      transaction.status === 'posted' &&
      transaction.amountCents > 0,
  );
  await dialog
    .getByRole('checkbox', {
      name: new RegExp(`Apply to all ${matching.length} matching posted transactions`),
    })
    .check();
  await dialog.getByRole('button', { name: 'Save category', exact: true }).click();
  await expect(
    dialog.getByText(`Category saved for ${matching.length} matching transactions.`, {
      exact: true,
    }),
  ).toBeVisible();
  const after = await savedState(page);
  const categoryId = after.dataset.categories.find(
    (category) => category.name === 'Interest income',
  )!.id;
  const matchingIds = new Set(matching.map((transaction) => transaction.id));
  for (const transaction of after.dataset.transactions) {
    if (matchingIds.has(transaction.id)) {
      expect(transaction.categoryId).toBe(categoryId);
      expect(transaction.categorySource).toBe('manual');
    } else {
      expect(transaction).toEqual(
        before.dataset.transactions.find((original) => original.id === transaction.id),
      );
    }
  }
});

test('transfer CSV exports classify both matched legs as transfers', async ({ page }) => {
  await page.goto('./#/transactions?review=transfers');
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    page.getByRole('button', { name: 'Export', exact: true }).click(),
  ]);
  const stream = await download.createReadStream();
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(Buffer.from(chunk));
  const lines = Buffer.concat(chunks).toString('utf8').trim().split('\r\n').slice(1);
  expect(lines.length).toBeGreaterThan(0);
  for (const line of lines) expect(line).toMatch(/,Transfer,posted$/);
});
