import { test, expect } from '@playwright/test';
import { createMockDataset } from '../../src/domain/mock';

test('an active consent automatically imports and displays bank balances and transactions', async ({
  page,
}) => {
  const fixture = createMockDataset();
  const organisation = { ...fixture.organisation, isDemo: false };
  const entity = fixture.entities[0];
  const accounts = fixture.accounts.filter((row) => row.entityId === entity.id).slice(0, 2);
  const today = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Australia/Brisbane',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).format(new Date());
  const transactions = fixture.transactions
    .filter((row) => row.accountId === accounts[0].id)
    .slice(0, 3)
    .map((row) => ({ ...row, postedAt: today }));
  const connection = fixture.connections.find((row) => row.entityId === entity.id)!;
  const userId = '12345678-1234-4123-8123-123456789012';
  const expiresAt = Math.floor(Date.now() / 1000) + 3600;
  const user = {
    id: userId,
    aud: 'authenticated',
    role: 'authenticated',
    email: 'owner@example.invalid',
    app_metadata: {},
    user_metadata: {},
    created_at: new Date().toISOString(),
  };
  const accessToken = `${Buffer.from(JSON.stringify({ alg: 'HS256', typ: 'JWT' })).toString('base64url')}.${Buffer.from(JSON.stringify({ sub: userId, aud: 'authenticated', role: 'authenticated', exp: expiresAt })).toString('base64url')}.synthetic-signature`;
  let imported = false;
  let imports = 0;
  const snake = (row: object) =>
    Object.fromEntries(
      Object.entries(row).map(([key, value]) => [
        key.replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`),
        value,
      ]),
    );

  await page.route('https://ci-example.supabase.co/**', async (route) => {
    const url = new URL(route.request().url());
    let body: unknown;
    if (url.pathname === '/auth/v1/token') {
      body = {
        access_token: accessToken,
        token_type: 'bearer',
        expires_in: 3600,
        expires_at: expiresAt,
        refresh_token: 'synthetic-refresh-token',
        user,
      };
    } else if (url.pathname === '/auth/v1/user') body = user;
    else if (url.pathname === '/functions/v1/bank-sync') {
      imports += 1;
      imported = true;
      body = {
        entityId: entity.id,
        syncedAccounts: accounts.length,
        syncedTransactions: transactions.length,
      };
    } else if (url.pathname === '/functions/v1/bank-connect') {
      const request = route.request().postDataJSON();
      const active = request.entityId === entity.id;
      body = {
        entityId: request.entityId,
        configured: active,
        provider: 'basiq',
        connectionState: active ? 'active' : 'not_connected',
        connections: active
          ? [
              {
                id: connection.id,
                institutionId: 'AU01001',
                institutionName: 'NAB',
                state: 'active',
                lastSyncedAt: imported ? '2026-10-13T01:00:00Z' : null,
                consentExpiresAt: '2027-10-01T00:00:00Z',
              },
            ]
          : [],
        lastSyncedAt: imported && active ? '2026-10-13T01:00:00Z' : null,
        consentExpiresAt: active ? '2027-10-01T00:00:00Z' : null,
        automaticSync: false,
      };
    } else if (url.pathname.startsWith('/rest/v1/')) {
      const table = url.pathname.split('/').at(-1);
      const rows: Record<string, object[]> = {
        organisations: [organisation],
        entities: fixture.entities,
        bank_connections: imported
          ? [{ ...connection, provider: 'basiq', lastSyncedAt: '2026-10-13T01:00:00Z' }]
          : [],
        accounts: imported ? accounts : [],
        categories: fixture.categories,
        transactions: imported ? transactions : [],
        finance_plans: [],
      };
      if (!table || !(table in rows)) throw new Error(`Unexpected mocked table: ${table}`);
      body = rows[table].map(snake);
    } else throw new Error(`Unexpected mocked API path: ${url.pathname}`);
    await route.fulfill({
      status: 200,
      contentType: 'application/json',
      body: JSON.stringify(body),
    });
  });

  // Another tab may have selected CSV while the bank consent tab was away.
  // A genuine pending return must still open the owned bank import flow.
  await page.addInitScript(
    ({ organisationId, entityId }) => {
      localStorage.setItem('clinic-finance.workspace-source', 'csv');
      sessionStorage.setItem(
        'clinic-finance.bank-consent-return',
        JSON.stringify({ organisationId, entityId, startedAt: Date.now() }),
      );
    },
    { organisationId: organisation.id, entityId: entity.id },
  );
  await page.goto('./#/settings');
  await page.getByLabel('Email address').fill(user.email);
  await page.getByLabel('Password', { exact: true }).fill('Synthetic-test-password-123');
  await page.getByRole('button', { name: 'Sign in', exact: true }).click();
  await expect(
    page.getByText('Bank balances and transactions imported.', { exact: true }),
  ).toBeVisible();
  expect(imports).toBe(1);
  await expect(page.getByLabel('Workspace data source')).toHaveValue('bank');
  await page.getByRole('link', { name: 'Accounts', exact: true }).click();
  await expect(page.locator('.account-card')).toHaveCount(accounts.length);
  await expect(page.locator('.account-card').first()).toContainText('Kilcoy operating');
  await expect(page.locator('.account-card').first()).toContainText('$85,511.68');
  await page
    .locator('.account-card')
    .first()
    .getByRole('button', { name: 'Transactions', exact: true })
    .click();
  await expect(page.locator('tbody tr').first()).toBeVisible();
  expect(imports).toBe(1);
});
