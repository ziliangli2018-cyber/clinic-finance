import { test, expect } from '@playwright/test';

test('monthly budgets can be created, edited, scoped, reloaded and removed', async ({ page }) => {
  await page.goto('./#/budgets');
  await page.getByRole('button', { name: 'New budget', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kilcoy supplies allowance');
  await page.getByLabel('Monthly limit (AUD)').fill('4000');
  await page.getByLabel('Entity', { exact: true }).selectOption({ label: 'Kilcoy' });
  await page.getByLabel('Category', { exact: true }).selectOption({ label: 'Dental supplies' });
  await page.getByRole('button', { name: 'Save budget', exact: true }).click();
  await expect(
    page.getByRole('status').filter({ hasText: 'Kilcoy supplies allowance saved.' }),
  ).toBeVisible();
  await page.reload();
  const card = page.locator('.mp-plan-card').filter({ hasText: 'Kilcoy supplies allowance' });
  await expect(card).toBeVisible();
  await expect(card).toContainText('$4,000.00');
  await page.getByRole('button', { name: 'Edit Kilcoy supplies allowance' }).click();
  await page.getByLabel('Monthly limit (AUD)').fill('4500');
  await page.getByRole('button', { name: 'Save budget', exact: true }).click();
  await expect(card).toContainText('$4,500.00');
  await page.getByLabel('Plan scope').selectOption({ label: 'Burpengary' });
  await expect(card).toHaveCount(0);
  await page.getByLabel('Plan scope').selectOption({ label: 'Kilcoy' });
  await page.getByRole('button', { name: 'Remove Kilcoy supplies allowance' }).click();
  await card.getByRole('button', { name: 'Remove', exact: true }).click();
  await expect(card).toHaveCount(0);
});

test('manual savings goals persist and account-linked goals follow cash balances', async ({
  page,
}) => {
  await page.goto('./#/goals');
  await page.getByRole('button', { name: 'New goal', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Equipment fund');
  await page.getByLabel('Target amount (AUD)').fill('20000');
  await page.getByLabel('Saved so far (AUD)').fill('5000');
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
  await page.reload();
  const card = page.locator('.mp-plan-card').filter({ hasText: 'Equipment fund' });
  await expect(card).toContainText('$5,000.00');
  await expect(card.getByRole('progressbar')).toHaveAttribute('aria-valuenow', '25');
  await page.getByRole('button', { name: 'Edit Equipment fund' }).click();
  await page
    .getByLabel('Linked account', { exact: true })
    .selectOption({ label: 'Kilcoy · Kilcoy reserve' });
  await page.getByRole('button', { name: 'Save goal', exact: true }).click();
  await expect(card).toContainText("Following Kilcoy reserve's current balance.");
});

test('bill schedules persist, include repeated payments and show detected suggestions', async ({
  page,
}) => {
  await page.goto('./#/bills');
  await expect(page.getByRole('heading', { name: 'Recurring payment suggestions' })).toBeVisible();
  await expect(page.locator('.mp-detected-card').first()).toBeVisible();
  await page.getByRole('button', { name: 'New bill', exact: true }).click();
  await page.getByLabel('Name', { exact: true }).fill('Kilcoy cleaning');
  await page.getByLabel('Amount per payment (AUD)').fill('250');
  await page.getByLabel('Entity', { exact: true }).selectOption({ label: 'Kilcoy' });
  await page.getByLabel('Next due date').fill('2026-09-21');
  await page.getByLabel('Frequency', { exact: true }).selectOption('weekly');
  await page.getByRole('button', { name: 'Save bill', exact: true }).click();
  await page.getByLabel('Look ahead').selectOption('30');
  await page.reload();
  const row = page.locator('.mp-bill-row').filter({ hasText: 'Kilcoy cleaning' });
  await expect(row).toBeVisible();
  await expect(row).toContainText('$250.00');
  await expect(row).toContainText('5 payments in this view');
});

test('planning pages are responsive and insights drill into the ledger', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  for (const route of ['budgets', 'bills', 'goals', 'insights']) {
    await page.goto(`./#/${route}`);
    await expect(page.locator('.money-planning')).toBeVisible();
    expect(
      await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth),
    ).toBe(true);
  }
  await expect(page.locator('.mp-insight-card').first()).toBeVisible();
  await page.locator('.mp-insight-card a').first().click();
  expect(page.url()).toMatch(/#\/(transactions|bills|budgets|accounts)/);
});
