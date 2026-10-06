import { Basiq, cents, classifyTransaction, stableId, transactionAmount } from './basiq.ts';

function assert(condition: unknown, message: string): asserts condition {
  if (!condition) throw new Error(message);
}

function json(value: unknown, status = 200) {
  return new Response(JSON.stringify(value), {
    status,
    headers: { 'Content-Type': 'application/json' },
  });
}

Deno.test('bank money conversion preserves exact integer cents', () => {
  assert(cents('584000.00') === 58_400_000, 'string amount was not converted');
  assert(cents(-18.55) === -1855, 'numeric amount was not converted');
  assert(
    transactionAmount({ amount: '-1855.00', direction: 'debit' }) === -185_500,
    'debit sign changed',
  );
  for (const invalid of ['1.001', Number.NaN, Number.MAX_VALUE]) {
    let rejected = false;
    try {
      cents(invalid);
    } catch {
      rejected = true;
    }
    assert(rejected, `accepted invalid amount ${String(invalid)}`);
  }
});

Deno.test('Basiq identifiers are deterministic and isolated by organisation', async () => {
  const first = await stableId('organisation-a', 'account:one');
  assert(first === (await stableId('organisation-a', 'account:one')), 'identifier changed');
  assert(first !== (await stableId('organisation-b', 'account:one')), 'tenant IDs collided');
  assert(
    /^[\da-f]{8}-[\da-f]{4}-5[\da-f]{3}-[89ab][\da-f]{3}-[\da-f]{12}$/.test(first),
    'not a UUIDv5-shaped identifier',
  );
});

Deno.test('transaction rules classify common clinic cash flows without guessing unknowns', () => {
  assert(
    classifyTransaction('HICAPS HEALTH FUND SETTLEMENT', 92_500).category_id ===
      'a7858a97-f8bf-450d-a57d-bdc9712b42e7',
    'health-fund receipt was not classified',
  );
  assert(
    classifyTransaction('TYRO MERCHANT FEE', -8_600).category_id ===
      '31fec648-65b4-417e-a245-6282f83dbcf8',
    'merchant fee was mistaken for a patient receipt',
  );
  assert(
    classifyTransaction('BOQ SPECIALIST INTEREST', -185_500).category_id ===
      '2f0252c7-c573-46bd-acba-3531ee5cb477',
    'loan interest was not classified as an expense',
  );
  const unknown = classifyTransaction('UNRECOGNISED COUNTERPARTY', -1_200);
  assert(unknown.category_id === null, 'unknown transaction was guessed');
  assert(unknown.category_source === 'uncategorised', 'unknown source was not preserved');
});

Deno.test('snapshot accepts a BOQ Specialist loan without treating it as cash', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input, init) => {
    const url = String(input);
    calls.push(`${init?.method ?? 'GET'} ${url}`);
    if (url.endsWith('/token'))
      return json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600 });
    if (url.includes('/consents'))
      return json({
        data: [
          {
            id: 'consent-one',
            status: 'active',
            expiryDate: '2027-09-01T00:00:00Z',
            data: {
              permissions: ['account.basic', 'account.detail', 'transaction.detail'].map(
                (scope) => ({ scope, consented: true }),
              ),
            },
          },
        ],
        links: { next: null },
      });
    if (url.includes('/connections'))
      return json({
        data: [
          {
            id: 'connection-boqs',
            institution: { id: 'AU20130', shortName: 'BOQ Specialist' },
            method: 'open-banking',
            status: 'active',
            expiryDate: '2027-09-01T00:00:00Z',
            lastUpdated: '2026-10-06T01:00:00Z',
          },
        ],
        links: { next: null },
      });
    if (url.includes('/accounts'))
      return json({
        data: [
          {
            id: 'loan-one',
            connection: 'connection-boqs',
            institution: 'AU20130',
            name: 'Practice loan',
            class: { type: 'loan' },
            currency: 'AUD',
            balance: '584000.00',
            availableFunds: null,
            accountNo: '124567892217',
            status: 'available',
            isOwned: true,
            lastUpdated: '2026-10-06T01:00:00Z',
          },
        ],
        links: { next: null },
      });
    if (url.includes('/transactions'))
      return json({
        data: [
          {
            id: 'repayment-one',
            account: 'loan-one',
            connection: 'connection-boqs',
            institution: 'AU20130',
            currency: 'AUD',
            status: 'posted',
            postDate: '2026-10-01',
            description: 'Practice loan repayment',
            amount: '-1855.00',
            direction: 'debit',
          },
        ],
        links: { next: null },
      });
    return json({}, 404);
  };
  const client = new Basiq(
    {
      apiKey: 'synthetic-key',
      allowedInstitutionIds: ['AU01001', 'AU20130'],
      automaticSync: true,
      businessProfile: {},
    },
    fetcher,
    () => Date.parse('2026-10-06T00:00:00Z'),
  );
  const snapshot = await client.snapshot('business-user', '00000000-0000-4000-8000-000000000001');
  assert(snapshot.connectionState === 'active', 'connection was not active');
  assert(snapshot.accounts.length === 1, 'loan was not imported');
  assert(snapshot.accounts[0].kind === 'loan', 'loan class was not retained');
  assert(snapshot.accounts[0].balance_cents === -58_400_000, 'loan was not a liability');
  assert(snapshot.accounts[0].masked_number === '•••• 2217', 'account number was not masked');
  assert(snapshot.transactions[0].amount_cents === -185_500, 'repayment changed value');
  assert(
    snapshot.transactions[0].category_id === '210ec3ae-8e0b-4e4c-a942-e188137d06de',
    'loan repayment rule was not applied',
  );
  assert(
    calls.filter((call) => call.includes('/token')).length === 1,
    'server token was not cached',
  );
});

Deno.test('manual refresh uses the refresh-all endpoint and job steps', async () => {
  const calls: string[] = [];
  const fetcher: typeof fetch = async (input) => {
    const url = String(input);
    calls.push(url);
    if (url.endsWith('/token'))
      return json({ access_token: 'synthetic-token', token_type: 'Bearer', expires_in: 3600 });
    if (url.endsWith('/connections/refresh'))
      return json({ type: 'list', data: [{ type: 'job', id: 'refresh-job' }] }, 202);
    if (url.endsWith('/jobs/refresh-job'))
      return json({
        type: 'job',
        id: 'refresh-job',
        steps: [
          { title: 'retrieve-accounts', status: 'success', result: {} },
          { title: 'retrieve-transactions', status: 'success', result: {} },
        ],
      });
    return json({}, 404);
  };
  const client = new Basiq(
    {
      apiKey: 'synthetic-key',
      allowedInstitutionIds: ['AU01001'],
      automaticSync: false,
      businessProfile: {},
    },
    fetcher,
  );
  await client.refreshUser('business-user');
  assert(
    calls.some((url) => url.endsWith('/users/business-user/connections/refresh')),
    'refresh-all endpoint was not used',
  );
  assert(
    calls.some((url) => url.endsWith('/jobs/refresh-job')),
    'refresh job was not checked',
  );
});
