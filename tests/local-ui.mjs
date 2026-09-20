// Requires local Supabase, Edge Functions and npm run dev on 127.0.0.1:5173.
// Uses new fictitious local users; never runs against a hosted backend.
import { chromium, expect } from '@playwright/test';
import { randomUUID } from 'node:crypto';
import assert from 'node:assert/strict';
import { loadEnv } from 'vite';
const localConfig = loadEnv('development', process.cwd(), 'VITE_');
assert.equal(localConfig.VITE_DATA_MODE, 'supabase');
assert.match(localConfig.VITE_SUPABASE_URL, /^http:\/\/(127\.0\.0\.1|localhost):54321$/);
const browser = await chromium.launch();
try {
  const page = await browser.newPage({ viewport: { width: 1440, height: 1000 } });
  const errors = [];
  page.on('pageerror', (error) => errors.push(error.message));
  await page.goto('http://127.0.0.1:5173/');
  await page.getByRole('button', { name: 'New here? Create an account' }).click();
  await page.getByLabel('Email address').fill(`browser-${randomUUID()}@example.invalid`);
  await page.getByLabel('Password', { exact: true }).fill(`Demo-${randomUUID()}!`);
  await page.getByRole('button', { name: 'Create account', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Make room for a clearer picture' })).toBeVisible({
    timeout: 15000,
  });
  await page.getByLabel('Organisation name').fill('Local Demo Clinic Group');
  await page.getByRole('button', { name: 'Create demo workspace' }).click();
  await expect(page.locator('.metric-card')).toHaveCount(4, { timeout: 30000 });
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Personal', exact: true }).click();
  await expect(page.locator('.account-card')).toHaveCount(2);
  await expect(page.getByRole('heading', { name: 'Personal credit card' })).toBeVisible();
  await page.getByRole('button', { name: 'Refresh data' }).click();
  await expect(page.getByRole('button', { name: 'Refresh data' })).toBeEnabled({ timeout: 20000 });
  await page.reload();
  await expect(page.locator('.account-card')).toHaveCount(6);
  await page.getByRole('button', { name: 'Sign out', exact: true }).click();
  await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible();
  expect(errors).toEqual([]);
  console.log(
    'PASS: browser signup, organisation onboarding, server mock sync, personal credit card, refresh persistence, session reload and sign out.',
  );
} finally {
  await browser.close();
}
