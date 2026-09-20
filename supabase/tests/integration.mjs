// Real local Auth + REST + Edge integration. Only public configuration is used.
// Creates isolated fictitious test users/tenants in the LOCAL Supabase stack.
import { readFileSync } from 'node:fs';
import assert from 'node:assert/strict';
import { randomUUID } from 'node:crypto';
import { createClient } from '@supabase/supabase-js';

const env = Object.fromEntries(readFileSync('.env.local', 'utf8').split(/\r?\n/)
  .filter((line) => line && !line.startsWith('#')).map((line) => [line.slice(0, line.indexOf('=')), line.slice(line.indexOf('=') + 1)]));
const url = env.VITE_SUPABASE_URL;
assert.match(url, /^http:\/\/(127\.0\.0\.1|localhost):54321$/, 'Integration fixtures are permitted only on local Supabase');
const key = env.VITE_SUPABASE_PUBLISHABLE_KEY;
const client = () => createClient(url, key, { auth: { persistSession: false, autoRefreshToken: false } });
const owner = client();
const other = client();
const anonymous = client();
const suffix = randomUUID();
const password = `Local-test-${randomUUID()}!`;

async function callOk(label, promise) {
  const result = await promise;
  if (result.error) throw new Error(`${label}: ${result.error.message}`);
  return result.data;
}
async function functionStatus(client, name, body) {
  const result = await client.functions.invoke(name, { body });
  return result.error?.context?.status ?? 200;
}

await callOk('owner sign up', owner.auth.signUp({ email: `owner-${suffix}@example.invalid`, password }));
await callOk('other sign up', other.auth.signUp({ email: `other-${suffix}@example.invalid`, password }));
const orgId = await callOk('owner demo onboarding', owner.rpc('create_demo_organisation', { name: 'Integration Test Clinic' }));
const repeatedOrgId = await callOk('repeat onboarding', owner.rpc('create_demo_organisation', { name: 'Repeat' }));
assert.equal(orgId, repeatedOrgId);
await callOk('other demo onboarding', other.rpc('create_demo_organisation', { name: 'Isolated Test Clinic' }));
assert.equal(await functionStatus(anonymous, 'bank-sync', { organisationId: orgId }), 401);
assert.equal(await functionStatus(other, 'bank-sync', { organisationId: orgId }), 403);
const sync = await callOk('initial bank sync', owner.functions.invoke('bank-sync', { body: { organisationId: orgId } }));
assert.equal(sync.syncedAccounts, 8);
assert.ok(sync.syncedTransactions > 100);
const transactions = await callOk('read transactions', owner.from('transactions').select('*').eq('organisation_id', orgId));
assert.equal(transactions.length, sync.syncedTransactions);
const categories = await callOk('read categories', owner.from('categories').select('id'));
const target = transactions.find((row) => row.transfer_pair_id === null);
const category = categories.find((row) => row.id !== target.category_id);
await callOk('manual category', owner.rpc('set_transaction_category', { transaction_id: target.id, category_id: category.id }));
await callOk('repeat bank sync', owner.functions.invoke('bank-sync', { body: { organisationId: orgId } }));
const after = await callOk('read after repeat', owner.from('transactions').select('*').eq('organisation_id', orgId));
assert.equal(after.length, transactions.length, 'Retry must not duplicate transactions');
assert.equal(after.find((row) => row.id === target.id).category_id, category.id, 'Retry must preserve manual category');
assert.equal(after.find((row) => row.id === target.id).category_source, 'manual');
assert.deepEqual(await callOk('cross-tenant read', other.from('transactions').select('id').eq('organisation_id', orgId)), []);
const forbiddenCategory = await other.rpc('set_transaction_category', { transaction_id: target.id, category_id: category.id });
assert.equal(forbiddenCategory.error?.code, '42501');
const forbiddenWrite = await owner.from('transactions').update({ amount_cents: 0 }).eq('id', target.id);
assert.equal(forbiddenWrite.error?.code, '42501');
const forgedIngest = await owner.rpc('ingest_mock_dataset', { organisation_id: orgId, actor_user_id: randomUUID(), dataset: {} });
assert.equal(forgedIngest.error?.code, '42501');
for (const feature of ['receipt-processing', 'economic-data-sync', 'transaction-processing']) {
  assert.equal(await functionStatus(owner, feature, { organisationId: orgId }), 501);
  assert.equal(await functionStatus(anonymous, feature, { organisationId: orgId }), 401);
  assert.equal(await functionStatus(other, feature, { organisationId: orgId }), 403);
}
await owner.auth.signOut();
await other.auth.signOut();
console.log(`PASS: local Auth, idempotent onboarding, 8 accounts / ${transactions.length} transactions, sync retries, category preservation, cross-tenant authorization and future endpoint 501s.`);
