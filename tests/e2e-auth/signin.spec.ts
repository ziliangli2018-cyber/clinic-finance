import { test as base, expect } from '@playwright/test';
import type { Page } from '@playwright/test';

const test = base.extend<{ checkBrowser: void }>({
  checkBrowser: [
    async ({ page }, use) => {
      const errors: string[] = [];
      const apiRequests: string[] = [];
      page.on('pageerror', (error) => errors.push(error.message));
      page.on('console', (message) => {
        if (message.type() === 'error') errors.push(message.text());
      });
      // No hosted credentials or backend are needed for signed-out access checks.
      // Block API traffic so a regression cannot contact an actual auth service.
      await page.route('**/*', async (route) => {
        const request = route.request();
        if (['fetch', 'xhr'].includes(request.resourceType())) {
          apiRequests.push(`${request.method()} ${request.url()}`);
          await route.fulfill({
            status: 503,
            contentType: 'application/json',
            body: '{"error":"Unexpected API request in signed-out test"}',
          });
        } else if (new URL(request.url()).hostname === 'fonts.googleapis.com') {
          await route.fulfill({ contentType: 'text/css', body: '' });
        } else {
          await route.continue();
        }
      });
      await use();
      expect(apiRequests, 'Signed-out visitors must not request auth or financial data').toEqual(
        [],
      );
      expect(errors, 'The sign-in screen must render without browser errors').toEqual([]);
    },
    { auto: true },
  ],
});

async function expectSignedOut(page: Page) {
  await expect(page.getByRole('heading', { name: 'Welcome back', exact: true })).toBeVisible();
  await expect(page.getByLabel('Email address', { exact: true })).toBeVisible();
  await expect(page.getByLabel('Password', { exact: true })).toHaveAttribute('type', 'password');
  await expect(page.getByRole('button', { name: 'Sign in', exact: true })).toBeVisible();
  await expect(page.getByRole('navigation', { name: 'Main navigation' })).toHaveCount(0);
  await expect(
    page.locator('.app-shell, .metric-card, .account-card, .transaction-link'),
  ).toHaveCount(0);
  await expect(
    page.getByRole('heading', { name: /^(Financial overview|Accounts|Transactions|Analytics)$/ }),
  ).toHaveCount(0);
  await expect(page.getByText('Banksia Dental Group', { exact: true })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /create.*account|new here/i })).toHaveCount(0);
  await expect(page.getByRole('heading', { name: 'Create your account', exact: true })).toHaveCount(
    0,
  );
}

test('hosted app requires sign-in and offers no public registration', async ({ page }) => {
  await page.goto('./');
  await expectSignedOut(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await expectSignedOut(page);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(
    true,
  );
});

test('protected Pages deep links and reloads remain behind sign-in', async ({ page }) => {
  for (const path of [
    'accounts',
    'transactions?account=private-account&review=uncategorised',
    'analytics',
    'settings',
  ]) {
    await page.goto(`./#/${path}`);
    await expectSignedOut(page);
    await page.reload();
    await expectSignedOut(page);
  }
});

test('hash navigation and browser history cannot reveal the workspace', async ({ page }) => {
  await page.goto('./');
  await expectSignedOut(page);
  await page.evaluate(() => {
    window.location.hash = '/accounts';
  });
  await expect(page).toHaveURL(/#\/accounts$/);
  await expectSignedOut(page);
  await page.evaluate(() => {
    window.location.hash = '/transactions';
  });
  await expect(page).toHaveURL(/#\/transactions$/);
  await expectSignedOut(page);
  await page.goBack();
  await expect(page).toHaveURL(/#\/accounts$/);
  await expectSignedOut(page);
  await page.goForward();
  await expect(page).toHaveURL(/#\/transactions$/);
  await expectSignedOut(page);
});
