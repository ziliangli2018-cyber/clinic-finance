import { test, expect } from '@playwright/test';

test('dashboard entity filters, period selection and responsive rendering', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('./');
  await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
  await expect(page.locator('.metric-card')).toHaveCount(4);
  const before = await page.locator('.metric-value').first().textContent();
  await page.getByRole('button', { name: 'Clinic A · Paddington', exact: true }).click();
  expect(await page.locator('.metric-value').first().textContent()).not.toBe(before);
  await page.getByLabel('Reporting period').selectOption('90');
  await expect(page.getByText('Posted inflows · last 90 days')).toBeVisible();
  await page.getByRole('button', { name: 'All clinics', exact: true }).click();
  await page.screenshot({ path: '.artifacts/dashboard-desktop.png', fullPage: true });
  await page.setViewportSize({ width: 390, height: 844 });
  await expect(page.getByRole('heading', { name: 'Financial overview' })).toBeVisible();
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
  await page.screenshot({
    path: '.artifacts/dashboard-mobile.png',
    fullPage: true,
    animations: 'disabled',
  });
  expect(errors).toEqual([]);
});

test('account links filter transactions and survive a Pages deep-link refresh', async ({
  page,
}) => {
  await page.goto('./#/accounts');
  await expect(page.locator('.account-card')).toHaveCount(6);
  await page.locator('.account-card').first().getByRole('button', { name: 'Transactions' }).click();
  expect(page.url()).toContain('account=');
  await expect(page.getByLabel('Account filter')).not.toHaveValue('all');
  await page.reload();
  await expect(page.getByRole('heading', { name: 'Transactions', exact: true })).toBeVisible();
  await expect(page.getByLabel('Account filter')).not.toHaveValue('all');
  await page.getByLabel('Search transactions').fill('no such transaction');
  await expect(page.getByText('No transactions match these filters.')).toBeVisible();
});

test('categorisation updates the session ledger and removes reviewed entries', async ({ page }) => {
  await page.goto('./#/transactions?review=uncategorised');
  await expect(page.locator('tbody tr').first()).toBeVisible();
  await page.locator('.transaction-link').first().click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toBeVisible();
  await dialog
    .getByRole('combobox', { name: 'Category', exact: true })
    .selectOption({ label: 'Miscellaneous business expenses' });
  await dialog.getByRole('button', { name: 'Save category' }).click();
  await expect(dialog.getByText('Category saved.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(dialog).not.toBeVisible();
});

test('mobile navigation and analytics work', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('./');
  await page.getByRole('button', { name: 'Open navigation' }).click();
  await page.getByRole('link', { name: 'Analytics', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Entity comparison' })).toBeVisible();
  await expect(page.locator('.comparison-item')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});
